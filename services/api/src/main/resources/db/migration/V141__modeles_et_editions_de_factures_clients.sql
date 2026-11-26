-- V141 — Modèles versionnés et archives immuables des factures clients (lot 6 D1).

CREATE TABLE public.document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  doc_type text NOT NULL DEFAULT 'ar_invoice' CHECK (doc_type = 'ar_invoice'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX document_templates_tenant ON public.document_templates (tenant_id);

CREATE TABLE public.document_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  template_id uuid NOT NULL CONSTRAINT document_template_versions_template_id_fkey REFERENCES public.document_templates (id),
  version_no integer NOT NULL CHECK (version_no > 0),
  layout jsonb NOT NULL,
  content_html text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  reason text,
  published_at timestamptz,
  published_by uuid,
  UNIQUE (template_id, version_no),
  CHECK ((published_at IS NULL) = (published_by IS NULL))
);
ALTER TABLE public.document_templates ADD CONSTRAINT document_templates_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES public.document_template_versions (id);

CREATE TABLE public.issued_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  ar_invoice_id uuid NOT NULL REFERENCES public.ar_invoices (id),
  template_version_id uuid NOT NULL REFERENCES public.document_template_versions (id),
  context jsonb NOT NULL,
  context_sha256 text NOT NULL CHECK (context_sha256 ~ '^[0-9a-f]{64}$'),
  reference text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
  storage_path text UNIQUE,
  pdf_sha256 text CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  renderer text,
  renderer_version text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  replaces_id uuid UNIQUE REFERENCES public.issued_documents (id),
  replacement_reason text,
  UNIQUE (tenant_id, reference),
  CHECK ((replacement_reason IS NULL) = (replaces_id IS NULL)),
  CHECK (storage_path IS NULL OR storage_path = tenant_id::text || '/issued/' || id::text || '.pdf'),
  CHECK ((status = 'queued') = (started_at IS NULL)),
  CHECK ((status IN ('ready', 'failed')) = (finished_at IS NOT NULL)),
  CHECK ((status = 'failed') = (error IS NOT NULL)),
  CHECK (CASE WHEN status = 'ready'
    THEN storage_path IS NOT NULL AND pdf_sha256 IS NOT NULL AND renderer IS NOT NULL AND renderer_version IS NOT NULL
    ELSE storage_path IS NULL AND pdf_sha256 IS NULL AND renderer IS NULL AND renderer_version IS NULL END)
);
CREATE UNIQUE INDEX issued_documents_first_edition ON public.issued_documents (ar_invoice_id) WHERE replaces_id IS NULL;
CREATE INDEX issued_documents_invoice ON public.issued_documents (ar_invoice_id, created_at DESC);

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issued_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.document_templates FOR SELECT TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_permission(auth.uid(), 'reports.templates')
    OR (current_version_id IS NOT NULL AND public.has_permission(auth.uid(), 'ar.invoice'))));
CREATE POLICY "Lecture société" ON public.document_template_versions FOR SELECT TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_permission(auth.uid(), 'reports.templates')
    OR (published_at IS NOT NULL AND public.has_permission(auth.uid(), 'ar.invoice'))));
CREATE POLICY "Lecture société" ON public.issued_documents FOR SELECT TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.invoice'));

-- Supabase et Flyway peuvent appliquer des privilèges par défaut différents.
REVOKE ALL ON public.document_templates, public.document_template_versions, public.issued_documents
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.document_templates, public.document_template_versions, public.issued_documents TO authenticated;

CREATE FUNCTION public.guard_document_template_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'Une version publiée est immuable' USING ERRCODE = 'QG038';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_document_template_version BEFORE UPDATE OR DELETE ON public.document_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_template_version();

CREATE FUNCTION public.guard_issued_document() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.status = 'ready' THEN
    RAISE EXCEPTION 'Une édition archivée est immuable' USING ERRCODE = 'QG038';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.ar_invoice_id, NEW.template_version_id, NEW.context, NEW.context_sha256,
         NEW.reference, NEW.created_by, NEW.created_at, NEW.replaces_id, NEW.replacement_reason)
    IS DISTINCT FROM ROW(OLD.id, OLD.tenant_id, OLD.ar_invoice_id, OLD.template_version_id, OLD.context, OLD.context_sha256,
         OLD.reference, OLD.created_by, OLD.created_at, OLD.replaces_id, OLD.replacement_reason) THEN
    RAISE EXCEPTION 'L’instantané d’une édition est immuable' USING ERRCODE = 'QG038';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_issued_document BEFORE UPDATE OR DELETE ON public.issued_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_issued_document();

