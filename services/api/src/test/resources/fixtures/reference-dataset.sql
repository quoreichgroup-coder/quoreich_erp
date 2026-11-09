-- Jeu de données de recette — synthétique, sans aucune donnée de production.
--
-- Objectif : prouver l'isolation par société (SEC-01/SEC-07) et fournir à terme
-- l'oracle de comparaison ancien SQL / nouvelle implémentation Java (lots 2 à 4).
--
-- Aucun identifiant, courriel, nom ou IBAN réel n'y figure : les UUID sont figés
-- pour rendre les tests reproductibles, mais ils sont inventés.
--
-- Application : après les migrations, en tant que propriétaire (pas via qerp_api :
-- les politiques RLS empêcheraient le chargement initial).

BEGIN;

-- Deux sociétés. L'insertion déclenche trg_seed_ar_defaults, trg_seed_inv_defaults,
-- trg_seed_procurement_defaults et trg_seed_sales : les paramétrages par défaut
-- sont donc créés automatiquement, il ne faut PAS les insérer à la main.
INSERT INTO tenants (id, name, currency, fiscal_year_start, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Société Alpha (recette)', 'XOF', 1, 'active'),
  ('22222222-2222-2222-2222-222222222222', 'Société Beta (recette)',  'XOF', 1, 'active');

-- Identités : auth.users porte l'UUID que Keycloak conservera (lot 1).
INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002');

INSERT INTO profiles (id, tenant_id, full_name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Utilisateur Alpha'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Utilisateur Beta');

-- Clients : 3 pour Alpha, 5 pour Beta.
INSERT INTO customers (id, tenant_id, name, status) VALUES
  ('c0000001-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'Client Alpha 1', 'active'),
  ('c0000002-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'Client Alpha 2', 'active'),
  ('c0000003-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'Client Alpha 3', 'active'),
  ('c0000004-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'Client Beta 1',  'active'),
  ('c0000005-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'Client Beta 2',  'active'),
  ('c0000006-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'Client Beta 3',  'active'),
  ('c0000007-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'Client Beta 4',  'active'),
  ('c0000008-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'Client Beta 5',  'active');

COMMIT;