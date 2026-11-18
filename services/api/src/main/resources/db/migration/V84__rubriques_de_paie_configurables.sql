-- Rubriques de remuneration configurees et isolees par societe.
-- Les valeurs legales et les rubriques restent saisies et validees par le client.
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('hr.manage_payroll_components', 'hr', 'manage_payroll_components', 'Configurer les rubriques de paie')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
VALUES ('admin', 'hr.manage_payroll_components'), ('hr_admin', 'hr.manage_payroll_components')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r
JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
WHERE r.is_system AND r.code IN ('admin', 'hr_admin')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

CREATE TABLE public.hr_payroll_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer_charge')),
  calculation_method text NOT NULL CHECK (calculation_method IN ('fixed', 'percent_base')),
  amount numeric(18,4) NOT NULL CHECK (amount >= 0 AND (calculation_method <> 'percent_base' OR amount <= 100)),
  cap numeric(18,2) CHECK (cap IS NULL OR cap > 0),
  effective_from date NOT NULL,
  effective_to date CHECK (effective_to IS NULL OR effective_to >= effective_from),
  gl_account_code text,
  printable boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX hr_payroll_components_active_idx
  ON public.hr_payroll_components (tenant_id, active, sort_order, code);
ALTER TABLE public.hr_payroll_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_payroll_components FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hr_payroll_components TO authenticated;
CREATE POLICY hr_payroll_components_read ON public.hr_payroll_components
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_hr_perm(auth.uid(), 'view_payroll')
      OR public.has_hr_perm(auth.uid(), 'manage_payroll_components')));
CREATE POLICY hr_payroll_components_no_direct_write ON public.hr_payroll_components
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE FUNCTION public.list_hr_payroll_components(_include_inactive boolean DEFAULT false)
RETURNS TABLE (id uuid, tenant_id uuid, code text, label text, kind text, calculation_method text,
  amount numeric, cap numeric, effective_from date, effective_to date, gl_account_code text,
  printable boolean, active boolean, sort_order integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR (NOT public.has_hr_perm(auth.uid(), 'view_payroll')
      AND NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components')) THEN
    RAISE EXCEPTION 'Droit insuffisant pour consulter les rubriques de paie' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT c.id, c.tenant_id, c.code, c.label, c.kind, c.calculation_method, c.amount, c.cap,
      c.effective_from, c.effective_to, c.gl_account_code, c.printable, c.active, c.sort_order
    FROM public.hr_payroll_components c
   WHERE c.tenant_id = _tenant AND (_include_inactive OR c.active)
   ORDER BY c.sort_order, c.label, c.code;
END
$function$;

CREATE FUNCTION public.save_hr_payroll_component(_input jsonb)
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
     OR _method IS NULL OR _method NOT IN ('fixed', 'percent_base') OR _amount IS NULL OR _amount < 0
     OR (_method = 'percent_base' AND _amount > 100) OR _from IS NULL
     OR (_to IS NOT NULL AND _to < _from) OR (_cap IS NOT NULL AND _cap <= 0) THEN
    RAISE EXCEPTION 'Definition de rubrique de paie invalide' USING ERRCODE = 'QG028';
  END IF;
  INSERT INTO public.hr_payroll_components
    (tenant_id, code, label, kind, calculation_method, amount, cap, effective_from, effective_to,
     gl_account_code, printable, active, sort_order)
  VALUES (_tenant, _code, _label, _kind, _method, _amount, _cap, _from, _to,
    nullif(btrim(_input->>'gl_account_code'), ''), COALESCE((_input->>'printable')::boolean, true),
    COALESCE((_input->>'active')::boolean, true), COALESCE((_input->>'sort_order')::integer, 0))
  ON CONFLICT (tenant_id, code) DO UPDATE SET
    label = EXCLUDED.label, kind = EXCLUDED.kind, calculation_method = EXCLUDED.calculation_method,
    amount = EXCLUDED.amount, cap = EXCLUDED.cap, effective_from = EXCLUDED.effective_from,
    effective_to = EXCLUDED.effective_to, gl_account_code = EXCLUDED.gl_account_code,
    printable = EXCLUDED.printable, active = EXCLUDED.active, sort_order = EXCLUDED.sort_order,
    updated_at = now()
  RETURNING id INTO _id;
  RETURN _id;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Definition de rubrique de paie invalide' USING ERRCODE = 'QG028';
END
$function$;

REVOKE ALL ON FUNCTION public.list_hr_payroll_components(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_hr_payroll_component(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_hr_payroll_components(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_hr_payroll_component(jsonb) TO authenticated;
