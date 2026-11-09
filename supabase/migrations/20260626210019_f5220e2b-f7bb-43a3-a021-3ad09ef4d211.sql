
-- 1. Extend procurement_settings with SLA configuration
ALTER TABLE public.procurement_settings
  ADD COLUMN IF NOT EXISTS sla_pr_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS sla_pr_to_po_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS sla_po_to_gr_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS sla_gr_to_ap_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS sla_warning_pct numeric NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS sla_critical_pct numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS sla_color_ok text NOT NULL DEFAULT '#16a34a',
  ADD COLUMN IF NOT EXISTS sla_color_warning text NOT NULL DEFAULT '#f59e0b',
  ADD COLUMN IF NOT EXISTS sla_color_critical text NOT NULL DEFAULT '#dc2626';

-- 2. Audit log for procurement role assignments
CREATE TABLE IF NOT EXISTS public.procurement_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  action text NOT NULL CHECK (action IN ('assign','revoke')),
  performed_by uuid NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.procurement_role_audit TO authenticated;
GRANT ALL ON public.procurement_role_audit TO service_role;
ALTER TABLE public.procurement_role_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read audit" ON public.procurement_role_audit
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "service insert" ON public.procurement_role_audit
  FOR INSERT TO authenticated WITH CHECK (false); -- writes happen via SECURITY DEFINER RPC only

-- 3. RPC: admin-only assign/revoke procurement roles, with audit
CREATE OR REPLACE FUNCTION public.assign_procurement_role(
  _target_user uuid,
  _role public.app_role,
  _action text,
  _comment text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _target_tenant uuid;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only administrators can assign procurement roles';
  END IF;
  IF _action NOT IN ('assign','revoke') THEN
    RAISE EXCEPTION 'Invalid action %', _action;
  END IF;
  IF _role::text NOT IN ('procurement_l1','procurement_l2','procurement_l3','procurement_controller','procurement_3wm_approver') THEN
    RAISE EXCEPTION 'Role % is not a procurement role', _role;
  END IF;

  SELECT tenant_id INTO _target_tenant FROM public.profiles WHERE id = _target_user;
  IF _target_tenant IS NULL OR _target_tenant <> _tenant THEN
    RAISE EXCEPTION 'Target user not in your tenant';
  END IF;

  IF _action = 'assign' THEN
    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (_target_user, _role, _tenant)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
     WHERE user_id = _target_user AND role = _role AND tenant_id = _tenant;
  END IF;

  INSERT INTO public.procurement_role_audit (tenant_id, target_user_id, role, action, performed_by, comment)
  VALUES (_tenant, _target_user, _role, _action, auth.uid(), _comment);
END; $$;

REVOKE ALL ON FUNCTION public.assign_procurement_role(uuid, public.app_role, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.assign_procurement_role(uuid, public.app_role, text, text) TO authenticated;
