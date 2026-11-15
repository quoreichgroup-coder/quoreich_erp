-- V72 — Factures fournisseurs à lignes, rapprochement à 3 voies ligne à ligne, factures non
-- parvenues (lot A4 ; écarts G-17, G-18 ; audit docs/audit-erp/14).
--
-- Constats : facture fournisseur en en-tête seul (HT et TVA saisis) ; rapprochement à 3 voies global
-- sur la valeur de la commande, ni par ligne ni par prix ; TVA déductible approximative ; aucune
-- écriture à la réception (charges de la période sous-évaluées tant que la facture n'est pas arrivée) ;
-- table des factures fournisseurs ouverte en écriture à tout membre (FOR ALL).
--
-- Comme SAP (MIRO : lignes rattachées aux postes de commande, contrôle quantité et prix, compte
-- d'attente GR/IR soldé par la facture, écart de prix en charge) et Sage X3 (factures non parvenues) :
-- 1. ap_invoice_lines (quantité, prix, remise, code TVA, compte de charge, ligne de commande) ;
--    l'en-tête est la somme des lignes ; montant TTC de contrôle (celui du papier) qui doit
--    correspondre au pied à la soumission.
-- 2. Soumission : pour chaque ligne rattachée à la commande, quantité ≤ reçu − déjà facturé et prix ≤
--    prix commandé, à la tolérance des paramètres d'achat près ; le contrôle global reste pour les
--    factures sans lignes.
-- 3. Factures non parvenues (paramètre procurement_settings.grni_on_receipt, désactivé par défaut —
--    décision de l'expert-comptable) : réception = DR achats / CR 408 (rôle GRNI) ; retour fournisseur =
--    contre-passation ; facture = DR 408 pour la valeur reçue au prix commandé, écart de prix en charge.
--    Registre grni_ledger par ligne de commande.
-- 4. Comptabilisation par ligne : charge par compte (ligne, sinon rôle PURCHASES), TVA par compte du
--    code TVA (sinon VAT_INPUT), fournisseur pour le TTC.
-- 5. Droit ap.invoice (saisir une facture fournisseur) : admin, comptable, contrôleur des achats.
-- Erreurs métier : QG008 (V41).

-- ─── Droit ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('ap.invoice', 'ap', 'invoice', 'Saisir et modifier les factures fournisseurs')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, 'ap.invoice' FROM (VALUES ('admin'), ('accountant'), ('procurement_controller')) AS v(r)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles WHERE code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code = 'ap.invoice' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

DROP POLICY "Tenant isolation" ON public.ap_invoices;
CREATE POLICY "Lecture société" ON public.ap_invoices FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Saisie habilitée" ON public.ap_invoices FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.invoice'));
CREATE POLICY "Modification habilitée" ON public.ap_invoices FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.invoice'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.invoice'));
CREATE POLICY "Suppression habilitée" ON public.ap_invoices FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.invoice'));

-- ─── Paramètre et rôle GRNI (408) ───
ALTER TABLE public.procurement_settings ADD COLUMN grni_on_receipt boolean NOT NULL DEFAULT false;
INSERT INTO public.posting_roles (code, label, module, description, expected_prefixes)
VALUES ('GRNI', 'Fournisseurs, factures non parvenues', 'AP', 'Crédité à la réception (biens reçus non facturés), débité par la facture', ARRAY['408'])
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.framework_reference_accounts (framework_code, code, name, account_type) VALUES
  ('SYSCOHADA_REVISE', '408', 'Fournisseurs, factures non parvenues', 'liability')
ON CONFLICT (framework_code, code) DO NOTHING;
INSERT INTO public.framework_role_expectations (framework_code, role_code, prefixes) VALUES
  ('SYSCOHADA_REVISE', 'GRNI', ARRAY['408']), ('PCG_FR', 'GRNI', ARRAY['408'])
ON CONFLICT (framework_code, role_code) DO NOTHING;
INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT v.f, '408', 'Fournisseurs, factures non parvenues', 'liability' FROM (VALUES ('SYSCOHADA_REVISE'), ('PCG_FR')) AS v(f)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_accounts a WHERE a.framework_code = v.f AND a.code = '408');
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT v.f, 'GRNI', '408' FROM (VALUES ('SYSCOHADA_REVISE'), ('PCG_FR')) AS v(f)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults d WHERE d.framework_code = v.f AND d.role_code = 'GRNI');
INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
SELECT s.tenant_id, '408', 'Fournisseurs, factures non parvenues', 'liability'
  FROM public.tenant_accounting_settings s WHERE s.framework_code IN ('SYSCOHADA_REVISE', 'PCG_FR')
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, 'GRNI', g.id FROM public.tenant_accounting_settings s
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = '408' AND g.is_active
 WHERE s.framework_code IN ('SYSCOHADA_REVISE', 'PCG_FR')
