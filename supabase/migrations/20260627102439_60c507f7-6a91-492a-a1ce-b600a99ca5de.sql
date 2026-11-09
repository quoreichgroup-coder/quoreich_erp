
CREATE TABLE IF NOT EXISTS public.budget_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  target_user_id uuid,
  role public.app_role,
  action text NOT NULL CHECK (action IN ('assign','revoke')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.budget_role_audit TO authenticated;
GRANT ALL ON public.budget_role_audit TO service_role;

ALTER TABLE public.budget_role_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "budget_audit_admin_select"
  ON public.budget_role_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'budget_admin'));

CREATE POLICY "budget_audit_admin_insert"
  ON public.budget_role_audit FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid()
      AND (public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'budget_admin')));

CREATE INDEX IF NOT EXISTS idx_budget_role_audit_tenant_created
  ON public.budget_role_audit(tenant_id, created_at DESC);
