
-- ── 1. user_roles : remplacer la politique ALL par des règles explicites ─────────
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "Admins insert roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Admins peuvent voir tous les rôles, en plus de la policy existante "Users can view own roles"
CREATE POLICY "Admins view all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ── 2. user_role_assignments : SELECT par tenant, écritures admin uniquement ───
DROP POLICY IF EXISTS "Tenant isolation" ON public.user_role_assignments;

CREATE POLICY "Tenant read assignments" ON public.user_role_assignments
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Admins insert assignments" ON public.user_role_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = public.get_user_tenant_id(auth.uid())
  );

CREATE POLICY "Admins update assignments" ON public.user_role_assignments
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = public.get_user_tenant_id(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = public.get_user_tenant_id(auth.uid())
  );

CREATE POLICY "Admins delete assignments" ON public.user_role_assignments
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = public.get_user_tenant_id(auth.uid())
  );

-- ── 3. Audit RBAC : autoriser l'INSERT pour les membres du tenant (toujours scoped) ─
-- procurement_role_audit
DROP POLICY IF EXISTS "service insert" ON public.procurement_role_audit;
CREATE POLICY "tenant insert audit" ON public.procurement_role_audit
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- sales_role_audit
DROP POLICY IF EXISTS "service insert" ON public.sales_role_audit;
CREATE POLICY "tenant insert audit" ON public.sales_role_audit
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- treasury_role_audit
DROP POLICY IF EXISTS "service insert" ON public.treasury_role_audit;
CREATE POLICY "tenant insert audit" ON public.treasury_role_audit
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- inventory_role_audit
DROP POLICY IF EXISTS "service insert" ON public.inventory_role_audit;
CREATE POLICY "tenant insert audit" ON public.inventory_role_audit
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
