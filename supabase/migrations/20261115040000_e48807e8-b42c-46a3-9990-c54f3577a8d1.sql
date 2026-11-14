-- V55 — Isolation stricte des sociétés (règle du propriétaire, 14 nov. 2026 : « les données d'une
-- société ne doivent pas se mélanger à une autre » ; aucun flux inter-sociétés).
--
-- La RLS empêche d'écrire une ligne DANS une autre société, mais 105 clés étrangères entre tables
-- de sociétés ne contrôlent que l'identifiant : une commande pouvait citer le fournisseur d'une autre
-- société, une ligne de commande son article, une ligne d'écriture son compte, etc. — et les
-- fonctions SECURITY DEFINER (réception, livraison…) auraient alors mouvementé les données de
-- l'autre société. Constat avant migration : 0 ligne mélangée sur les deux bases.
--
-- Après : chaque table concernée porte le déclencheur trg_zz_isolation_societe (dernier BEFORE, donc
-- après les numérotations et compléments) qui vérifie, pour TOUT écrivain (écran, API, fonctions
-- internes), que chaque ligne référencée appartient à la société de la ligne — ou, pour une table de
-- lignes sans tenant_id, à la société de sa pièce. Refus SQLSTATE QG017. Les données de référence
-- globales (tenant_id NULL) restent citables.
-- install_tenant_isolation_triggers() régénère ces déclencheurs depuis le catalogue : toute migration
-- qui ajoute une clé étrangère entre tables de sociétés l'appelle ; IsolationSocietesIT échoue si une
-- clé n'est pas couverte.

CREATE OR REPLACE FUNCTION public.assert_same_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row jsonb := to_jsonb(NEW);
  _tenant uuid;
  _i integer;
  _id uuid;
  _ref uuid;
  _found boolean;
BEGIN
  IF TG_ARGV[0] = 'self' THEN
    _tenant := (_row->>'tenant_id')::uuid;
    _i := 1;
  ELSE
    -- Table de lignes : la société est celle de la pièce (TG_ARGV[1] = colonne, TG_ARGV[2] = table).
    _id := (_row->>TG_ARGV[1])::uuid;
    IF _id IS NOT NULL THEN
      EXECUTE format('SELECT tenant_id FROM public.%I WHERE id = $1', TG_ARGV[2]) INTO _tenant USING _id;
    END IF;
    _i := 3;
  END IF;
  IF _tenant IS NULL THEN RETURN NEW; END IF;

  WHILE _i < TG_NARGS LOOP
    _id := (_row->>TG_ARGV[_i])::uuid;
    IF _id IS NOT NULL THEN
      EXECUTE format('SELECT tenant_id, true FROM public.%I WHERE id = $1', TG_ARGV[_i + 1]) INTO _ref, _found USING _id;
      IF _found AND _ref IS NOT NULL AND _ref <> _tenant THEN
        RAISE EXCEPTION 'Isolation des sociétés : « % » cite une ligne de « % » appartenant à une autre société', TG_ARGV[_i], TG_ARGV[_i + 1]
          USING ERRCODE = 'QG017', HINT = 'Une pièce ne peut citer que les tiers, articles, comptes et pièces de sa propre société.';
      END IF;
    END IF;
    _i := _i + 2;
  END LOOP;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.assert_same_tenant() FROM PUBLIC, anon, authenticated;

-- Régénère les déclencheurs depuis le catalogue. Tables de lignes sans tenant_id : la pièce parente
-- est déclarée ici (la table de lignes suit la société de sa pièce).
CREATE OR REPLACE FUNCTION public.install_tenant_isolation_triggers()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET client_min_messages TO 'warning'
AS $function$
DECLARE
  _t record;
  _args text[];
  _p text;
  _n integer := 0;
BEGIN
  FOR _t IN
    WITH tables_societe AS (
      SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
    ), parents(tbl, col, parent) AS (
      VALUES ('budget_lines', 'budget_id', 'budgets'), ('dn_lines', 'dn_id', 'delivery_notes'),
             ('gr_lines', 'gr_id', 'goods_receipts'), ('inventory_count_lines', 'count_id', 'inventory_counts'),
             ('journal_lines', 'entry_id', 'journal_entries'), ('po_lines', 'po_id', 'purchase_orders'),
             ('project_costs', 'project_id', 'projects'), ('quote_lines', 'quotation_id', 'quotations'),
             ('requisition_lines', 'requisition_id', 'purchase_requisitions'), ('so_lines', 'so_id', 'sales_orders'),
             ('depreciation_entries', 'asset_id', 'assets')
    ), cles AS (
      SELECT src.relname AS tbl, a.attname AS col, dst.relname AS ref
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid JOIN pg_namespace ns ON ns.oid = src.relnamespace AND ns.nspname = 'public'
        JOIN tables_societe dst ON dst.oid = c.confrelid
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f' AND cardinality(c.conkey) = 1 AND a.attname <> 'tenant_id'
    )
    SELECT k.tbl,
           CASE WHEN EXISTS (SELECT 1 FROM tables_societe s WHERE s.relname = k.tbl) THEN ARRAY['self']
                ELSE ARRAY['parent', p.col, p.parent] END AS head,
           array_agg(k.col || ',' || k.ref ORDER BY k.col) FILTER (WHERE p.col IS NULL OR k.col <> p.col) AS pairs
      FROM cles k LEFT JOIN parents p ON p.tbl = k.tbl
     WHERE EXISTS (SELECT 1 FROM tables_societe s WHERE s.relname = k.tbl) OR p.tbl IS NOT NULL
     GROUP BY k.tbl, p.col, p.parent
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_zz_isolation_societe ON public.%I', _t.tbl);
    IF _t.pairs IS NULL THEN CONTINUE; END IF;
    _args := _t.head;
    FOREACH _p IN ARRAY _t.pairs LOOP
      _args := _args || string_to_array(_p, ',');
    END LOOP;
    EXECUTE format('CREATE TRIGGER trg_zz_isolation_societe BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW '
                   'EXECUTE FUNCTION public.assert_same_tenant(%s)', _t.tbl,
                   (SELECT string_agg(quote_literal(x), ', ') FROM unnest(_args) x));
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $function$;
REVOKE ALL ON FUNCTION public.install_tenant_isolation_triggers() FROM PUBLIC, anon, authenticated;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