ON CONFLICT (tenant_id, role_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.journal_for_source(_source text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _source
    WHEN 'ar_invoice' THEN 'VT'
    WHEN 'ar_credit_note' THEN 'VT'
    WHEN 'ap_invoice' THEN 'AC'
    WHEN 'ap_credit_note' THEN 'AC'
    WHEN 'goods_receipt' THEN 'AC'
    WHEN 'grni_return' THEN 'AC'
    WHEN 'ar_receipt' THEN 'BQ'
    WHEN 'ar_advance' THEN 'BQ'
    WHEN 'ar_refund' THEN 'BQ'
    WHEN 'ap_payment' THEN 'BQ'
    WHEN 'treasury' THEN 'BQ'
    WHEN 'payroll' THEN 'PA'
    ELSE 'OD'
  END
$function$;

-- ─── Lignes de facture fournisseur ───
ALTER TABLE public.ap_invoices ADD COLUMN control_total numeric(18, 2);
CREATE TABLE public.ap_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.ap_invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  po_line_id uuid REFERENCES public.po_lines(id),
  description text NOT NULL CHECK (btrim(description) <> ''),
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(18, 2) NOT NULL CHECK (unit_price >= 0),
  discount_pct numeric(5, 2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  tax_code_id uuid REFERENCES public.tax_codes(id),
  expense_account_id uuid REFERENCES public.gl_accounts(id),
  net_amount numeric(18, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(18, 2) NOT NULL DEFAULT 0,
  grni_cleared numeric(18, 2) NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, line_no)
);
CREATE INDEX ap_invoice_lines_po_line ON public.ap_invoice_lines (po_line_id) WHERE po_line_id IS NOT NULL;
ALTER TABLE public.ap_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.ap_invoice_lines FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Saisie habilitée" ON public.ap_invoice_lines FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.invoice'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.invoice'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_invoice_lines TO authenticated;

CREATE OR REPLACE FUNCTION public.compute_ap_invoice_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _inv public.ap_invoices%ROWTYPE; _rate numeric; _active boolean; _po uuid;
BEGIN
  SELECT * INTO _inv FROM public.ap_invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF TG_OP = 'DELETE' AND NOT FOUND THEN RETURN OLD; END IF;
  IF _inv.approval_status NOT IN ('draft', 'rejected', 'pending') AND current_setting('qerp.ap_posting', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Facture « % » : ses lignes ne se modifient qu''en brouillon ou après rejet', _inv.approval_status USING ERRCODE = 'QG008';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.tenant_id := _inv.tenant_id;
  IF NEW.po_line_id IS NOT NULL THEN
    SELECT pl.po_id INTO _po FROM public.po_lines pl WHERE pl.id = NEW.po_line_id;
    IF _inv.po_id IS NULL OR _po IS DISTINCT FROM _inv.po_id THEN
      RAISE EXCEPTION 'Une ligne de facture ne cite qu''une ligne de la commande de la facture' USING ERRCODE = 'QG008';
    END IF;
  END IF;
  IF NEW.tax_code_id IS NOT NULL THEN
    SELECT rate, is_active INTO _rate, _active FROM public.tax_codes WHERE id = NEW.tax_code_id AND tenant_id = _inv.tenant_id;
    IF NOT FOUND OR NOT _active THEN RAISE EXCEPTION 'Code TVA inconnu ou inactif' USING ERRCODE = 'QG008'; END IF;
  END IF;
  IF NEW.expense_account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.gl_accounts g WHERE g.id = NEW.expense_account_id AND g.tenant_id = _inv.tenant_id AND g.is_active AND NOT g.is_header) THEN
    RAISE EXCEPTION 'Compte de charge : compte actif et imputable de la société requis' USING ERRCODE = 'QG008';
  END IF;
  IF current_setting('qerp.ap_posting', true) IS DISTINCT FROM 'on' THEN
    NEW.net_amount := round(NEW.quantity * NEW.unit_price * (1 - NEW.discount_pct / 100), 2);
    NEW.tax_amount := round(NEW.net_amount * COALESCE(_rate, 0) / 100, 2);
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_compute_ap_invoice_line BEFORE INSERT OR UPDATE OR DELETE ON public.ap_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.compute_ap_invoice_line();

-- En-tête = somme des lignes (une facture sans ligne garde ses montants d'en-tête).
CREATE OR REPLACE FUNCTION public.sync_ap_invoice_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  IF current_setting('qerp.ap_posting', true) = 'on' THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ap_invoices WHERE id = _id) THEN RETURN NULL; END IF;
  UPDATE public.ap_invoices i SET
    subtotal = COALESCE((SELECT sum(l.net_amount) FROM public.ap_invoice_lines l WHERE l.invoice_id = _id), 0),
    tax_amount = COALESCE((SELECT sum(l.tax_amount) FROM public.ap_invoice_lines l WHERE l.invoice_id = _id), 0)
   WHERE i.id = _id AND EXISTS (SELECT 1 FROM public.ap_invoice_lines l WHERE l.invoice_id = _id);
  RETURN NULL;
END $function$;
CREATE TRIGGER trg_sync_ap_invoice_totals AFTER INSERT OR UPDATE OR DELETE ON public.ap_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.sync_ap_invoice_totals();

-- Quantités par ligne de commande : reçu (net des retours) et déjà facturé (soumis ou approuvé).
CREATE OR REPLACE FUNCTION public.po_line_received(_po_line uuid)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT sum(gl.quantity_received) FROM public.gr_lines gl JOIN public.goods_receipts g ON g.id = gl.gr_id AND g.status = 'completed'
                    WHERE gl.po_line_id = _po_line), 0) - public.po_line_returned(_po_line, false)
