-- V112 — Notes de frais : avances au salarié, barèmes (indemnités kilométriques, per diem), dépenses en
-- devise, justificatif joint.
--
-- Suite de V109 (restes listés dans docs/audit-erp/22). Références : SAP Travel Management (avances de
-- voyage imputées au décompte ; indemnités forfaitaires par barème ; dépenses en devise au cours du
-- jour), Sage X3 (avances sur frais, barèmes kilométriques), SYSCOHADA (compte du personnel « avances
-- et acomptes » distinct des sommes dues au personnel).
--
-- • Avance : versée par la trésorerie (débit « avances au personnel », crédit trésorerie), numérotée
--   AVS-AAAA-####. Au remboursement d'une note, les avances ouvertes du salarié s'imputent d'abord
--   (débit « à rembourser », crédit « avances ») ; seul le reste passe par la trésorerie. Une avance non
--   consommée se restitue (débit trésorerie, crédit « avances »).
-- • Barème : taux par unité (kilomètre, jour, nuit) fixé par la société, rattaché à une catégorie (son
--   compte), daté ; la ligne vaut quantité × taux, sans TVA. Aucun barème n'est pré-rempli.
-- • Devise : la ligne garde le montant d'origine, la devise et le cours saisi ; le montant de la note est
--   la contre-valeur dans la devise de la société, arrondie au centime.
-- • Justificatif : chemin du fichier déposé (stockage du nuage ; voir scripts/schema/supabase-platform.sql).

-- ─── Rôle « avances au personnel » ───
INSERT INTO public.posting_roles (code, label, module, description, expected_prefixes) VALUES
  ('EXPENSE_ADVANCE', 'Personnel, avances sur frais', 'EXP', 'Débité des avances versées aux salariés, crédité à leur imputation sur une note ou à leur restitution', ARRAY['42'])
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.framework_role_expectations (framework_code, role_code, prefixes)
SELECT f.code, 'EXPENSE_ADVANCE', ARRAY['42'] FROM public.accounting_frameworks f WHERE f.code IN ('SYSCOHADA_REVISE', 'PCG_FR')
ON CONFLICT (framework_code, role_code) DO NOTHING;
INSERT INTO public.framework_reference_accounts (framework_code, code, name, account_type)
SELECT v.f, v.c, v.n, v.t FROM (VALUES
  ('SYSCOHADA_REVISE', '4211', 'Personnel, avances', 'asset'),
  ('PCG_FR', '425', 'Personnel, avances et acomptes', 'asset')) AS v(f, c, n, t)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
ON CONFLICT (framework_code, code) DO NOTHING;
INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT v.f, v.c, v.n, v.t FROM (VALUES
  ('SYSCOHADA_REVISE', '4211', 'Personnel, avances', 'asset'),
  ('PCG_FR', '425', 'Personnel, avances et acomptes', 'asset')) AS v(f, c, n, t)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_accounts a WHERE a.framework_code = v.f AND a.code = v.c);
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT v.f, 'EXPENSE_ADVANCE', v.c FROM (VALUES ('SYSCOHADA_REVISE', '4211'), ('PCG_FR', '425')) AS v(f, c)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults d WHERE d.framework_code = v.f AND d.role_code = 'EXPENSE_ADVANCE');
INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
SELECT s.tenant_id, a.code, a.name, a.account_type
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code = 'EXPENSE_ADVANCE'
  JOIN public.accounting_framework_accounts a ON a.framework_code = d.framework_code AND a.code = d.account_code
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, 'EXPENSE_ADVANCE', g.id
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code = 'EXPENSE_ADVANCE'
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = d.account_code AND g.is_active
ON CONFLICT (tenant_id, role_code) DO NOTHING;

-- ─── Barèmes ───
CREATE TABLE public.expense_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('mileage', 'per_diem')),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  unit text NOT NULL CHECK (unit IN ('km', 'day', 'night', 'meal')),
  rate numeric(18, 2) NOT NULL CHECK (rate > 0),
  category_id uuid NOT NULL,
  valid_from date,
  valid_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (id, tenant_id),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to),
  FOREIGN KEY (category_id, tenant_id) REFERENCES public.expense_categories(id, tenant_id)
);
COMMENT ON TABLE public.expense_rates IS 'Barèmes de la société (indemnités kilométriques, per diem) ; aucun barème légal pré-rempli.';

