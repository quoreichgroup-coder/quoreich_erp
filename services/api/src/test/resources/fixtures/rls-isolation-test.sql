-- Recette négative d'isolation par société (SEC-01 / SEC-07).
--
-- À exécuter APRÈS les migrations et le jeu de recette :
--   psql -v ON_ERROR_STOP=1 -f reference-dataset.sql -f rls-isolation-test.sql
--
-- Chaque assertion lève une exception si elle échoue : le script se termine en
-- erreur, ce qui en fait un test exécutable et non une simple description.
--
-- Le rôle utilisé est `qerp_api` : NOLOGIN, NOSUPERUSER, NOBYPASSRLS, membre de
-- `authenticated`. C'est exactement le chemin applicatif. Le rôle propriétaire
-- des tables (postgres) n'est jamais employé pour lire des données métier, car
-- il contournerait les 157 politiques.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. auth.uid() sans contexte de session
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  u uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  u := auth.uid();
  IF u IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC 1 : auth.uid() devrait être NULL sans contexte, obtenu %', u;
  END IF;
  RAISE NOTICE 'OK 1 — auth.uid() vaut NULL sans contexte de session';
END $$;

-- ---------------------------------------------------------------------------
-- 2. Lecture : un utilisateur d'Alpha ne voit que les clients d'Alpha
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE qerp_api;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  total int;
  hors_societe int;
  uid uuid;
BEGIN
  uid := auth.uid();
  IF uid IS DISTINCT FROM 'aaaaaaaa-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'ÉCHEC 2a : auth.uid() = %, attendu le profil Alpha', uid;
  END IF;

  SELECT count(*) INTO total FROM customers;
  SELECT count(*) INTO hors_societe FROM customers
   WHERE tenant_id = '22222222-2222-2222-2222-222222222222';

  IF total <> 3 THEN
    RAISE EXCEPTION 'ÉCHEC 2b : % clients visibles pour Alpha, attendu 3', total;
  END IF;
  IF hors_societe <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC 2c : % lignes de la société Beta visibles depuis Alpha', hors_societe;
  END IF;

  RAISE NOTICE 'OK 2 — Alpha voit 3 clients, 0 ligne de Beta';
END $$;

-- ---------------------------------------------------------------------------
-- 3. Écriture : Alpha ne peut ni modifier ni insérer chez Beta
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  touches int;
BEGIN
  UPDATE customers SET name = 'INTRUSION'
   WHERE tenant_id = '22222222-2222-2222-2222-222222222222';
  GET DIAGNOSTICS touches = ROW_COUNT;

  IF touches <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC 3a : % lignes de Beta modifiées par Alpha', touches;
  END IF;

  BEGIN
    INSERT INTO customers (tenant_id, name)
    VALUES ('22222222-2222-2222-2222-222222222222', 'INTRUSION');
    RAISE EXCEPTION 'ÉCHEC 3b : insertion dans la société Beta acceptée depuis Alpha';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK 3 — écriture chez Beta refusée (42501), insertion rejetée';
  END;

  RAISE NOTICE 'OK 3 — aucune ligne de Beta modifiée';
END $$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 4. Sans contexte de session, le rôle applicatif ne voit AUCUNE ligne (échec fermé)
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE qerp_api;
SET LOCAL request.jwt.claims = '';

DO $$
DECLARE
  total int;
BEGIN
  SELECT count(*) INTO total FROM customers;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC 4 : % lignes visibles sans contexte de session (échec ouvert)', total;
  END IF;
  RAISE NOTICE 'OK 4 — 0 ligne visible sans contexte : la RLS échoue fermée';
END $$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 5. Un utilisateur de Beta ne voit que Beta (contrôle symétrique)
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE qerp_api;
SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

DO $$
DECLARE
  total int;
  hors_societe int;
BEGIN
  SELECT count(*) INTO total FROM customers;
  SELECT count(*) INTO hors_societe FROM customers
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111';

  IF total <> 5 THEN
    RAISE EXCEPTION 'ÉCHEC 5a : % clients visibles pour Beta, attendu 5', total;
  END IF;
  IF hors_societe <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC 5b : % lignes de la société Alpha visibles depuis Beta', hors_societe;
  END IF;

  RAISE NOTICE 'OK 5 — Beta voit 5 clients, 0 ligne d''Alpha';
END $$;

ROLLBACK;

\echo 'RECETTE D''ISOLATION : TOUTES LES ASSERTIONS SONT PASSÉES'