$function$;
CREATE OR REPLACE FUNCTION public.po_line_invoiced(_po_line uuid, _except uuid DEFAULT NULL)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(l.quantity), 0) FROM public.ap_invoice_lines l JOIN public.ap_invoices i ON i.id = l.invoice_id
   WHERE l.po_line_id = _po_line AND i.approval_status IN ('submitted', 'approved') AND (_except IS NULL OR i.id <> _except)
$function$;

-- ─── Registre des factures non parvenues ───
CREATE TABLE public.grni_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  po_line_id uuid NOT NULL REFERENCES public.po_lines(id),
  source text NOT NULL CHECK (source IN ('receipt', 'return', 'invoice')),
  source_id uuid NOT NULL,
  amount numeric(18, 2) NOT NULL,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grni_ledger_po_line ON public.grni_ledger (po_line_id);
ALTER TABLE public.grni_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.grni_ledger FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.grni_ledger TO authenticated;

CREATE OR REPLACE FUNCTION public.grni_open(_po_line uuid)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$ SELECT COALESCE(sum(amount), 0) FROM public.grni_ledger WHERE po_line_id = _po_line $function$;

-- Écriture à deux lignes dont l'auteur est donné (déclencheurs : l'auteur de la pièce, la session
-- pouvant ne pas en avoir).
CREATE OR REPLACE FUNCTION public.post_two_line_entry_as(_tenant uuid, _date date, _source text, _label text, _debit_account uuid,
                                                         _credit_account uuid, _amount numeric, _actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid; _who uuid := COALESCE(auth.uid(), _actor);
BEGIN
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-' || upper(left(_source, 6)) || '-' || to_char(now(), 'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text, 1, 6),
          _date, _label, _source, 'draft', _who)
  RETURNING id INTO _id;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_id, _debit_account, _amount, 0, _label), (_id, _credit_account, 0, _amount, _label);
  UPDATE public.journal_entries SET status = 'posted', posted_by = _who, posted_at = now() WHERE id = _id;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.post_two_line_entry_as(uuid, date, text, text, uuid, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;

-- Réception validée : DR achats / CR factures non parvenues, au prix de la commande.
CREATE OR REPLACE FUNCTION public.on_gr_grni()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _total numeric; _entry uuid;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NULL; END IF;
  IF NOT COALESCE((public.procurement_setting(NEW.tenant_id)).grni_on_receipt, false) THEN RETURN NULL; END IF;
  SELECT round(sum(gl.quantity_received * COALESCE(pl.unit_cost, 0)), 2) INTO _total
    FROM public.gr_lines gl JOIN public.po_lines pl ON pl.id = gl.po_line_id WHERE gl.gr_id = NEW.id AND gl.quantity_received > 0;
  IF COALESCE(_total, 0) <= 0 THEN RETURN NULL; END IF;
  _entry := public.post_two_line_entry_as(NEW.tenant_id, COALESCE(NEW.receipt_date, CURRENT_DATE), 'goods_receipt',
    'Réception ' || NEW.gr_number || ' — factures non parvenues',
    public.require_posting_account(NEW.tenant_id, 'PURCHASES'), public.require_posting_account(NEW.tenant_id, 'GRNI'), _total, NEW.received_by);
  INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount, journal_entry_id)
  SELECT NEW.tenant_id, gl.po_line_id, 'receipt', NEW.id, round(sum(gl.quantity_received * COALESCE(pl.unit_cost, 0)), 2), _entry
    FROM public.gr_lines gl JOIN public.po_lines pl ON pl.id = gl.po_line_id
   WHERE gl.gr_id = NEW.id AND gl.quantity_received > 0 GROUP BY gl.po_line_id;
  RETURN NULL;
