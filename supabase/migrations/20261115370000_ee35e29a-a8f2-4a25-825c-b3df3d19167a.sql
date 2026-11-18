-- Restitue la valeur de remplacement brute pour permettre une edition sans changer la regle source.
DROP FUNCTION public.list_hr_employee_payroll_components(uuid);
CREATE FUNCTION public.list_hr_employee_payroll_components(_employee uuid)
RETURNS TABLE (id uuid, tenant_id uuid, employee_id uuid, component_id uuid, code text, label text,
  kind text, calculation_method text, amount numeric, amount_override numeric, cap numeric,
  effective_from date, effective_to date, active boolean)
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
      c.calculation_method, COALESCE(a.amount_override, c.amount), a.amount_override, c.cap,
      a.effective_from, a.effective_to, a.active
    FROM public.hr_employee_payroll_components a
    JOIN public.hr_payroll_components c ON c.id = a.component_id AND c.tenant_id = a.tenant_id
   WHERE a.tenant_id = _tenant AND a.employee_id = _employee
   ORDER BY a.effective_from DESC, c.sort_order, c.code;
END
$function$;
REVOKE ALL ON FUNCTION public.list_hr_employee_payroll_components(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_employee_payroll_components(uuid) TO authenticated;
