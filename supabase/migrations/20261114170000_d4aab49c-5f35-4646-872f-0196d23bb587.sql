-- V44 — Commande client créée depuis les lignes d'un devis du client (référence : SAP VA01 « créer
-- avec référence », Sage « transformation de pièce » ligne à ligne ; même logique que la réception
-- fournisseur V34 : tiers d'abord, puis SES pièces ouvertes, puis leurs lignes et quantités).
--
-- Avant V44, un devis se convertissait en bloc (toutes ses lignes, une fois) ; l'écran de commande
-- ne montrait pas les devis ouverts du client choisi. Désormais :
--   * chaque ligne de devis tient sa quantité déjà commandée (quote_lines.quantity_ordered) ;
--   * create_sales_order_from_quote(devis, lignes [{quote_line_id, quantity}], date) crée une
--     commande brouillon liée au devis, ligne à ligne (remise et TVA reprises), sans dépasser le
--     reste à commander ; le devis passe « partially_converted » puis « converted » ;
--   * la ligne de commande garde sa ligne de devis d'origine (so_lines.quote_line_id) ;
--   * confirm_quote_to_so (conversion complète, CRM) passe par la même fonction.

ALTER TABLE public.quote_lines ADD COLUMN quantity_ordered numeric NOT NULL DEFAULT 0;
ALTER TABLE public.so_lines ADD COLUMN quote_line_id uuid REFERENCES public.quote_lines(id);
CREATE INDEX so_lines_quote_line_id_idx ON public.so_lines (quote_line_id);

-- Historique : un devis déjà converti l'a été en totalité.
UPDATE public.quote_lines ql SET quantity_ordered = ql.quantity
  FROM public.quotations q
 WHERE q.id = ql.quotation_id AND q.status = 'converted';

CREATE OR REPLACE FUNCTION public.create_sales_order_from_quote(_quote_id uuid, _lines jsonb, _order_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _q public.quotations%ROWTYPE;
  _so_id uuid;
  _so_number text;
  _line jsonb;
  _ql public.quote_lines%ROWTYPE;
  _qty numeric;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'create') AND NOT public.has_sales_perm(auth.uid(), 'confirm') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _q FROM public.quotations WHERE id = _quote_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Devis introuvable dans la société active'; END IF;
  IF _q.status NOT IN ('draft', 'sent', 'accepted', 'partially_converted') THEN
    RAISE EXCEPTION 'Ce devis ne peut plus être transformé en commande (statut %)', _q.status USING ERRCODE = 'QG010';
  END IF;
  IF _q.valid_until IS NOT NULL AND _q.valid_until < CURRENT_DATE THEN
    RAISE EXCEPTION 'Devis % expiré le % : établir un nouveau devis', _q.quote_number, to_char(_q.valid_until, 'DD/MM/YYYY')
      USING ERRCODE = 'QG010';
  END IF;
  IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'Choisir au moins une ligne du devis' USING ERRCODE = 'QG010';
  END IF;

  INSERT INTO public.sales_orders (tenant_id, so_number, quotation_id, customer_id, order_date, total, status, created_by)
  VALUES (_tenant, '', _q.id, _q.customer_id, COALESCE(_order_date, CURRENT_DATE), 0, 'draft', auth.uid())
  RETURNING id, so_number INTO _so_id, _so_number;

  FOR _line IN SELECT value FROM jsonb_array_elements(_lines) WITH ORDINALITY AS t(value, n) ORDER BY n LOOP
    SELECT * INTO _ql FROM public.quote_lines
     WHERE id = NULLIF(_line->>'quote_line_id', '')::uuid AND quotation_id = _quote_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La ligne ne fait pas partie de ce devis' USING ERRCODE = 'QG010'; END IF;
    _qty := NULLIF(_line->>'quantity', '')::numeric;
    IF _qty IS NULL OR _qty <= 0 THEN
      RAISE EXCEPTION 'La quantité commandée doit être positive (%)', _ql.description USING ERRCODE = 'QG010';
    END IF;
    IF _ql.quantity_ordered + _qty > _ql.quantity THEN
      RAISE EXCEPTION 'Quantité supérieure au reste à commander pour « % » (reste %)', _ql.description,
        _ql.quantity - _ql.quantity_ordered USING ERRCODE = 'QG010';
    END IF;
    INSERT INTO public.so_lines (so_id, item_id, description, quantity, unit_price, discount_pct, tax_code_id, quote_line_id)
    VALUES (_so_id, _ql.item_id, _ql.description, _qty, _ql.unit_price, _ql.discount_pct,
            (SELECT id FROM public.tax_codes WHERE id = _ql.tax_code_id AND is_active), _ql.id);
    UPDATE public.quote_lines SET quantity_ordered = quantity_ordered + _qty WHERE id = _ql.id;
  END LOOP;

  UPDATE public.quotations
     SET status = CASE WHEN EXISTS (SELECT 1 FROM public.quote_lines WHERE quotation_id = _quote_id AND quantity_ordered < quantity)
                       THEN 'partially_converted' ELSE 'converted' END
   WHERE id = _quote_id;
  PERFORM public.notify_sales(_tenant, 'info', 'Commande créée depuis le devis', _q.quote_number || ' → ' || _so_number, _so_id::text);
  RETURN _so_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_sales_order_from_quote(uuid, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_order_from_quote(uuid, jsonb, date) TO authenticated;

-- Conversion complète (CRM, bouton « Convertir ») : tout le reste à commander.
CREATE OR REPLACE FUNCTION public.confirm_quote_to_so(_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _lines jsonb;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'confirm') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quotations WHERE id = _quote_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Devis introuvable dans la société active';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('quote_line_id', id, 'quantity', quantity - quantity_ordered) ORDER BY created_at, id)
    INTO _lines
    FROM public.quote_lines WHERE quotation_id = _quote_id AND quantity_ordered < quantity;
  IF _lines IS NULL THEN
    RAISE EXCEPTION 'Le devis n''a plus de ligne à commander' USING ERRCODE = 'QG010';
  END IF;
  RETURN public.create_sales_order_from_quote(_quote_id, _lines, CURRENT_DATE);
END;
$function$;
