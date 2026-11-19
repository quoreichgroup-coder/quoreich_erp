-- V109 — Notes de frais : catégories, règles, approbation par niveaux, comptabilisation, remboursement.
--
-- Avant : deux tables sans règle (en-tête et lignes), politiques FOR ALL ouvertes à tout membre, aucun
-- calcul, aucune écriture ; les six écrans affichaient des données de démonstration. Aucune note n'existait.
-- Références : SAP Concur / SAP Travel Management (note → approbation hiérarchique → comptabilisation →
-- remboursement), Sage X3 (notes de frais : catégories de frais, plafonds, justificatifs), OHADA (pièce
-- justificative, AUDCIF art. 19 ; TVA récupérable seulement sur facture conforme).
--
-- Cycle : brouillon → soumise (justificatifs et plafonds contrôlés, numéro légal, file d'approbation à partir
-- des seuils) → approuvée niveau par niveau (jamais par son auteur, jamais deux fois par la même personne) →
-- comptabilisée (débit compte de la catégorie HT + TVA récupérable, crédit « Notes de frais à rembourser »)
-- → remboursée (débit « à rembourser », crédit trésorerie). Rejetée = modifiable et soumise de nouveau.
-- Montants saisis TTC (montant du justificatif) ; HT et TVA calculés par le code TVA de la ligne.
-- Rien n'est pré-rempli : catégories, plafonds et seuils sont ceux de la société (vide = pas de contrôle).

-- ─── Rôle de comptabilisation ───
INSERT INTO public.posting_roles (code, label, module, description, expected_prefixes) VALUES
  ('EXPENSE_PAYABLE', 'Personnel, notes de frais à rembourser', 'EXP', 'Crédité du total des notes de frais comptabilisées, débité au remboursement', ARRAY['42'])
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.framework_role_expectations (framework_code, role_code, prefixes)
SELECT f.code, 'EXPENSE_PAYABLE', ARRAY['42'] FROM public.accounting_frameworks f
 WHERE f.code IN ('SYSCOHADA_REVISE', 'PCG_FR')
ON CONFLICT (framework_code, role_code) DO NOTHING;
-- Compte proposé : celui des rémunérations dues au personnel du référentiel (sommes dues aux salariés).
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT d.framework_code, 'EXPENSE_PAYABLE', d.account_code FROM public.accounting_framework_role_defaults d
 WHERE d.role_code = 'PAYROLL_NET_PAYABLE'
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults x WHERE x.framework_code = d.framework_code AND x.role_code = 'EXPENSE_PAYABLE');
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, 'EXPENSE_PAYABLE', g.id
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code = 'EXPENSE_PAYABLE'
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = d.account_code AND g.is_active
ON CONFLICT (tenant_id, role_code) DO NOTHING;

-- La trésorerie connaît l'origine « note de frais ».
ALTER TABLE public.bank_transactions DROP CONSTRAINT bank_transactions_source_check;
ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_source_check
  CHECK (source = ANY (ARRAY['manual', 'payment', 'advance', 'refund', 'transfer', 'statement', 'expense']));

-- Journaux : la note comptabilisée en opérations diverses, son remboursement en banque.
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
    WHEN 'expense_payment' THEN 'BQ'
    WHEN 'payroll' THEN 'PA'
    ELSE 'OD'
  END
$function$;

