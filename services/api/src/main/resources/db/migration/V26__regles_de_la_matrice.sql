-- V26 — Règles de la matrice des autorisations, dans la base. Écrit à la main.
--
-- L'API Java les contrôlait déjà (V25), avec des messages précis ; mais l'écran de production
-- passe par Supabase, qui écrit directement dans les tables. Un invariant qui ne vit que dans
-- un des deux chemins n'en est pas un : la base les impose désormais, quel que soit l'appelant.
--   - une société garde toujours au moins un administrateur ;
--   - un rôle « à revoir » ne s'affecte pas tant qu'il n'est pas activé ;
--   - un rôle encore affecté ne se supprime pas.
-- La suppression d'une société entière (cascade) reste possible.
--
-- Jumelle : supabase/migrations/20261113140000_1a7e5c3d-8b2f-4d6a-9e1c-4f0b7d2a6c85.sql

CREATE FUNCTION public.guard_role_assignments() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _role public.erp_roles%ROWTYPE;
BEGIN
  IF current_setting('qerp.system_roles_seed', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO _role FROM public.erp_roles WHERE id = NEW.role_id;
    IF _role.needs_review THEN
      RAISE EXCEPTION 'Rôle à revoir : vérifiez ses droits et activez-le avant de l''affecter'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE : société supprimée en cascade → rien à protéger.
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
  SELECT * INTO _role FROM public.erp_roles WHERE id = OLD.role_id;
  IF _role.code = 'admin' AND NOT EXISTS (
       SELECT 1 FROM public.user_role_assignments a
       WHERE a.role_id = OLD.role_id AND a.user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'Impossible de retirer le dernier administrateur de la société'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END; $$;

CREATE TRIGGER trg_guard_role_assignments BEFORE INSERT OR DELETE ON public.user_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_role_assignments();

CREATE FUNCTION public.guard_role_in_use() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
  SELECT count(*) INTO _n FROM public.user_role_assignments WHERE role_id = OLD.id;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Retirez d''abord ce rôle à ses % utilisateur(s)', _n USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END; $$;

CREATE TRIGGER trg_guard_role_in_use BEFORE DELETE ON public.erp_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_role_in_use();

REVOKE ALL ON FUNCTION public.guard_role_assignments(), public.guard_role_in_use() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_role_assignments(), public.guard_role_in_use() FROM anon;
