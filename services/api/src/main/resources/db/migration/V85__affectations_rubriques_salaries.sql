-- Affectations effectives des rubriques aux salaries, sous controle du tenant.
ALTER TABLE public.hr_payroll_components
  ADD CONSTRAINT hr_payroll_components_id_tenant_unique UNIQUE (id, tenant_id);

CREATE TABLE public.hr_employee_payroll_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  component_id uuid NOT NULL,
  amount_override numeric(18,4) CHECK (amount_override IS NULL OR amount_override >= 0),
  effective_from date NOT NULL,
  effective_to date CHECK (effective_to IS NULL OR effective_to >= effective_from),
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, component_id, effective_from),
  FOREIGN KEY (component_id, tenant_id)
    REFERENCES public.hr_payroll_components(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX hr_employee_payroll_components_lookup_idx
  ON public.hr_employee_payroll_components (tenant_id, employee_id, active, effective_from, effective_to);
ALTER TABLE public.hr_employee_payroll_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_employee_payroll_components FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hr_employee_payroll_components TO authenticated;
CREATE POLICY hr_employee_payroll_components_read ON public.hr_employee_payroll_components
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_hr_perm(auth.uid(), 'view_payroll')
      OR public.has_hr_perm(auth.uid(), 'manage_payroll_components')));
CREATE POLICY hr_employee_payroll_components_no_direct_write ON public.hr_employee_payroll_components
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE FUNCTION public.list_hr_employee_payroll_components(_employee uuid)
RETURNS TABLE (id uuid, tenant_id uuid, employee_id uuid, component_id uuid, code text, label text,
  kind text, calculation_method text, amount numeric, cap numeric, effective_from date,
  effective_to date, active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR (NOT public.has_hr_perm(auth.uid(), 'view_payroll')
      AND NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components')) THEN
    RAISE EXCEPTION 'Droit insuffisant pour consulter les affectations de paie' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = _employee AND e.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Salarie introuvable dans la societe courante' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT a.id, a.tenant_id, a.employee_id, c.id, c.code, c.label, c.kind,
      c.calculation_method, COALESCE(a.amount_override, c.amount), c.cap,
      a.effective_from, a.effective_to, a.active
    FROM public.hr_employee_payroll_components a
    JOIN public.hr_payroll_components c ON c.id = a.component_id AND c.tenant_id = a.tenant_id
   WHERE a.tenant_id = _tenant AND a.employee_id = _employee
   ORDER BY a.effective_from DESC, c.sort_order, c.code;
END
$function$;

CREATE FUNCTION public.save_hr_employee_payroll_component(_employee uuid, _input jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _component uuid := (_input->>'component_id')::uuid;
  _amount numeric := nullif(_input->>'amount_override', '')::numeric;
  _from date := (_input->>'effective_from')::date;
  _to date := nullif(_input->>'effective_to', '')::date;
  _active boolean := COALESCE((_input->>'active')::boolean, true);
  _id uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_payroll_components' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = _employee AND e.tenant_id = _tenant)
     OR NOT EXISTS (SELECT 1 FROM public.hr_payroll_components c
       WHERE c.id = _component AND c.tenant_id = _tenant AND c.active)
     OR _from IS NULL OR (_to IS NOT NULL AND _to < _from) OR (_amount IS NOT NULL AND _amount < 0) THEN
    RAISE EXCEPTION 'Affectation de rubrique invalide' USING ERRCODE = 'QG028';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hr_employee_payroll_components a
      WHERE a.tenant_id = _tenant AND a.employee_id = _employee AND a.component_id = _component
        AND a.effective_from <> _from
        AND (_to IS NULL OR a.effective_from <= _to)
        AND (a.effective_to IS NULL OR a.effective_to >= _from)) THEN
    RAISE EXCEPTION 'Les dates de cette rubrique chevauchent une affectation existante' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.hr_employee_payroll_components
    (tenant_id, employee_id, component_id, amount_override, effective_from, effective_to, active, created_by)
  VALUES (_tenant, _employee, _component, _amount, _from, _to, _active, auth.uid())
  ON CONFLICT (tenant_id, employee_id, component_id, effective_from) DO UPDATE SET
    amount_override = EXCLUDED.amount_override, effective_to = EXCLUDED.effective_to,
    active = EXCLUDED.active, updated_at = now()
  RETURNING id INTO _id;
  RETURN _id;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Affectation de rubrique invalide' USING ERRCODE = 'QG028';
END
$function$;

REVOKE ALL ON FUNCTION public.list_hr_employee_payroll_components(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_hr_employee_payroll_component(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_hr_employee_payroll_components(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_hr_employee_payroll_component(uuid, jsonb) TO authenticated;