-- ─── Droits du catalogue ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('expenses.submit', 'expenses', 'submit', 'Saisir et soumettre ses notes de frais'),
  ('expenses.manage', 'expenses', 'manage', 'Saisir et modifier les notes de frais de tout salarié'),
  ('expenses.view_all', 'expenses', 'view_all', 'Consulter toutes les notes de frais de la société'),
  ('expenses.approve_l1', 'expenses', 'approve_l1', 'Approuver les notes de frais — niveau 1'),
  ('expenses.approve_l2', 'expenses', 'approve_l2', 'Approuver les notes de frais — niveau 2'),
  ('expenses.approve_l3', 'expenses', 'approve_l3', 'Approuver les notes de frais — niveau 3'),
  ('expenses.post', 'expenses', 'post', 'Comptabiliser les notes de frais approuvées'),
  ('expenses.pay', 'expenses', 'pay', 'Rembourser les notes de frais'),
  ('expenses.settings', 'expenses', 'settings', 'Paramétrer les notes de frais (catégories, plafonds, seuils)'),
  ('expenses.export', 'expenses', 'export', 'Exporter les notes de frais')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES
  ('admin', 'expenses.submit'), ('admin', 'expenses.manage'), ('admin', 'expenses.view_all'), ('admin', 'expenses.approve_l1'),
  ('admin', 'expenses.approve_l2'), ('admin', 'expenses.approve_l3'), ('admin', 'expenses.post'), ('admin', 'expenses.pay'),
  ('admin', 'expenses.settings'), ('admin', 'expenses.export'),
  ('expense_admin', 'expenses.submit'), ('expense_admin', 'expenses.manage'), ('expense_admin', 'expenses.view_all'),
  ('expense_admin', 'expenses.approve_l1'), ('expense_admin', 'expenses.approve_l2'), ('expense_admin', 'expenses.settings'), ('expense_admin', 'expenses.export'),
  ('expense_clerk', 'expenses.submit'),
  ('expense_approver', 'expenses.submit'), ('expense_approver', 'expenses.view_all'), ('expense_approver', 'expenses.approve_l1'), ('expense_approver', 'expenses.export'),
  ('expense_controller', 'expenses.submit'), ('expense_controller', 'expenses.manage'), ('expense_controller', 'expenses.view_all'),
  ('expense_controller', 'expenses.approve_l2'), ('expense_controller', 'expenses.post'), ('expense_controller', 'expenses.pay'), ('expense_controller', 'expenses.export'),
  ('accountant', 'expenses.submit'), ('accountant', 'expenses.view_all'), ('accountant', 'expenses.post'), ('accountant', 'expenses.pay'), ('accountant', 'expenses.export'),
  ('manager', 'expenses.submit'), ('manager', 'expenses.view_all'), ('manager', 'expenses.approve_l1')) AS v(r, p)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND sp.permission_code LIKE 'expenses.%'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── Référentiel et paramètres ───
CREATE TABLE public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  gl_account_id uuid NOT NULL,
  default_tax_code_id uuid,
  receipt_required_above numeric(18, 2) CHECK (receipt_required_above IS NULL OR receipt_required_above >= 0),
  max_amount_per_line numeric(18, 2) CHECK (max_amount_per_line IS NULL OR max_amount_per_line > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (gl_account_id, tenant_id) REFERENCES public.gl_accounts(id, tenant_id),
  FOREIGN KEY (default_tax_code_id, tenant_id) REFERENCES public.tax_codes(id, tenant_id)
);
COMMENT ON COLUMN public.expense_categories.receipt_required_above IS 'Justificatif exigé à partir de ce montant TTC ; NULL = paramètre général.';

CREATE TABLE public.expense_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  receipt_required_above numeric(18, 2) CHECK (receipt_required_above IS NULL OR receipt_required_above >= 0),
  max_report_amount numeric(18, 2) CHECK (max_report_amount IS NULL OR max_report_amount > 0),
  late_submission_days integer CHECK (late_submission_days IS NULL OR late_submission_days BETWEEN 1 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);
COMMENT ON TABLE public.expense_settings IS 'Paramètres des notes de frais ; NULL = contrôle désactivé (aucun plafond imposé).';

CREATE TABLE public.expense_approval_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (btrim(level) <> ''),
  max_amount numeric CHECK (max_amount IS NULL OR max_amount > 0),
  approver text NOT NULL CHECK (btrim(approver) <> ''),
  sla_hours integer NOT NULL DEFAULT 24 CHECK (sla_hours > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, level)
);

