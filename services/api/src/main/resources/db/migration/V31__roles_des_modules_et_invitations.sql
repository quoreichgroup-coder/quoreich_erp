-- V31 — Rôles des modules écrits dans la matrice ; on rejoint une société sur invitation. Écrit à la main.
--
-- Constaté sur la copie réelle, chaque fonction appelée comme le fait l'écran :
--
-- 1. Les douze RPC assign_<module>_role (écrans de rôles par module) écrivaient dans user_roles,
--    table de transition. Une seule fonctionnait de bout en bout (CRM) :
--      - budget, immobilisations, RH, inventaire, achats, projets, ventes, trésorerie : ON
--        CONFLICT (user_id, role) alors que la seule contrainte est UNIQUE (user_id, role,
--        tenant_id) → « there is no unique or exclusion constraint matching the ON CONFLICT
--        specification » à chaque attribution ;
--      - notes de frais : lisait user_role_assignments.role, colonne qui n'existe pas ;
--      - conformité, risques : écrivaient une ligne SANS société, que la recopie vers la matrice
--        ignore — l'écran annonçait « rôle attribué », sans aucun effet.
-- 2. Neuf d'entre elles ne vérifiaient pas que l'utilisateur ciblé appartient à la société de
--    l'appelant, et plusieurs supprimaient « WHERE user_id AND role » sans société : un
--    administrateur pouvait retirer un rôle dans une autre société. assign_crm_role prenait la
--    société dans un paramètre fourni par le client (p_tenant), assign_project_role de même pour
--    son journal (_tenant_id).
-- 3. join_tenant(nom) rattachait l'appelant à N'IMPORTE QUELLE société dont il tapait le nom,
--    avec le rôle viewer, y compris s'il appartenait déjà à une autre société (la fonction,
--    SECURITY DEFINER, contourne la garde V24). Reproduit : un utilisateur d'une société lisait
--    aussitôt les clients et les factures d'une autre.
--
-- Corrections :
--   - trois fonctions internes communes : module_role_tenant (société de l'appelant, cible
--     vérifiée dans cette société), module_role_held (rôle détenu, lu dans la matrice — pour les
--     contrôles de séparation des tâches), module_role_set (écriture dans user_role_assignments) ;
--   - les douze RPC gardent signature, droits de l'appelant, rôles admis, vocabulaire d'action,
--     séparation des tâches et journal de leur module ; seule la notes de frais change de règle
--     d'accès, cassée jusqu'ici : admin ou expense_admin, comme les autres modules ;
--   - tenant_invitations : code à usage unique, daté, émis par un administrateur de la société,
--     avec le rôle d'arrivée (viewer par défaut). join_tenant(_tenant_name) garde sa signature
--     — l'écran envoie déjà le champ « joinCode » — mais le paramètre est désormais ce code, et
--     seul un utilisateur sans société peut l'utiliser ;
--   - create_tenant_for_user : réservé à un utilisateur sans société ; le rôle admin est écrit
--     dans la matrice.
-- Les recopies user_roles ⇄ matrice restent en place : user_roles reste cohérente jusqu'à sa
-- suppression.
--
-- Jumelle : supabase/migrations/20261113190000_2d7f4a9c-6e1b-4c8a-9f3d-5b0e8a2c1d76.sql

-- ─── Fonctions internes ───

-- Société de l'appelant, après vérification que la cible y est rattachée.
CREATE FUNCTION public.module_role_tenant(_target uuid) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Aucune société rattachée à votre profil' USING ERRCODE = '42501';
  END IF;
  IF _target IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Utilisateur cible non rattaché à votre société' USING ERRCODE = '42501';
  END IF;
  RETURN _tenant;
END $$;

-- Le rôle système _role est-il détenu par _user dans la société de l'appelant ?
CREATE FUNCTION public.module_role_held(_user uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_role_assignments a
    JOIN public.erp_roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
    WHERE a.user_id = _user
      AND a.tenant_id = public.get_user_tenant_id(auth.uid())
      AND r.code = _role::text)
