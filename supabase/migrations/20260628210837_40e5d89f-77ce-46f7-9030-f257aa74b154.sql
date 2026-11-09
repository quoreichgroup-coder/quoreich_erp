
-- 1. Fix SECURITY DEFINER views
ALTER VIEW public.inventory_abc_view SET (security_invoker = on);
ALTER VIEW public.inventory_slow_moving_view SET (security_invoker = on);
ALTER VIEW public.inventory_variance_view SET (security_invoker = on);

-- 2. Revoke anon execution on SECURITY DEFINER functions (defense in depth)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon', r.proname, r.args);
  END LOOP;
END $$;

-- Trigger-only functions: revoke from authenticated too (called only by triggers)
REVOKE EXECUTE ON FUNCTION public.apply_stock_movement() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_invoice_on_delivery() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.check_customer_credit_on_so() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.commit_budget_on_po() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_audit_stage_change() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_inventory_period_lock() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_period_lock() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_sales_period_lock() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_ap_payment() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_po_approval() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;

-- 3. Audit actor binding fixes
-- CRM
DROP POLICY IF EXISTS crm_role_audit_insert ON public.crm_role_audit;
CREATE POLICY crm_role_audit_insert ON public.crm_role_audit FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND performed_by = auth.uid());

-- Inventory (also remove duplicate)
DROP POLICY IF EXISTS "inv role audit insert via definer" ON public.inventory_role_audit;
DROP POLICY IF EXISTS "tenant insert audit" ON public.inventory_role_audit;
CREATE POLICY inv_role_audit_insert ON public.inventory_role_audit FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND performed_by = auth.uid());

-- Procurement
DROP POLICY IF EXISTS "tenant insert audit" ON public.procurement_role_audit;
CREATE POLICY procurement_role_audit_insert ON public.procurement_role_audit FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND performed_by = auth.uid());

-- Sales (remove duplicate)
DROP POLICY IF EXISTS "tenant insert audit" ON public.sales_role_audit;
DROP POLICY IF EXISTS "tenant insert sales_role_audit" ON public.sales_role_audit;
CREATE POLICY sales_role_audit_insert ON public.sales_role_audit FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND performed_by = auth.uid());

-- 4. Restrict employees to HR roles
DROP POLICY IF EXISTS "employees tenant scoped" ON public.employees;
CREATE POLICY employees_hr_select ON public.employees FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'view_sensitive'));
CREATE POLICY employees_hr_write ON public.employees FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'manage_employees'));
CREATE POLICY employees_hr_update ON public.employees FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'manage_employees'))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'manage_employees'));
CREATE POLICY employees_hr_delete ON public.employees FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'manage_employees'));

-- 5. Restrict payroll tables to HR/payroll roles
DROP POLICY IF EXISTS "payroll_runs tenant scoped" ON public.payroll_runs;
CREATE POLICY payroll_runs_hr_select ON public.payroll_runs FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'view_payroll'));
CREATE POLICY payroll_runs_hr_write ON public.payroll_runs FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'run_payroll'));
CREATE POLICY payroll_runs_hr_update ON public.payroll_runs FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'run_payroll'))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'run_payroll'));
CREATE POLICY payroll_runs_hr_delete ON public.payroll_runs FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'run_payroll'));

DROP POLICY IF EXISTS "payroll_lines tenant scoped" ON public.payroll_lines;
CREATE POLICY payroll_lines_hr_select ON public.payroll_lines FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'view_payroll'));
CREATE POLICY payroll_lines_hr_write ON public.payroll_lines FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'run_payroll'));
CREATE POLICY payroll_lines_hr_update ON public.payroll_lines FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'run_payroll'))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'run_payroll'));
CREATE POLICY payroll_lines_hr_delete ON public.payroll_lines FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_hr_perm(auth.uid(), 'run_payroll'));

-- 6. user_role_assignments: restrict writes to admins (read stays tenant-scoped)
DROP POLICY IF EXISTS "Tenant isolation" ON public.user_role_assignments;
-- existing Admins insert/update/delete + Tenant read policies remain