-- ─── Notes et lignes ───
ALTER TABLE public.expense_reports
  ADD COLUMN purpose text,
  ADD COLUMN period_start date,
  ADD COLUMN period_end date,
  ADD COLUMN currency text NOT NULL DEFAULT 'XOF',
  ADD COLUMN subtotal numeric(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN tax_amount numeric(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN created_by uuid DEFAULT auth.uid(),
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN posted_at timestamptz,
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN payment_journal_entry_id uuid REFERENCES public.journal_entries(id),
  ADD COLUMN bank_account_id uuid,
  ADD COLUMN rejection_reason text,
  ADD COLUMN cancel_reason text,
  ADD COLUMN notes text;
UPDATE public.expense_reports SET status = 'draft' WHERE status IS NULL OR status NOT IN ('draft', 'submitted', 'approved', 'rejected', 'posted', 'paid', 'cancelled');
ALTER TABLE public.expense_reports ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE public.expense_reports ADD CONSTRAINT expense_reports_status_check
  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'posted', 'paid', 'cancelled'));
ALTER TABLE public.expense_reports ADD CONSTRAINT expense_reports_period_check CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end);
ALTER TABLE public.expense_reports ADD CONSTRAINT expense_reports_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE public.expense_reports ADD CONSTRAINT expense_reports_bank_account_fkey FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id);
CREATE UNIQUE INDEX expense_reports_number_key ON public.expense_reports (tenant_id, report_number);
-- Le salarié de la note appartient à la société (contrôlé aussi par l'isolation générale).
ALTER TABLE public.expense_reports DROP CONSTRAINT IF EXISTS expense_reports_employee_id_fkey;
ALTER TABLE public.expense_reports ADD CONSTRAINT expense_reports_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);