END $function$;
CREATE TRIGGER trg_gr_grni AFTER UPDATE ON public.goods_receipts FOR EACH ROW EXECUTE FUNCTION public.on_gr_grni();

-- Retour fournisseur : contre-passation de la part non encore facturée.
CREATE OR REPLACE FUNCTION public.on_supplier_return_grni()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.supplier_returns%ROWTYPE; _amt numeric; _entry uuid;
BEGIN
  IF NEW.po_line_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _r FROM public.supplier_returns WHERE id = NEW.return_id;
  IF NOT COALESCE((public.procurement_setting(_r.tenant_id)).grni_on_receipt, false) THEN RETURN NULL; END IF;
  _amt := least(round(NEW.quantity * COALESCE(NEW.unit_cost, 0), 2), public.grni_open(NEW.po_line_id));
  IF _amt <= 0 THEN RETURN NULL; END IF;
  _entry := public.post_two_line_entry_as(_r.tenant_id, COALESCE(_r.return_date, CURRENT_DATE), 'grni_return',
    'Retour ' || _r.return_number || ' — factures non parvenues',
    public.require_posting_account(_r.tenant_id, 'GRNI'), public.require_posting_account(_r.tenant_id, 'PURCHASES'), _amt, _r.created_by);
  INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount, journal_entry_id)
  VALUES (_r.tenant_id, NEW.po_line_id, 'return', _r.id, -_amt, _entry);
  RETURN NULL;
