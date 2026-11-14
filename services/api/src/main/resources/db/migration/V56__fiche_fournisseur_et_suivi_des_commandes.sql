-- V56 — Fiche fournisseur complète et suivi des commandes (audit 11 §4, lot A1 ; écarts G-33, G-45 ;
-- références : SAP fiche fournisseur et double contrôle des données sensibles, confirmations de
-- commande et relances ; Sage X3 / Sage 300 fiche fournisseur, accusé de réception, suivi des retards).
--
-- 1. suppliers : identification (raison sociale, RCCM, IFU, régime fiscal, catégorie), coordonnées
--    (contact, ville, pays), conditions (devise, Incoterm par défaut, délai de livraison), banque
--    (banque, compte / RIB / IBAN, BIC). Écriture réservée à l'administrateur, au comptable et aux
--    rôles achats (avant : tout membre, un lecteur compris) ; suppression : administrateur, comptable.
-- 2. Double contrôle des coordonnées bancaires (anti-fraude au changement de RIB) : toute
--    modification du compte ou du BIC rend les coordonnées « à valider » ; un AUTRE utilisateur
--    habilité (administrateur, comptable) les valide par verify_supplier_bank_details ; tant qu'elles
--    ne le sont pas, un paiement par virement à ce fournisseur est refusé (QG018). Les changements
--    sensibles (nom, IFU, RCCM, banque, compte, BIC) sont journalisés dans supplier_change_log.
-- 3. Commandes : date de livraison prévue (par défaut date de commande + délai du fournisseur),
--    Incoterm (par défaut celui du fournisseur), par ligne une date prévue facultative ;
--    accusé de réception du fournisseur (sa référence, sa date confirmée ; une commande approuvée
--    passe « commandée ») et replanification motivée, journalisés ; vue purchase_order_followup_view
--    (reste à recevoir, date promise, retard en jours, état : en retard, à confirmer, dans les délais).
-- Erreurs métier : QG018.