ALTER TABLE public.expense_lines
  ADD COLUMN tenant_id uuid,
  ADD COLUMN line_no integer NOT NULL DEFAULT 1,
  ADD COLUMN category_id uuid,
  ADD COLUMN tax_code_id uuid,
  ADD COLUMN merchant text,
  ADD COLUMN receipt_ref text,
  ADD COLUMN net_amount numeric(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN tax_amount numeric(18, 2) NOT NULL DEFAULT 0;
UPDATE public.expense_lines l SET tenant_id = r.tenant_id FROM public.expense_reports r WHERE r.id = l.report_id;
ALTER TABLE public.expense_lines ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.expense_lines ADD CONSTRAINT expense_lines_amount_check CHECK (amount > 0);
ALTER TABLE public.expense_lines ADD CONSTRAINT expense_lines_report_fkey FOREIGN KEY (report_id, tenant_id) REFERENCES public.expense_reports(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.expense_lines ADD CONSTRAINT expense_lines_category_fkey FOREIGN KEY (category_id, tenant_id) REFERENCES public.expense_categories(id, tenant_id);
ALTER TABLE public.expense_lines ADD CONSTRAINT expense_lines_tax_code_fkey FOREIGN KEY (tax_code_id, tenant_id) REFERENCES public.tax_codes(id, tenant_id);

CREATE TABLE public.expense_report_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  report_id uuid NOT NULL,
  level_order integer NOT NULL,
  level_label text NOT NULL,
  approver_label text NOT NULL,
  sla_hours integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  decided_by uuid,
  decided_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (report_id, tenant_id) REFERENCES public.expense_reports(id, tenant_id) ON DELETE CASCADE
);

-- ─── Calculs ───
-- Ligne : TTC saisi, TVA = TTC × taux / (100 + taux) arrondie au centime, HT = TTC − TVA.
CREATE FUNCTION public.compute_expense_line() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _rate numeric;
BEGIN
  SELECT tenant_id INTO NEW.tenant_id FROM public.expense_reports WHERE id = NEW.report_id;
  IF NEW.tax_code_id IS NULL AND NEW.category_id IS NOT NULL THEN
    SELECT default_tax_code_id INTO NEW.tax_code_id FROM public.expense_categories WHERE id = NEW.category_id;
  END IF;
  -- Libellé de la catégorie photographié sur la ligne (colonne historique « category »).
  IF NEW.category_id IS NOT NULL THEN SELECT name INTO NEW.category FROM public.expense_categories WHERE id = NEW.category_id; END IF;
  NEW.category := COALESCE(NEW.category, '');
  SELECT rate INTO _rate FROM public.tax_codes WHERE id = NEW.tax_code_id;
  NEW.tax_amount := CASE WHEN COALESCE(_rate, 0) > 0 THEN round(NEW.amount * _rate / (100 + _rate), 2) ELSE 0 END;
  NEW.net_amount := NEW.amount - NEW.tax_amount;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_compute_expense_line BEFORE INSERT OR UPDATE ON public.expense_lines
  FOR EACH ROW EXECUTE FUNCTION public.compute_expense_line();

CREATE FUNCTION public.sync_expense_report_totals() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid := COALESCE(NEW.report_id, OLD.report_id);
BEGIN
  PERFORM set_config('qerp.expense_system', 'on', true);
  UPDATE public.expense_reports r SET
    total = COALESCE((SELECT SUM(amount) FROM public.expense_lines WHERE report_id = _id), 0),
    subtotal = COALESCE((SELECT SUM(net_amount) FROM public.expense_lines WHERE report_id = _id), 0),
    tax_amount = COALESCE((SELECT SUM(tax_amount) FROM public.expense_lines WHERE report_id = _id), 0)
   WHERE r.id = _id;
  PERFORM set_config('qerp.expense_system', 'off', true);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_sync_expense_report_totals AFTER INSERT OR UPDATE OR DELETE ON public.expense_lines
  FOR EACH ROW EXECUTE FUNCTION public.sync_expense_report_totals();

-- Numéro provisoire d'un brouillon ; le numéro légal est attribué à la soumission.
CREATE FUNCTION public.default_expense_report_number() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.report_number IS NULL OR btrim(NEW.report_number) = '' THEN NEW.report_number := 'BROUILLON-' || substr(NEW.id::text, 1, 8); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_default_expense_report_number BEFORE INSERT ON public.expense_reports
  FOR EACH ROW EXECUTE FUNCTION public.default_expense_report_number();

-- ─── Gardes (pas SECURITY DEFINER : elles voient le rôle de l'appelant) ───
CREATE FUNCTION public.guard_expense_report() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _r record;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.report_number NOT LIKE 'BROUILLON-%' OR NEW.journal_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'Une note de frais se crée en brouillon ; la soumission lui donne son numéro' USING ERRCODE = 'QG027';
    END IF;
    NEW.created_by := auth.uid();
    IF NOT public.has_permission(auth.uid(), 'expenses.submit') AND NOT public.has_permission(auth.uid(), 'expenses.manage') THEN
      RAISE EXCEPTION 'Droit insuffisant : « expenses.submit » requis' USING ERRCODE = '42501';
    END IF;
    NEW.total := 0; NEW.subtotal := 0; NEW.tax_amount := 0;
    RETURN NEW;
  END IF;
  _r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE OLD END;
  IF OLD.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Note de frais % (%) : plus modifiable', COALESCE(OLD.report_number, 'brouillon'), OLD.status USING ERRCODE = 'QG027';
  END IF;
  IF OLD.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_permission(auth.uid(), 'expenses.manage') THEN
    RAISE EXCEPTION 'Seul l''auteur (ou le droit « expenses.manage ») modifie cette note' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Seul un brouillon se supprime ; une note rejetée s''annule' USING ERRCODE = 'QG027'; END IF;
    RETURN OLD;
  END IF;
  IF current_setting('qerp.expense_system', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.report_number IS DISTINCT FROM OLD.report_number
     OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id OR NEW.payment_journal_entry_id IS DISTINCT FROM OLD.payment_journal_entry_id
     OR NEW.total IS DISTINCT FROM OLD.total OR NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.posted_at IS DISTINCT FROM OLD.posted_at OR NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Statut, numéro, montants et écritures d''une note de frais changent par ses fonctions (soumettre, approuver, comptabiliser, rembourser)'
      USING ERRCODE = 'QG027';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_expense_report BEFORE INSERT OR UPDATE OR DELETE ON public.expense_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_expense_report();

CREATE FUNCTION public.guard_expense_line() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _rep record;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status, created_by INTO _rep FROM public.expense_reports WHERE id = COALESCE(NEW.report_id, OLD.report_id);
  IF _rep.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Lignes d''une note % : plus modifiables', _rep.status USING ERRCODE = 'QG027';
  END IF;
  IF _rep.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_permission(auth.uid(), 'expenses.manage') THEN
    RAISE EXCEPTION 'Seul l''auteur (ou le droit « expenses.manage ») modifie les lignes de cette note' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.expense_categories c WHERE c.id = NEW.category_id AND c.is_active) THEN
    RAISE EXCEPTION 'Catégorie de frais inactive' USING ERRCODE = 'QG027';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard_expense_line BEFORE INSERT OR UPDATE OR DELETE ON public.expense_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_expense_line();

-- ─── Fonctions du cycle de vie ───
CREATE FUNCTION public.expense_report_submit(_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _r public.expense_reports%ROWTYPE; _s public.expense_settings%ROWTYPE; _l record; _t record; _n integer := 0; _issues text[] := '{}';
BEGIN
  SELECT * INTO _r FROM public.expense_reports WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Note de frais introuvable dans la société active' USING ERRCODE = 'QG027'; END IF;
  IF _r.status NOT IN ('draft', 'rejected') THEN RAISE EXCEPTION 'Seule une note en brouillon ou rejetée se soumet' USING ERRCODE = 'QG027'; END IF;
  IF _r.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_permission(auth.uid(), 'expenses.manage') THEN
    RAISE EXCEPTION 'Seul l''auteur (ou le droit « expenses.manage ») soumet cette note' USING ERRCODE = '42501';
  END IF;
  IF _r.employee_id IS NULL THEN RAISE EXCEPTION 'Indiquer le salarié concerné par la note' USING ERRCODE = 'QG027'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.expense_lines WHERE report_id = _id) THEN
    RAISE EXCEPTION 'Une note sans dépense ne se soumet pas' USING ERRCODE = 'QG027';
  END IF;
  SELECT * INTO _s FROM public.expense_settings WHERE tenant_id = _tenant;
  FOR _l IN SELECT l.*, c.name AS cname, c.receipt_required_above AS c_receipt, c.max_amount_per_line AS c_max
              FROM public.expense_lines l LEFT JOIN public.expense_categories c ON c.id = l.category_id
             WHERE l.report_id = _id ORDER BY l.line_no LOOP
    IF _l.category_id IS NULL THEN _issues := _issues || format('ligne %s : catégorie manquante', _l.line_no); END IF;
    IF COALESCE(_l.c_receipt, _s.receipt_required_above) IS NOT NULL AND _l.amount >= COALESCE(_l.c_receipt, _s.receipt_required_above)
       AND btrim(COALESCE(_l.receipt_ref, '')) = '' THEN
      _issues := _issues || format('ligne %s : justificatif exigé à partir de %s', _l.line_no, COALESCE(_l.c_receipt, _s.receipt_required_above));
    END IF;
    IF _l.c_max IS NOT NULL AND _l.amount > _l.c_max THEN
      _issues := _issues || format('ligne %s : %s dépasse le plafond de la catégorie %s (%s)', _l.line_no, _l.amount, _l.cname, _l.c_max);
    END IF;
    IF _s.late_submission_days IS NOT NULL AND _l.expense_date < CURRENT_DATE - _s.late_submission_days THEN
      _issues := _issues || format('ligne %s : dépense du %s, au-delà du délai de %s jours', _l.line_no, to_char(_l.expense_date, 'DD/MM/YYYY'), _s.late_submission_days);
    END IF;
  END LOOP;
  IF _s.max_report_amount IS NOT NULL AND _r.total > _s.max_report_amount THEN
    _issues := _issues || format('total %s au-delà du plafond par note (%s)', _r.total, _s.max_report_amount);
  END IF;
  IF cardinality(_issues) > 0 THEN
    RAISE EXCEPTION 'Note de frais non conforme : %', array_to_string(_issues, ' ; ') USING ERRCODE = 'QG027';
  END IF;

  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _tenant, 'expense_report', 'NDF-', 'NDF-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _tenant AND doc_type = 'expense_report');

  DELETE FROM public.expense_report_approvals WHERE report_id = _id;
  FOR _t IN SELECT * FROM public.expense_approval_thresholds WHERE tenant_id = _tenant ORDER BY max_amount NULLS LAST, level LOOP
    _n := _n + 1;
    INSERT INTO public.expense_report_approvals (tenant_id, report_id, level_order, level_label, approver_label, sla_hours)
    VALUES (_tenant, _id, _n, _t.level, _t.approver, _t.sla_hours);
    EXIT WHEN _t.max_amount IS NULL OR _r.total <= _t.max_amount OR _n = 3;
  END LOOP;
  IF _n = 0 THEN
    _n := 1;
    INSERT INTO public.expense_report_approvals (tenant_id, report_id, level_order, level_label, approver_label)
    VALUES (_tenant, _id, 1, 'L1', 'Responsable');
  END IF;

  PERFORM set_config('qerp.expense_system', 'on', true);
  UPDATE public.expense_reports SET status = 'submitted', submitted_at = now(), submission_date = CURRENT_DATE, rejection_reason = NULL,
         report_number = CASE WHEN report_number LIKE 'BROUILLON-%' THEN public.next_document_number(_tenant, 'expense_report', CURRENT_DATE) ELSE report_number END
   WHERE id = _id;
  PERFORM set_config('qerp.expense_system', 'off', true);
  RETURN _n;
END $$;

CREATE FUNCTION public.expense_report_decide(_approval uuid, _approve boolean, _comment text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _a public.expense_report_approvals%ROWTYPE; _r public.expense_reports%ROWTYPE; _next integer;
BEGIN
  SELECT * INTO _a FROM public.expense_report_approvals WHERE id = _approval AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Étape d''approbation introuvable dans la société active' USING ERRCODE = 'QG027'; END IF;
  SELECT * INTO _r FROM public.expense_reports WHERE id = _a.report_id FOR UPDATE;
  IF _r.status <> 'submitted' OR _a.status <> 'pending' THEN RAISE EXCEPTION 'Cette étape n''est plus en attente' USING ERRCODE = 'QG027'; END IF;
  IF EXISTS (SELECT 1 FROM public.expense_report_approvals WHERE report_id = _a.report_id AND status = 'pending' AND level_order < _a.level_order) THEN
    RAISE EXCEPTION 'Les niveaux s''approuvent dans l''ordre' USING ERRCODE = 'QG027';
  END IF;
  IF _r.created_by = auth.uid() THEN RAISE EXCEPTION 'L''auteur d''une note ne l''approuve pas' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.expense_report_approvals WHERE report_id = _a.report_id AND status = 'approved' AND decided_by = auth.uid()) THEN
    RAISE EXCEPTION 'Une même personne n''approuve pas deux niveaux' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission(auth.uid(), 'expenses.approve_l' || least(_a.level_order, 3)) THEN
    RAISE EXCEPTION 'Droit insuffisant : « expenses.approve_l% » requis', least(_a.level_order, 3) USING ERRCODE = '42501';
  END IF;
  IF NOT _approve AND btrim(COALESCE(_comment, '')) = '' THEN RAISE EXCEPTION 'Motif du rejet obligatoire' USING ERRCODE = 'QG027'; END IF;

  UPDATE public.expense_report_approvals SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         decided_by = auth.uid(), decided_at = now(), comment = NULLIF(btrim(_comment), '') WHERE id = _approval;
  PERFORM set_config('qerp.expense_system', 'on', true);
  IF NOT _approve THEN
    UPDATE public.expense_report_approvals SET status = 'skipped' WHERE report_id = _a.report_id AND status = 'pending';
    UPDATE public.expense_reports SET status = 'rejected', rejection_reason = btrim(_comment) WHERE id = _a.report_id;
    PERFORM set_config('qerp.expense_system', 'off', true);
    RETURN 'rejected';
  END IF;
  SELECT min(level_order) INTO _next FROM public.expense_report_approvals WHERE report_id = _a.report_id AND status = 'pending';
  IF _next IS NULL THEN
    UPDATE public.expense_reports SET status = 'approved', approved_at = now() WHERE id = _a.report_id;
    PERFORM set_config('qerp.expense_system', 'off', true);
    RETURN 'approved';
  END IF;
  PERFORM set_config('qerp.expense_system', 'off', true);
  RETURN 'pending';
END $$;

-- Comptabilisation : débit compte de chaque catégorie (HT), TVA par compte du code TVA (sinon rôle TVA
-- récupérable), crédit « notes de frais à rembourser » ; journal des opérations diverses.
CREATE FUNCTION public.expense_report_post(_id uuid, _date date DEFAULT CURRENT_DATE) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _r public.expense_reports%ROWTYPE; _entry uuid; _payable uuid; _g record; _who text;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'expenses.post') THEN RAISE EXCEPTION 'Droit insuffisant : « expenses.post » requis' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _r FROM public.expense_reports WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Note de frais introuvable dans la société active' USING ERRCODE = 'QG027'; END IF;
  IF _r.status <> 'approved' THEN RAISE EXCEPTION 'Seule une note approuvée se comptabilise' USING ERRCODE = 'QG027'; END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'GL');
  _payable := public.require_posting_account(_tenant, 'EXPENSE_PAYABLE');
  SELECT e.first_name || ' ' || e.last_name INTO _who FROM public.employees e WHERE e.id = _r.employee_id;
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-NDF-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(_id::text, 1, 8), _date,
          'Note de frais ' || _r.report_number || COALESCE(' — ' || _who, ''), 'expense_report', 'draft', auth.uid())
  RETURNING id INTO _entry;
  FOR _g IN SELECT c.gl_account_id AS acc, SUM(l.net_amount) AS amt FROM public.expense_lines l JOIN public.expense_categories c ON c.id = l.category_id
             WHERE l.report_id = _id GROUP BY c.gl_account_id LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description) VALUES (_entry, _g.acc, _g.amt, 0, 'Frais ' || _r.report_number);
  END LOOP;
  FOR _g IN SELECT COALESCE(t.gl_account_id, public.require_posting_account(_tenant, 'VAT_INPUT')) AS acc, SUM(l.tax_amount) AS amt
              FROM public.expense_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
             WHERE l.report_id = _id AND l.tax_amount > 0 GROUP BY 1 LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description) VALUES (_entry, _g.acc, _g.amt, 0, 'TVA récupérable ' || _r.report_number);
  END LOOP;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry, _payable, 0, _r.total, 'À rembourser' || COALESCE(' — ' || _who, ''));
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;
  PERFORM set_config('qerp.expense_system', 'on', true);
  UPDATE public.expense_reports SET status = 'posted', posted_at = now(), journal_entry_id = _entry WHERE id = _id;
  PERFORM set_config('qerp.expense_system', 'off', true);
  RETURN _entry;
