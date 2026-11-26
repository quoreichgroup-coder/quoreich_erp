-- V144 - Modèle par défaut partagé par société et type de document.
ALTER TABLE public.document_templates ADD COLUMN is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX document_templates_one_default_per_type ON public.document_templates (tenant_id,doc_type) WHERE is_default;

WITH latest AS (
  SELECT DISTINCT ON (t.tenant_id,t.doc_type) t.id
  FROM public.document_templates t JOIN public.document_template_versions v
    ON v.id=t.current_version_id AND v.template_id=t.id AND v.tenant_id=t.tenant_id
  WHERE v.published_at IS NOT NULL
  ORDER BY t.tenant_id,t.doc_type,v.published_at DESC,t.id
)
UPDATE public.document_templates t SET is_default=true FROM latest l WHERE l.id=t.id;

CREATE FUNCTION public.set_default_document_template(_template uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.document_actor_tenant(_actor,'reports.templates');
  _doc_type text;
  _template_row public.document_templates;
BEGIN
  SELECT t.doc_type INTO _doc_type FROM public.document_templates t WHERE t.id=_template AND t.tenant_id=_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Modèle introuvable' USING ERRCODE='QG038'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('qerp:document-default:'||_tenant::text||':'||_doc_type,0));
  SELECT t.* INTO _template_row FROM public.document_templates t
    JOIN public.document_template_versions v ON v.id=t.current_version_id AND v.template_id=t.id AND v.tenant_id=t.tenant_id
    WHERE t.id=_template AND t.tenant_id=_tenant AND v.published_at IS NOT NULL FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Le modèle doit avoir une version publiée' USING ERRCODE='QG038'; END IF;
  UPDATE public.document_templates t SET is_default=false WHERE t.tenant_id=_tenant AND t.doc_type=_doc_type AND t.is_default AND t.id<>_template;
  UPDATE public.document_templates t SET is_default=true WHERE t.id=_template AND t.tenant_id=_tenant RETURNING t.* INTO _template_row;
  RETURN to_jsonb(_template_row);
END $$;

CREATE OR REPLACE FUNCTION public.request_document_edition(_invoice uuid, _template uuid DEFAULT NULL,
  _replace uuid DEFAULT NULL, _reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.document_actor_tenant(_actor, 'ar.invoice');
  _inv public.ar_invoices;
  _edition public.issued_documents;
  _successor public.issued_documents;
  _version uuid;
  _reason_clean text := nullif(btrim(_reason), '');
  _reference text;
  _snapshot jsonb;
BEGIN
  -- La facture est le verrou commun, même si aucun travail n’a encore été créé.
  SELECT i.* INTO _inv FROM public.ar_invoices i WHERE i.tenant_id = _tenant AND i.id = _invoice FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facture client introuvable' USING ERRCODE = 'QG038'; END IF;

  SELECT d.* INTO _edition FROM public.issued_documents d
    WHERE d.tenant_id = _tenant AND d.ar_invoice_id = _inv.id AND NOT EXISTS (
      SELECT 1 FROM public.issued_documents n WHERE n.replaces_id = d.id AND n.tenant_id = _tenant);
  IF _replace IS NULL AND _edition.id IS NOT NULL THEN RETURN to_jsonb(_edition); END IF;
  IF _replace IS NOT NULL THEN
    IF _reason_clean IS NULL OR char_length(_reason_clean) > 500 THEN
      RAISE EXCEPTION 'Indiquez le motif du remplacement (500 caractères maximum)' USING ERRCODE = 'QG038';
    END IF;
    SELECT d.* INTO _successor FROM public.issued_documents d JOIN public.document_template_versions v ON v.id = d.template_version_id
      WHERE d.tenant_id = _tenant AND d.ar_invoice_id = _inv.id AND d.replaces_id = _replace
        AND d.replacement_reason = _reason_clean AND (_template IS NULL OR v.template_id = _template);
    IF FOUND THEN RETURN to_jsonb(_successor); END IF;
    IF _edition.id IS DISTINCT FROM _replace OR _edition.status IS DISTINCT FROM 'ready' THEN
      RAISE EXCEPTION 'Seule la dernière édition archivée de cette facture peut être remplacée' USING ERRCODE = 'QG038';
    END IF;
  END IF;

  IF _inv.status NOT IN ('sent', 'open', 'posted', 'partially_paid', 'partial', 'overdue', 'paid') THEN
    RAISE EXCEPTION 'Seule une facture client émise peut être archivée' USING ERRCODE = 'QG038';
  END IF;
  SELECT v.id INTO _version FROM public.document_templates t JOIN public.document_template_versions v
    ON v.id = t.current_version_id AND v.template_id = t.id AND v.tenant_id = t.tenant_id
    WHERE t.tenant_id = _tenant AND t.doc_type = 'ar_invoice' AND v.published_at IS NOT NULL
      AND (_template IS NULL OR t.id = _template)
    ORDER BY CASE WHEN _template IS NULL AND t.is_default THEN 0 ELSE 1 END, v.published_at DESC, t.id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aucun modèle de facture publié disponible' USING ERRCODE = 'QG038'; END IF;

  SELECT _inv.invoice_number || '/ED-' || (count(*) + 1) INTO _reference
    FROM public.issued_documents d WHERE d.ar_invoice_id = _inv.id AND d.tenant_id = _tenant;
  _snapshot := public.document_invoice_snapshot(_inv, _reference);
  IF _snapshot IS NULL OR _snapshot #>> '{document,total}' IS NULL THEN
    RAISE EXCEPTION 'Les données nécessaires à l’édition de la facture sont incomplètes' USING ERRCODE = 'QG038';
  END IF;
  INSERT INTO public.issued_documents (tenant_id, ar_invoice_id, template_version_id, context, context_sha256,
    reference, created_by, replaces_id, replacement_reason)
  VALUES (_tenant, _inv.id, _version, _snapshot, public.document_hash(_snapshot::text), _reference, _actor, _replace,
    CASE WHEN _replace IS NOT NULL THEN _reason_clean END) RETURNING * INTO _edition;
  RETURN to_jsonb(_edition);
END $$;

CREATE OR REPLACE FUNCTION public.request_purchase_order_edition(_po uuid, _template uuid DEFAULT NULL,
  _replace uuid DEFAULT NULL, _reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.document_actor_tenant(_actor, 'procurement.order');
  _order public.purchase_orders;
  _edition public.issued_documents;
  _successor public.issued_documents;
  _version uuid;
  _reason_clean text := nullif(btrim(_reason), '');
  _reference text;
  _snapshot jsonb;
BEGIN
  -- La facture est le verrou commun, même si aucun travail n’a encore été créé.
  SELECT i.* INTO _order FROM public.purchase_orders i WHERE i.tenant_id = _tenant AND i.id = _po FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bon de commande introuvable' USING ERRCODE = 'QG038'; END IF;

  SELECT d.* INTO _edition FROM public.issued_documents d
    WHERE d.tenant_id = _tenant AND d.po_id = _order.id AND NOT EXISTS (
      SELECT 1 FROM public.issued_documents n WHERE n.replaces_id = d.id AND n.tenant_id = _tenant);
  IF _replace IS NULL AND _edition.id IS NOT NULL THEN RETURN to_jsonb(_edition); END IF;
  IF _replace IS NOT NULL THEN
    IF _reason_clean IS NULL OR char_length(_reason_clean) > 500 THEN
      RAISE EXCEPTION 'Indiquez le motif du remplacement (500 caractères maximum)' USING ERRCODE = 'QG038';
    END IF;
    SELECT d.* INTO _successor FROM public.issued_documents d JOIN public.document_template_versions v ON v.id = d.template_version_id
      WHERE d.tenant_id = _tenant AND d.po_id = _order.id AND d.replaces_id = _replace
        AND d.replacement_reason = _reason_clean AND (_template IS NULL OR v.template_id = _template);
    IF FOUND THEN RETURN to_jsonb(_successor); END IF;
    IF _edition.id IS DISTINCT FROM _replace OR _edition.status IS DISTINCT FROM 'ready' THEN
      RAISE EXCEPTION 'Seule la dernière édition archivée de ce bon de commande peut être remplacée' USING ERRCODE = 'QG038';
    END IF;
  END IF;

  IF _order.status NOT IN ('approved','ordered','partially_received','received','closed') THEN
    RAISE EXCEPTION 'Seule une commande approuvee peut être archivée' USING ERRCODE = 'QG038';
  END IF;
  SELECT v.id INTO _version FROM public.document_templates t JOIN public.document_template_versions v
    ON v.id = t.current_version_id AND v.template_id = t.id AND v.tenant_id = t.tenant_id
    WHERE t.tenant_id = _tenant AND t.doc_type = 'purchase_order' AND v.published_at IS NOT NULL
      AND (_template IS NULL OR t.id = _template)
    ORDER BY CASE WHEN _template IS NULL AND t.is_default THEN 0 ELSE 1 END, v.published_at DESC, t.id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aucun modele de bon de commande publié disponible' USING ERRCODE = 'QG038'; END IF;

  SELECT _order.po_number || '/ED-' || (count(*) + 1) INTO _reference
    FROM public.issued_documents d WHERE d.po_id = _order.id AND d.tenant_id = _tenant;
  _snapshot := public.document_purchase_order_snapshot(_order, _reference);
  IF _snapshot IS NULL OR _snapshot #>> '{document,total}' IS NULL OR jsonb_array_length(_snapshot->'lines')=0 THEN
    RAISE EXCEPTION 'Les données nécessaires à l’édition du bon de commande sont incomplètes' USING ERRCODE = 'QG038';
  END IF;
  INSERT INTO public.issued_documents (tenant_id, po_id, template_version_id, context, context_sha256,
    reference, created_by, replaces_id, replacement_reason)
  VALUES (_tenant, _order.id, _version, _snapshot, public.document_hash(_snapshot::text), _reference, _actor, _replace,
    CASE WHEN _replace IS NOT NULL THEN _reason_clean END) RETURNING * INTO _edition;
  RETURN to_jsonb(_edition);
END $$;
REVOKE ALL ON FUNCTION public.set_default_document_template(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_default_document_template(uuid) TO authenticated;