CREATE FUNCTION public.document_hash(_value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
  SELECT encode(sha256(convert_to(_value, 'UTF8')), 'hex')
$$;

CREATE FUNCTION public.document_html_escape(_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT replace(replace(replace(replace(replace(coalesce(_value, ''), '&', '&amp;'), '<', '&lt;'),
    '>', '&gt;'), '"', '&quot;'), chr(39), '&#39;')
$$;

-- Sans instantané, le texte du modèle est échappé et ses marqueurs vérifiés. Au rendu, le HTML
-- conservé est parcouru une fois : une valeur de l’instantané ne devient jamais un nouveau marqueur.
CREATE FUNCTION public.document_template_interpolate(_text text, _context jsonb, _rows text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  _fields CONSTANT text[] := ARRAY[
    'company.name', 'company.legal_name', 'company.address', 'company.phone', 'company.email', 'company.rccm',
    'company.tax_id', 'company.tax_regime', 'company.tax_office', 'company.bank_details',
    'customer.name', 'customer.address', 'customer.phone', 'customer.email', 'customer.tax_id',
    'document.number', 'document.invoice_date', 'document.due_date', 'document.currency', 'document.subtotal',
    'document.tax_amount', 'document.total', 'document.reference'];
  _rest text := coalesce(_text, '');
  _part text[];
  _marker text;
  _pos integer;
  _before text;
  _result text := '';
BEGIN
  FOR _part IN SELECT regexp_matches(_rest, '[{][{]([^{}]*)[}][}]', 'g') LOOP
    _marker := '{{' || _part[1] || '}}';
    _pos := strpos(_rest, _marker);
    _before := left(_rest, _pos - 1);
    IF strpos(_before, '{{') > 0 OR strpos(_before, '}}') > 0 THEN
      RAISE EXCEPTION 'Marqueur de document incomplet' USING ERRCODE = 'QG038';
    END IF;
    IF _context IS NOT NULL AND _part[1] = 'rows' THEN
      _result := _result || _before || coalesce(_rows, '');
    ELSIF _part[1] = ANY(_fields) THEN
      _result := _result || CASE WHEN _context IS NULL THEN public.document_html_escape(_before) || _marker
        ELSE _before || public.document_html_escape(_context #>> string_to_array(_part[1], '.')) END;
    ELSE
      RAISE EXCEPTION 'Champ de modèle non autorisé : %', left(_part[1], 80) USING ERRCODE = 'QG038';
    END IF;
    _rest := substr(_rest, _pos + char_length(_marker));
  END LOOP;
  IF strpos(_rest, '{{') > 0 OR strpos(_rest, '}}') > 0 THEN
    RAISE EXCEPTION 'Marqueur de document incomplet' USING ERRCODE = 'QG038';
  END IF;
  RETURN _result || CASE WHEN _context IS NULL THEN public.document_html_escape(_rest) ELSE _rest END;
END $$;

CREATE FUNCTION public.document_template_html(_layout jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT format($html$<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Facture {{document.number}}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
@page { size: A4; margin: 18mm 16mm; }
body { color: #17202a; font: %spt Montserrat, sans-serif; overflow-wrap: anywhere; }
h1, h2 { color: %s; font-family: 'Playfair Display', serif; }
h1 { margin: 0 0 6pt; font-size: 25pt; }
h2 { margin: 0 0 5pt; font-size: 15pt; }
.identity { display: grid; grid-template-columns: 1fr 1fr; gap: 18pt; margin: 17pt 0; }
.text { white-space: pre-line; }
.dates { margin: 12pt 0; }
table { width: 100%%; border-collapse: collapse; margin: 14pt 0; }
thead { background: #eef1f4; }
tr { break-inside: avoid; }
th, td { border-bottom: 1px solid #cdd4db; padding: 6pt 4pt; text-align: right; vertical-align: top; }
th:first-child, td:first-child { text-align: left; }
.totals { padding-top: 5pt; text-align: right; break-inside: avoid; }
.totals div { margin: 5pt 0; }
footer { margin-top: 20pt; padding-top: 9pt; border-top: 1px solid #cdd4db; }
</style></head>
<body>
  <h1>%s</h1>
  <div>Facture {{document.number}} · Édition {{document.reference}}</div>
  <div class="identity">
    <section><h2>{{company.name}}</h2><div>{{company.legal_name}}</div>
      <div class="text">{{company.address}}</div><div>{{company.email}}</div><div>{{company.phone}}</div>
      <div>RCCM · {{company.rccm}}</div><div>Identifiant fiscal · {{company.tax_id}}</div>
      <div>{{company.tax_regime}}</div><div>{{company.tax_office}}</div><div class="text">{{company.bank_details}}</div></section>
    <section><h2>Client</h2><div>{{customer.name}}</div><div class="text">{{customer.address}}</div>
      <div>{{customer.email}}</div><div>{{customer.phone}}</div><div>Identifiant fiscal · {{customer.tax_id}}</div></section>
  </div>
  <div class="dates">Émise le {{document.invoice_date}} · Échéance {{document.due_date}}</div>
  <div class="text">%s</div>
  <table><thead><tr><th>Désignation</th><th>Qté</th><th>Prix unitaire</th><th>Remise</th><th>Montant HT</th><th>TVA</th></tr></thead>
    <tbody>{{rows}}</tbody></table>
  <div class="totals"><div>HT · {{document.subtotal}} {{document.currency}}</div>
    <div>TVA · {{document.tax_amount}} {{document.currency}}</div>
    <div><strong>Total TTC · {{document.total}} {{document.currency}}</strong></div></div>
  <footer class="text">%s</footer>
</body></html>$html$, _layout->>'font_size', _layout->>'accent_color',
    public.document_template_interpolate(_layout->>'title', NULL), public.document_template_interpolate(_layout->>'intro', NULL),
    public.document_template_interpolate(_layout->>'footer', NULL))
$$;

CREATE FUNCTION public.document_actor_tenant(_actor uuid, _permission text) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(_actor);
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(_actor, _permission) THEN
    RAISE EXCEPTION 'Droit insuffisant : %', _permission USING ERRCODE = '42501';
  END IF;
  RETURN _tenant;
END $$;

CREATE FUNCTION public.save_document_template(_id uuid, _name text, _layout jsonb, _reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.document_actor_tenant(_actor, 'reports.templates');
  _name_clean text := btrim(_name);
  _reason_clean text := nullif(btrim(_reason), '');
  _template public.document_templates;
  _version public.document_template_versions;
  _field text;
  _clean jsonb;
  _font numeric;
  _html text;
BEGIN
  IF _name_clean IS NULL OR char_length(_name_clean) NOT BETWEEN 1 AND 120 OR _reason_clean IS NULL OR char_length(_reason_clean) > 500 THEN
    RAISE EXCEPTION 'Le nom ou le motif du modèle dépasse la longueur autorisée' USING ERRCODE = 'QG038';
  END IF;
  IF jsonb_typeof(_layout) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'La présentation du modèle doit être un objet' USING ERRCODE = 'QG038';
  END IF;
  FOR _field IN SELECT jsonb_object_keys(_layout) LOOP
    IF _field = 'font_size' THEN
      IF jsonb_typeof(_layout->_field) <> 'number' THEN
        RAISE EXCEPTION 'La taille du texte doit être numérique' USING ERRCODE = 'QG038';
      END IF;
    ELSIF _field NOT IN ('title', 'intro', 'footer', 'accent_color') OR jsonb_typeof(_layout->_field) <> 'string' THEN
      RAISE EXCEPTION 'Composant de présentation non autorisé : %', left(_field, 80) USING ERRCODE = 'QG038';
    END IF;
  END LOOP;
  _font := coalesce((_layout->>'font_size')::numeric, 10);
  IF _font NOT BETWEEN 8 AND 14 OR trunc(_font) <> _font OR (_layout->>'accent_color') !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Utilisez une couleur #RRGGBB et une taille entière de 8 à 14' USING ERRCODE = 'QG038';
  END IF;
  IF char_length(_layout->>'title') > 160 OR char_length(_layout->>'intro') > 2000 OR char_length(_layout->>'footer') > 2000 THEN
    RAISE EXCEPTION 'Le titre est limité à 160 caractères et l’introduction et le pied à 2 000 caractères'
      USING ERRCODE = 'QG038';
  END IF;
  _clean := jsonb_build_object('title', coalesce(_layout->>'title', 'Facture'), 'intro', coalesce(_layout->>'intro', ''),
    'footer', coalesce(_layout->>'footer', ''), 'accent_color', coalesce(_layout->>'accent_color', '#17324D'),
    'font_size', _font::integer);
  _html := public.document_template_html(_clean);

  IF _id IS NULL THEN
    INSERT INTO public.document_templates (tenant_id, name, created_by) VALUES (_tenant, _name_clean, _actor)
      RETURNING * INTO _template;
  ELSE
    UPDATE public.document_templates t SET name = _name_clean WHERE t.id = _id AND t.tenant_id = _tenant
      RETURNING * INTO _template;
    IF NOT FOUND THEN RAISE EXCEPTION 'Modèle introuvable' USING ERRCODE = 'QG038'; END IF;
  END IF;
  INSERT INTO public.document_template_versions (tenant_id, template_id, version_no, layout, content_html, sha256, created_by, reason)
  SELECT _tenant, _template.id, coalesce(max(v.version_no), 0) + 1, _clean, _html, public.document_hash(_html), _actor, _reason_clean
    FROM public.document_template_versions v WHERE v.template_id = _template.id AND v.tenant_id = _tenant
  RETURNING * INTO _version;
  RETURN jsonb_build_object('template', to_jsonb(_template), 'version', to_jsonb(_version));
END $$;

CREATE FUNCTION public.publish_document_template(_version uuid, _reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.document_actor_tenant(_actor, 'reports.templates');
  _reason_clean text := nullif(btrim(_reason), '');
  _template_id uuid;
  _published public.document_template_versions;
BEGIN
  IF _reason_clean IS NULL OR char_length(_reason_clean) > 500 THEN
    RAISE EXCEPTION 'Le motif de publication est limité à 500 caractères' USING ERRCODE = 'QG038';
  END IF;
  SELECT t.id INTO _template_id FROM public.document_templates t JOIN public.document_template_versions v ON v.template_id = t.id
    WHERE v.id = _version AND v.tenant_id = _tenant AND t.tenant_id = _tenant FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version de modèle introuvable' USING ERRCODE = 'QG038'; END IF;

  UPDATE public.document_template_versions v SET published_at = clock_timestamp(), published_by = _actor,
    reason = nullif(concat_ws(E'\n', v.reason, CASE WHEN v.reason IS DISTINCT FROM _reason_clean THEN _reason_clean END), '')
    WHERE v.id = _version AND v.tenant_id = _tenant AND v.published_at IS NULL RETURNING * INTO _published;
  IF FOUND THEN
    UPDATE public.document_templates t SET current_version_id = _version WHERE t.id = _template_id AND t.tenant_id = _tenant;
  ELSE
    SELECT v.* INTO STRICT _published FROM public.document_template_versions v WHERE v.id = _version AND v.tenant_id = _tenant;
  END IF;
  RETURN to_jsonb(_published);
END $$;

CREATE FUNCTION public.document_invoice_snapshot(_invoice public.ar_invoices, _reference text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object(
    'company', jsonb_build_object('name', t.name, 'legal_name', t.legal_name, 'address', t.address, 'phone', t.phone,
      'email', t.email, 'rccm', t.rccm, 'tax_id', t.tax_id, 'tax_regime', t.tax_regime, 'tax_office', t.tax_office, 'bank_details', t.bank_details),
    'customer', jsonb_build_object('name', c.name, 'address', c.address, 'phone', c.phone, 'email', c.email, 'tax_id', c.tax_id),
    'document', jsonb_build_object('number', _invoice.invoice_number, 'invoice_date', to_char(_invoice.invoice_date, 'YYYY-MM-DD'),
      'due_date', to_char(_invoice.due_date, 'YYYY-MM-DD'), 'currency', coalesce(_invoice.currency, t.currency),
      'exchange_rate', _invoice.exchange_rate, 'reference', _reference,
      'subtotal', CASE WHEN _invoice.currency IS NULL THEN _invoice.subtotal ELSE _invoice.fx_subtotal END,
      'tax_amount', CASE WHEN _invoice.currency IS NULL THEN _invoice.tax_amount ELSE _invoice.fx_tax_amount END,
      'total', CASE WHEN _invoice.currency IS NULL THEN _invoice.total ELSE _invoice.fx_total END),
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('line_no', l.line_no, 'description', l.description,
        'quantity', l.quantity, 'discount_pct', l.discount_pct, 'tax_code', x.code, 'tax_rate', x.rate,
        'unit_price', CASE WHEN _invoice.currency IS NULL THEN l.unit_price ELSE l.fx_unit_price END,
        'net_amount', CASE WHEN _invoice.currency IS NULL THEN l.net_amount ELSE l.fx_net_amount END,
        'tax_amount', CASE WHEN _invoice.currency IS NULL THEN l.tax_amount ELSE l.fx_tax_amount END) ORDER BY l.line_no)
      FROM public.ar_invoice_lines l LEFT JOIN public.tax_codes x ON x.id = l.tax_code_id AND x.tenant_id = l.tenant_id
      WHERE l.invoice_id = _invoice.id AND l.tenant_id = _invoice.tenant_id), '[]'::jsonb))
  FROM public.tenants t JOIN public.customers c ON c.tenant_id = t.id AND c.id = _invoice.customer_id
  WHERE t.id = _invoice.tenant_id
$$;

CREATE FUNCTION public.request_document_edition(_invoice uuid, _template uuid DEFAULT NULL,
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
    ORDER BY v.published_at DESC, t.id LIMIT 1;
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

CREATE FUNCTION public.retry_document_edition(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  _tenant uuid := public.document_actor_tenant(auth.uid(), 'ar.invoice');
  _job public.issued_documents;
  _expires_before timestamptz := clock_timestamp() - interval '60 seconds';
BEGIN
  SELECT d.* INTO _job FROM public.issued_documents d WHERE d.id = _id AND d.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Édition introuvable' USING ERRCODE = 'QG038'; END IF;
  -- Si l’envoi au travailleur a été interrompu avant claim, l’édition attend toujours dans la file.
  IF _job.status = 'queued' AND _job.created_at < _expires_before THEN RETURN to_jsonb(_job); END IF;
  IF _job.status <> 'failed' AND NOT (_job.status = 'rendering' AND _job.started_at < _expires_before) THEN
    RAISE EXCEPTION 'Seule une édition en échec ou expirée peut être relancée' USING ERRCODE = 'QG038';
  END IF;
  UPDATE public.issued_documents d SET status = 'queued', started_at = NULL, finished_at = NULL, error = NULL
    WHERE d.id = _job.id RETURNING d.* INTO _job;
  RETURN to_jsonb(_job);
END $$;

-- Les RPC réservées au service ont en commun le verrou sur le travail et le contrôle de son acteur.
CREATE FUNCTION public.document_worker_job(_id uuid, _actor uuid) RETURNS public.issued_documents
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  _tenant uuid := public.document_actor_tenant(_actor, 'ar.invoice');
  _authenticated_actor uuid := auth.uid();
  _job public.issued_documents;
BEGIN
  IF (session_user = 'qerp_api' OR _authenticated_actor IS NOT NULL) AND _authenticated_actor IS DISTINCT FROM _actor THEN
    RAISE EXCEPTION 'Acteur du rendu non autorisé' USING ERRCODE = '42501';
  END IF;
  SELECT d.* INTO _job FROM public.issued_documents d WHERE d.id = _id AND d.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur du rendu non autorisé' USING ERRCODE = '42501'; END IF;
  RETURN _job;
END $$;

CREATE FUNCTION public.document_render_snapshot(_template_html text, _context jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT public.document_template_interpolate(_template_html, _context, coalesce(string_agg(format(
    '<tr><td>%s</td><td>%s</td><td>%s</td><td>%s %%</td><td>%s</td><td>%s%s</td></tr>',
    public.document_html_escape(r.line->>'description'), public.document_html_escape(r.line->>'quantity'),
    public.document_html_escape(r.line->>'unit_price'), public.document_html_escape(r.line->>'discount_pct'),
    public.document_html_escape(r.line->>'net_amount'), public.document_html_escape(r.line->>'tax_amount'),
    CASE WHEN r.line->>'tax_rate' IS NOT NULL THEN ' (' || public.document_html_escape(r.line->>'tax_rate') || ' %)' END
  ), '' ORDER BY r.seq), '<tr><td colspan="6">Facture sans lignes détaillées</td></tr>'))
  FROM jsonb_array_elements(_context->'lines') WITH ORDINALITY AS r(line, seq)
$$;

CREATE FUNCTION public.claim_document_edition(_id uuid, _actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  _job public.issued_documents := public.document_worker_job(_id, _actor);
  _version public.document_template_versions;
  _html text;
BEGIN
  IF _job.status <> 'queued' THEN RETURN NULL; END IF;
  SELECT v.* INTO STRICT _version FROM public.document_template_versions v
    WHERE v.id = _job.template_version_id AND v.tenant_id = _job.tenant_id AND v.published_at IS NOT NULL;
  IF public.document_hash(_job.context::text) <> _job.context_sha256 OR public.document_hash(_version.content_html) <> _version.sha256 THEN
    RAISE EXCEPTION 'L’empreinte des données d’édition a changé' USING ERRCODE = 'QG038';
  END IF;
  _html := public.document_render_snapshot(_version.content_html, _job.context);
  UPDATE public.issued_documents d SET status = 'rendering', started_at = clock_timestamp()
    WHERE d.id = _job.id RETURNING d.* INTO _job;
  RETURN to_jsonb(_job) || jsonb_build_object('html', _html, 'storage_path', _job.tenant_id || '/issued/' || _job.id || '.pdf');
END $$;

CREATE FUNCTION public.complete_document_edition(_id uuid, _actor uuid, _path text, _sha256 text, _renderer text, _renderer_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  _job public.issued_documents := public.document_worker_job(_id, _actor);
  _canonical text := _job.tenant_id || '/issued/' || _job.id || '.pdf';
  _hash text := lower(_sha256);
BEGIN
  IF _path IS DISTINCT FROM _canonical OR _hash IS NULL OR _hash !~ '^[0-9a-f]{64}$'
    OR _renderer IS NULL OR char_length(btrim(_renderer)) NOT BETWEEN 1 AND 80
    OR _renderer_version IS NULL OR char_length(btrim(_renderer_version)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Métadonnées de l’archive PDF invalides' USING ERRCODE = 'QG038';
  END IF;
  IF _job.status = 'ready' AND _job.pdf_sha256 = _hash THEN RETURN to_jsonb(_job); END IF;
  IF _job.status <> 'rendering' OR _job.started_at < clock_timestamp() - interval '60 seconds' THEN
    RAISE EXCEPTION 'Le travail de rendu n’est plus en cours' USING ERRCODE = 'QG038';
  END IF;
  UPDATE public.issued_documents d SET status = 'ready', storage_path = _canonical, pdf_sha256 = _hash,
    renderer = btrim(_renderer), renderer_version = btrim(_renderer_version), finished_at = clock_timestamp()
    WHERE d.id = _job.id RETURNING d.* INTO _job;
  RETURN to_jsonb(_job);
END $$;

CREATE FUNCTION public.fail_document_edition(_id uuid, _actor uuid, _error text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE _job public.issued_documents := public.document_worker_job(_id, _actor);
BEGIN
  IF _job.status <> 'rendering' OR _job.started_at < clock_timestamp() - interval '60 seconds' THEN
    RAISE EXCEPTION 'Le travail de rendu n’est plus en cours' USING ERRCODE = 'QG038';
  END IF;
  UPDATE public.issued_documents d SET status = 'failed', finished_at = clock_timestamp(),
    error = left(coalesce(nullif(btrim(_error), ''), 'Le rendu a échoué.'), 500)
    WHERE d.id = _job.id RETURNING d.* INTO _job;
  RETURN to_jsonb(_job);
END $$;

REVOKE ALL ON FUNCTION public.guard_document_template_version(), public.guard_issued_document(),
  public.document_hash(text), public.document_html_escape(text), public.document_template_interpolate(text, jsonb, text),
  public.document_template_html(jsonb), public.document_actor_tenant(uuid, text), public.document_invoice_snapshot(public.ar_invoices, text),
  public.document_worker_job(uuid, uuid), public.document_render_snapshot(text, jsonb),
  public.save_document_template(uuid, text, jsonb, text), public.publish_document_template(uuid, text),
  public.request_document_edition(uuid, uuid, uuid, text), public.retry_document_edition(uuid),
  public.claim_document_edition(uuid, uuid), public.complete_document_edition(uuid, uuid, text, text, text, text),
  public.fail_document_edition(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.save_document_template(uuid, text, jsonb, text), public.publish_document_template(uuid, text),
  public.request_document_edition(uuid, uuid, uuid, text), public.retry_document_edition(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_document_edition(uuid, uuid), public.complete_document_edition(uuid, uuid, text, text, text, text),
  public.fail_document_edition(uuid, uuid, text) TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'qerp_api') THEN
    GRANT EXECUTE ON FUNCTION public.claim_document_edition(uuid, uuid), public.complete_document_edition(uuid, uuid, text, text, text, text),
      public.fail_document_edition(uuid, uuid, text) TO qerp_api;
  END IF;
END $$;

SELECT public.install_tenant_isolation_triggers();
