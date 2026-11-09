
CREATE TABLE IF NOT EXISTS public.compliance_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  action text NOT NULL CHECK (action IN ('grant','revoke')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.compliance_role_audit TO authenticated;
GRANT ALL ON public.compliance_role_audit TO service_role;
ALTER TABLE public.compliance_role_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compliance_audit_admin_select" ON public.compliance_role_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'compliance_admin'));
CREATE POLICY "compliance_audit_service_all" ON public.compliance_role_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.risk_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  action text NOT NULL CHECK (action IN ('grant','revoke')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.risk_role_audit TO authenticated;
GRANT ALL ON public.risk_role_audit TO service_role;
ALTER TABLE public.risk_role_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "risk_audit_admin_select" ON public.risk_role_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'risk_admin'));
CREATE POLICY "risk_audit_service_all" ON public.risk_role_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.assign_compliance_role(
  _target_user uuid, _role public.app_role, _action text, _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _tenant uuid; _actor uuid := auth.uid(); _conflict public.app_role;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.has_role(_actor,'admin') OR public.has_role(_actor,'compliance_admin')) THEN
    RAISE EXCEPTION 'forbidden: compliance_admin required';
  END IF;
  IF _role NOT IN ('compliance_officer','compliance_auditor','compliance_admin') THEN
    RAISE EXCEPTION 'invalid compliance role: %', _role;
  END IF;
  IF _action NOT IN ('grant','revoke') THEN RAISE EXCEPTION 'invalid action'; END IF;

  SELECT tenant_id INTO _tenant FROM public.profiles WHERE id = _target_user;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'target user not found'; END IF;

  IF _action = 'grant' THEN
    _conflict := CASE _role
      WHEN 'compliance_officer' THEN 'compliance_auditor'::public.app_role
      WHEN 'compliance_auditor' THEN 'compliance_officer'::public.app_role
      ELSE NULL END;
    IF _conflict IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _target_user AND role = _conflict
    ) THEN
      RAISE EXCEPTION 'SoD violation: user already has conflicting role %', _conflict;
    END IF;
    INSERT INTO public.user_roles(user_id, role) VALUES (_target_user, _role)
      ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _target_user AND role = _role;
  END IF;

  INSERT INTO public.compliance_role_audit(tenant_id, actor_user_id, target_user_id, role, action, reason)
  VALUES (_tenant, _actor, _target_user, _role, _action, _reason);
END $$;
REVOKE ALL ON FUNCTION public.assign_compliance_role(uuid, public.app_role, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_compliance_role(uuid, public.app_role, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_risk_role(
  _target_user uuid, _role public.app_role, _action text, _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _tenant uuid; _actor uuid := auth.uid(); _conflict public.app_role;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.has_role(_actor,'admin') OR public.has_role(_actor,'risk_admin')) THEN
    RAISE EXCEPTION 'forbidden: risk_admin required';
  END IF;
  IF _role NOT IN ('risk_owner','risk_assessor','risk_admin') THEN
    RAISE EXCEPTION 'invalid risk role: %', _role;
  END IF;
  IF _action NOT IN ('grant','revoke') THEN RAISE EXCEPTION 'invalid action'; END IF;

  SELECT tenant_id INTO _tenant FROM public.profiles WHERE id = _target_user;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'target user not found'; END IF;

  IF _action = 'grant' THEN
    _conflict := CASE _role
      WHEN 'risk_owner' THEN 'risk_assessor'::public.app_role
      WHEN 'risk_assessor' THEN 'risk_owner'::public.app_role
      ELSE NULL END;
    IF _conflict IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _target_user AND role = _conflict
    ) THEN
      RAISE EXCEPTION 'SoD violation: user already has conflicting role %', _conflict;
    END IF;
    INSERT INTO public.user_roles(user_id, role) VALUES (_target_user, _role)
      ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _target_user AND role = _role;
  END IF;

  INSERT INTO public.risk_role_audit(tenant_id, actor_user_id, target_user_id, role, action, reason)
  VALUES (_tenant, _actor, _target_user, _role, _action, _reason);
END $$;
REVOKE ALL ON FUNCTION public.assign_risk_role(uuid, public.app_role, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_risk_role(uuid, public.app_role, text, text) TO authenticated;