END $$;

CREATE FUNCTION public.expense_report_pay(_id uuid, _date date DEFAULT CURRENT_DATE, _payment_method text DEFAULT 'bank_transfer',
  _bank_account_id uuid DEFAULT NULL, _reference text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _r public.expense_reports%ROWTYPE; _treso uuid; _entry uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'expenses.pay') THEN RAISE EXCEPTION 'Droit insuffisant : « expenses.pay » requis' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _r FROM public.expense_reports WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Note de frais introuvable dans la société active' USING ERRCODE = 'QG027'; END IF;
  IF _r.status <> 'posted' THEN RAISE EXCEPTION 'Seule une note comptabilisée se rembourse' USING ERRCODE = 'QG027'; END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'TREASURY');
  _treso := public.resolve_treasury_account(_tenant, _bank_account_id, _payment_method);
  _entry := public.post_two_line_entry(_tenant, _date, 'expense_payment', 'Remboursement de la note ' || _r.report_number,
    public.require_posting_account(_tenant, 'EXPENSE_PAYABLE'), public.treasury_gl_account(_tenant, _treso, _payment_method, true), _r.total);
  PERFORM public.record_treasury_line(_tenant, _treso, _date, -_r.total, 'expense', 'Remboursement de la note ' || _r.report_number,
    NULLIF(btrim(_reference), ''), _entry, NULL);
  PERFORM set_config('qerp.expense_system', 'on', true);
  UPDATE public.expense_reports SET status = 'paid', paid_at = now(), payment_journal_entry_id = _entry, bank_account_id = _treso WHERE id = _id;
  PERFORM set_config('qerp.expense_system', 'off', true);
  RETURN _entry;
