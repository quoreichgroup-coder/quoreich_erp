-- V24 — La société d'un profil ne se choisit pas soi-même. Écrit à la main. SÉCURITÉ.
--
-- LA FAILLE (présente dans le schéma de production, politiques du dump)
-- Toute l'isolation entre sociétés repose sur get_user_tenant_id(), qui lit
-- profiles.tenant_id. Or :
--   « Users can update own profile »  FOR UPDATE USING (id = auth.uid())   — sans WITH CHECK
--   « Users can insert own profile »  FOR INSERT WITH CHECK (id = auth.uid())
-- Un utilisateur connecté pouvait donc, d'un simple appel depuis son navigateur, remplacer
-- la société de son profil par celle d'une autre entreprise (ou créer son profil directement
-- rattaché à elle) et lire puis modifier ses données partout où la RLS ne vérifie que la
-- société.
--
-- LA CORRECTION
-- Seuls les traitements du serveur rattachent un profil à une société : create_tenant_for_user()
-- (onboarding) et les fonctions SECURITY DEFINER, qui s'exécutent sous le rôle propriétaire.
-- Une écriture faite directement sous un rôle applicatif (authenticated, anon, qerp_api)
-- ne peut ni changer profiles.tenant_id, ni créer un profil déjà rattaché à une société.
-- Le nom, l'avatar, etc. restent modifiables par l'utilisateur.
--
-- Vérifié : l'application ne modifie jamais profiles.tenant_id directement (seule
-- create_tenant_for_user le fait).
--
-- Jumelle : supabase/migrations/20261113120000_5d2b9e7a-4c1f-4a8e-b3d6-1e7f0c9a2b54.sql

CREATE FUNCTION public.guard_profile_tenant() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  -- current_user est le rôle effectif : celui du client pour une écriture directe, le
  -- propriétaire à l'intérieur d'une fonction SECURITY DEFINER.
  IF current_user IN ('authenticated', 'anon', 'qerp_api') THEN
    IF TG_OP = 'INSERT' AND NEW.tenant_id IS NOT NULL THEN
      RAISE EXCEPTION 'Un profil ne peut pas être rattaché à une société par l''utilisateur lui-même'
        USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'La société d''un profil ne se modifie pas par l''utilisateur lui-même'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_guard_profile_tenant BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_tenant();

REVOKE ALL ON FUNCTION public.guard_profile_tenant() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_profile_tenant() FROM anon;
