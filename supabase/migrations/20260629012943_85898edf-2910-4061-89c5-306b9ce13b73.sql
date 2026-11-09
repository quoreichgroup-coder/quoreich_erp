
-- 1) journal_entries
DROP POLICY IF EXISTS "tenant_isolation_journal_entries" ON public.journal_entries;
DROP POLICY IF EXISTS "tenant access journal_entries" ON public.journal_entries;
DROP POLICY IF EXISTS "tenant_journal_entries" ON public.journal_entries;
DROP POLICY IF EXISTS "Tenant isolation" ON public.journal_entries;

CREATE POLICY "je_select_tenant" ON public.journal_entries FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "je_insert_accountant" ON public.journal_entries FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'accountant'))
  );
CREATE POLICY "je_update_accountant" ON public.journal_entries FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'accountant'))
  );
CREATE POLICY "je_delete_admin" ON public.journal_entries FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.has_role(auth.uid(),'admin')
  );

-- 2) journal_lines (no tenant_id column — scope via parent entry)
DROP POLICY IF EXISTS "tenant_isolation_journal_lines" ON public.journal_lines;
DROP POLICY IF EXISTS "tenant access journal_lines" ON public.journal_lines;
DROP POLICY IF EXISTS "tenant_journal_lines" ON public.journal_lines;
DROP POLICY IF EXISTS "Tenant isolation" ON public.journal_lines;

CREATE POLICY "jl_select_tenant" ON public.journal_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.journal_entries je
    WHERE je.id = journal_lines.entry_id
      AND je.tenant_id = public.get_user_tenant_id(auth.uid())
  ));
CREATE POLICY "jl_insert_accountant" ON public.journal_lines FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_lines.entry_id
        AND je.tenant_id = public.get_user_tenant_id(auth.uid())
    )
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'accountant'))
  );
CREATE POLICY "jl_update_accountant" ON public.journal_lines FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.journal_entries je
    WHERE je.id = journal_lines.entry_id
      AND je.tenant_id = public.get_user_tenant_id(auth.uid())
  ))
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_lines.entry_id
        AND je.tenant_id = public.get_user_tenant_id(auth.uid())
    )
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'accountant'))
  );
CREATE POLICY "jl_delete_admin" ON public.journal_lines FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_lines.entry_id
        AND je.tenant_id = public.get_user_tenant_id(auth.uid())
    )
    AND public.has_role(auth.uid(),'admin')
  );

-- 3) hr_role_audit
DROP POLICY IF EXISTS "hr_role_audit_admin_insert" ON public.hr_role_audit;
CREATE POLICY "hr_role_audit_admin_insert" ON public.hr_role_audit FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND performed_by = auth.uid()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr_admin'))
  );

-- 4) sales_role_audit
DROP POLICY IF EXISTS "tenant read sales_role_audit" ON public.sales_role_audit;
DROP POLICY IF EXISTS "tenant_read_sales_role_audit" ON public.sales_role_audit;
CREATE POLICY "sales_role_audit_admin_read" ON public.sales_role_audit FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'sales_manager')
      OR public.has_role(auth.uid(),'sales_controller')
    )
  );

-- 5) treasury_role_audit
DROP POLICY IF EXISTS "tenant_treasury_audit_read" ON public.treasury_role_audit;
CREATE POLICY "treasury_role_audit_admin_read" ON public.treasury_role_audit FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'treasury_manager')
      OR public.has_role(auth.uid(),'treasury_controller')
    )
  );

-- 6) procurement_role_audit
DROP POLICY IF EXISTS "tenant read audit" ON public.procurement_role_audit;
DROP POLICY IF EXISTS "tenant_read_audit" ON public.procurement_role_audit;
CREATE POLICY "procurement_role_audit_admin_read" ON public.procurement_role_audit FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'procurement_controller')
      OR public.has_role(auth.uid(),'procurement_l3')
    )
  );
