-- Réglages propres à Supabase (nuage), hors schéma métier. Rejouable sans effet.
--
-- Les migrations (Flyway sur site, jumelles Supabase) décrivent le schéma public, identique des
-- deux côtés. Ce fichier ne porte que ce que seul Supabase possède :
--   - la publication temps réel « supabase_realtime » (rafraîchissement automatique des écrans,
--     useRealtimeInvalidation et les canaux des hooks) : mêmes tables que l'ancien projet Lovable
--     Cloud (dump du 9 novembre 2026), user_roles en moins (supprimée en V32), plus les tables de
--     calendrier fiscal (V33) que les écrans de clôture affichent.
-- Sur site, l'équivalent temps réel sera servi par l'API (SSE/WebSocket, plan de bascule).
--
-- Appliqué par scripts/schema/deploy-supabase.sh après les migrations.

DO $$
DECLARE
  _t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'Publication supabase_realtime absente : rien à faire (base hors Supabase ?)';
    RETURN;
  END IF;
  FOREACH _t IN ARRAY ARRAY[
    'ai_analysis_history', 'ap_invoices', 'ar_invoices', 'bank_accounts', 'delivery_notes', 'erp_alerts',
    'inventory_counts', 'inventory_role_audit', 'item_locations', 'journal_entries', 'payments',
    'procurement_approvals', 'procurement_match_decisions', 'quotations', 'sales_orders', 'sales_role_audit',
    'stock_movements', 'warehouses', 'period_locks', 'fiscal_years'
  ] LOOP
    IF to_regclass('public.' || _t) IS NULL THEN
      RAISE NOTICE 'Table public.% absente : ignorée', _t;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                        AND schemaname = 'public' AND tablename = _t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', _t);
    END IF;
  END LOOP;
END $$;
