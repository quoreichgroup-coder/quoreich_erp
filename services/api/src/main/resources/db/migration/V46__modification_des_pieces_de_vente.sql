-- V46 — Modifier et supprimer un devis ou une commande client tant qu'ils ne sont pas engagés.
--
-- V40 a retiré toute écriture directe sur les pièces de vente (à raison : numéros, totaux et statuts
-- relèvent de la base), sans fonction de modification : un devis créé ne pouvait plus être corrigé.
-- Référence SAP / Sage : une pièce se modifie tant qu'aucune pièce suivante ne la reprend.
--
--   * update_sales_quotation(devis, client, date, validité, lignes) et delete_sales_quotation(devis) :
--     devis en brouillon / envoyé / accepté dont aucune ligne n'a encore été commandée ;
--   * update_sales_order(commande, date, lignes) : commande en brouillon saisie librement (une
--     commande reprise d'un devis se supprime, elle ne se réécrit pas) ;
--   * delete_sales_order(commande) : commande en brouillon ; si elle venait d'un devis, les quantités
--     reprises sont rendues au devis, qui repasse « partially_converted » ou « sent ».
-- Mêmes contrôles de lignes que la création (V43 : remise 0–100 %, code TVA de la société, actif).

CREATE OR REPLACE FUNCTION public.update_sales_quotation(_quote_id uuid, _customer_id uuid, _quote_date date,
                                                        _valid_until date, _lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _q public.quotations%ROWTYPE;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'create') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _q FROM public.quotations WHERE id = _quote_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Devis introuvable dans la société active' USING ERRCODE = 'QG010'; END IF;
  IF _q.status NOT IN ('draft', 'sent', 'accepted')
     OR EXISTS (SELECT 1 FROM public.quote_lines WHERE quotation_id = _quote_id AND quantity_ordered > 0) THEN
    RAISE EXCEPTION 'Le devis % est déjà repris en commande : il ne se modifie plus', _q.quote_number USING ERRCODE = 'QG010';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = _customer_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Client introuvable dans la société active' USING ERRCODE = 'QG010';
  END IF;
  IF _quote_date IS NULL OR _valid_until IS NULL OR _valid_until < _quote_date THEN
    RAISE EXCEPTION 'La date de validité doit être égale ou postérieure à la date du devis' USING ERRCODE = 'QG010';
  END IF;
  PERFORM public.sales_check_lines(_tenant, _lines, 'du devis');
  UPDATE public.quotations SET customer_id = _customer_id, quote_date = _quote_date, valid_until = _valid_until
   WHERE id = _quote_id;
  DELETE FROM public.quote_lines WHERE quotation_id = _quote_id;
  INSERT INTO public.quote_lines (quotation_id, item_id, description, quantity, unit_price, discount_pct, tax_code_id)
  SELECT _quote_id, NULLIF(l->>'item_id', '')::uuid, btrim(l->>'description'), (l->>'quantity')::numeric,
         (l->>'unit_price')::numeric, COALESCE(NULLIF(l->>'discount_pct', '')::numeric, 0), NULLIF(l->>'tax_code_id', '')::uuid
    FROM jsonb_array_elements(_lines) WITH ORDINALITY AS t(l, n) ORDER BY n;
  RETURN _quote_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_sales_quotation(_quote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _q public.quotations%ROWTYPE;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'create') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _q FROM public.quotations WHERE id = _quote_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Devis introuvable dans la société active' USING ERRCODE = 'QG010'; END IF;
  IF _q.status NOT IN ('draft', 'sent', 'accepted', 'expired')
     OR EXISTS (SELECT 1 FROM public.quote_lines WHERE quotation_id = _quote_id AND quantity_ordered > 0)
     OR EXISTS (SELECT 1 FROM public.sales_orders WHERE quotation_id = _quote_id) THEN
    RAISE EXCEPTION 'Le devis % est repris en commande : il ne se supprime pas', _q.quote_number USING ERRCODE = 'QG010';
  END IF;
  -- Une opportunité CRM qui citait ce devis le perd (elle reste « gagnée »).
  UPDATE public.crm_opportunities SET converted_quotation_id = NULL WHERE converted_quotation_id = _quote_id;
  DELETE FROM public.quote_lines WHERE quotation_id = _quote_id;
  DELETE FROM public.quotations WHERE id = _quote_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_sales_order(_so_id uuid, _order_date date, _lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _s public.sales_orders%ROWTYPE;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'create') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _s FROM public.sales_orders WHERE id = _so_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable dans la société active' USING ERRCODE = 'QG010'; END IF;
  IF _s.status <> 'draft' THEN
    RAISE EXCEPTION 'Seule une commande en brouillon se modifie (statut %)', _s.status USING ERRCODE = 'QG010';
  END IF;
  IF _s.quotation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Commande reprise du devis : la supprimer puis la recréer depuis le devis' USING ERRCODE = 'QG010';
  END IF;
  IF _order_date IS NULL THEN RAISE EXCEPTION 'La date de commande est requise' USING ERRCODE = 'QG010'; END IF;
  PERFORM public.sales_check_lines(_tenant, _lines, 'de la commande');
  UPDATE public.sales_orders SET order_date = _order_date WHERE id = _so_id;
  DELETE FROM public.so_lines WHERE so_id = _so_id;
  INSERT INTO public.so_lines (so_id, item_id, description, quantity, unit_price, discount_pct, tax_code_id)
  SELECT _so_id, NULLIF(l->>'item_id', '')::uuid, btrim(l->>'description'), (l->>'quantity')::numeric,
         (l->>'unit_price')::numeric, COALESCE(NULLIF(l->>'discount_pct', '')::numeric, 0), NULLIF(l->>'tax_code_id', '')::uuid
    FROM jsonb_array_elements(_lines) WITH ORDINALITY AS t(l, n) ORDER BY n;
  RETURN _so_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_sales_order(_so_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _s public.sales_orders%ROWTYPE;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'create') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _s FROM public.sales_orders WHERE id = _so_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable dans la société active' USING ERRCODE = 'QG010'; END IF;
  IF _s.status <> 'draft' OR EXISTS (SELECT 1 FROM public.delivery_notes WHERE so_id = _so_id) THEN
    RAISE EXCEPTION 'Seule une commande en brouillon, sans livraison, se supprime (statut %)', _s.status USING ERRCODE = 'QG010';
  END IF;
  -- Quantités rendues au devis d'origine.
  UPDATE public.quote_lines ql SET quantity_ordered = GREATEST(ql.quantity_ordered - sl.quantity, 0)
    FROM public.so_lines sl WHERE sl.so_id = _so_id AND sl.quote_line_id = ql.id;
  IF _s.quotation_id IS NOT NULL THEN
    UPDATE public.quotations q
       SET status = CASE
             WHEN NOT EXISTS (SELECT 1 FROM public.quote_lines WHERE quotation_id = q.id AND quantity_ordered > 0) THEN 'sent'
             WHEN EXISTS (SELECT 1 FROM public.quote_lines WHERE quotation_id = q.id AND quantity_ordered < quantity) THEN 'partially_converted'
             ELSE 'converted' END
     WHERE q.id = _s.quotation_id;
  END IF;
  DELETE FROM public.so_lines WHERE so_id = _so_id;
  DELETE FROM public.sales_orders WHERE id = _so_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_sales_quotation(uuid, uuid, date, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_sales_quotation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_sales_order(uuid, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_sales_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_sales_quotation(uuid, uuid, date, date, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_sales_quotation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_sales_order(uuid, date, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_sales_order(uuid) TO authenticated;
