-- V25 — Matrice des autorisations : journal des changements, cohérence avec les écrans de
-- rôles des modules. Écrit à la main.
--
-- 1. JOURNAL (documents de modification SAP) : chaque création, modification ou suppression
--    de rôle, chaque droit coché ou retiré, chaque rôle affecté ou retiré est inscrit dans
--    erp_authorization_audit, avec son auteur et sa date. Le journal est écrit par la base
--    elle-même (déclencheurs) : aucun chemin d'écriture ne peut l'oublier, pas même un appel
--    direct à la table. Lecture : l'administrateur de la société.
--
-- 2. RECOPIE INVERSE (transition, complète celle de V23) : un rôle SYSTÈME affecté ou retiré
--    depuis la matrice est aussi écrit dans user_roles, que lisent encore les écrans de rôles
--    des modules et leurs fichiers *-roles.ts. Les deux recopies ne bouclent pas : chacune
--    écrit avec ON CONFLICT DO NOTHING, ou supprime une ligne déjà absente.
--
-- Jumelle : supabase/migrations/20261113130000_8e4c2a6b-7d9f-4b1e-a5c3-2f6d0b8e9a17.sql

CREATE TABLE public.erp_authorization_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Pas de clé étrangère : le journal survit à la suppression de ce qu'il décrit.
    tenant_id uuid NOT NULL,
    actor_id uuid,
    action text NOT NULL CHECK (action IN ('role_created', 'role_updated', 'role_activated',
                                           'role_deleted', 'permission_granted', 'permission_removed',
                                           'role_assigned', 'role_revoked')),
    role_id uuid,
    role_name text,
    target_user_id uuid,
    permission_code text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX erp_authorization_audit_tenant_idx ON public.erp_authorization_audit (tenant_id, created_at DESC);

CREATE FUNCTION public.audit_authorizations() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _role public.erp_roles%ROWTYPE;
  _action text;
BEGIN
  -- L'initialisation des rôles système (seed) n'est pas une décision de quelqu'un.
  IF current_setting('qerp.system_roles_seed', true) = 'on' THEN RETURN NULL; END IF;

  IF TG_TABLE_NAME = 'erp_roles' THEN
    _role := COALESCE(NEW, OLD);
    _action := CASE
      WHEN TG_OP = 'INSERT' THEN 'role_created'
      WHEN TG_OP = 'DELETE' THEN 'role_deleted'
      WHEN OLD.needs_review AND NOT NEW.needs_review THEN 'role_activated'
      ELSE 'role_updated' END;
    -- Suppression en cascade d'une société : rien à tracer pour elle.
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN RETURN NULL; END IF;
    INSERT INTO public.erp_authorization_audit (tenant_id, actor_id, action, role_id, role_name)
    VALUES (_role.tenant_id, auth.uid(), _action, _role.id, _role.name);
    RETURN NULL;
  END IF;

  SELECT * INTO _role FROM public.erp_roles
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.role_id ELSE NEW.role_id END;
  IF NOT FOUND THEN RETURN NULL; END IF;   -- rôle en cours de suppression : déjà tracé

  IF TG_TABLE_NAME = 'erp_role_permissions' THEN
    INSERT INTO public.erp_authorization_audit (tenant_id, actor_id, action, role_id, role_name, permission_code)
    VALUES (_role.tenant_id, auth.uid(),
            CASE TG_OP WHEN 'INSERT' THEN 'permission_granted' ELSE 'permission_removed' END,
            _role.id, _role.name, COALESCE(NEW.permission_code, OLD.permission_code));
  ELSE -- user_role_assignments
    INSERT INTO public.erp_authorization_audit (tenant_id, actor_id, action, role_id, role_name, target_user_id)
    VALUES (_role.tenant_id, auth.uid(),
            CASE TG_OP WHEN 'INSERT' THEN 'role_assigned' ELSE 'role_revoked' END,
            _role.id, _role.name, COALESCE(NEW.user_id, OLD.user_id));
  END IF;
  RETURN NULL;
END; $$;

CREATE TRIGGER trg_audit_erp_roles AFTER INSERT OR UPDATE OR DELETE ON public.erp_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_authorizations();
CREATE TRIGGER trg_audit_erp_role_permissions AFTER INSERT OR DELETE ON public.erp_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_authorizations();
CREATE TRIGGER trg_audit_user_role_assignments AFTER INSERT OR DELETE ON public.user_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.audit_authorizations();

-- Recopie inverse : affectation d'un rôle système → user_roles.
CREATE FUNCTION public.mirror_role_assignments() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _code text;
BEGIN
  SELECT code INTO _code FROM public.erp_roles
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.role_id ELSE NEW.role_id END;
  IF _code IS NULL THEN RETURN NULL; END IF;   -- rôle sur mesure : rien à recopier
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (NEW.user_id, _code::public.app_role, NEW.tenant_id)
    ON CONFLICT (user_id, role, tenant_id) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
     WHERE user_id = OLD.user_id AND role = _code::public.app_role AND tenant_id = OLD.tenant_id;
  END IF;
  RETURN NULL;
END; $$;

CREATE TRIGGER trg_mirror_role_assignments AFTER INSERT OR DELETE ON public.user_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.mirror_role_assignments();

ALTER TABLE public.erp_authorization_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Administrateur de la société" ON public.erp_authorization_audit FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin());
REVOKE INSERT, UPDATE, DELETE ON public.erp_authorization_audit FROM authenticated;

REVOKE ALL ON FUNCTION public.audit_authorizations(), public.mirror_role_assignments() FROM PUBLIC;
REVOKE ALL ON public.erp_authorization_audit FROM anon;
REVOKE ALL ON FUNCTION public.audit_authorizations(), public.mirror_role_assignments() FROM anon;
