-- V2 — Schéma `auth` de compatibilité.
--
-- DOIT précéder V8 (fonctions), V12 (politiques) et V14 (clés étrangères).
-- Les 157 politiques RLS et 122 corps de fonctions appellent `auth.uid()` ;
-- 16 clés étrangères de `public` ciblent `auth.users`.
--
-- Ce schéma reproduit FIDÈLEMENT le contrat des fonctions Supabase, afin que
-- les politiques, les fonctions et les triggers restent inchangés, octet pour
-- octet. L'API fixe le contexte par transaction :
--
--   SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated",...}';
--
-- Le choix de `SET LOCAL` (et non `SET`) est structurant : le contexte est
-- annulé à la fin de la transaction, donc aucune fuite entre deux requêtes
-- qui réutilisent la même connexion.
--
-- COMPORTEMENT PAR DÉFAUT — ÉCHEC FERMÉ. Sans variable de session :
--   auth.jwt()  -> '{}'::jsonb
--   auth.uid()  -> NULL
--   une politique `tenant_id = get_user_tenant_id(auth.uid())` compare alors à
--   NULL, donc n'est jamais vraie : 0 ligne lue, 0 ligne écrite.
-- Aucune branche de ce fichier ne transforme l'absence de contexte en accès
-- autorisé : il n'y a ni valeur par défaut, ni repli sur un rôle d'administration.

CREATE SCHEMA IF NOT EXISTS auth;

-- Table minimale. Vérifié sur le dump : aucune fonction ni vue de `public` ne lit
-- une colonne de `auth.users` autre que `id` ; les 16 FK ne portent que sur `id`.
-- Les utilisateurs eux-mêmes vivent dans Keycloak (lot 1), importés avec leurs
-- UUID d'origine pour que ces clés étrangères restent valides sans migration.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY
);

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
           NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
           '{}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
           COALESCE(
             NULLIF(current_setting('request.jwt.claim.sub', true), ''),
             NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
           ), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
           NULLIF(current_setting('request.jwt.claim.role', true), ''),
           NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
           'anon')
$$;

CREATE OR REPLACE FUNCTION auth.email()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
           NULLIF(current_setting('request.jwt.claim.email', true), ''),
           NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
$$;

GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt(), auth.role(), auth.email()
  TO authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;