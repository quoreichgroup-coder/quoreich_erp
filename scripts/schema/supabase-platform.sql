-- Réglages propres à Supabase (nuage), hors schéma métier. Rejouable sans effet.
--
-- Les migrations (Flyway sur site, jumelles Supabase) décrivent le schéma public, identique des
-- deux côtés. Ce fichier ne porte que ce que seul Supabase possède :
--   - la publication temps réel « supabase_realtime » (rafraîchissement automatique des écrans,
--     useRealtimeInvalidation et les canaux des hooks) : mêmes tables que l'ancien projet Lovable
--     Cloud (dump du 9 novembre 2026), user_roles en moins (supprimée en V32), plus les tables de
--     calendrier fiscal (V33) que les écrans de clôture affichent ;
--   - le profil créé à l'inscription (déclencheur on_auth_user_created sur auth.users, comme dans
--     l'ancien projet) : sans lui, un nouvel utilisateur n'a pas de profil, create_tenant_for_user
--     crée la société sans l'y rattacher et l'écran d'accueil boucle. Constaté le 13 nov. 2026 sur
--     le projet propre, où la reprise n'avait copié que le schéma public. Les profils manquants des
--     comptes déjà inscrits sont créés au passage.
-- Sur site, l'équivalent temps réel sera servi par l'API (SSE/WebSocket, plan de bascule), et la
-- création du profil est du ressort de l'API (pas de schéma auth complet).
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

DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL OR to_regprocedure('public.handle_new_user()') IS NULL THEN
    RAISE NOTICE 'auth.users ou handle_new_user absent : profil à l''inscription ignoré';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
  INSERT INTO public.profiles (id, full_name)
  SELECT u.id, COALESCE(u.raw_user_meta_data ->> 'full_name', '')
    FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);
END $$;
