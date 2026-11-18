-- Calcul de paie par rubrique avec variables approuvees et photographie immuable.
ALTER TABLE public.hr_payroll_components
  ADD COLUMN taxable boolean NOT NULL DEFAULT false,
  ADD COLUMN subject_employee_social boolean NOT NULL DEFAULT false,
  ADD COLUMN subject_employer_social boolean NOT NULL DEFAULT false;

CREATE TABLE public.payroll_run_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  component_id uuid NOT NULL,
  source_key text NOT NULL CHECK (length(btrim(source_key)) BETWEEN 1 AND 120),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  UNIQUE (tenant_id, run_id, source_key),
  FOREIGN KEY (component_id, tenant_id)
    REFERENCES public.hr_payroll_components(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX payroll_run_variables_run_idx ON public.payroll_run_variables (tenant_id, run_id, status, employee_id);
ALTER TABLE public.payroll_run_variables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_run_variables FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payroll_run_variables TO authenticated;
CREATE POLICY payroll_run_variables_read ON public.payroll_run_variables
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.has_hr_perm(auth.uid(), 'view_payroll'));
CREATE POLICY payroll_run_variables_no_direct_write ON public.payroll_run_variables
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TABLE public.payroll_component_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  component_id uuid,
  code_snapshot text NOT NULL,
  label_snapshot text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer_charge')),
  calculation_method text NOT NULL CHECK (calculation_method IN ('fixed', 'percent_base')),
  calculation_base numeric(18,2) NOT NULL DEFAULT 0,
  rate_snapshot numeric(18,4),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  source_type text NOT NULL CHECK (source_type IN ('base_salary', 'employee_assignment', 'payroll_variable')),
  source_id uuid,
  definition_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (component_id, tenant_id)
    REFERENCES public.hr_payroll_components(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX payroll_component_lines_run_idx ON public.payroll_component_lines (tenant_id, run_id, employee_id, id);
ALTER TABLE public.payroll_component_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_component_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payroll_component_lines TO authenticated;
CREATE POLICY payroll_component_lines_read ON public.payroll_component_lines
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.has_hr_perm(auth.uid(), 'view_payroll'));
CREATE POLICY payroll_component_lines_no_direct_write ON public.payroll_component_lines
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE FUNCTION public.create_payroll_run_variable(
  _run uuid, _employee uuid, _component uuid, _amount numeric, _source_key text, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid;
  _run_row public.payroll_runs%ROWTYPE;
  _component_row public.hr_payroll_components%ROWTYPE;
  _period_start date;
  _period_end date;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'create_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusee : hr.create_payroll_run' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run_row FROM public.payroll_runs WHERE id = _run AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND OR _run_row.status <> 'draft' OR _run_row.period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Cycle de paie introuvable ou non modifiable' USING ERRCODE = 'QG028';
  END IF;
  SELECT * INTO _component_row FROM public.hr_payroll_components
    WHERE id = _component AND tenant_id = _tenant AND active;
  _period_start := to_date(_run_row.period || '-01', 'YYYY-MM-DD');
  _period_end := (_period_start + interval '1 month - 1 day')::date;
  IF _component_row.id IS NULL OR _component_row.effective_from > _period_end
     OR (_component_row.effective_to IS NOT NULL AND _component_row.effective_to < _period_start)
     OR NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = _employee AND e.tenant_id = _tenant)
     OR COALESCE(_amount, 0) <= 0 OR NULLIF(btrim(_source_key), '') IS NULL
     OR NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Variable de paie invalide pour ce cycle' USING ERRCODE = 'QG028';
  END IF;
  INSERT INTO public.payroll_run_variables
    (tenant_id, run_id, employee_id, component_id, amount, source_key, reason, created_by)
  VALUES (_tenant, _run, _employee, _component, _amount, btrim(_source_key), btrim(_reason), auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END
$function$;

CREATE FUNCTION public.decide_payroll_run_variable(_variable uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _row public.payroll_run_variables%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'approve_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusee : hr.approve_payroll_run' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _row FROM public.payroll_run_variables WHERE id = _variable AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND OR _row.status <> 'pending'
     OR (SELECT status FROM public.payroll_runs WHERE id = _row.run_id) <> 'draft' THEN
    RAISE EXCEPTION 'Variable absente ou deja decidee' USING ERRCODE = 'QG028';
  END IF;
  IF _row.created_by = auth.uid() THEN
    RAISE EXCEPTION 'Un auteur ne peut pas approuver sa propre variable' USING ERRCODE = '42501';
  END IF;
  IF NOT _approve AND NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Le rejet doit comporter un motif' USING ERRCODE = 'QG028';
  END IF;
  UPDATE public.payroll_run_variables SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    decided_by = auth.uid(), decided_at = now(), decision_reason = NULLIF(btrim(_reason), '')
  WHERE id = _variable;
  RETURN _variable;
END
$function$;

CREATE OR REPLACE FUNCTION public.generate_payroll_lines(_run_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _run public.payroll_runs%ROWTYPE;
  _settings public.hr_payroll_settings%ROWTYPE;
  _employee public.employees%ROWTYPE;
  _state jsonb;
  _item record;
  _period_start date;
  _period_end date;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _base numeric(18,2);
  _rate numeric(18,4);
  _amount numeric(18,2);
  _gross numeric(18,2);
  _earned numeric(18,2);
  _component_deductions numeric(18,2);
  _component_charges numeric(18,2);
  _employee_base numeric(18,2);
  _employer_base numeric(18,2);
  _taxable_base numeric(18,2);
  _employee_social numeric(18,2);
  _employer_social numeric(18,2);
  _taxes numeric(18,2);
  _net numeric(18,2);
  _count integer := 0;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'create_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusee : role Saisie RH requis' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id FOR UPDATE;
  IF _run.tenant_id IS NULL OR _run.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Cycle non modifiable (statut %)', _run.status; END IF;
  IF _run.period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Periode de paie invalide (format attendu AAAA-MM)' USING ERRCODE = 'QG028';
  END IF;
  _period_start := to_date(_run.period || '-01', 'YYYY-MM-DD');
  _period_end := (_period_start + interval '1 month - 1 day')::date;
  IF EXISTS (SELECT 1 FROM public.payroll_run_variables v WHERE v.tenant_id = _tenant
       AND v.run_id = _run_id AND v.status = 'pending') THEN
    RAISE EXCEPTION 'Toutes les variables doivent etre approuvees ou rejetees avant calcul' USING ERRCODE = 'QG028';
  END IF;
  SELECT * INTO _settings FROM public.hr_payroll_settings WHERE tenant_id = _tenant FOR SHARE;
  IF NOT FOUND OR _settings.rules_validated_at IS NULL OR NOT public.payroll_rules_valid(_settings) THEN
    RAISE EXCEPTION 'Les baremes de paie doivent etre configures et confirmes avant le calcul' USING ERRCODE = 'QG028';
  END IF;
  IF _settings.rules_effective_from > _period_start THEN
    RAISE EXCEPTION 'Les baremes du pays ne sont pas applicables a la periode de paie' USING ERRCODE = 'QG028';
  END IF;

  DELETE FROM public.payroll_component_lines WHERE run_id = _run_id;
  DELETE FROM public.payroll_lines WHERE run_id = _run_id;
  FOR _employee IN SELECT e.* FROM public.employees e WHERE e.tenant_id = _tenant ORDER BY e.id LOOP
    _state := public.hr_employee_state_at(_employee.id, _period_end);
    IF COALESCE(_state->>'status', _employee.status) = 'active' THEN
      IF COALESCE(upper(btrim(_state->>'currency')), '') <> _settings.currency_code::text THEN
        RAISE EXCEPTION 'Devise des salaries differente de la devise du bareme de paie' USING ERRCODE = 'QG028';
      END IF;
      _base := ROUND(GREATEST(COALESCE(NULLIF(_state->>'base_salary', '')::numeric, 0), 0), 2);
      _earned := 0; _component_deductions := 0; _component_charges := 0;
      _employee_base := _base; _employer_base := _base; _taxable_base := _base;
      INSERT INTO public.payroll_component_lines
        (tenant_id, run_id, employee_id, code_snapshot, label_snapshot, kind, calculation_method,
         calculation_base, amount, source_type, definition_snapshot)
      VALUES (_tenant, _run_id, _employee.id, 'BASE_SALARY', 'Salaire de base', 'earning', 'fixed',
        _base, _base, 'base_salary', jsonb_build_object('employee_state', _state, 'as_of', _period_end));

      FOR _item IN
        SELECT c.id component_id, c.code, c.label, c.kind, c.calculation_method,
          c.taxable, c.subject_employee_social, c.subject_employer_social, c.cap,
          c.printable, c.sort_order, c.gl_account_code, c.amount definition_amount,
          COALESCE(a.amount_override, c.amount) rate_amount, NULL::numeric variable_amount,
          'employee_assignment'::text source_type, a.id source_id
        FROM public.hr_employee_payroll_components a
        JOIN public.hr_payroll_components c ON c.id = a.component_id AND c.tenant_id = a.tenant_id
        WHERE a.tenant_id = _tenant AND a.employee_id = _employee.id AND a.active
          AND a.effective_from <= _period_end AND (a.effective_to IS NULL OR a.effective_to >= _period_start)
          AND c.active AND c.effective_from <= _period_end AND (c.effective_to IS NULL OR c.effective_to >= _period_start)
        UNION ALL
        SELECT c.id, c.code, c.label, c.kind, c.calculation_method,
          c.taxable, c.subject_employee_social, c.subject_employer_social, c.cap,
          c.printable, c.sort_order, c.gl_account_code, c.amount, NULL::numeric, v.amount,
          'payroll_variable'::text, v.id
        FROM public.payroll_run_variables v
        JOIN public.hr_payroll_components c ON c.id = v.component_id AND c.tenant_id = v.tenant_id
        WHERE v.tenant_id = _tenant AND v.run_id = _run_id AND v.employee_id = _employee.id
          AND v.status = 'approved' AND c.active
        ORDER BY code, source_type, source_id
      LOOP
        _rate := _item.rate_amount;
        _amount := CASE WHEN _item.source_type = 'payroll_variable' THEN _item.variable_amount
          WHEN _item.calculation_method = 'fixed' THEN _rate
          ELSE ROUND(_base * _rate / 100, 2) END;
        IF _item.cap IS NOT NULL THEN _amount := LEAST(_amount, _item.cap); END IF;
        _amount := ROUND(GREATEST(_amount, 0), 2);
        IF _item.kind = 'earning' THEN
          _earned := _earned + _amount;
          IF _item.taxable THEN _taxable_base := _taxable_base + _amount; END IF;
          IF _item.subject_employee_social THEN _employee_base := _employee_base + _amount; END IF;
          IF _item.subject_employer_social THEN _employer_base := _employer_base + _amount; END IF;
        ELSIF _item.kind = 'deduction' THEN
          _component_deductions := _component_deductions + _amount;
        ELSE
          _component_charges := _component_charges + _amount;
        END IF;
        INSERT INTO public.payroll_component_lines
          (tenant_id, run_id, employee_id, component_id, code_snapshot, label_snapshot, kind,
           calculation_method, calculation_base, rate_snapshot, amount, source_type, source_id, definition_snapshot)
        VALUES (_tenant, _run_id, _employee.id, _item.component_id, _item.code, _item.label, _item.kind,
          _item.calculation_method, _base, CASE WHEN _item.source_type = 'payroll_variable' THEN NULL ELSE _rate END,
          _amount, _item.source_type, _item.source_id,
          jsonb_build_object('definition_amount', _item.definition_amount, 'rate_amount', _rate, 'cap', _item.cap,
            'sort_order', _item.sort_order,
            'taxable', _item.taxable, 'subject_employee_social', _item.subject_employee_social,
            'subject_employer_social', _item.subject_employer_social, 'printable', _item.printable,
            'gl_account_code', _item.gl_account_code, 'period_start', _period_start, 'period_end', _period_end));
      END LOOP;

      _gross := ROUND(_base + _earned, 2);
      _employee_social := ROUND(LEAST(_employee_base, COALESCE(_settings.employee_contribution_cap, _employee_base))
        * _settings.employee_contribution_pct / 100, 2);
      _employer_social := ROUND(LEAST(_employer_base, COALESCE(_settings.employer_contribution_cap, _employer_base))
        * _settings.employer_contribution_pct / 100, 2);
      _taxes := public.compute_progressive_payroll_tax(GREATEST(_taxable_base - _employee_social, 0), _settings.income_tax_bands);
      _net := ROUND(_gross - _employee_social - _component_deductions - _taxes, 2);
      INSERT INTO public.payroll_lines
        (tenant_id, run_id, employee_id, gross, deductions, taxes, net, employer_charges, department_snapshot)
      VALUES (_tenant, _run_id, _employee.id, _gross, ROUND(_employee_social + _component_deductions, 2), _taxes,
          _net, ROUND(_employer_social + _component_charges, 2), COALESCE(_state->>'department', ''));
      _count := _count + 1;
    END IF;
  END LOOP;
  UPDATE public.payroll_runs
     SET gross_total = COALESCE((SELECT SUM(gross) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         net_total = COALESCE((SELECT SUM(net) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         deductions_total = COALESCE((SELECT SUM(deductions) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         taxes_total = COALESCE((SELECT SUM(taxes) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         employer_charges_total = COALESCE((SELECT SUM(employer_charges) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         employee_count = _count, payroll_country_code = _settings.country_code,
         payroll_currency_code = _settings.currency_code,
         payroll_rules_snapshot = jsonb_build_object('country_code', _settings.country_code,
           'currency_code', _settings.currency_code, 'employee_contribution_pct', _settings.employee_contribution_pct,
           'employee_contribution_cap', _settings.employee_contribution_cap,
           'employer_contribution_pct', _settings.employer_contribution_pct,
           'employer_contribution_cap', _settings.employer_contribution_cap,
           'income_tax_bands', _settings.income_tax_bands, 'rules_effective_from', _settings.rules_effective_from,
           'rules_reference', _settings.rules_reference, 'rules_validated_at', _settings.rules_validated_at,
           'rules_validated_by', _settings.rules_validated_by, 'components_snapshot', true)
   WHERE id = _run_id;
  INSERT INTO public.payroll_run_audit (tenant_id, run_id, event_type, from_status, to_status, performed_by, details)
  VALUES (_tenant, _run_id, 'lines_generated', _run.status, _run.status, auth.uid(),
    jsonb_build_object('line_count', _count, 'country', _settings.country_code,
      'currency', _settings.currency_code, 'employment_state_as_of', _period_end,
      'component_line_count', (SELECT count(*) FROM public.payroll_component_lines WHERE run_id = _run_id)));
  RETURN _count;
END
$function$;

REVOKE ALL ON FUNCTION public.create_payroll_run_variable(uuid, uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_payroll_run_variable(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_payroll_run_variable(uuid, uuid, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_payroll_run_variable(uuid, boolean, text) TO authenticated;


