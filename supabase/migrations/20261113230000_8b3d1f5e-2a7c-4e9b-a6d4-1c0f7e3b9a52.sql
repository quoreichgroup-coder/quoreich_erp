-- Jumelle Supabase de services/api/src/main/resources/db/migration/V35__conversion_demande_en_commande.sql (même SQL exécutable).
-- V35 — Conversion d'une demande d'achat en commande. Écrit à la main.
--
-- Constaté par les parcours de bout en bout (tests/e2e/parcours/20-achats.spec.ts, 13 nov. 2026) :
-- convert_pr_to_po échouait à CHAQUE appel — elle insérait une valeur dans po_lines.total, colonne
-- calculée (quantité × coût) : « cannot insert a non-DEFAULT value into column "total" ». Aucune
-- demande approuvée ne pouvait devenir une commande.
--
-- Corrigé au passage :
--   - numéro de commande tiré au hasard (PO-AAAA-nnnn, collisions possibles) → séquence de la table
--     (valeur par défaut de purchase_orders.po_number), comme une commande saisie ;
--   - fournisseur non contrôlé : il doit appartenir à la société de l'utilisateur ;
--   - messages en français, codes SQLSTATE explicites (42501 droit, 22023 donnée, 23514 état).
-- Signature, droits d'exécution et notification inchangés.
--
-- Jumelle : supabase/migrations/20261113230000_8b3d1f5e-2a7c-4e9b-a6d4-1c0f7e3b9a52.sql

CREATE OR REPLACE FUNCTION public.convert_pr_to_po(_pr_id uuid, _supplier_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _pr public.purchase_requisitions%ROWTYPE;
  _po_id uuid;
  _po_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_procurement_perm(auth.uid(), 'convert') THEN
    RAISE EXCEPTION 'Droit insuffisant : la conversion d''une demande en commande est réservée au contrôleur des achats ou à un approbateur de niveau 2 et plus'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _pr FROM public.purchase_requisitions WHERE id = _pr_id FOR UPDATE;
  IF NOT FOUND OR _pr.tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'Demande d''achat introuvable' USING ERRCODE = '22023';
  END IF;
  IF _pr.status <> 'approved' THEN
    RAISE EXCEPTION 'La demande % doit être approuvée pour être convertie (statut : %)', _pr.pr_number, _pr.status
      USING ERRCODE = '23514';
  END IF;
  IF _pr.po_id IS NOT NULL THEN
    RAISE EXCEPTION 'La demande % est déjà convertie en commande', _pr.pr_number USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = _supplier_id AND s.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Fournisseur introuvable dans la société' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.requisition_lines rl WHERE rl.requisition_id = _pr_id) THEN
    RAISE EXCEPTION 'La demande % n''a aucune ligne : rien à commander', _pr.pr_number USING ERRCODE = '23514';
  END IF;

  -- Numéro : séquence de la table (valeur par défaut de po_number).
  INSERT INTO public.purchase_orders (tenant_id, supplier_id, order_date, total, status, created_by)
  VALUES (_pr.tenant_id, _supplier_id, CURRENT_DATE, COALESCE(_pr.estimated_total, 0), 'draft', auth.uid())
  RETURNING id, po_number INTO _po_id, _po_number;

  -- total : colonne calculée par la base ; le total de la commande est recalculé par recompute_po_total.
  INSERT INTO public.po_lines (po_id, item_id, description, quantity, unit_cost)
  SELECT _po_id, rl.item_id, rl.description, rl.quantity, rl.estimated_unit_cost
    FROM public.requisition_lines rl WHERE rl.requisition_id = _pr_id;

  UPDATE public.purchase_requisitions SET po_id = _po_id, status = 'converted' WHERE id = _pr_id;

  PERFORM public.notify_procurement(_pr.tenant_id, 'info',
    'Demande convertie en commande', _pr.pr_number || ' → ' || _po_number, _po_id::text);
  RETURN _po_id;
END;
$function$;
