-- V1 — Rôles de base.
--
-- DOIT précéder V3..V14 : PostgreSQL valide la clause `TO <role>` d'un
-- `CREATE POLICY` au moment de la création. Les 152 politiques du schéma public
-- ciblent `authenticated`, les 4 autres `service_role`. Sans ces rôles, la
-- reconstruction échoue.
--
-- Aucun de ces rôles n'a de LOGIN : personne ne s'y connecte directement.
-- Le rôle de connexion de l'API est accordé à `authenticated` (voir V15).

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'qerp_api'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', r);
    END IF;
  END LOOP;
END $$;

-- service_role est le rôle d'administration (tâches planifiées, maintenance).
-- Il contourne la RLS et ne doit JAMAIS servir au chemin de requête d'un utilisateur.
ALTER ROLE service_role BYPASSRLS;

-- Le rôle applicatif est membre de `authenticated` : c'est ce qui rend les
-- 152 politiques RLS applicables à l'API, sans en réécrire une seule.
-- INHERIT est l'attribut par défaut de CREATE ROLE ; on le réaffirme pour qu'un
-- changement global de `role_attribute` ne puisse pas désactiver silencieusement
-- l'héritage (et donc l'application des politiques).
ALTER ROLE qerp_api INHERIT;
GRANT authenticated TO qerp_api;