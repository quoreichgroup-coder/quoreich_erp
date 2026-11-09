
-- 1) Tighten SELECT policies on cross-module audit tables to scope by tenant.

-- project_role_audit
DROP POLICY IF EXISTS "Project admins can view project audit" ON public.project_role_audit;
DROP POLICY IF EXISTS "project_role_audit_select" ON public.project_role_audit;
DROP POLICY IF EXISTS "tenant_project_audit_select" ON public.project_role_audit;
CREATE POLICY "tenant_project_audit_select"
  ON public.project_role_audit FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'project_admin'))
  );

-- compliance_role_audit
DROP POLICY IF EXISTS "Compliance admins can view compliance audit" ON public.compliance_role_audit;
DROP POLICY IF EXISTS "compliance_role_audit_select" ON public.compliance_role_audit;
DROP POLICY IF EXISTS "tenant_compliance_audit_select" ON public.compliance_role_audit;
CREATE POLICY "tenant_compliance_audit_select"
  ON public.compliance_role_audit FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'compliance_admin'))
  );

-- budget_role_audit
DROP POLICY IF EXISTS "Budget admins can view budget audit" ON public.budget_role_audit;
DROP POLICY IF EXISTS "budget_role_audit_select" ON public.budget_role_audit;
DROP POLICY IF EXISTS "tenant_budget_audit_select" ON public.budget_role_audit;
CREATE POLICY "tenant_budget_audit_select"
  ON public.budget_role_audit FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'budget_admin'))
  );

-- risk_role_audit
DROP POLICY IF EXISTS "Risk admins can view risk audit" ON public.risk_role_audit;
DROP POLICY IF EXISTS "risk_role_audit_select" ON public.risk_role_audit;
DROP POLICY IF EXISTS "tenant_risk_audit_select" ON public.risk_role_audit;
CREATE POLICY "tenant_risk_audit_select"
  ON public.risk_role_audit FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'risk_admin'))
  );

-- 2) Remove duplicate weak INSERT policy on treasury_role_audit
DROP POLICY IF EXISTS "tenant insert audit" ON public.treasury_role_audit;
