
-- Audit table for project role assignments
CREATE TABLE IF NOT EXISTS public.project_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  role app_role NOT NULL,
  action text NOT NULL CHECK (action IN ('grant','revoke')),
  performed_by uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.project_role_audit TO authenticated;
GRANT ALL ON public.project_role_audit TO service_role;

ALTER TABLE public.project_role_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project admins read tenant audit"
  ON public.project_role_audit FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'project_admin')
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Service role full access"
  ON public.project_role_audit FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_project_role_audit_tenant ON public.project_role_audit(tenant_id, created_at DESC);

-- SoD-enforcing role assignment RPC
CREATE OR REPLACE FUNCTION public.assign_project_role(
  _tenant_id uuid,
  _target_user_id uuid,
  _role app_role,
  _action text,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _conflict app_role;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF NOT (public.has_role(_caller, 'project_admin') OR public.has_role(_caller, 'admin')) THEN
    RAISE EXCEPTION 'FORBIDDEN: project_admin role required' USING ERRCODE = '42501';
  END IF;

  IF _role NOT IN ('project_planner','project_accountant','project_controller','project_admin') THEN
    RAISE EXCEPTION 'INVALID_ROLE: %', _role USING ERRCODE = '22023';
  END IF;

  IF _action NOT IN ('grant','revoke') THEN
    RAISE EXCEPTION 'INVALID_ACTION: %', _action USING ERRCODE = '22023';
  END IF;

  -- Segregation of Duties: planner and controller are mutually exclusive
  IF _action = 'grant' THEN
    IF _role = 'project_planner' THEN
      _conflict := 'project_controller';
    ELSIF _role = 'project_controller' THEN
      _conflict := 'project_planner';
    END IF;

    IF _conflict IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _target_user_id AND role = _conflict
    ) THEN
      RAISE EXCEPTION 'SOD_VIOLATION: user already has conflicting role %', _conflict USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.user_roles(user_id, role)
    VALUES (_target_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = _target_user_id AND role = _role;
  END IF;

  INSERT INTO public.project_role_audit(tenant_id, target_user_id, role, action, performed_by, reason)
  VALUES (_tenant_id, _target_user_id, _role, _action, _caller, _reason);

  RETURN jsonb_build_object('ok', true, 'role', _role, 'action', _action);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_project_role(uuid, uuid, app_role, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.assign_project_role(uuid, uuid, app_role, text, text) TO authenticated;
