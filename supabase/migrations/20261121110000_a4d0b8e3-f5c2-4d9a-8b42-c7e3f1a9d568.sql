-- V138 — Pièces jointes sur toutes les pièces (écart G-35 ; SAP « services pour objets », Sage X3 pièces jointes, Odoo).
-- Avant : seuls les justificatifs des notes de frais avaient un fichier (V112). Une facture fournisseur, un connaissement, une
-- déclaration en douane ou un contrat restaient hors de l'ERP.
--   document_attachments    une ligne par fichier : type de pièce + identifiant (achats, ventes, stocks, comptabilité, tiers,
--                           immobilisations, projets), catégorie, nom, type, taille, empreinte SHA-256 (preuve d'intégrité),
--                           auteur, date ; jamais supprimée : une suppression est tracée (date, auteur, motif) et le fichier
--                           est gardé (archive) ; écrite seulement par register_attachment / delete_attachment ;
--   attachment_categories   catégories de la société (pièces auxquelles elles s'appliquent, NULL = toutes) ; required_for =
--                           pièces dont la soumission exige une pièce jointe de cette catégorie (facture fournisseur soumise
--                           à approbation, demande ou commande soumise, dossier d'importation dédouané) — rien d'imposé
--                           par défaut ; catégories usuelles créées au premier usage, modifiables ;
--   attachment_settings     taille maximale, types de fichiers admis, verrouillage après validation (une pièce validée ne
--                           perd plus ses pièces jointes sauf droit documents.delete), catégorie obligatoire ;
--   droits                  documents.attach (joindre ; supprimer les siennes tant que la pièce n'est pas validée),
--                           documents.delete (supprimer toute pièce jointe, avec motif), documents.settings.
-- Stockage : nuage = compartiment privé « documents » (scripts/schema/supabase-platform.sql), chemin
-- <société>/<type>/<pièce>/<fichier> ; sur site = répertoire de fichiers de l'API, même chemin.

CREATE TABLE public.attachment_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  max_size_mb integer NOT NULL DEFAULT 10 CHECK (max_size_mb BETWEEN 1 AND 50),
  allowed_mime_types text[] NOT NULL DEFAULT ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv', 'application/xml', 'text/xml'],
  lock_after_validation boolean NOT NULL DEFAULT true,
  require_category boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);

CREATE TABLE public.attachment_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_]{1,30}$'),
  label text NOT NULL CHECK (btrim(label) <> ''),
  doc_types text[],
  required_for text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (id, tenant_id),
  CHECK (required_for <@ ARRAY['ap_invoice', 'purchase_requisition', 'purchase_order', 'import_file']::text[])
);

CREATE TABLE public.document_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  doc_id uuid NOT NULL,
  category_id uuid,
  file_name text NOT NULL CHECK (btrim(file_name) <> ''),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text NOT NULL UNIQUE,
  note text,
  uploaded_by uuid NOT NULL DEFAULT auth.uid(),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  FOREIGN KEY (category_id, tenant_id) REFERENCES public.attachment_categories (id, tenant_id),
  CHECK ((deleted_at IS NULL) = (delete_reason IS NULL))
);
CREATE INDEX document_attachments_doc ON public.document_attachments (tenant_id, doc_type, doc_id);

ALTER TABLE public.attachment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachment_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.attachment_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.attachment_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'documents.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'documents.settings'));
CREATE POLICY "Lecture société" ON public.attachment_categories FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.attachment_categories FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'documents.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'documents.settings'));
-- Lecture seule : l'écriture passe par les fonctions (contrôles de taille, de type, de pièce, d'auteur).
CREATE POLICY "Lecture société" ON public.document_attachments FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.document_attachments FROM PUBLIC, anon, authenticated;

INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('documents.attach', 'documents', 'attach', 'Joindre des fichiers aux pièces'),
  ('documents.delete', 'documents', 'delete', 'Supprimer une pièce jointe (avec motif), y compris d''une pièce validée'),
  ('documents.settings', 'documents', 'settings', 'Paramétrer les pièces jointes (catégories, types, taille, exigences)')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT r.code, 'documents.attach' FROM public.erp_system_roles r WHERE r.code NOT IN ('viewer', 'crm_auditor', 'hr_auditor', 'compliance_auditor')
UNION ALL SELECT r.code, p FROM public.erp_system_roles r, unnest(ARRAY['documents.delete', 'documents.settings']) p WHERE r.code = 'admin'
UNION ALL SELECT 'accountant', 'documents.delete'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND sp.permission_code IN ('documents.attach', 'documents.delete', 'documents.settings')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