END $function$;
CREATE TRIGGER trg_supplier_return_grni AFTER INSERT ON public.supplier_return_lines FOR EACH ROW EXECUTE FUNCTION public.on_supplier_return_grni();

-- ─── Comptabilisation de la facture ───
CREATE OR REPLACE FUNCTION public.ap_invoice_journal_entry(_inv ap_invoices)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _entry_id uuid;
  _payable uuid := public.posting_account(_inv.tenant_id, 'AP_PAYABLE');
  _purchases uuid := public.posting_account(_inv.tenant_id, 'PURCHASES');
  _vat uuid := public.posting_account(_inv.tenant_id, 'VAT_INPUT');
  _grni uuid := public.posting_account(_inv.tenant_id, 'GRNI');
  _grni_on boolean := COALESCE((public.procurement_setting(_inv.tenant_id)).grni_on_receipt, false);
  _has_lines boolean := EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = _inv.id);
  _tax numeric := COALESCE(_inv.tax_amount, 0);
  _net numeric := COALESCE(_inv.subtotal, 0);
  _total numeric := round(COALESCE(_inv.subtotal, 0) + COALESCE(_inv.tax_amount, 0), 2);
  _manquants text[] := '{}';
  _l record; _clear numeric; _left numeric; _acc uuid[] := '{}'; _amt numeric[] := '{}'; _lbl text[] := '{}';
