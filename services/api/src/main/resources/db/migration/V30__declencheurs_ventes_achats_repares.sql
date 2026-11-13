-- V30 — Ventes et achats : deux déclencheurs qui refusaient tout. Écrit à la main.
--
-- Deux fonctions de déclencheur (schéma de production, V8) sont attachées à plusieurs tables et
-- lisaient, dans UNE expression, des colonnes qui n'existent que sur l'une d'elles. PL/pgSQL
-- prépare une expression d'un bloc : chaque champ NEW.x cité doit exister sur la table qui
-- déclenche, même dans une branche CASE non retenue. D'où, à chaque appel :
--
--   enforce_sales_period_lock (quotations, sales_orders, delivery_notes, INSERT/UPDATE)
--       CASE TG_TABLE_NAME WHEN ... THEN NEW.quote_date / NEW.order_date / NEW.delivery_date
--       → « record "new" has no field "order_date" » : aucun devis, aucune commande client,
--         aucun bon de livraison ne pouvait être créé ni modifié. Constaté sur la copie réelle :
--         un seul devis (2 mai 2026, avant l'ajout du déclencheur le 26 juin), zéro commande,
--         zéro livraison ; et la conversion d'une opportunité en devis échouait de même.
--   seed_procurement_approval_queue (purchase_requisitions, purchase_orders)
--       CASE WHEN _doc_type = 'PR' THEN NEW.pr_number ELSE NEW.po_number END
--       → aucune demande d'achat ni commande fournisseur ne pouvait être soumise à approbation
--         (passage en pending_approval).
--
-- Correction : chaque champ est lu dans une branche IF propre à sa table — une branche IF n'est
-- préparée que si elle s'exécute. Le reste des deux corps est celui de V8, inchangé.
--
-- Jumelle : supabase/migrations/20261113180000_5f2b8d1e-9c4a-4e7b-b3d6-1a8e0c7f4b62.sql

-- ─── Ventes : verrouillage de période ───
CREATE OR REPLACE FUNCTION public.enforce_sales_period_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _period text;
  _date date;
  _locked boolean;
BEGIN
  -- Une branche par table : une expression CASE est préparée d'un bloc et exigeait les trois
  -- colonnes de date sur chaque table (« record "new" has no field "order_date" »).
  IF TG_TABLE_NAME = 'quotations' THEN
    _date := NEW.quote_date;
  ELSIF TG_TABLE_NAME = 'sales_orders' THEN
    _date := NEW.order_date;
  ELSIF TG_TABLE_NAME = 'delivery_notes' THEN
    _date := NEW.delivery_date;
  END IF;
  IF _date IS NULL THEN RETURN NEW; END IF;

  _period := to_char(_date, 'YYYY-MM');
  SELECT (status='closed') INTO _locked
    FROM public.period_locks
   WHERE tenant_id = NEW.tenant_id AND module = 'Sales' AND period = _period
   LIMIT 1;

  IF COALESCE(_locked, false) THEN
    RAISE EXCEPTION 'Sales period % is closed — operation refused on %', _period, TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $function$;

-- ─── Achats : file d'approbation ───
CREATE OR REPLACE FUNCTION public.seed_procurement_approval_queue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _doc_type text;
  _amount numeric;
  _t public.procurement_approval_thresholds%ROWTYPE;
  _order int := 1;
  _doc_number text;
BEGIN
  -- Le numéro est lu dans la branche de sa table : l'ancienne expression CASE (PR → pr_number,
  -- sinon po_number) était préparée d'un bloc et exigeait les deux colonnes sur chaque table.
  IF TG_TABLE_NAME = 'purchase_requisitions' THEN
    _doc_type := 'PR'; _amount := COALESCE(NEW.estimated_total, 0); _doc_number := NEW.pr_number;
  ELSE
    _doc_type := 'PO'; _amount := COALESCE(NEW.total, 0); _doc_number := NEW.po_number;
  END IF;

  -- Only seed when entering pending_approval and queue empty
  IF NEW.status <> 'pending_approval' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.procurement_approvals WHERE doc_type=_doc_type AND doc_id=NEW.id) THEN
    RETURN NEW;
  END IF;

  FOR _t IN
    SELECT * FROM public.procurement_approval_thresholds
     WHERE tenant_id = NEW.tenant_id AND doc_type = _doc_type
     ORDER BY max_amount NULLS LAST
  LOOP
    INSERT INTO public.procurement_approvals
      (tenant_id, doc_type, doc_id, level_order, level_label, approver_role, sla_hours, sla_due_at, amount)
    VALUES
      (NEW.tenant_id, _doc_type, NEW.id, _order, _t.level, _t.approver, _t.sla_hours,
       now() + (_t.sla_hours || ' hours')::interval, _amount);
    _order := _order + 1;
    -- Stop at the threshold that covers the amount (NULL = top tier)
    IF _t.max_amount IS NULL OR _amount <= _t.max_amount THEN EXIT; END IF;
  END LOOP;

  PERFORM public.notify_procurement(
    NEW.tenant_id, 'info',
    _doc_type || ' assignée pour approbation',
    'Document ' || COALESCE(_doc_number, '') || ' en file d''attente.',
    NEW.id::text);
  RETURN NEW;
END; $function$;
