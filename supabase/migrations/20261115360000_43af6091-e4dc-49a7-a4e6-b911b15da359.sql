-- Traitements sociaux/fiscaux et lecture des detail de bulletin reserves aux droits sensibles.
DROP POLICY payroll_component_lines_read ON public.payroll_component_lines;
CREATE POLICY payroll_component_lines_read ON public.payroll_component_lines
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.has_hr_perm(auth.uid(), 'view_payroll')
    AND public.has_hr_perm(auth.uid(), 'view_sensitive'));

DROP FUNCTION public.list_hr_payroll_components(boolean);
CREATE FUNCTION public.list_hr_payroll_components(_include_inactive boolean DEFAULT false)
RETURNS TABLE (id uuid, tenant_id uuid, code text, label text, kind text, calculation_method text,
  amount numeric, cap numeric, effective_from date, effective_to date, gl_account_code text,
  printable boolean, active boolean, sort_order integer, taxable boolean,
  subject_employee_social boolean, subject_employer_social boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR (NOT public.has_hr_perm(auth.uid(), 'view_payroll')
      AND NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components')) THEN
    RAISE EXCEPTION 'Droit insuffisant pour consulter les rubriques de paie' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT c.id, c.tenant_id, c.code, c.label, c.kind, c.calculation_method, c.amount, c.cap,
      c.effective_from, c.effective_to, c.gl_account_code, c.printable, c.active, c.sort_order,
      c.taxable, c.subject_employee_social, c.subject_employer_social
    FROM public.hr_payroll_components c
   WHERE c.tenant_id = _tenant AND (_include_inactive OR c.active)
   ORDER BY c.sort_order, c.label, c.code;
END
$function$;

CREATE OR REPLACE FUNCTION public.save_hr_payroll_component(_input jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid;
  _code text := lower(btrim(_input->>'code'));
  _label text := btrim(_input->>'label');
  _kind text := _input->>'kind';
  _method text := _input->>'calculation_method';
  _amount numeric := (_input->>'amount')::numeric;
  _cap numeric := nullif(_input->>'cap', '')::numeric;
  _from date := (_input->>'effective_from')::date;
  _to date := nullif(_input->>'effective_to', '')::date;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_payroll_components' USING ERRCODE = '42501';
  END IF;
  IF _code IS NULL OR _code !~ '^[a-z0-9][a-z0-9._-]{0,39}$' OR _label IS NULL OR length(_label) NOT BETWEEN 1 AND 120
     OR _kind IS NULL OR _kind NOT IN ('earning', 'deduction', 'employer_charge')
     OR _method IS NULL OR _method NOT IN ('fixed', 'percent_base') OR _amount IS NULL OR _amount <= 0
     OR (_method = 'percent_base' AND _amount > 100) OR _from IS NULL
     OR (_to IS NOT NULL AND _to < _from) OR (_cap IS NOT NULL AND _cap <= 0) THEN
    RAISE EXCEPTION 'Definition de rubrique de paie invalide' USING ERRCODE = 'QG028';
  END IF;
  INSERT INTO public.hr_payroll_components
    (tenant_id, code, label, kind, calculation_method, amount, cap, effective_from, effective_to,
     gl_account_code, printable, active, sort_order, taxable, subject_employee_social, subject_employer_social)
  VALUES (_tenant, _code, _label, _kind, _method, _amount, _cap, _from, _to,
    nullif(btrim(_input->>'gl_account_code'), ''), COALESCE((_input->>'printable')::boolean, true),
    COALESCE((_input->>'active')::boolean, true), COALESCE((_input->>'sort_order')::integer, 0),
    COALESCE((_input->>'taxable')::boolean, false),
    COALESCE((_input->>'subject_employee_social')::boolean, false),
    COALESCE((_input->>'subject_employer_social')::boolean, false))
  ON CONFLICT (tenant_id, code) DO UPDATE SET
    label = EXCLUDED.label, kind = EXCLUDED.kind, calculation_method = EXCLUDED.calculation_method,
    amount = EXCLUDED.amount, cap = EXCLUDED.cap, effective_from = EXCLUDED.effective_from,
    effective_to = EXCLUDED.effective_to, gl_account_code = EXCLUDED.gl_account_code,
    printable = EXCLUDED.printable, active = EXCLUDED.active, sort_order = EXCLUDED.sort_order,
    taxable = EXCLUDED.taxable, subject_employee_social = EXCLUDED.subject_employee_social,
    subject_employer_social = EXCLUDED.subject_employer_social, updated_at = now()
  RETURNING id INTO _id;
  RETURN _id;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Definition de rubrique de paie invalide' USING ERRCODE = 'QG028';
END
$function$;

REVOKE ALL ON FUNCTION public.list_hr_payroll_components(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_payroll_components(boolean) TO authenticated;
