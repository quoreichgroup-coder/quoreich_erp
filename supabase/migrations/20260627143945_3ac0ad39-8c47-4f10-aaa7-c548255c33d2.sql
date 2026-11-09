
-- 1) Restrict HR policies to authenticated role
DROP POLICY IF EXISTS "employees tenant scoped" ON public.employees;
CREATE POLICY "employees tenant scoped" ON public.employees
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "payroll_runs tenant scoped" ON public.payroll_runs;
CREATE POLICY "payroll_runs tenant scoped" ON public.payroll_runs
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "payroll_lines tenant scoped" ON public.payroll_lines;
CREATE POLICY "payroll_lines tenant scoped" ON public.payroll_lines
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "hr_role_audit tenant read" ON public.hr_role_audit;
CREATE POLICY "hr_role_audit tenant read" ON public.hr_role_audit
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "hr_role_audit admin insert" ON public.hr_role_audit;
CREATE POLICY "hr_role_audit admin insert" ON public.hr_role_audit
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid())
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- 2) Tenant isolation on user_roles write policies
DROP POLICY IF EXISTS "Admins insert roles" ON public.user_roles;
CREATE POLICY "Admins insert roles" ON public.user_roles
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND tenant_id = public.get_user_tenant_id(auth.uid())
  );

DROP POLICY IF EXISTS "Admins update roles" ON public.user_roles;
CREATE POLICY "Admins update roles" ON public.user_roles
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND tenant_id = public.get_user_tenant_id(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND tenant_id = public.get_user_tenant_id(auth.uid())
  );

DROP POLICY IF EXISTS "Admins delete roles" ON public.user_roles;
CREATE POLICY "Admins delete roles" ON public.user_roles
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND tenant_id = public.get_user_tenant_id(auth.uid())
  );
