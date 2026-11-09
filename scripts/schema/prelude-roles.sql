-- Prélude de rôles pour restaurer le dump Supabase dans un PostgreSQL standard.
--
-- Pourquoi : le dump contient 152 politiques `TO authenticated`, 4 `TO service_role`,
-- et de nombreux GRANT vers `anon`. Un `CREATE POLICY ... TO <role>` échoue si le
-- rôle n'existe pas — et PostgreSQL valide cette clause au moment de la création.
--
-- Ces rôles sont NOLOGIN : personne ne s'y connecte. L'API se connectera avec un
-- rôle `qerp_api` membre de `authenticated` (voir V1__bootstrap_roles.sql).
--
-- Ce fichier ne sert QU'À reconstruire la base oracle de référence. Il n'est pas
-- une migration Flyway.

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_admin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

-- service_role est le rôle d'administration de Supabase : il contourne la RLS.
-- Il ne doit JAMAIS être utilisé par le chemin de requête de l'API.
ALTER ROLE service_role BYPASSRLS;