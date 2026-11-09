
-- Expense Management RBAC: add roles to app_role enum, audit table, and SoD-aware RPC.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'expense_clerk' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'expense_clerk';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'expense_approver' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'expense_approver';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'expense_controller' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'expense_controller';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'expense_admin' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'expense_admin';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.expense_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('grant','revoke')),
  role public.app_role NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.expense_role_audit TO authenticated;
GRANT ALL ON public.expense_role_audit TO service_role;

ALTER TABLE public.expense_role_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_role_audit_select_tenant" ON public.expense_role_audit;
CREATE POLICY "expense_role_audit_select_tenant"
ON public.expense_role_audit FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.user_role_assignments WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "expense_role_audit_no_direct_write" ON public.expense_role_audit;
CREATE POLICY "expense_role_audit_no_direct_write"
ON public.expense_role_audit FOR INSERT TO authenticated
WITH CHECK (false);

CREATE INDEX IF NOT EXISTS expense_role_audit_tenant_created_idx
  ON public.expense_role_audit (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.assign_expense_role(
  _target_user uuid,
  _role public.app_role,
  _action text,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid;
  _conflict public.app_role;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _action NOT IN ('grant','revoke') THEN RAISE EXCEPTION 'invalid_action'; END IF;
  IF _role NOT IN ('expense_clerk','expense_approver','expense_controller','expense_admin') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  SELECT tenant_id INTO _tenant
  FROM public.user_role_assignments
  WHERE user_id = _actor AND role = 'expense_admin'
  LIMIT 1;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'forbidden: expense_admin required'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_role_assignments
    WHERE user_id = _target_user AND tenant_id = _tenant
  ) THEN
    RAISE EXCEPTION 'target_user_not_in_tenant';
  END IF;

  IF _action = 'grant' THEN
    -- SoD: clerk ⊕ approver mutually exclusive
    IF _role = 'expense_clerk' THEN _conflict := 'expense_approver';
    ELSIF _role = 'expense_approver' THEN _conflict := 'expense_clerk';
    ELSE _conflict := NULL; END IF;

    IF _conflict IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _target_user AND role = _conflict
    ) THEN
      RAISE EXCEPTION 'sod_violation: % conflicts with %', _role, _conflict;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target_user, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = _target_user AND role = _role;
  END IF;

  INSERT INTO public.expense_role_audit (tenant_id, actor_user_id, target_user_id, action, role, reason)
  VALUES (_tenant, _actor, _target_user, _action, _role, _reason);

  RETURN jsonb_build_object('ok', true, 'action', _action, 'role', _role);
END;
$$;

REVOKE ALL ON FUNCTION public.assign_expense_role(uuid, public.app_role, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.assign_expense_role(uuid, public.app_role, text, text) TO authenticated;
