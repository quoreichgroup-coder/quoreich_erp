
CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  position TEXT,
  owner_id UUID,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_contacts TO authenticated;
GRANT ALL ON public.crm_contacts TO service_role;
ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'lead',
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'XOF',
  probability NUMERIC(5,2) NOT NULL DEFAULT 0,
  expected_close_date DATE,
  owner_id UUID,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_opportunities TO authenticated;
GRANT ALL ON public.crm_opportunities TO service_role;
ALTER TABLE public.crm_opportunities ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  opportunity_id UUID REFERENCES public.crm_opportunities(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'task',
  subject TEXT NOT NULL,
  notes TEXT,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  assigned_to UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_activities TO authenticated;
GRANT ALL ON public.crm_activities TO service_role;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_role_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  target_user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  action TEXT NOT NULL,
  performed_by UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.crm_role_audit TO authenticated;
GRANT ALL ON public.crm_role_audit TO service_role;
ALTER TABLE public.crm_role_audit ENABLE ROW LEVEL SECURITY;

-- Local updated_at trigger (inlined to avoid search_path issues)
CREATE OR REPLACE FUNCTION public.crm_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER crm_contacts_set_updated BEFORE UPDATE ON public.crm_contacts
  FOR EACH ROW EXECUTE FUNCTION public.crm_set_updated_at();
CREATE TRIGGER crm_opportunities_set_updated BEFORE UPDATE ON public.crm_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.crm_set_updated_at();

-- has_crm_perm
CREATE OR REPLACE FUNCTION public.has_crm_perm(_user_id UUID, _action TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.has_role(_user_id, 'admin'::public.app_role)
      OR public.has_role(_user_id, 'crm_admin'::public.app_role) THEN TRUE
    ELSE CASE _action
      WHEN 'view' THEN
        public.has_role(_user_id, 'crm_agent'::public.app_role)
        OR public.has_role(_user_id, 'crm_manager'::public.app_role)
        OR public.has_role(_user_id, 'crm_auditor'::public.app_role)
      WHEN 'create' THEN
        public.has_role(_user_id, 'crm_agent'::public.app_role)
        OR public.has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'edit' THEN
        public.has_role(_user_id, 'crm_agent'::public.app_role)
        OR public.has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'delete' THEN public.has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'approve_discount' THEN public.has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'convert' THEN public.has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'export' THEN
        public.has_role(_user_id, 'crm_manager'::public.app_role)
        OR public.has_role(_user_id, 'crm_auditor'::public.app_role)
      WHEN 'view_sensitive' THEN
        public.has_role(_user_id, 'crm_manager'::public.app_role)
        OR public.has_role(_user_id, 'crm_auditor'::public.app_role)
      WHEN 'audit' THEN public.has_role(_user_id, 'crm_auditor'::public.app_role)
      ELSE FALSE
    END
  END;
$$;
REVOKE ALL ON FUNCTION public.has_crm_perm(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_crm_perm(uuid, text) TO authenticated;

-- assign_crm_role with SoD agent <-> manager
CREATE OR REPLACE FUNCTION public.assign_crm_role(
  p_target_user UUID, p_role public.app_role, p_action TEXT,
  p_reason TEXT DEFAULT NULL, p_tenant UUID DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant UUID; _has_agent BOOLEAN; _has_manager BOOLEAN;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::public.app_role)
       OR public.has_role(auth.uid(),'crm_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'CRM_FORBIDDEN';
  END IF;
  IF p_role NOT IN ('crm_agent','crm_manager','crm_admin','crm_auditor') THEN
    RAISE EXCEPTION 'CRM_INVALID_ROLE: %', p_role;
  END IF;
  _tenant := COALESCE(p_tenant, public.get_user_tenant_id(auth.uid()));
  IF _tenant IS NULL THEN RAISE EXCEPTION 'CRM_TENANT_REQUIRED'; END IF;

  IF p_action = 'grant' THEN
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_target_user AND role='crm_agent'::public.app_role AND tenant_id=_tenant) INTO _has_agent;
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_target_user AND role='crm_manager'::public.app_role AND tenant_id=_tenant) INTO _has_manager;
    IF p_role='crm_manager'::public.app_role AND _has_agent THEN RAISE EXCEPTION 'CRM_SOD_CONFLICT'; END IF;
    IF p_role='crm_agent'::public.app_role AND _has_manager THEN RAISE EXCEPTION 'CRM_SOD_CONFLICT'; END IF;
    INSERT INTO public.user_roles(user_id, role, tenant_id) VALUES (p_target_user, p_role, _tenant) ON CONFLICT DO NOTHING;
  ELSIF p_action = 'revoke' THEN
    DELETE FROM public.user_roles WHERE user_id=p_target_user AND role=p_role AND tenant_id=_tenant;
  ELSE RAISE EXCEPTION 'CRM_INVALID_ACTION: %', p_action; END IF;

  INSERT INTO public.crm_role_audit(tenant_id, target_user_id, role, action, performed_by, reason)
  VALUES (_tenant, p_target_user, p_role, p_action, auth.uid(), p_reason);
END; $$;
REVOKE ALL ON FUNCTION public.assign_crm_role(uuid, public.app_role, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_crm_role(uuid, public.app_role, text, text, uuid) TO authenticated;

-- RLS policies
CREATE POLICY "crm_contacts_select" ON public.crm_contacts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'view'));
CREATE POLICY "crm_contacts_insert" ON public.crm_contacts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'create'));
CREATE POLICY "crm_contacts_update" ON public.crm_contacts FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'edit'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'edit'));
CREATE POLICY "crm_contacts_delete" ON public.crm_contacts FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'delete'));

CREATE POLICY "crm_opportunities_select" ON public.crm_opportunities FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'view'));
CREATE POLICY "crm_opportunities_insert" ON public.crm_opportunities FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'create'));
CREATE POLICY "crm_opportunities_update" ON public.crm_opportunities FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'edit'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'edit'));
CREATE POLICY "crm_opportunities_delete" ON public.crm_opportunities FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'delete'));

CREATE POLICY "crm_activities_select" ON public.crm_activities FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'view'));
CREATE POLICY "crm_activities_insert" ON public.crm_activities FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'create'));
CREATE POLICY "crm_activities_update" ON public.crm_activities FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'edit'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'edit'));
CREATE POLICY "crm_activities_delete" ON public.crm_activities FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'delete'));

CREATE POLICY "crm_role_audit_select" ON public.crm_role_audit FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_crm_perm(auth.uid(),'audit'));
CREATE POLICY "crm_role_audit_insert" ON public.crm_role_audit FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Stage transition audit
CREATE OR REPLACE FUNCTION public.crm_audit_stage_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.crm_activities(tenant_id, opportunity_id, contact_id, type, subject, completed_at, created_by)
    VALUES (NEW.tenant_id, NEW.id, NEW.contact_id, 'stage_change',
            'Étape : ' || OLD.stage || ' → ' || NEW.stage, now(), auth.uid());
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER crm_opportunities_audit_stage AFTER UPDATE ON public.crm_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.crm_audit_stage_change();

CREATE INDEX IF NOT EXISTS idx_crm_contacts_tenant ON public.crm_contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_crm_opp_tenant_stage ON public.crm_opportunities(tenant_id, stage);
CREATE INDEX IF NOT EXISTS idx_crm_activities_opp ON public.crm_activities(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_crm_role_audit_tenant ON public.crm_role_audit(tenant_id, created_at DESC);
