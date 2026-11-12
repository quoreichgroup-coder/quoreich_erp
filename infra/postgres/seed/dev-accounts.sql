-- Comptes de test pour l'environnement de développement — synthétiques, jetables.
-- NE JAMAIS appliquer en production.
--
-- Pourquoi un script séparé et pas dans `init/` : les scripts d'init tournent
-- avant Flyway, quand les tables n'existent pas encore. À appliquer après le
-- premier démarrage de l'API, en tant que propriétaire :
--
--   docker exec -i qerp-dev-postgres psql -U postgres -d qerp -v ON_ERROR_STOP=1 \
--     < infra/postgres/seed/dev-accounts.sql
--
-- Idempotent : rejouable sans doublon.
--
-- Il n'y a pas de mot de passe ici : l'authentification est portée par Keycloak,
-- et `auth.users` ne contient que l'UUID. Pour se connecter, créer dans le realm
-- les utilisateurs de même UUID (ou forger un JWT dont `sub` vaut cet UUID en dev).
--
--   UUID                                   société  rôle        usage
--   dddddddd-0000-0000-0000-000000000001   Dev A    admin       tout faire
--   dddddddd-0000-0000-0000-000000000002   Dev A    accountant  saisie comptable
--   dddddddd-0000-0000-0000-000000000003   Dev A    viewer      lecture seule (refus d'écriture)
--   dddddddd-0000-0000-0000-000000000004   Dev B    admin       recette négative inter-sociétés
--   dddddddd-0000-0000-0000-000000000005   (aucune) —          refus onboarding / zéro ligne

BEGIN;

-- L'insertion d'une société déclenche les triggers de paramétrage par défaut.
INSERT INTO tenants (id, name, currency, fiscal_year_start, status) VALUES
  ('d1000000-0000-0000-0000-00000000000a', 'Société Dev A', 'XOF', 1, 'active'),
  ('d1000000-0000-0000-0000-00000000000b', 'Société Dev B', 'XOF', 1, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id) VALUES
  ('dddddddd-0000-0000-0000-000000000001'),
  ('dddddddd-0000-0000-0000-000000000002'),
  ('dddddddd-0000-0000-0000-000000000003'),
  ('dddddddd-0000-0000-0000-000000000004'),
  ('dddddddd-0000-0000-0000-000000000005')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, tenant_id, full_name) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'Dev A — Admin'),
  ('dddddddd-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000a', 'Dev A — Comptable'),
  ('dddddddd-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-00000000000a', 'Dev A — Lecteur'),
  ('dddddddd-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-00000000000b', 'Dev B — Admin'),
  ('dddddddd-0000-0000-0000-000000000005', NULL,                                   'Sans société')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role, tenant_id)
SELECT v.user_id::uuid, v.role::app_role, v.tenant_id::uuid
FROM (VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'admin',      'd1000000-0000-0000-0000-00000000000a'),
  ('dddddddd-0000-0000-0000-000000000002', 'accountant', 'd1000000-0000-0000-0000-00000000000a'),
  ('dddddddd-0000-0000-0000-000000000003', 'viewer',     'd1000000-0000-0000-0000-00000000000a'),
  ('dddddddd-0000-0000-0000-000000000004', 'admin',      'd1000000-0000-0000-0000-00000000000b')
) AS v(user_id, role, tenant_id)
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles r WHERE r.user_id = v.user_id::uuid AND r.role = v.role::app_role);

-- Quelques clients pour que les listes ne soient pas vides.
INSERT INTO customers (id, tenant_id, name, status) VALUES
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'Client Dev A 1', 'active'),
  ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000a', 'Client Dev A 2', 'active'),
  ('d2000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-00000000000b', 'Client Dev B 1', 'active')
ON CONFLICT (id) DO NOTHING;

COMMIT;
