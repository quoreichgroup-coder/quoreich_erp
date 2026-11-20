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

-- Justificatifs des notes de frais (V112) : stockage privé du nuage. Chemin <société>/<note>/<fichier> ;
-- lecture par qui voit la note (sa RLS s'applique dans la sous-requête), dépôt par son auteur ou le droit
-- « expenses.manage », retrait seulement tant que la note est modifiable. Sur site, pas de stockage :
-- la référence du justificatif reste obligatoire au-delà du seuil.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('public.expense_reports') IS NULL THEN
    RAISE NOTICE 'storage ou notes de frais absents : stockage des justificatifs ignoré';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('expense-receipts', 'expense-receipts', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

  DROP POLICY IF EXISTS "Justificatifs : lecture avec la note" ON storage.objects;
  DROP POLICY IF EXISTS "Justificatifs : dépôt par l'auteur" ON storage.objects;
  DROP POLICY IF EXISTS "Justificatifs : retrait tant que modifiable" ON storage.objects;
  CREATE POLICY "Justificatifs : lecture avec la note" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'expense-receipts' AND (storage.foldername(name))[1] = public.get_user_tenant_id(auth.uid())::text
           AND EXISTS (SELECT 1 FROM public.expense_reports r WHERE r.id::text = (storage.foldername(name))[2]));
  CREATE POLICY "Justificatifs : dépôt par l'auteur" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'expense-receipts' AND (storage.foldername(name))[1] = public.get_user_tenant_id(auth.uid())::text
           AND EXISTS (SELECT 1 FROM public.expense_reports r WHERE r.id::text = (storage.foldername(name))[2]
                        AND r.status IN ('draft', 'rejected')
                        AND (r.created_by = auth.uid() OR public.has_permission(auth.uid(), 'expenses.manage'))));
  CREATE POLICY "Justificatifs : retrait tant que modifiable" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'expense-receipts' AND (storage.foldername(name))[1] = public.get_user_tenant_id(auth.uid())::text
           AND EXISTS (SELECT 1 FROM public.expense_reports r WHERE r.id::text = (storage.foldername(name))[2]
                        AND r.status IN ('draft', 'rejected')
                        AND (r.created_by = auth.uid() OR public.has_permission(auth.uid(), 'expenses.manage'))));
END $$;

-- Pièces jointes de toutes les pièces (V138) : compartiment privé « documents », chemin
-- <société>/<type>/<pièce>/<fichier>. Lecture : fichier enregistré dans document_attachments (lecture sous RLS, donc
-- société de l'appelant). Dépôt : droit documents.attach et pièce de la société. Aucune modification ni suppression
-- d'un fichier enregistré (archive : la suppression est tracée dans la table, le fichier reste) ; seul un dépôt orphelin
-- (enregistrement refusé) peut être retiré par son auteur. Les limites de la société (taille, types) sont appliquées par
-- register_attachment ; celles du compartiment sont le plafond technique (50 Mo).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('public.document_attachments') IS NULL THEN
    RAISE NOTICE 'storage ou pièces jointes absents : compartiment documents ignoré';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('documents', 'documents', false, 52428800, NULL)
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = NULL;

  DROP POLICY IF EXISTS "Pièces jointes : lecture" ON storage.objects;
  DROP POLICY IF EXISTS "Pièces jointes : dépôt" ON storage.objects;
  DROP POLICY IF EXISTS "Pièces jointes : retrait d'un dépôt orphelin" ON storage.objects;
  CREATE POLICY "Pièces jointes : lecture" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = public.get_user_tenant_id(auth.uid())::text
           AND EXISTS (SELECT 1 FROM public.document_attachments a WHERE a.storage_path = name));
  CREATE POLICY "Pièces jointes : dépôt" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = public.get_user_tenant_id(auth.uid())::text
           AND public.has_permission(auth.uid(), 'documents.attach')
           AND public.attachment_doc_in_my_tenant((storage.foldername(name))[2], (storage.foldername(name))[3]));
  CREATE POLICY "Pièces jointes : retrait d'un dépôt orphelin" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'documents' AND owner_id = auth.uid()::text
           AND NOT EXISTS (SELECT 1 FROM public.document_attachments a WHERE a.storage_path = name));
END $$;
