
CREATE OR REPLACE FUNCTION public.assign_fixed_asset_role(
  p_target_user uuid,
  p_role app_role,
  p_action text,
  p_comment text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  IF NOT (public.has_role(auth.uid(), 'asset_admin') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  IF p_role::text NOT IN ('asset_clerk','asset_accountant','asset_controller','asset_admin') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;
  IF p_action = 'assign' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (p_target_user, p_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSIF p_action = 'revoke' THEN
    DELETE FROM public.user_roles WHERE user_id = p_target_user AND role = p_role;
  ELSE
    RAISE EXCEPTION 'invalid_action';
  END IF;
  INSERT INTO public.fixed_asset_role_audit(tenant_id, actor_user_id, target_user_id, role, action, details)
  VALUES (v_tenant, auth.uid(), p_target_user, p_role::text, p_action,
          CASE WHEN p_comment IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('comment', p_comment) END);
END $$;
