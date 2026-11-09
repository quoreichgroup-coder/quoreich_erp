
CREATE OR REPLACE FUNCTION public.assign_hr_role(
  p_target_user uuid,
  p_role public.app_role,
  p_action text,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _target_tenant uuid;
  _has_clerk boolean;
  _has_approver boolean;
  _has_officer boolean;
  _has_auditor boolean;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin'::public.app_role)
       OR public.has_role(auth.uid(),'hr_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Seuls les administrateurs peuvent assigner les rôles RH';
  END IF;
  IF p_action NOT IN ('assign','revoke') THEN
    RAISE EXCEPTION 'Action invalide: %', p_action;
  END IF;
  IF p_role::text NOT IN ('hr_clerk','hr_approver','payroll_officer','hr_auditor','hr_admin') THEN
    RAISE EXCEPTION 'Rôle % n''est pas un rôle RH', p_role;
  END IF;

  SELECT tenant_id INTO _target_tenant FROM public.profiles WHERE id = p_target_user;
  IF _target_tenant IS NULL OR _target_tenant <> _tenant THEN
    RAISE EXCEPTION 'Utilisateur cible non rattaché à votre tenant';
  END IF;

  IF p_action = 'assign' THEN
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_target_user AND role='hr_clerk'::public.app_role AND tenant_id=_tenant) INTO _has_clerk;
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_target_user AND role='hr_approver'::public.app_role AND tenant_id=_tenant) INTO _has_approver;
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_target_user AND role='payroll_officer'::public.app_role AND tenant_id=_tenant) INTO _has_officer;
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_target_user AND role='hr_auditor'::public.app_role AND tenant_id=_tenant) INTO _has_auditor;

    IF p_role='hr_approver'::public.app_role AND _has_clerk THEN
      RAISE EXCEPTION 'SoD: utilisateur déjà Saisie RH — incompatible avec Approbateur Paie';
    END IF;
    IF p_role='hr_clerk'::public.app_role AND _has_approver THEN
      RAISE EXCEPTION 'SoD: utilisateur déjà Approbateur Paie — incompatible avec Saisie RH';
    END IF;
    IF p_role='hr_auditor'::public.app_role AND _has_officer THEN
      RAISE EXCEPTION 'SoD: utilisateur déjà Officier de Paie — incompatible avec Auditeur RH';
    END IF;
    IF p_role='payroll_officer'::public.app_role AND _has_auditor THEN
      RAISE EXCEPTION 'SoD: utilisateur déjà Auditeur RH — incompatible avec Officier de Paie';
    END IF;

    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (p_target_user, p_role, _tenant)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
      WHERE user_id=p_target_user AND role=p_role AND tenant_id=_tenant;
  END IF;

  INSERT INTO public.hr_role_audit (tenant_id, performed_by, target_user_id, role, action, reason)
  VALUES (_tenant, auth.uid(), p_target_user, p_role::text, p_action::text, p_reason);
END $$;

REVOKE ALL ON FUNCTION public.assign_hr_role(uuid, public.app_role, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_hr_role(uuid, public.app_role, text, text) TO authenticated;