-- ─── Lignes : barème, devise, justificatif ───
ALTER TABLE public.expense_lines
  ADD COLUMN rate_id uuid,
  ADD COLUMN quantity numeric(18, 3),
  ADD COLUMN original_currency text CHECK (original_currency IS NULL OR original_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN original_amount numeric(18, 2) CHECK (original_amount IS NULL OR original_amount > 0),
  ADD COLUMN exchange_rate numeric(18, 6) CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  ADD COLUMN receipt_path text;
ALTER TABLE public.expense_lines ADD CONSTRAINT expense_lines_rate_fkey FOREIGN KEY (rate_id, tenant_id) REFERENCES public.expense_rates(id, tenant_id);
ALTER TABLE public.expense_lines ADD CONSTRAINT expense_lines_rate_quantity_check CHECK (rate_id IS NULL OR quantity > 0);
ALTER TABLE public.expense_lines ADD CONSTRAINT expense_lines_currency_check
  CHECK ((original_amount IS NULL AND exchange_rate IS NULL) OR (original_amount IS NOT NULL AND exchange_rate IS NOT NULL AND original_currency IS NOT NULL));

-- Calcul : barème (quantité × taux, catégorie du barème, sans TVA), devise (montant d'origine × cours), sinon TTC saisi.
CREATE OR REPLACE FUNCTION public.compute_expense_line() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _rate numeric; _b record;
BEGIN
  SELECT tenant_id INTO NEW.tenant_id FROM public.expense_reports WHERE id = NEW.report_id;
  IF NEW.rate_id IS NOT NULL THEN
    SELECT rate, category_id INTO _b FROM public.expense_rates WHERE id = NEW.rate_id;
    NEW.category_id := _b.category_id;
    NEW.amount := round(COALESCE(NEW.quantity, 0) * _b.rate, 2);
    NEW.tax_code_id := NULL;
    NEW.original_currency := NULL; NEW.original_amount := NULL; NEW.exchange_rate := NULL;
  ELSIF NEW.original_amount IS NOT NULL THEN
    NEW.amount := round(NEW.original_amount * NEW.exchange_rate, 2);
  END IF;
  IF NEW.tax_code_id IS NULL AND NEW.category_id IS NOT NULL AND NEW.rate_id IS NULL THEN
    SELECT default_tax_code_id INTO NEW.tax_code_id FROM public.expense_categories WHERE id = NEW.category_id;
  END IF;
  IF NEW.category_id IS NOT NULL THEN SELECT name INTO NEW.category FROM public.expense_categories WHERE id = NEW.category_id; END IF;
  NEW.category := COALESCE(NEW.category, '');
  SELECT rate INTO _rate FROM public.tax_codes WHERE id = NEW.tax_code_id;
  NEW.tax_amount := CASE WHEN COALESCE(_rate, 0) > 0 THEN round(NEW.amount * _rate / (100 + _rate), 2) ELSE 0 END;
  NEW.net_amount := NEW.amount - NEW.tax_amount;
  RETURN NEW;
END $$;

-- Soumission : une indemnité au barème n'exige pas de justificatif de montant.
CREATE OR REPLACE FUNCTION public.expense_report_submit(_id uuid) RETURNS integer
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
    -- Indemnité au barème (kilométrique, per diem) : forfait, pas de justificatif de montant.
    IF _l.rate_id IS NULL AND COALESCE(_l.c_receipt, _s.receipt_required_above) IS NOT NULL AND _l.amount >= COALESCE(_l.c_receipt, _s.receipt_required_above)
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

-- Lignes : barème actif et valable à la date.
CREATE OR REPLACE FUNCTION public.guard_expense_line() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
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
  IF TG_OP <> 'DELETE' AND NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.status = 'active') THEN
    RAISE EXCEPTION 'Une dépense ne s''impute qu''à un projet actif' USING ERRCODE = 'QG027';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.rate_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.expense_rates r WHERE r.id = NEW.rate_id AND r.is_active
          AND (r.valid_from IS NULL OR NEW.expense_date >= r.valid_from) AND (r.valid_to IS NULL OR NEW.expense_date <= r.valid_to)) THEN
    RAISE EXCEPTION 'Barème inactif ou non valable à la date de la dépense' USING ERRCODE = 'QG027';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- ─── Avances ───
CREATE TABLE public.expense_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  advance_number text NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  advance_date date NOT NULL,
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  amount_applied numeric(18, 2) NOT NULL DEFAULT 0 CHECK (amount_applied >= 0),
  amount_refunded numeric(18, 2) NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
  purpose text,
  payment_method text NOT NULL,
  bank_account_id uuid REFERENCES public.bank_accounts(id),
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, advance_number),
  CHECK (amount_applied + amount_refunded <= amount)
);
CREATE TABLE public.expense_advance_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  advance_id uuid NOT NULL REFERENCES public.expense_advances(id),
  kind text NOT NULL CHECK (kind IN ('application', 'refund')),
  report_id uuid REFERENCES public.expense_reports(id),
  movement_date date NOT NULL,
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.expense_reports ADD COLUMN advance_applied numeric(18, 2) NOT NULL DEFAULT 0;

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
    WHEN 'expense_advance' THEN 'BQ'
    WHEN 'expense_advance_refund' THEN 'BQ'
    WHEN 'payroll' THEN 'PA'
    ELSE 'OD'
  END