CREATE FUNCTION public.attachment_setting(_tenant uuid)
RETURNS public.attachment_settings LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT s FROM public.attachment_settings s WHERE s.tenant_id = _tenant),
    ROW(_tenant, 10, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/csv', 'application/xml', 'text/xml'], true, false, now(), NULL)::public.attachment_settings)
$$;
REVOKE EXECUTE ON FUNCTION public.attachment_setting(uuid) FROM PUBLIC, anon, authenticated;

-- Société et verrouillage d'une pièce (requêtes statiques par type : pas de SQL dynamique).
CREATE FUNCTION public.attachment_doc_info(_doc_type text, _doc_id uuid, OUT tenant_id uuid, OUT locked boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  CASE _doc_type
    WHEN 'purchase_requisition' THEN SELECT d.tenant_id, d.status NOT IN ('draft', 'rejected') INTO tenant_id, locked FROM public.purchase_requisitions d WHERE d.id = _doc_id;
    WHEN 'purchase_order' THEN SELECT d.tenant_id, d.status NOT IN ('draft', 'rejected') INTO tenant_id, locked FROM public.purchase_orders d WHERE d.id = _doc_id;
    WHEN 'goods_receipt' THEN SELECT d.tenant_id, d.status = 'completed' INTO tenant_id, locked FROM public.goods_receipts d WHERE d.id = _doc_id;
    WHEN 'ap_invoice' THEN SELECT d.tenant_id, d.approval_status = 'approved' INTO tenant_id, locked FROM public.ap_invoices d WHERE d.id = _doc_id;
    WHEN 'ap_credit_note' THEN SELECT d.tenant_id, true INTO tenant_id, locked FROM public.ap_credit_notes d WHERE d.id = _doc_id;
    WHEN 'supplier_return' THEN SELECT d.tenant_id, true INTO tenant_id, locked FROM public.supplier_returns d WHERE d.id = _doc_id;
    WHEN 'import_file' THEN SELECT d.tenant_id, d.status IN ('allocated', 'closed') INTO tenant_id, locked FROM public.import_files d WHERE d.id = _doc_id;
    WHEN 'supplier' THEN SELECT d.tenant_id, false INTO tenant_id, locked FROM public.suppliers d WHERE d.id = _doc_id;
    WHEN 'customer' THEN SELECT d.tenant_id, false INTO tenant_id, locked FROM public.customers d WHERE d.id = _doc_id;
    WHEN 'quotation' THEN SELECT d.tenant_id, d.status <> 'draft' INTO tenant_id, locked FROM public.quotations d WHERE d.id = _doc_id;
    WHEN 'sales_order' THEN SELECT d.tenant_id, d.status <> 'draft' INTO tenant_id, locked FROM public.sales_orders d WHERE d.id = _doc_id;
    WHEN 'delivery_note' THEN SELECT d.tenant_id, d.status = 'completed' INTO tenant_id, locked FROM public.delivery_notes d WHERE d.id = _doc_id;
    WHEN 'ar_invoice' THEN SELECT d.tenant_id, d.status <> 'draft' INTO tenant_id, locked FROM public.ar_invoices d WHERE d.id = _doc_id;
    WHEN 'ar_credit_note' THEN SELECT d.tenant_id, true INTO tenant_id, locked FROM public.ar_credit_notes d WHERE d.id = _doc_id;
    WHEN 'customer_return' THEN SELECT d.tenant_id, true INTO tenant_id, locked FROM public.customer_returns d WHERE d.id = _doc_id;
    WHEN 'payment' THEN SELECT d.tenant_id, true INTO tenant_id, locked FROM public.payments d WHERE d.id = _doc_id;
    WHEN 'bank_statement' THEN SELECT d.tenant_id, true INTO tenant_id, locked FROM public.bank_statements d WHERE d.id = _doc_id;
    WHEN 'journal_entry' THEN SELECT d.tenant_id, d.status <> 'draft' INTO tenant_id, locked FROM public.journal_entries d WHERE d.id = _doc_id;
    WHEN 'asset' THEN SELECT d.tenant_id, false INTO tenant_id, locked FROM public.assets d WHERE d.id = _doc_id;
    WHEN 'project' THEN SELECT d.tenant_id, false INTO tenant_id, locked FROM public.projects d WHERE d.id = _doc_id;
    ELSE RAISE EXCEPTION 'Type de pièce « % » sans pièces jointes', _doc_type USING ERRCODE = 'QG035';
  END CASE;
END $$;
REVOKE EXECUTE ON FUNCTION public.attachment_doc_info(text, uuid) FROM PUBLIC, anon, authenticated;

-- Pour le stockage du nuage : la pièce existe-t-elle dans la société de l'appelant ?
CREATE FUNCTION public.attachment_doc_in_my_tenant(_doc_type text, _doc_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t uuid; _l boolean;
BEGIN
  IF _doc_id !~ '^[0-9a-f-]{36}$' THEN RETURN false; END IF;
  SELECT i.tenant_id, i.locked INTO _t, _l FROM public.attachment_doc_info(_doc_type, _doc_id::uuid) i;
  RETURN _t IS NOT NULL AND _t = public.get_user_tenant_id(auth.uid());
EXCEPTION WHEN SQLSTATE 'QG035' THEN RETURN false;
END $$;
REVOKE EXECUTE ON FUNCTION public.attachment_doc_in_my_tenant(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attachment_doc_in_my_tenant(text, text) TO authenticated;

-- Catégories usuelles, créées au premier usage (modifiables, désactivables ; aucune exigence imposée).
CREATE FUNCTION public.ensure_attachment_categories()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t uuid := public.get_user_tenant_id(auth.uid()); _n integer;
BEGIN
  IF _t IS NULL OR EXISTS (SELECT 1 FROM public.attachment_categories WHERE tenant_id = _t) THEN RETURN 0; END IF;
  INSERT INTO public.attachment_categories (tenant_id, code, label, doc_types, sort_order) VALUES
    (_t, 'FACTURE', 'Facture du fournisseur', ARRAY['ap_invoice', 'ap_credit_note', 'import_file'], 10),
    (_t, 'OFFRE', 'Offre ou devis du fournisseur', ARRAY['purchase_requisition', 'purchase_order'], 20),
    (_t, 'CONNAISSEMENT', 'Connaissement / LTA', ARRAY['import_file', 'purchase_order', 'goods_receipt'], 30),
    (_t, 'DOUANE', 'Déclaration en douane', ARRAY['import_file'], 40),
    (_t, 'BON_LIVRAISON', 'Bon de livraison', ARRAY['goods_receipt', 'delivery_note', 'supplier_return', 'customer_return'], 50),
    (_t, 'CONTRAT', 'Contrat', ARRAY['supplier', 'customer', 'purchase_order', 'sales_order', 'project', 'asset'], 60),
    (_t, 'PREUVE_PAIEMENT', 'Preuve de paiement', ARRAY['payment', 'ap_invoice', 'ar_invoice', 'bank_statement'], 70),
    (_t, 'AUTRE', 'Autre document', NULL, 900);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE EXECUTE ON FUNCTION public.ensure_attachment_categories() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_attachment_categories() TO authenticated;

CREATE FUNCTION public.register_attachment(_doc_type text, _doc_id uuid, _storage_path text, _file_name text, _mime_type text, _size_bytes bigint,
                                           _sha256 text DEFAULT NULL, _category_id uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _t uuid := public.get_user_tenant_id(auth.uid());
  _doc_tenant uuid; _locked boolean;
  _s public.attachment_settings;
  _c public.attachment_categories%ROWTYPE;
  _id uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'documents.attach') THEN
    RAISE EXCEPTION 'Droit insuffisant : joindre des fichiers aux pièces' USING ERRCODE = '42501';
  END IF;
  SELECT i.tenant_id, i.locked INTO _doc_tenant, _locked FROM public.attachment_doc_info(_doc_type, _doc_id) i;
  IF _doc_tenant IS NULL OR _doc_tenant IS DISTINCT FROM _t THEN
    RAISE EXCEPTION 'Pièce introuvable dans la société active' USING ERRCODE = 'QG035';
  END IF;
  IF _storage_path IS NULL OR position(_t::text || '/' || _doc_type || '/' || _doc_id::text || '/' IN _storage_path) <> 1 OR _storage_path ~ '\.\.' THEN
    RAISE EXCEPTION 'Emplacement du fichier invalide' USING ERRCODE = 'QG035';
  END IF;
  _s := public.attachment_setting(_t);
  IF _size_bytes IS NULL OR _size_bytes <= 0 OR _size_bytes > _s.max_size_mb::bigint * 1024 * 1024 THEN
    RAISE EXCEPTION 'Fichier vide ou de plus de % Mo', _s.max_size_mb USING ERRCODE = 'QG035';
  END IF;
  IF NOT (lower(_mime_type) = ANY (_s.allowed_mime_types)) THEN
    RAISE EXCEPTION 'Type de fichier « % » non admis par la société (Paramètres → Pièces jointes)', _mime_type USING ERRCODE = 'QG035';
  END IF;
  IF _category_id IS NOT NULL THEN
    SELECT * INTO _c FROM public.attachment_categories WHERE id = _category_id AND tenant_id = _t AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Catégorie de pièce jointe inconnue ou inactive' USING ERRCODE = 'QG035'; END IF;
    IF _c.doc_types IS NOT NULL AND NOT (_doc_type = ANY (_c.doc_types)) THEN
      RAISE EXCEPTION 'La catégorie « % » ne s''applique pas à ce type de pièce', _c.label USING ERRCODE = 'QG035';
    END IF;
  ELSIF _s.require_category THEN
    RAISE EXCEPTION 'Choisissez la catégorie de la pièce jointe' USING ERRCODE = 'QG035';
  END IF;
  INSERT INTO public.document_attachments (tenant_id, doc_type, doc_id, category_id, file_name, mime_type, size_bytes, sha256, storage_path, note, uploaded_by)
  VALUES (_t, _doc_type, _doc_id, _category_id, left(btrim(_file_name), 200), lower(_mime_type), _size_bytes, lower(_sha256), _storage_path,
          NULLIF(btrim(COALESCE(_note, '')), ''), auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.register_attachment(text, uuid, text, text, text, bigint, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_attachment(text, uuid, text, text, text, bigint, text, uuid, text) TO authenticated;

CREATE FUNCTION public.delete_attachment(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _t uuid := public.get_user_tenant_id(auth.uid());
  _a public.document_attachments%ROWTYPE; _locked boolean; _admin boolean := public.has_permission(auth.uid(), 'documents.delete');
BEGIN
  SELECT * INTO _a FROM public.document_attachments WHERE id = _id AND tenant_id = _t AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pièce jointe introuvable dans la société active' USING ERRCODE = 'QG035'; END IF;
  IF btrim(COALESCE(_reason, '')) = '' THEN RAISE EXCEPTION 'Indiquez le motif de la suppression' USING ERRCODE = 'QG035'; END IF;
  SELECT i.locked INTO _locked FROM public.attachment_doc_info(_a.doc_type, _a.doc_id) i;
  IF NOT _admin THEN
    IF NOT (public.has_permission(auth.uid(), 'documents.attach') AND _a.uploaded_by = auth.uid()) THEN
      RAISE EXCEPTION 'Seul l''auteur du dépôt ou un titulaire du droit « supprimer une pièce jointe » la supprime' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(_locked, false) AND (public.attachment_setting(_t)).lock_after_validation THEN
      RAISE EXCEPTION 'La pièce est validée : ses pièces jointes sont archivées (droit « supprimer une pièce jointe » requis)' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE public.document_attachments SET deleted_at = now(), deleted_by = auth.uid(), delete_reason = btrim(_reason) WHERE id = _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.delete_attachment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_attachment(uuid, text) TO authenticated;

-- Exigence configurable : la soumission (ou le dédouanement) attend une pièce jointe de chaque catégorie exigée.
CREATE FUNCTION public.assert_required_attachments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _type text; _missing text;
BEGIN
  IF TG_TABLE_NAME = 'ap_invoices' THEN
    IF NOT (NEW.approval_status = 'submitted' AND OLD.approval_status IS DISTINCT FROM 'submitted') THEN RETURN NEW; END IF;
    _type := 'ap_invoice';
  ELSIF TG_TABLE_NAME = 'purchase_requisitions' THEN
    IF NOT (NEW.status = 'pending_approval' AND OLD.status IS DISTINCT FROM 'pending_approval') THEN RETURN NEW; END IF;
    _type := 'purchase_requisition';
  ELSIF TG_TABLE_NAME = 'purchase_orders' THEN
    IF NOT (NEW.status = 'pending_approval' AND OLD.status IS DISTINCT FROM 'pending_approval') THEN RETURN NEW; END IF;
    _type := 'purchase_order';
  ELSIF TG_TABLE_NAME = 'import_files' THEN
    IF NOT (NEW.status = 'cleared' AND OLD.status IS DISTINCT FROM 'cleared') THEN RETURN NEW; END IF;
    _type := 'import_file';
  ELSE
    RETURN NEW;
  END IF;
  SELECT string_agg(c.label, ', ' ORDER BY c.sort_order, c.label) INTO _missing
    FROM public.attachment_categories c
   WHERE c.tenant_id = NEW.tenant_id AND c.is_active AND _type = ANY (c.required_for)
     AND NOT EXISTS (SELECT 1 FROM public.document_attachments a
                      WHERE a.tenant_id = NEW.tenant_id AND a.doc_type = _type AND a.doc_id = NEW.id AND a.category_id = c.id AND a.deleted_at IS NULL);
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'Pièce jointe exigée avant cette étape : %', _missing USING ERRCODE = 'QG035';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.assert_required_attachments() FROM PUBLIC, anon;
CREATE TRIGGER trg_required_attachments BEFORE UPDATE OF approval_status ON public.ap_invoices
  FOR EACH ROW EXECUTE FUNCTION public.assert_required_attachments();
CREATE TRIGGER trg_required_attachments BEFORE UPDATE OF status ON public.purchase_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.assert_required_attachments();
CREATE TRIGGER trg_required_attachments BEFORE UPDATE OF status ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.assert_required_attachments();
CREATE TRIGGER trg_required_attachments BEFORE UPDATE OF status ON public.import_files
  FOR EACH ROW EXECUTE FUNCTION public.assert_required_attachments();

SELECT public.install_tenant_isolation_triggers();
