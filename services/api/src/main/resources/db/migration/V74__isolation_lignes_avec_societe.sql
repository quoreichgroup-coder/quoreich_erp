-- V74 — Isolation des sociétés (V55) : une table de lignes qui porte sa propre société contrôle aussi
-- sa pièce.
--
-- install_tenant_isolation_triggers() écartait toujours la colonne « pièce » des tables de lignes
-- déclarées (budget_lines.budget_id, po_lines.po_id…), même quand la table a sa propre colonne
-- tenant_id : la ligne est alors contrôlée par sa société (« self ») et sa pièce doit l'être aussi.
-- V73 a ajouté tenant_id à budget_lines : budget_lines.budget_id → budgets n'était plus contrôlé
-- (IsolationSocietesIT). Corrigé ici, puis triggers réinstallés.

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
           array_agg(k.col || ',' || k.ref ORDER BY k.col) FILTER (WHERE p.col IS NULL OR k.col <> p.col
             OR EXISTS (SELECT 1 FROM tables_societe s WHERE s.relname = k.tbl)) AS pairs
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

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
