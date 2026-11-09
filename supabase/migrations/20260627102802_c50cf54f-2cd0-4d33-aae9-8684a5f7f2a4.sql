
CREATE OR REPLACE FUNCTION public.assign_budget_role(
  p_target_user uuid,
  p_role public.app_role,
  p_action text,
  p_comment text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _target_tenant uuid;
  _has_planner boolean;
  _has_approver boolean;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin'::public.app_role)
       OR public.has_role(auth.uid(),'budget_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Seuls les administrateurs peuvent assigner les rôles Budget';
  END IF;
  IF p_action NOT IN ('assign','revoke') THEN
    RAISE EXCEPTION 'Action invalide: %', p_action;
  END IF;
  IF p_role::text NOT IN ('budget_planner','budget_approver','budget_controller','budget_admin') THEN
    RAISE EXCEPTION 'Rôle % n''est pas un rôle Budget', p_role;
  END IF;

  SELECT tenant_id INTO _target_tenant FROM public.profiles WHERE id = p_target_user;
  IF _target_tenant IS NULL OR _target_tenant <> _tenant THEN
    RAISE EXCEPTION 'Utilisateur cible non rattaché à votre tenant';
  END IF;

  IF p_action = 'assign' THEN
    -- SoD: planner XOR approver
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_target_user AND role = 'budget_planner'::public.app_role AND tenant_id = _tenant)
      INTO _has_planner;
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_target_user AND role = 'budget_approver'::public.app_role AND tenant_id = _tenant)
      INTO _has_approver;

    IF p_role = 'budget_approver'::public.app_role AND _has_planner THEN
      RAISE EXCEPTION 'SoD: l''utilisateur est déjà Planificateur — incompatible avec Approbateur';
    END IF;
    IF p_role = 'budget_planner'::public.app_role AND _has_approver THEN
      RAISE EXCEPTION 'SoD: l''utilisateur est déjà Approbateur — incompatible avec Planificateur';
    END IF;

    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (p_target_user, p_role, _tenant)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
      WHERE user_id = p_target_user AND role = p_role AND tenant_id = _tenant;
  END IF;

  INSERT INTO public.budget_role_audit (tenant_id, actor_user_id, target_user_id, role, action, details)
  VALUES (_tenant, auth.uid(), p_target_user, p_role, p_action,
          jsonb_build_object('comment', COALESCE(p_comment,'')));
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_budget_role(uuid, public.app_role, text, text) TO authenticated;