$function$;

CREATE FUNCTION public.expense_advance_pay(_employee uuid, _date date, _amount numeric, _purpose text, _payment_method text DEFAULT 'bank_transfer',
  _bank_account_id uuid DEFAULT NULL, _reference text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _treso uuid; _entry uuid; _id uuid := gen_random_uuid(); _num text; _who text;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'expenses.pay') THEN RAISE EXCEPTION 'Droit insuffisant : « expenses.pay » requis' USING ERRCODE = '42501'; END IF;
  SELECT first_name || ' ' || last_name INTO _who FROM public.employees WHERE id = _employee AND tenant_id = _tenant AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Salarié actif introuvable dans la société active' USING ERRCODE = 'QG027'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Montant de l''avance à saisir' USING ERRCODE = 'QG027'; END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'TREASURY');
  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _tenant, 'expense_advance', 'AVS-', 'AVS-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _tenant AND doc_type = 'expense_advance');
  _num := public.next_document_number(_tenant, 'expense_advance', _date);
  _treso := public.resolve_treasury_account(_tenant, _bank_account_id, _payment_method);
  _entry := public.post_two_line_entry(_tenant, _date, 'expense_advance', 'Avance sur frais ' || _num || ' — ' || _who,
    public.require_posting_account(_tenant, 'EXPENSE_ADVANCE'), public.treasury_gl_account(_tenant, _treso, _payment_method, true), _amount);
  PERFORM public.record_treasury_line(_tenant, _treso, _date, -_amount, 'expense', 'Avance sur frais ' || _num, NULLIF(btrim(_reference), ''), _entry, NULL);
  INSERT INTO public.expense_advances (id, tenant_id, advance_number, employee_id, advance_date, amount, purpose, payment_method, bank_account_id, journal_entry_id)
  VALUES (_id, _tenant, _num, _employee, _date, _amount, NULLIF(btrim(_purpose), ''), _payment_method, _treso, _entry);
  RETURN _id;
END $$;

CREATE FUNCTION public.expense_advance_refund(_advance uuid, _date date, _amount numeric, _payment_method text DEFAULT 'cash',
  _bank_account_id uuid DEFAULT NULL, _reference text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _a public.expense_advances%ROWTYPE; _treso uuid; _entry uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'expenses.pay') THEN RAISE EXCEPTION 'Droit insuffisant : « expenses.pay » requis' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _a FROM public.expense_advances WHERE id = _advance AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avance introuvable dans la société active' USING ERRCODE = 'QG027'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > _a.amount - _a.amount_applied - _a.amount_refunded THEN
    RAISE EXCEPTION 'Montant supérieur au solde de l''avance (%)', _a.amount - _a.amount_applied - _a.amount_refunded USING ERRCODE = 'QG027';
  END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'TREASURY');
  _treso := public.resolve_treasury_account(_tenant, _bank_account_id, _payment_method);
  _entry := public.post_two_line_entry(_tenant, _date, 'expense_advance_refund', 'Restitution de l''avance ' || _a.advance_number,
    public.treasury_gl_account(_tenant, _treso, _payment_method, true), public.require_posting_account(_tenant, 'EXPENSE_ADVANCE'), _amount);
  PERFORM public.record_treasury_line(_tenant, _treso, _date, _amount, 'expense', 'Restitution de l''avance ' || _a.advance_number, NULLIF(btrim(_reference), ''), _entry, NULL);
  UPDATE public.expense_advances SET amount_refunded = amount_refunded + _amount WHERE id = _advance;
  INSERT INTO public.expense_advance_movements (tenant_id, advance_id, kind, movement_date, amount, journal_entry_id)
  VALUES (_tenant, _advance, 'refund', _date, _amount, _entry);
  RETURN _entry;
END $$;

