-- V15 — Droits applicatifs, écrits délibérément.
--
-- Les ACL d'origine du dump ne sont pas rejouées : elles ciblaient des rôles
-- Supabase inexistants (`sandbox_exec`, `dashboard_user`, `supabase_*_admin`) et
-- accordaient `ALL` sur les 141 tables à `anon` comme à `authenticated`.
-- L'original est conservé pour audit dans `scripts/schema/reference/acl-original.sql`.
--
-- Modèle retenu :
--   authenticated : lecture et écriture, bornées par les 157 politiques RLS.
--   service_role  : tous droits (tâches planifiées, maintenance).
--   anon          : AUCUN droit — la nouvelle architecture n'expose aucun accès
--                   direct à la base sans identité (l'authentification passe par
--                   Keycloak et l'API, jamais par une connexion anonyme).

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- Depuis PostgreSQL 15, `CREATE FUNCTION` accorde EXECUTE à PUBLIC. L'original
-- révoquait explicitement : on le reproduit. Sans cette révocation, n'importe quel
-- rôle pourrait appeler les RPC SECURITY DEFINER, y compris celles qui écrivent.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- Même logique pour les objets créés par les migrations suivantes.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;