END $$;

CREATE FUNCTION public.expense_report_cancel(_id uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _r public.expense_reports%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM public.expense_reports WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Note de frais introuvable dans la société active' USING ERRCODE = 'QG027'; END IF;
  IF _r.status NOT IN ('draft', 'submitted', 'rejected') THEN
    RAISE EXCEPTION 'Une note approuvée ou comptabilisée ne s''annule pas ici (contre-passer l''écriture)' USING ERRCODE = 'QG027';
  END IF;
  IF _r.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_permission(auth.uid(), 'expenses.manage') THEN
    RAISE EXCEPTION 'Seul l''auteur (ou le droit « expenses.manage ») annule cette note' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(_reason, '')) = '' THEN RAISE EXCEPTION 'Motif de l''annulation obligatoire' USING ERRCODE = 'QG027'; END IF;
  UPDATE public.expense_report_approvals SET status = 'skipped' WHERE report_id = _id AND status = 'pending';
  PERFORM set_config('qerp.expense_system', 'on', true);
  UPDATE public.expense_reports SET status = 'cancelled', cancel_reason = btrim(_reason) WHERE id = _id;
  PERFORM set_config('qerp.expense_system', 'off', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.expense_report_submit(uuid), public.expense_report_decide(uuid, boolean, text),
  public.expense_report_post(uuid, date), public.expense_report_pay(uuid, date, text, uuid, text), public.expense_report_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expense_report_submit(uuid), public.expense_report_decide(uuid, boolean, text),
  public.expense_report_post(uuid, date), public.expense_report_pay(uuid, date, text, uuid, text), public.expense_report_cancel(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_expense_report_totals() FROM PUBLIC, anon, authenticated;

-- ─── RLS ───
DROP POLICY IF EXISTS "Tenant isolation" ON public.expense_reports;
DROP POLICY IF EXISTS "Access via report" ON public.expense_lines;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_approval_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_report_approvals ENABLE ROW LEVEL SECURITY;

-- Confidentialité : chacun voit ses notes ; « expenses.view_all » voit celles de la société.
CREATE POLICY "Lecture : auteur ou droit de consultation" ON public.expense_reports FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (created_by = auth.uid() OR public.has_permission(auth.uid(), 'expenses.view_all')));
CREATE POLICY "Saisie" ON public.expense_reports FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Modification par l'auteur ou le gestionnaire" ON public.expense_reports FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (created_by = auth.uid() OR public.has_permission(auth.uid(), 'expenses.manage')))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Suppression par l'auteur ou le gestionnaire" ON public.expense_reports FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (created_by = auth.uid() OR public.has_permission(auth.uid(), 'expenses.manage')));

CREATE POLICY "Lecture avec la note" ON public.expense_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expense_reports r WHERE r.id = expense_lines.report_id));
CREATE POLICY "Écriture avec la note" ON public.expense_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expense_reports r WHERE r.id = expense_lines.report_id
                  AND (r.created_by = auth.uid() OR public.has_permission(auth.uid(), 'expenses.manage'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.expense_reports r WHERE r.id = expense_lines.report_id
                       AND (r.created_by = auth.uid() OR public.has_permission(auth.uid(), 'expenses.manage'))));

CREATE POLICY "Lecture avec la note" ON public.expense_report_approvals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expense_reports r WHERE r.id = expense_report_approvals.report_id));

CREATE POLICY "Lecture société" ON public.expense_categories FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.expense_categories FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'expenses.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'expenses.settings'));
CREATE POLICY "Lecture société" ON public.expense_settings FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.expense_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'expenses.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'expenses.settings'));
CREATE POLICY "Lecture société" ON public.expense_approval_thresholds FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.expense_approval_thresholds FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'expenses.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'expenses.settings'));

REVOKE ALL ON public.expense_categories, public.expense_settings, public.expense_approval_thresholds, public.expense_report_approvals,
  public.expense_reports, public.expense_lines FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_categories, public.expense_settings, public.expense_approval_thresholds,
  public.expense_reports, public.expense_lines TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.expense_report_approvals FROM authenticated;
GRANT SELECT ON public.expense_report_approvals TO authenticated;

SELECT public.install_tenant_isolation_triggers();