BEGIN
  IF _payable IS NULL THEN _manquants := _manquants || 'AP_PAYABLE'::text; END IF;
  IF _purchases IS NULL AND (NOT _has_lines OR EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = _inv.id AND expense_account_id IS NULL)) THEN
    _manquants := _manquants || 'PURCHASES'::text;
  END IF;
  IF _tax <> 0 AND _vat IS NULL AND (NOT _has_lines OR EXISTS (
       SELECT 1 FROM public.ap_invoice_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
        WHERE l.invoice_id = _inv.id AND l.tax_amount <> 0 AND t.gl_account_id IS NULL)) THEN
    _manquants := _manquants || 'VAT_INPUT'::text;
  END IF;
  IF _grni_on AND _grni IS NULL AND _inv.po_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.grni_ledger g JOIN public.po_lines pl ON pl.id = g.po_line_id WHERE pl.po_id = _inv.po_id) THEN
    _manquants := _manquants || 'GRNI'::text;
  END IF;
  IF cardinality(_manquants) > 0 THEN
    RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; la facture fournisseur % ne peut pas être comptabilisée',
      public.posting_roles_label(_manquants), _inv.invoice_number
      USING ERRCODE = 'QG001', HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable.';
  END IF;
  PERFORM set_config('qerp.ap_posting', 'on', true);

  IF _has_lines THEN
    FOR _l IN SELECT l.*, pl.unit_cost FROM public.ap_invoice_lines l LEFT JOIN public.po_lines pl ON pl.id = l.po_line_id
               WHERE l.invoice_id = _inv.id ORDER BY l.line_no LOOP
      _clear := 0;
      IF _grni_on AND _l.po_line_id IS NOT NULL THEN
        _clear := greatest(0, least(round(_l.quantity * COALESCE(_l.unit_cost, 0), 2), public.grni_open(_l.po_line_id)));
        IF _clear > 0 THEN
          INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount) VALUES (_inv.tenant_id, _l.po_line_id, 'invoice', _inv.id, -_clear);
          UPDATE public.ap_invoice_lines SET grni_cleared = _clear WHERE id = _l.id;
          _acc := _acc || _grni; _amt := _amt || _clear; _lbl := _lbl || 'DR Factures non parvenues'::text;
        END IF;
      END IF;
      IF _l.net_amount - _clear <> 0 THEN
        _acc := _acc || COALESCE(_l.expense_account_id, _purchases); _amt := _amt || (_l.net_amount - _clear);
        _lbl := _lbl || CASE WHEN _clear > 0 THEN 'Écart de prix / quantité' ELSE 'DR Achats HT' END;
      END IF;
    END LOOP;
    FOR _l IN SELECT COALESCE(t.gl_account_id, _vat) AS acc, sum(l.tax_amount) AS tax FROM public.ap_invoice_lines l
                LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id WHERE l.invoice_id = _inv.id AND l.tax_amount <> 0 GROUP BY 1 LOOP
      _acc := _acc || _l.acc; _amt := _amt || _l.tax; _lbl := _lbl || 'DR TVA déductible'::text;
    END LOOP;
  ELSE
    _clear := 0;
    IF _grni_on AND _inv.po_id IS NOT NULL THEN
      _left := _net;
      FOR _l IN SELECT pl.id, public.grni_open(pl.id) AS open FROM public.po_lines pl WHERE pl.po_id = _inv.po_id ORDER BY pl.id LOOP
        EXIT WHEN _left <= 0;
        IF _l.open > 0 THEN
          INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount) VALUES (_inv.tenant_id, _l.id, 'invoice', _inv.id, -least(_l.open, _left));
          _clear := _clear + least(_l.open, _left); _left := _left - least(_l.open, _left);
        END IF;
      END LOOP;
    END IF;
    IF _clear > 0 THEN _acc := _acc || _grni; _amt := _amt || _clear; _lbl := _lbl || 'DR Factures non parvenues'::text; END IF;
    IF _net - _clear <> 0 THEN _acc := _acc || _purchases; _amt := _amt || (_net - _clear); _lbl := _lbl || 'DR Achats HT'::text; END IF;
    IF _tax <> 0 THEN _acc := _acc || _vat; _amt := _amt || _tax; _lbl := _lbl || 'DR TVA déductible'::text; END IF;
  END IF;

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_inv.tenant_id, 'JE-AP-' || to_char(now(), 'YYYYMMDD') || '-' || substr(_inv.id::text, 1, 8),
          _inv.invoice_date, 'Facture fournisseur ' || _inv.invoice_number, 'ap_invoice', 'draft', _inv.created_by)
  RETURNING id INTO _entry_id;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  SELECT _entry_id, x.a, greatest(sum(x.m), 0), greatest(-sum(x.m), 0), min(x.l)
    FROM unnest(_acc, _amt, _lbl) AS x(a, m, l) GROUP BY x.a HAVING sum(x.m) <> 0;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _payable, 0, _total, 'CR Fournisseurs');
  UPDATE public.grni_ledger SET journal_entry_id = _entry_id WHERE source = 'invoice' AND source_id = _inv.id AND journal_entry_id IS NULL;
  UPDATE public.journal_entries SET status = 'posted', posted_by = _inv.created_by, posted_at = now() WHERE id = _entry_id;
  PERFORM set_config('qerp.ap_posting', 'off', true);
  RETURN _entry_id;
END $function$;

-- Lignes de commande à facturer (reprises dans la saisie) : reçu net des retours, déjà facturé, reste.
CREATE OR REPLACE FUNCTION public.ap_po_lines_to_invoice(_po uuid, _except uuid DEFAULT NULL)
 RETURNS TABLE (po_line_id uuid, description text, unit_cost numeric, ordered numeric, received numeric, invoiced numeric, remaining numeric)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT pl.id, COALESCE(pl.description, i.name, 'Ligne'), pl.unit_cost, pl.quantity, public.po_line_received(pl.id), public.po_line_invoiced(pl.id, _except),
         greatest(public.po_line_received(pl.id) - public.po_line_invoiced(pl.id, _except), 0)
    FROM public.po_lines pl JOIN public.purchase_orders po ON po.id = pl.po_id
    LEFT JOIN public.items i ON i.id = pl.item_id
   WHERE pl.po_id = _po AND po.tenant_id = public.get_user_tenant_id(auth.uid())
   ORDER BY pl.id