-- Remboursement d'une note : les avances ouvertes du salarié (les plus anciennes d'abord) s'imputent, le reste
-- passe par la trésorerie. Si les avances couvrent tout, aucun mouvement de trésorerie.
DROP FUNCTION public.expense_report_pay(uuid, date, text, uuid, text);
CREATE FUNCTION public.expense_report_pay(_id uuid, _date date DEFAULT CURRENT_DATE, _payment_method text DEFAULT 'bank_transfer',
  _bank_account_id uuid DEFAULT NULL, _reference text DEFAULT NULL, _apply_advances boolean DEFAULT true) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _r public.expense_reports%ROWTYPE; _treso uuid; _entry uuid; _adv record; _part numeric; _rest numeric; _applied numeric := 0; _app_entry uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'expenses.pay') THEN RAISE EXCEPTION 'Droit insuffisant : « expenses.pay » requis' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _r FROM public.expense_reports WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Note de frais introuvable dans la société active' USING ERRCODE = 'QG027'; END IF;
  IF _r.status <> 'posted' THEN RAISE EXCEPTION 'Seule une note comptabilisée se rembourse' USING ERRCODE = 'QG027'; END IF;
  _rest := _r.total;
  IF _apply_advances THEN
    FOR _adv IN SELECT * FROM public.expense_advances WHERE tenant_id = _tenant AND employee_id = _r.employee_id
                 AND amount - amount_applied - amount_refunded > 0 ORDER BY advance_date, advance_number FOR UPDATE LOOP
      EXIT WHEN _rest <= 0;
      _part := least(_rest, _adv.amount - _adv.amount_applied - _adv.amount_refunded);
      PERFORM public.assert_fiscal_period_open(_tenant, _date, 'GL');
      _app_entry := public.post_two_line_entry(_tenant, _date, 'expense_advance_application',
        'Imputation de l''avance ' || _adv.advance_number || ' sur la note ' || _r.report_number,
        public.require_posting_account(_tenant, 'EXPENSE_PAYABLE'), public.require_posting_account(_tenant, 'EXPENSE_ADVANCE'), _part);
      UPDATE public.expense_advances SET amount_applied = amount_applied + _part WHERE id = _adv.id;
      INSERT INTO public.expense_advance_movements (tenant_id, advance_id, kind, report_id, movement_date, amount, journal_entry_id)
      VALUES (_tenant, _adv.id, 'application', _id, _date, _part, _app_entry);
      _rest := _rest - _part; _applied := _applied + _part;
    END LOOP;
  END IF;
  IF _rest > 0 THEN
    PERFORM public.assert_fiscal_period_open(_tenant, _date, 'TREASURY');
    _treso := public.resolve_treasury_account(_tenant, _bank_account_id, _payment_method);
    _entry := public.post_two_line_entry(_tenant, _date, 'expense_payment', 'Remboursement de la note ' || _r.report_number,
      public.require_posting_account(_tenant, 'EXPENSE_PAYABLE'), public.treasury_gl_account(_tenant, _treso, _payment_method, true), _rest);
    PERFORM public.record_treasury_line(_tenant, _treso, _date, -_rest, 'expense', 'Remboursement de la note ' || _r.report_number,
      NULLIF(btrim(_reference), ''), _entry, NULL);
  END IF;
  PERFORM set_config('qerp.expense_system', 'on', true);
  UPDATE public.expense_reports SET status = 'paid', paid_at = now(), payment_journal_entry_id = COALESCE(_entry, _app_entry),
         bank_account_id = _treso, advance_applied = _applied WHERE id = _id;
  PERFORM set_config('qerp.expense_system', 'off', true);
  RETURN COALESCE(_entry, _app_entry);
END $$;

REVOKE EXECUTE ON FUNCTION public.expense_advance_pay(uuid, date, numeric, text, text, uuid, text), public.expense_advance_refund(uuid, date, numeric, text, uuid, text),
  public.expense_report_pay(uuid, date, text, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expense_advance_pay(uuid, date, numeric, text, text, uuid, text), public.expense_advance_refund(uuid, date, numeric, text, uuid, text),
  public.expense_report_pay(uuid, date, text, uuid, text, boolean) TO authenticated;

-- Le statut et les montants d'une note restent réservés aux fonctions (la nouvelle colonne aussi).
CREATE OR REPLACE FUNCTION public.guard_expense_report_advance() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon', 'qerp_api') AND NEW.advance_applied IS DISTINCT FROM OLD.advance_applied
     AND current_setting('qerp.expense_system', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'L''imputation des avances se fait au remboursement' USING ERRCODE = 'QG027';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_expense_report_advance BEFORE UPDATE ON public.expense_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_expense_report_advance();

-- ─── RLS ───
ALTER TABLE public.expense_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_advance_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.expense_rates FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.expense_rates FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'expenses.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'expenses.settings'));
-- Avances : visibles de la comptabilité et de la trésorerie (droits view_all ou pay) ; écrites par les fonctions.
CREATE POLICY "Lecture habilitée" ON public.expense_advances FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_permission(auth.uid(), 'expenses.view_all') OR public.has_permission(auth.uid(), 'expenses.pay')));
CREATE POLICY "Lecture habilitée" ON public.expense_advance_movements FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_permission(auth.uid(), 'expenses.view_all') OR public.has_permission(auth.uid(), 'expenses.pay')));
REVOKE ALL ON public.expense_rates, public.expense_advances, public.expense_advance_movements FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_rates TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.expense_advances, public.expense_advance_movements FROM authenticated;
GRANT SELECT ON public.expense_advances, public.expense_advance_movements TO authenticated;

SELECT public.install_tenant_isolation_triggers();