$$;

-- Attribue (_grant) ou retire le rôle système _role à _target, dans la société de l'appelant.
CREATE FUNCTION public.module_role_set(_target uuid, _role public.app_role, _grant boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.module_role_tenant(_target);
  _role_id uuid;
BEGIN
  SELECT id INTO _role_id FROM public.erp_roles WHERE tenant_id = _tenant AND code = _role::text;
  IF _role_id IS NULL THEN
    RAISE EXCEPTION 'Rôle système % absent de la société', _role USING ERRCODE = '22023';
  END IF;
  IF _grant THEN
    INSERT INTO public.user_role_assignments (user_id, role_id, tenant_id, assigned_by)
    VALUES (_target, _role_id, _tenant, auth.uid())
    ON CONFLICT (user_id, role_id) DO NOTHING;
  ELSE
    DELETE FROM public.user_role_assignments WHERE user_id = _target AND role_id = _role_id;
  END IF;
  RETURN _tenant;
END $$;

REVOKE ALL ON FUNCTION public.module_role_tenant(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.module_role_held(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.module_role_set(uuid, public.app_role, boolean) FROM PUBLIC, anon, authenticated;

-- ─── Les douze RPC des écrans de rôles ───

CREATE OR REPLACE FUNCTION public.assign_budget_role(p_target_user uuid, p_role public.app_role, p_action text, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
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
  PERFORM public.module_role_tenant(p_target_user);

  IF p_action = 'assign' THEN
    -- SoD: planner XOR approver
    IF p_role = 'budget_approver'::public.app_role AND public.module_role_held(p_target_user, 'budget_planner') THEN
      RAISE EXCEPTION 'SoD: l''utilisateur est déjà Planificateur — incompatible avec Approbateur';
    END IF;
    IF p_role = 'budget_planner'::public.app_role AND public.module_role_held(p_target_user, 'budget_approver') THEN
      RAISE EXCEPTION 'SoD: l''utilisateur est déjà Approbateur — incompatible avec Planificateur';
    END IF;
  END IF;
  PERFORM public.module_role_set(p_target_user, p_role, p_action = 'assign');

  INSERT INTO public.budget_role_audit (tenant_id, actor_user_id, target_user_id, role, action, details)
  VALUES (_tenant, auth.uid(), p_target_user, p_role, p_action,
          jsonb_build_object('comment', COALESCE(p_comment,'')));
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_compliance_role(_target_user uuid, _role public.app_role, _action text, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _tenant := public.module_role_tenant(_target_user);

  IF _action = 'grant' THEN
    _conflict := CASE _role
      WHEN 'compliance_officer' THEN 'compliance_auditor'::public.app_role
      WHEN 'compliance_auditor' THEN 'compliance_officer'::public.app_role
      ELSE NULL END;
    IF _conflict IS NOT NULL AND public.module_role_held(_target_user, _conflict) THEN
      RAISE EXCEPTION 'SoD violation: user already has conflicting role %', _conflict;
    END IF;
  END IF;
  PERFORM public.module_role_set(_target_user, _role, _action = 'grant');

  INSERT INTO public.compliance_role_audit(tenant_id, actor_user_id, target_user_id, role, action, reason)
  VALUES (_tenant, _actor, _target_user, _role, _action, _reason);
END $function$;

CREATE OR REPLACE FUNCTION public.assign_crm_role(p_target_user uuid, p_role public.app_role, p_action text, p_reason text DEFAULT NULL::text, p_tenant uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::public.app_role)
       OR public.has_role(auth.uid(),'crm_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'CRM_FORBIDDEN';
  END IF;
  IF p_role NOT IN ('crm_agent','crm_manager','crm_admin','crm_auditor') THEN
    RAISE EXCEPTION 'CRM_INVALID_ROLE: %', p_role;
  END IF;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'CRM_TENANT_REQUIRED'; END IF;
  -- La société est celle de l'appelant ; le paramètre n'est plus qu'un contrôle de cohérence.
  IF p_tenant IS NOT NULL AND p_tenant <> _tenant THEN
    RAISE EXCEPTION 'CRM_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('grant','revoke') THEN RAISE EXCEPTION 'CRM_INVALID_ACTION: %', p_action; END IF;
  PERFORM public.module_role_tenant(p_target_user);

  IF p_action = 'grant' THEN
    IF p_role = 'crm_manager'::public.app_role AND public.module_role_held(p_target_user, 'crm_agent') THEN
      RAISE EXCEPTION 'CRM_SOD_CONFLICT';
    END IF;
    IF p_role = 'crm_agent'::public.app_role AND public.module_role_held(p_target_user, 'crm_manager') THEN
      RAISE EXCEPTION 'CRM_SOD_CONFLICT';
    END IF;
  END IF;
  PERFORM public.module_role_set(p_target_user, p_role, p_action = 'grant');

  INSERT INTO public.crm_role_audit(tenant_id, target_user_id, role, action, performed_by, reason)
  VALUES (_tenant, p_target_user, p_role, p_action, auth.uid(), p_reason);
END; $function$;

CREATE OR REPLACE FUNCTION public.assign_expense_role(_target_user uuid, _role public.app_role, _action text, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- L'ancienne vérification lisait user_role_assignments.role, colonne inexistante.
  IF NOT (public.has_role(_actor, 'admin') OR public.has_role(_actor, 'expense_admin')) THEN
    RAISE EXCEPTION 'forbidden: expense_admin required';
  END IF;
  _tenant := public.module_role_tenant(_target_user);

  IF _action = 'grant' THEN
    -- SoD: clerk ⊕ approver mutually exclusive
    IF _role = 'expense_clerk' THEN _conflict := 'expense_approver';
    ELSIF _role = 'expense_approver' THEN _conflict := 'expense_clerk';
    ELSE _conflict := NULL; END IF;
    IF _conflict IS NOT NULL AND public.module_role_held(_target_user, _conflict) THEN
      RAISE EXCEPTION 'sod_violation: % conflicts with %', _role, _conflict;
    END IF;
  END IF;
  PERFORM public.module_role_set(_target_user, _role, _action = 'grant');

  INSERT INTO public.expense_role_audit (tenant_id, actor_user_id, target_user_id, action, role, reason)
  VALUES (_tenant, _actor, _target_user, _action, _role, _reason);

  RETURN jsonb_build_object('ok', true, 'action', _action, 'role', _role);
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_fixed_asset_role(p_target_user uuid, p_role public.app_role, p_action text, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF p_action NOT IN ('assign','revoke') THEN RAISE EXCEPTION 'invalid_action'; END IF;
  PERFORM public.module_role_set(p_target_user, p_role, p_action = 'assign');
  INSERT INTO public.fixed_asset_role_audit(tenant_id, actor_user_id, target_user_id, role, action, details)
  VALUES (v_tenant, auth.uid(), p_target_user, p_role::text, p_action,
          CASE WHEN p_comment IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('comment', p_comment) END);
END $function$;

CREATE OR REPLACE FUNCTION public.assign_hr_role(p_target_user uuid, p_role public.app_role, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
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
  PERFORM public.module_role_tenant(p_target_user);

  IF p_action = 'assign' THEN
    IF p_role = 'hr_approver'::public.app_role AND public.module_role_held(p_target_user, 'hr_clerk') THEN
      RAISE EXCEPTION 'SoD: utilisateur déjà Saisie RH — incompatible avec Approbateur Paie';
    END IF;
    IF p_role = 'hr_clerk'::public.app_role AND public.module_role_held(p_target_user, 'hr_approver') THEN
      RAISE EXCEPTION 'SoD: utilisateur déjà Approbateur Paie — incompatible avec Saisie RH';
    END IF;
    IF p_role = 'hr_auditor'::public.app_role AND public.module_role_held(p_target_user, 'payroll_officer') THEN
      RAISE EXCEPTION 'SoD: utilisateur déjà Officier de Paie — incompatible avec Auditeur RH';
    END IF;
    IF p_role = 'payroll_officer'::public.app_role AND public.module_role_held(p_target_user, 'hr_auditor') THEN
      RAISE EXCEPTION 'SoD: utilisateur déjà Auditeur RH — incompatible avec Officier de Paie';
    END IF;
  END IF;
  PERFORM public.module_role_set(p_target_user, p_role, p_action = 'assign');

  INSERT INTO public.hr_role_audit (tenant_id, performed_by, target_user_id, role, action, reason)
  VALUES (_tenant, auth.uid(), p_target_user, p_role::text, p_action::text, p_reason);
END $function$;

CREATE OR REPLACE FUNCTION public.assign_inventory_role(_target_user uuid, _role public.app_role, _action text, _comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RAISE EXCEPTION 'Admin only'; END IF;
  IF _action NOT IN ('assign','revoke') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  IF _role::text NOT IN ('inventory_clerk','inventory_manager','inventory_controller') THEN
    RAISE EXCEPTION 'Not an inventory role';
  END IF;
  PERFORM public.module_role_set(_target_user, _role, _action = 'assign');

  INSERT INTO public.inventory_role_audit(tenant_id, target_user_id, role, action, performed_by, comment)
  VALUES (_tenant, _target_user, _role, _action, auth.uid(), _comment);
END $function$;

CREATE OR REPLACE FUNCTION public.assign_procurement_role(_target_user uuid, _role public.app_role, _action text, _comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
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
  PERFORM public.module_role_set(_target_user, _role, _action = 'assign');

  INSERT INTO public.procurement_role_audit (tenant_id, target_user_id, role, action, performed_by, comment)
  VALUES (_tenant, _target_user, _role, _action, auth.uid(), _comment);
END; $function$;

CREATE OR REPLACE FUNCTION public.assign_project_role(_tenant_id uuid, _target_user_id uuid, _role public.app_role, _action text, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _conflict public.app_role;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(_caller, 'project_admin') OR public.has_role(_caller, 'admin')) THEN
    RAISE EXCEPTION 'FORBIDDEN: project_admin role required' USING ERRCODE = '42501';
  END IF;
  -- La société est celle de l'appelant ; le paramètre n'est plus qu'un contrôle de cohérence.
  IF _tenant IS NULL OR (_tenant_id IS NOT NULL AND _tenant_id <> _tenant) THEN
    RAISE EXCEPTION 'FORBIDDEN: tenant mismatch' USING ERRCODE = '42501';
  END IF;
  IF _role NOT IN ('project_planner','project_accountant','project_controller','project_admin') THEN
    RAISE EXCEPTION 'INVALID_ROLE: %', _role USING ERRCODE = '22023';
  END IF;
  IF _action NOT IN ('grant','revoke') THEN
    RAISE EXCEPTION 'INVALID_ACTION: %', _action USING ERRCODE = '22023';
  END IF;
  PERFORM public.module_role_tenant(_target_user_id);

  -- Segregation of Duties: planner and controller are mutually exclusive
  IF _action = 'grant' THEN
    IF _role = 'project_planner' THEN
      _conflict := 'project_controller';
    ELSIF _role = 'project_controller' THEN
      _conflict := 'project_planner';
    END IF;
    IF _conflict IS NOT NULL AND public.module_role_held(_target_user_id, _conflict) THEN
      RAISE EXCEPTION 'SOD_VIOLATION: user already has conflicting role %', _conflict USING ERRCODE = '23514';
    END IF;
  END IF;
  PERFORM public.module_role_set(_target_user_id, _role, _action = 'grant');

  INSERT INTO public.project_role_audit(tenant_id, target_user_id, role, action, performed_by, reason)
  VALUES (_tenant, _target_user_id, _role, _action, _caller, _reason);

  RETURN jsonb_build_object('ok', true, 'role', _role, 'action', _action);
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_risk_role(_target_user uuid, _role public.app_role, _action text, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _tenant := public.module_role_tenant(_target_user);

  IF _action = 'grant' THEN
    _conflict := CASE _role
      WHEN 'risk_owner' THEN 'risk_assessor'::public.app_role
      WHEN 'risk_assessor' THEN 'risk_owner'::public.app_role
      ELSE NULL END;
    IF _conflict IS NOT NULL AND public.module_role_held(_target_user, _conflict) THEN
      RAISE EXCEPTION 'SoD violation: user already has conflicting role %', _conflict;
    END IF;
  END IF;
  PERFORM public.module_role_set(_target_user, _role, _action = 'grant');

  INSERT INTO public.risk_role_audit(tenant_id, actor_user_id, target_user_id, role, action, reason)
  VALUES (_tenant, _actor, _target_user, _role, _action, _reason);
END $function$;

CREATE OR REPLACE FUNCTION public.assign_sales_role(_target_user uuid, _role public.app_role, _action text, _comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RAISE EXCEPTION 'Admin only'; END IF;
  IF _action NOT IN ('assign','revoke') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  IF _role::text NOT IN ('sales_rep','sales_manager','sales_controller') THEN RAISE EXCEPTION 'Not a sales role'; END IF;
  PERFORM public.module_role_set(_target_user, _role, _action = 'assign');

  INSERT INTO public.sales_role_audit(tenant_id,target_user_id,role,action,performed_by,comment)
  VALUES (_tenant,_target_user,_role,_action,auth.uid(),_comment);
END $function$;

CREATE OR REPLACE FUNCTION public.assign_treasury_role(p_target_user uuid, p_role public.app_role, p_action text, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  IF NOT (public.has_role(auth.uid(), 'cash_admin') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  IF p_role NOT IN ('treasury_clerk','treasury_manager','treasury_controller','cash_admin') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;
  IF p_action NOT IN ('assign','revoke') THEN RAISE EXCEPTION 'invalid_action'; END IF;
  PERFORM public.module_role_set(p_target_user, p_role, p_action = 'assign');
  INSERT INTO public.treasury_role_audit(tenant_id, actor_id, target_user_id, role, action, comment)
  VALUES (v_tenant, auth.uid(), p_target_user, p_role, p_action, p_comment);
END $function$;

-- ─── Invitations ───

CREATE TABLE public.tenant_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    code text NOT NULL UNIQUE,
    role_id uuid NOT NULL REFERENCES public.erp_roles(id) ON DELETE CASCADE,
    note text,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_by uuid,
    used_at timestamptz,
    revoked_at timestamptz,
    CHECK (expires_at > created_at),
    CHECK ((used_by IS NULL) = (used_at IS NULL))
);
CREATE INDEX tenant_invitations_tenant_idx ON public.tenant_invitations (tenant_id, created_at DESC);

ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;
-- Lecture par les administrateurs de la société ; aucune écriture directe : tout passe par les
-- fonctions ci-dessous.
CREATE POLICY "Administrateur de la société" ON public.tenant_invitations FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin());
GRANT SELECT ON public.tenant_invitations TO authenticated;

-- Émet un code à usage unique pour rejoindre la société de l'administrateur appelant.
CREATE FUNCTION public.create_tenant_invitation(_role_id uuid DEFAULT NULL, _valid_days integer DEFAULT 7, _note text DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _role uuid;
  _raw text;
  _code text;
  _row public.tenant_invitations%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT public.is_tenant_admin() THEN
    RAISE EXCEPTION 'Seul un administrateur de la société peut inviter' USING ERRCODE = '42501';
  END IF;
  IF _valid_days IS NULL OR _valid_days < 1 OR _valid_days > 30 THEN
    RAISE EXCEPTION 'Durée de validité entre 1 et 30 jours' USING ERRCODE = '22023';
  END IF;
  IF _role_id IS NULL THEN
    SELECT id INTO _role FROM public.erp_roles WHERE tenant_id = _tenant AND code = 'viewer';
  ELSE
    SELECT id INTO _role FROM public.erp_roles WHERE id = _role_id AND tenant_id = _tenant AND NOT needs_review;
  END IF;
  IF _role IS NULL THEN
    RAISE EXCEPTION 'Rôle d''arrivée introuvable dans la société' USING ERRCODE = '22023';
  END IF;
  -- 16 caractères hexadécimaux (64 bits), lisibles par groupes de 4.
  _raw := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  _code := substr(_raw, 1, 4) || '-' || substr(_raw, 5, 4) || '-' || substr(_raw, 9, 4) || '-' || substr(_raw, 13, 4);
  INSERT INTO public.tenant_invitations (tenant_id, code, role_id, note, created_by, expires_at)
  VALUES (_tenant, _code, _role, NULLIF(btrim(_note), ''), auth.uid(), now() + make_interval(days => _valid_days))
  RETURNING * INTO _row;
  RETURN jsonb_build_object('id', _row.id, 'code', _row.code, 'expires_at', _row.expires_at);
END $$;

CREATE FUNCTION public.revoke_tenant_invitation(_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.is_tenant_admin() THEN
    RAISE EXCEPTION 'Seul un administrateur de la société peut révoquer une invitation' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tenant_invitations SET revoked_at = now()
   WHERE id = _id AND tenant_id = public.get_user_tenant_id(auth.uid()) AND used_at IS NULL AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation introuvable, déjà utilisée ou déjà révoquée' USING ERRCODE = '22023';
  END IF;
END $$;

-- Rejoindre une société : le paramètre (nom conservé pour l'écran existant) est un code
-- d'invitation. Réservé à un utilisateur sans société.
CREATE OR REPLACE FUNCTION public.join_tenant(_tenant_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _inv public.tenant_invitations%ROWTYPE;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Connexion requise' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND tenant_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Votre profil est déjà rattaché à une société' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _inv FROM public.tenant_invitations
   WHERE code = upper(btrim(_tenant_name))
     AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    -- Même message pour un code inconnu, expiré, révoqué ou déjà utilisé : rien à deviner.
    RAISE EXCEPTION 'Code d''invitation invalide ou expiré — demandez-en un à l''administrateur de la société'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles SET tenant_id = _inv.tenant_id WHERE id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profil introuvable' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.user_role_assignments (user_id, role_id, tenant_id, assigned_by)
  VALUES (_user_id, _inv.role_id, _inv.tenant_id, _inv.created_by)
  ON CONFLICT (user_id, role_id) DO NOTHING;
  UPDATE public.tenant_invitations SET used_by = _user_id, used_at = now() WHERE id = _inv.id;
  RETURN _inv.tenant_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_tenant_for_user(_tenant_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_id uuid;
  _user_id uuid := auth.uid();
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Connexion requise' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND tenant_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Votre profil est déjà rattaché à une société' USING ERRCODE = '42501';
  END IF;
  IF _tenant_name IS NULL OR btrim(_tenant_name) = '' THEN
    RAISE EXCEPTION 'Nom de société requis' USING ERRCODE = '22023';
  END IF;

  -- Les rôles système de la société sont créés par trg_seed_system_roles (V23).
  INSERT INTO public.tenants (name) VALUES (btrim(_tenant_name)) RETURNING id INTO _tenant_id;
  UPDATE public.profiles SET tenant_id = _tenant_id WHERE id = _user_id;
  INSERT INTO public.user_role_assignments (user_id, role_id, tenant_id, assigned_by)
  SELECT _user_id, r.id, _tenant_id, _user_id FROM public.erp_roles r
   WHERE r.tenant_id = _tenant_id AND r.code = 'admin';
  RETURN _tenant_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_tenant_invitation(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_tenant_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_invitation(uuid, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_tenant_invitation(uuid) TO authenticated, service_role;