$function$;
REVOKE ALL ON FUNCTION public.ap_po_lines_to_invoice(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ap_po_lines_to_invoice(uuid, uuid) TO authenticated;

-- ─── Soumission : contrôle TTC et 3 voies ligne à ligne ───
CREATE OR REPLACE FUNCTION public.ap_invoice_submit(_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _inv public.ap_invoices%ROWTYPE := public.ap_invoice_for_caller(_id);
  _po_required text;
  _three_way boolean;
  _gr_required boolean;
  _tol_pct numeric;
  _tol_amount numeric;
  _recu numeric;
  _deja numeric;
  _reste numeric;
  _tol numeric;
  _t record;
  _n integer := 0;
  _lines_po boolean;
  _l record;
  _recu_q numeric;
  _fact_q numeric;
  _ecart numeric;
BEGIN
  IF _inv.approval_status NOT IN ('draft', 'rejected', 'pending') THEN
    RAISE EXCEPTION 'La facture % est « % » : seule une facture en brouillon ou rejetée se soumet',
      _inv.invoice_number, _inv.approval_status USING ERRCODE = 'QG008';
  END IF;
  IF COALESCE(_inv.subtotal, 0) <= 0 THEN
    RAISE EXCEPTION 'La facture % n''a pas de montant HT', _inv.invoice_number USING ERRCODE = 'QG008';
  END IF;

  IF _inv.control_total IS NOT NULL AND round(_inv.control_total, 2) <> round(_inv.total, 2) THEN
    RAISE EXCEPTION 'Facture % : montant TTC de contrôle % différent du total des lignes %', _inv.invoice_number, _inv.control_total, _inv.total
      USING ERRCODE = 'QG008', HINT = 'Corriger les lignes ou le montant TTC de la facture papier.';
  END IF;
  _lines_po := EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = _id AND po_line_id IS NOT NULL);

  SELECT g.po_required, g.three_way_match INTO _po_required, _three_way
    FROM public.ap_general_settings g WHERE g.tenant_id = _inv.tenant_id;
  SELECT s.require_gr_before_ap, s.three_way_tolerance_pct, s.three_way_tolerance_amount
    INTO _gr_required, _tol_pct, _tol_amount
    FROM public.procurement_settings s WHERE s.tenant_id = _inv.tenant_id;

  IF COALESCE(_po_required, 'optional') = 'mandatory' AND _inv.po_id IS NULL THEN
    RAISE EXCEPTION 'La société exige un bon de commande : la facture % doit citer la commande du fournisseur', _inv.invoice_number
      USING ERRCODE = 'QG008', HINT = 'Paramètres fournisseurs : « bon de commande requis ».';
  END IF;

  IF _inv.po_id IS NOT NULL THEN
    -- Reçu facturable : net de tous les retours fournisseurs (V52).
    SELECT COALESCE(sum(gl.quantity_received * pl.unit_cost), 0)
           - COALESCE((SELECT sum(rl.quantity * rl.unit_cost) FROM public.supplier_return_lines rl
                         JOIN public.supplier_returns sr ON sr.id = rl.return_id WHERE sr.po_id = _inv.po_id), 0) INTO _recu
      FROM public.gr_lines gl
      JOIN public.goods_receipts g ON g.id = gl.gr_id AND g.status = 'completed'
      JOIN public.po_lines pl ON pl.id = gl.po_line_id
     WHERE g.po_id = _inv.po_id;
    IF COALESCE(_gr_required, false) AND _recu = 0 THEN
      RAISE EXCEPTION 'La société exige une réception avant la facture : la commande citée par % n''a aucune réception validée',
        _inv.invoice_number USING ERRCODE = 'QG008', HINT = 'Paramètres des achats : « réception avant facture ».';
    END IF;
    IF COALESCE(_three_way, false) AND NOT _lines_po THEN
      SELECT COALESCE(sum(a.subtotal), 0) INTO _deja FROM public.ap_invoices a
       WHERE a.po_id = _inv.po_id AND a.id <> _inv.id AND a.approval_status IN ('submitted', 'approved');
      _reste := _recu - _deja;
      _tol := greatest(COALESCE(_tol_amount, 0), _reste * COALESCE(_tol_pct, 0) / 100);
      IF _inv.subtotal > _reste + _tol THEN
        RAISE EXCEPTION 'Rapprochement à 3 voies : % HT facturé pour % reçu non encore facturé (tolérance %) sur la commande',
          _inv.subtotal, _reste, round(_tol, 2) USING ERRCODE = 'QG008',
          HINT = 'Facturer au plus la valeur reçue, ou réceptionner le reste de la commande.';
      END IF;
    END IF;
  END IF;

  -- Rapprochement à 3 voies ligne à ligne (lignes rattachées à la commande) : quantité et prix.
  IF _lines_po THEN
    FOR _l IN SELECT l.*, pl.unit_cost, pl.description AS po_desc FROM public.ap_invoice_lines l JOIN public.po_lines pl ON pl.id = l.po_line_id
               WHERE l.invoice_id = _id ORDER BY l.line_no LOOP
      _recu_q := public.po_line_received(_l.po_line_id);
      IF COALESCE(_gr_required, false) AND _recu_q <= 0 THEN
        RAISE EXCEPTION 'Ligne % (« % ») : aucune réception validée, la société exige la réception avant la facture', _l.line_no, _l.description
          USING ERRCODE = 'QG008', HINT = 'Paramètres des achats : « réception avant facture ».';
      END IF;
      IF COALESCE(_three_way, false) THEN
        _fact_q := public.po_line_invoiced(_l.po_line_id, _id);
        IF _l.quantity > (_recu_q - _fact_q) * (1 + COALESCE(_tol_pct, 0) / 100) THEN
          RAISE EXCEPTION 'Rapprochement à 3 voies, ligne % (« % ») : % facturé pour % reçu non encore facturé', _l.line_no, _l.description,
            _l.quantity, greatest(_recu_q - _fact_q, 0) USING ERRCODE = 'QG008', HINT = 'Facturer au plus la quantité reçue, ou réceptionner le reste.';
        END IF;
        _ecart := round((_l.unit_price * (1 - _l.discount_pct / 100) - COALESCE(_l.unit_cost, 0)) * _l.quantity, 2);
        IF _ecart > greatest(COALESCE(_tol_amount, 0), round(COALESCE(_l.unit_cost, 0) * _l.quantity * COALESCE(_tol_pct, 0) / 100, 2)) THEN
          RAISE EXCEPTION 'Rapprochement à 3 voies, ligne % (« % ») : prix % au-dessus du prix commandé % (écart % hors tolérance)', _l.line_no, _l.description,
            round(_l.unit_price * (1 - _l.discount_pct / 100), 2), _l.unit_cost, _ecart USING ERRCODE = 'QG008',
            HINT = 'Corriger le prix, ou faire modifier la commande.';
        END IF;
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.ap_invoice_approvals WHERE invoice_id = _id;
  FOR _t IN
    SELECT * FROM public.ap_approval_thresholds
     WHERE tenant_id = _inv.tenant_id AND (doc_types ILIKE '%facture%' OR doc_types ILIKE '%tous%')
     ORDER BY max_amount NULLS LAST, level
  LOOP
    _n := _n + 1;
    INSERT INTO public.ap_invoice_approvals (tenant_id, invoice_id, level_order, level_label, approver_label, amount)
    VALUES (_inv.tenant_id, _id, _n, _t.level, _t.approver, _inv.total);
    EXIT WHEN _t.max_amount IS NULL OR _inv.total <= _t.max_amount OR _n = 9;
  END LOOP;
  IF _n = 0 THEN
    INSERT INTO public.ap_invoice_approvals (tenant_id, invoice_id, level_order, level_label, approver_label, amount)
    VALUES (_inv.tenant_id, _id, 1, 'L1', 'Approbateur niveau 1', _inv.total);
    _n := 1;
  END IF;

  UPDATE public.ap_invoices SET approval_status = 'submitted' WHERE id = _id;
  RETURN _n;
END $function$;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
