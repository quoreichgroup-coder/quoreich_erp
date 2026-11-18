-- Photographie du rang d?affichage au calcul du bulletin.
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


