-- Manifeste de parité du schéma `public`.
--
-- Sortie TSV, sections délimitées par `# @@ section: <nom>`. Toutes les requêtes
-- sont triées et normalisées (espaces compactés), pour que deux bases issues du
-- même schéma produisent exactement les mêmes octets, indépendamment de l'ordre
-- physique des objets.
--
-- Usage (noter `-q`, sans quoi psql ajoute deux lignes de confirmation `\pset`
-- au fichier et le manifeste n'est plus comparable) :
--   psql -q -f scripts/schema/schema-manifest.sql > manifeste.tsv
--
-- Comparaison : `diff manifeste-oracle.tsv manifeste-reconstruit.tsv` doit être vide.

-- Toute erreur doit interrompre : une section qui échoue des deux côtés
-- produirait deux manifestes identiques... et une parité faussement verte.
\set ON_ERROR_STOP on

\pset footer off
\pset tuples_only on
\pset format unaligned
\pset fieldsep '\t'

\echo '# @@ section: tables_columns'
SELECT c.relname,
       a.attnum,
       a.attname,
       pg_catalog.format_type(a.atttypid, a.atttypmod),
       a.attnotnull,
       COALESCE(pg_get_expr(d.adbin, d.adrelid), ''),
       a.attidentity,
       a.attgenerated
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY 1, 2;

\echo '# @@ section: constraints'
SELECT c.relname,
       con.conname,
       con.contype,
       regexp_replace(pg_get_constraintdef(con.oid), '\s+', ' ', 'g')
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY 1, 2;

\echo '# @@ section: indexes'
SELECT tablename, indexname, regexp_replace(indexdef, '\s+', ' ', 'g')
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY 1, 2;

\echo '# @@ section: functions'
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid),
       p.prosecdef,
       COALESCE(array_to_string(p.proconfig, ','), ''),
       regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY 1, 2;

\echo '# @@ section: views'
SELECT c.relname,
       c.relkind,
       COALESCE(array_to_string(c.reloptions, ','), ''),
       regexp_replace(pg_get_viewdef(c.oid, true), '\s+', ' ', 'g')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
ORDER BY 1;

\echo '# @@ section: triggers'
SELECT c.relname,
       t.tgname,
       regexp_replace(pg_get_triggerdef(t.oid), '\s+', ' ', 'g')
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY 1, 2;

\echo '# @@ section: policies'
SELECT schemaname,
       tablename,
       policyname,
       permissive,
       array_to_string(roles, ','),
       cmd,
       COALESCE(regexp_replace(qual, '\s+', ' ', 'g'), ''),
       COALESCE(regexp_replace(with_check, '\s+', ' ', 'g'), '')
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY 2, 3;

\echo '# @@ section: rls_enabled'
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY 1;

\echo '# @@ section: sequences'
SELECT sequence_name, data_type, start_value, increment, cycle_option
FROM information_schema.sequences
WHERE sequence_schema = 'public'
ORDER BY 1;

\echo '# @@ section: enums'
SELECT t.typname, e.enumlabel, e.enumsortorder
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY 1, 3;

\echo '# @@ section: fk_to_auth_users'
SELECT c.relname, con.conname, regexp_replace(pg_get_constraintdef(con.oid), '\s+', ' ', 'g')
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND con.contype = 'f'
  AND con.confrelid = 'auth.users'::regclass
ORDER BY 1, 2;