-- ─── 1. Fiche fournisseur ───
ALTER TABLE public.suppliers
  ADD COLUMN legal_name text,
  ADD COLUMN rccm text,
  ADD COLUMN tax_regime text,
  ADD COLUMN category text,
  ADD COLUMN contact_name text,
  ADD COLUMN city text,
  ADD COLUMN country text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  ADD COLUMN currency text NOT NULL DEFAULT 'XOF' CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN default_incoterm text CHECK (default_incoterm IS NULL OR default_incoterm IN
    ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP')),
  ADD COLUMN lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  ADD COLUMN bank_name text,
  ADD COLUMN bank_account text,
  ADD COLUMN bank_swift text CHECK (bank_swift IS NULL OR bank_swift ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  ADD COLUMN bank_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN bank_changed_by uuid,
  ADD COLUMN bank_changed_at timestamptz,
  ADD COLUMN bank_verified_by uuid,
  ADD COLUMN bank_verified_at timestamptz,
  ADD COLUMN notes text;

DROP POLICY "Tenant isolation" ON public.suppliers;
CREATE POLICY "Lecture société" ON public.suppliers FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Création habilitée" ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.tenant_has_any_role(ARRAY['admin', 'accountant', 'procurement_controller', 'procurement_l1', 'procurement_l2', 'procurement_l3']));
CREATE POLICY "Modification habilitée" ON public.suppliers FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.tenant_has_any_role(ARRAY['admin', 'accountant', 'procurement_controller', 'procurement_l1', 'procurement_l2', 'procurement_l3']))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Suppression comptable" ON public.suppliers FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']));

CREATE TABLE public.supplier_change_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_change_log_supplier_idx ON public.supplier_change_log (supplier_id, id);
ALTER TABLE public.supplier_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture comptable" ON public.supplier_change_log FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']));
GRANT SELECT ON public.supplier_change_log TO authenticated;

-- Coordonnées bancaires : un changement les rend « à valider » ; seul verify_supplier_bank_details
-- (autre utilisateur) les valide. Garde non SECURITY DEFINER : elle voit le rôle de l'appelant.
CREATE OR REPLACE FUNCTION public.guard_supplier_bank()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _app boolean := current_user IN ('authenticated', 'anon', 'qerp_api');
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.bank_verified := false; NEW.bank_verified_by := NULL; NEW.bank_verified_at := NULL;
    IF NEW.bank_account IS NOT NULL OR NEW.bank_swift IS NOT NULL THEN
      NEW.bank_changed_by := auth.uid(); NEW.bank_changed_at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.bank_account IS DISTINCT FROM OLD.bank_account OR NEW.bank_swift IS DISTINCT FROM OLD.bank_swift
     OR NEW.bank_name IS DISTINCT FROM OLD.bank_name THEN
    NEW.bank_verified := false; NEW.bank_verified_by := NULL; NEW.bank_verified_at := NULL;
    NEW.bank_changed_by := auth.uid(); NEW.bank_changed_at := now();
  ELSIF _app AND (NEW.bank_verified IS DISTINCT FROM OLD.bank_verified OR NEW.bank_verified_by IS DISTINCT FROM OLD.bank_verified_by
                  OR NEW.bank_changed_by IS DISTINCT FROM OLD.bank_changed_by) THEN
    RAISE EXCEPTION 'La validation des coordonnées bancaires passe par « Valider les coordonnées bancaires »' USING ERRCODE = 'QG018';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_supplier_bank BEFORE INSERT OR UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_bank();

CREATE OR REPLACE FUNCTION public.log_supplier_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _f text;
  _old jsonb := to_jsonb(OLD);
  _new jsonb := to_jsonb(NEW);
BEGIN
  FOREACH _f IN ARRAY ARRAY['name', 'legal_name', 'tax_id', 'rccm', 'bank_name', 'bank_account', 'bank_swift', 'bank_verified'] LOOP
    IF _old->>_f IS DISTINCT FROM _new->>_f THEN
      INSERT INTO public.supplier_change_log (tenant_id, supplier_id, field, old_value, new_value, changed_by)
      VALUES (NEW.tenant_id, NEW.id, _f, _old->>_f, _new->>_f, auth.uid());
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_log_supplier_changes AFTER UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.log_supplier_changes();

CREATE OR REPLACE FUNCTION public.verify_supplier_bank_details(_supplier_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _s public.suppliers%ROWTYPE;
BEGIN
  IF NOT public.tenant_has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Seul un administrateur ou un comptable valide des coordonnées bancaires' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _s FROM public.suppliers WHERE id = _supplier_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fournisseur introuvable dans la société active' USING ERRCODE = 'QG018'; END IF;
  IF _s.bank_account IS NULL THEN RAISE EXCEPTION 'Aucune coordonnée bancaire à valider' USING ERRCODE = 'QG018'; END IF;
  IF _s.bank_verified THEN RAISE EXCEPTION 'Coordonnées bancaires déjà validées' USING ERRCODE = 'QG018'; END IF;
  IF _s.bank_changed_by IS NOT DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Double contrôle : les coordonnées bancaires doivent être validées par une autre personne que celle qui les a saisies'
      USING ERRCODE = 'QG018';
  END IF;
  UPDATE public.suppliers SET bank_verified = true, bank_verified_by = auth.uid(), bank_verified_at = now() WHERE id = _supplier_id;
END $function$;
REVOKE ALL ON FUNCTION public.verify_supplier_bank_details(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_supplier_bank_details(uuid) TO authenticated;

-- Paiement par virement refusé vers des coordonnées non validées.
CREATE OR REPLACE FUNCTION public.guard_supplier_bank_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s record;
BEGIN
  IF NEW.payment_type <> 'ap_payment' OR NEW.ap_invoice_id IS NULL OR NEW.reversal_of IS NOT NULL
     OR COALESCE(NEW.payment_method, '') <> 'bank_transfer' THEN
    RETURN NEW;
  END IF;
  SELECT s.name, s.bank_account, s.bank_verified INTO _s
    FROM public.ap_invoices i JOIN public.suppliers s ON s.id = i.supplier_id WHERE i.id = NEW.ap_invoice_id;
  IF _s.bank_account IS NOT NULL AND NOT _s.bank_verified THEN
    RAISE EXCEPTION 'Virement refusé : les coordonnées bancaires de « % » ont été modifiées et ne sont pas encore validées par une autre personne', _s.name
      USING ERRCODE = 'QG018', HINT = 'Fiche fournisseur → « Valider les coordonnées bancaires » (administrateur ou comptable, autre que l''auteur du changement).';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_supplier_bank_payment BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_bank_payment();

-- ─── 3. Commandes : dates prévues, accusé de réception, replanification ───
ALTER TABLE public.purchase_orders
  ADD COLUMN expected_date date,
  ADD COLUMN incoterm text CHECK (incoterm IS NULL OR incoterm IN ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP')),
  ADD COLUMN supplier_reference text,
  ADD COLUMN supplier_confirmed_date date,
  ADD COLUMN acknowledged_by uuid,
  ADD COLUMN acknowledged_at timestamptz;
ALTER TABLE public.po_lines ADD COLUMN expected_date date;

CREATE OR REPLACE FUNCTION public.default_po_dates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _lead integer; _inco text;
BEGIN
  SELECT lead_time_days, default_incoterm INTO _lead, _inco FROM public.suppliers WHERE id = NEW.supplier_id;
  IF NEW.expected_date IS NULL THEN NEW.expected_date := COALESCE(NEW.order_date, CURRENT_DATE) + COALESCE(_lead, 0); END IF;
  IF NEW.incoterm IS NULL THEN NEW.incoterm := _inco; END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_default_po_dates BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.default_po_dates();

CREATE TABLE public.purchase_order_followup_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('acknowledged', 'rescheduled')),
  old_date date,
  new_date date,
  supplier_reference text,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_order_followup_log_po_idx ON public.purchase_order_followup_log (po_id, id);
ALTER TABLE public.purchase_order_followup_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.purchase_order_followup_log FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.purchase_order_followup_log TO authenticated;

CREATE OR REPLACE FUNCTION public.po_followup_target(_po_id uuid)
 RETURNS public.purchase_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _po public.purchase_orders%ROWTYPE;
BEGIN
  IF NOT public.tenant_has_any_role(ARRAY['admin', 'procurement_controller', 'procurement_l1', 'procurement_l2', 'procurement_l3']) THEN
    RAISE EXCEPTION 'Droit insuffisant : suivi des commandes réservé aux acheteurs' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _po FROM public.purchase_orders WHERE id = _po_id AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable dans la société active' USING ERRCODE = 'QG018'; END IF;
  IF _po.status NOT IN ('approved', 'ordered', 'partially_received') THEN
    RAISE EXCEPTION 'Seule une commande approuvée et non soldée se suit (commande %, %)', _po.po_number, _po.status USING ERRCODE = 'QG018';
  END IF;
  RETURN _po;
END $function$;
REVOKE ALL ON FUNCTION public.po_followup_target(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.acknowledge_purchase_order(_po_id uuid, _supplier_reference text, _confirmed_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _po public.purchase_orders%ROWTYPE := public.po_followup_target(_po_id);
BEGIN
  IF _confirmed_date IS NULL THEN RAISE EXCEPTION 'Date de livraison confirmée par le fournisseur obligatoire' USING ERRCODE = 'QG018'; END IF;
  IF _confirmed_date < _po.order_date THEN
    RAISE EXCEPTION 'La date confirmée ne peut pas précéder la commande (%)', _po.order_date USING ERRCODE = 'QG018';
  END IF;
  UPDATE public.purchase_orders
     SET supplier_reference = NULLIF(btrim(COALESCE(_supplier_reference, '')), ''), supplier_confirmed_date = _confirmed_date,
         acknowledged_by = auth.uid(), acknowledged_at = now(),
         status = CASE WHEN status = 'approved' THEN 'ordered' ELSE status END
   WHERE id = _po_id;
  INSERT INTO public.purchase_order_followup_log (tenant_id, po_id, event, old_date, new_date, supplier_reference, created_by)
  VALUES (_po.tenant_id, _po_id, 'acknowledged', COALESCE(_po.supplier_confirmed_date, _po.expected_date), _confirmed_date,
          NULLIF(btrim(COALESCE(_supplier_reference, '')), ''), auth.uid());
END $function$;
REVOKE ALL ON FUNCTION public.acknowledge_purchase_order(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_purchase_order(uuid, text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.reschedule_purchase_order(_po_id uuid, _new_date date, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _po public.purchase_orders%ROWTYPE := public.po_followup_target(_po_id);
BEGIN
  IF _new_date IS NULL OR _new_date < _po.order_date THEN
    RAISE EXCEPTION 'Nouvelle date invalide (au plus tôt la date de commande %)', _po.order_date USING ERRCODE = 'QG018';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Motif de replanification obligatoire' USING ERRCODE = 'QG018'; END IF;
  UPDATE public.purchase_orders SET supplier_confirmed_date = _new_date WHERE id = _po_id;
  INSERT INTO public.purchase_order_followup_log (tenant_id, po_id, event, old_date, new_date, reason, created_by)
  VALUES (_po.tenant_id, _po_id, 'rescheduled', COALESCE(_po.supplier_confirmed_date, _po.expected_date), _new_date, btrim(_reason), auth.uid());
END $function$;
REVOKE ALL ON FUNCTION public.reschedule_purchase_order(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_purchase_order(uuid, date, text) TO authenticated;

-- Suivi : commandes ouvertes, reste à recevoir, date promise, retard.
CREATE OR REPLACE VIEW public.purchase_order_followup_view WITH (security_invoker = on) AS
WITH restes AS (
  SELECT pl.po_id,
         sum(GREATEST(pl.quantity
           - COALESCE((SELECT sum(g.quantity_received) FROM public.gr_lines g JOIN public.goods_receipts r ON r.id = g.gr_id
                        WHERE g.po_line_id = pl.id AND r.status = 'completed'), 0)
           + public.po_line_returned(pl.id, true), 0)) AS qty_remaining,
         sum(GREATEST(pl.quantity
           - COALESCE((SELECT sum(g.quantity_received) FROM public.gr_lines g JOIN public.goods_receipts r ON r.id = g.gr_id
                        WHERE g.po_line_id = pl.id AND r.status = 'completed'), 0)
           + public.po_line_returned(pl.id, true), 0) * pl.unit_cost) AS value_remaining,
         min(pl.expected_date) AS first_line_date
    FROM public.po_lines pl GROUP BY pl.po_id
)
SELECT po.tenant_id, po.id AS po_id, po.po_number, po.supplier_id, s.name AS supplier_name, po.order_date, po.status,
       po.incoterm, po.expected_date, po.supplier_confirmed_date, po.supplier_reference, po.acknowledged_at,
       COALESCE(po.supplier_confirmed_date, LEAST(po.expected_date, r.first_line_date), po.expected_date) AS promised_date,
       COALESCE(r.qty_remaining, 0) AS qty_remaining,
       round(COALESCE(r.value_remaining, 0), 2) AS value_remaining,
       GREATEST(CURRENT_DATE - COALESCE(po.supplier_confirmed_date, po.expected_date), 0) AS days_late,
       CASE WHEN COALESCE(r.qty_remaining, 0) = 0 THEN 'complete'
            WHEN COALESCE(po.supplier_confirmed_date, po.expected_date) < CURRENT_DATE THEN 'late'
            WHEN po.acknowledged_at IS NULL THEN 'unconfirmed'
            ELSE 'on_time' END AS followup_state
  FROM public.purchase_orders po
  LEFT JOIN public.suppliers s ON s.id = po.supplier_id
  LEFT JOIN restes r ON r.po_id = po.id
 WHERE po.status IN ('approved', 'ordered', 'partially_received');
GRANT SELECT ON public.purchase_order_followup_view TO authenticated;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
