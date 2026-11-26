-- V143 - Modeles versionnes et archives de bons de commande, en conservant le contrat AR V141.
ALTER TABLE public.document_templates DROP CONSTRAINT document_templates_doc_type_check;
ALTER TABLE public.document_templates ADD CONSTRAINT document_templates_doc_type_check CHECK (doc_type IN ('ar_invoice','purchase_order'));
ALTER TABLE public.document_templates ADD COLUMN preset_key text CHECK (preset_key IS NULL OR (doc_type='purchase_order' AND preset_key IN ('standard','reference-PO0004821')));
CREATE UNIQUE INDEX document_templates_po_default ON public.document_templates (tenant_id,preset_key) WHERE preset_key IS NOT NULL;
ALTER TABLE public.issued_documents ALTER COLUMN ar_invoice_id DROP NOT NULL;
ALTER TABLE public.issued_documents ADD COLUMN po_id uuid REFERENCES public.purchase_orders(id);
ALTER TABLE public.issued_documents ADD CONSTRAINT issued_documents_one_source CHECK (num_nonnulls(ar_invoice_id,po_id)=1);
CREATE UNIQUE INDEX issued_documents_first_po_edition ON public.issued_documents(po_id) WHERE replaces_id IS NULL;
CREATE INDEX issued_documents_po ON public.issued_documents(po_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.guard_issued_document() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.status='ready' THEN RAISE EXCEPTION 'Une edition archivee est immuable' USING ERRCODE='QG038'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF ROW(NEW.id,NEW.tenant_id,NEW.ar_invoice_id,NEW.po_id,NEW.template_version_id,NEW.context,NEW.context_sha256,NEW.reference,NEW.created_by,NEW.created_at,NEW.replaces_id,NEW.replacement_reason)
    IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.ar_invoice_id,OLD.po_id,OLD.template_version_id,OLD.context,OLD.context_sha256,OLD.reference,OLD.created_by,OLD.created_at,OLD.replaces_id,OLD.replacement_reason) THEN
    RAISE EXCEPTION 'L''instantane d''une edition est immuable' USING ERRCODE='QG038';
  END IF;
  RETURN NEW;
END $$;

DROP POLICY "Lecture société" ON public.document_templates;
CREATE POLICY "Lecture société" ON public.document_templates FOR SELECT TO authenticated USING (
 tenant_id=public.get_user_tenant_id(auth.uid()) AND (public.has_permission(auth.uid(),'reports.templates') OR
 (current_version_id IS NOT NULL AND public.has_permission(auth.uid(),CASE WHEN doc_type='purchase_order' THEN 'procurement.order' ELSE 'ar.invoice' END))));
DROP POLICY "Lecture société" ON public.document_template_versions;
CREATE POLICY "Lecture société" ON public.document_template_versions FOR SELECT TO authenticated USING (
 tenant_id=public.get_user_tenant_id(auth.uid()) AND (public.has_permission(auth.uid(),'reports.templates') OR
 (published_at IS NOT NULL AND EXISTS (SELECT 1 FROM public.document_templates t WHERE t.id=template_id AND t.tenant_id=document_template_versions.tenant_id
 AND public.has_permission(auth.uid(),CASE WHEN t.doc_type='purchase_order' THEN 'procurement.order' ELSE 'ar.invoice' END)))));
DROP POLICY "Lecture société" ON public.issued_documents;
CREATE POLICY "Lecture société" ON public.issued_documents FOR SELECT TO authenticated USING (
 tenant_id=public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(),CASE WHEN po_id IS NOT NULL THEN 'procurement.order' ELSE 'ar.invoice' END));


CREATE OR REPLACE FUNCTION public.document_template_interpolate(_text text, _context jsonb, _rows text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  _fields CONSTANT text[] := ARRAY[
    'company.name', 'company.legal_name', 'company.address', 'company.phone', 'company.email', 'company.rccm',
    'company.tax_id', 'company.tax_regime', 'company.tax_office', 'company.bank_details',
    'customer.name', 'customer.address', 'customer.phone', 'customer.email', 'customer.tax_id',
    'document.number', 'document.invoice_date', 'document.due_date', 'document.currency', 'document.subtotal',
    'document.tax_amount', 'document.total', 'document.reference',
    'supplier.name','supplier.code','supplier.address','supplier.phone','supplier.email','supplier.tax_id','supplier.contact',
    'document.order_date','document.expected_date','document.incoterm','document.payment_terms','document.description',
    'document.shipping_method','document.delivery_address','document.buyer_name','document.buyer_phone','document.buyer_email',
    'document.invoice_email','document.notes','document.footer'];
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

CREATE FUNCTION public.document_po_template_html(_layout jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE _html text;
BEGIN
  IF coalesce(_layout->>'preset','standard')='reference-PO0004821' THEN
    _html := $po_landscape$<!doctype html>
<html lang="fr" data-po-preset="reference-PO0004821">
<head>
  <meta charset="utf-8">
  <title>Bon de commande {{document.number}}</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <style>
    @page { size: A4 landscape; margin: 10mm 9mm; @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 7pt Arial, sans-serif; } }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111; font: 8pt Arial, sans-serif; overflow-wrap: anywhere; }
    .sample { font-size: 6.5pt; color: #666; letter-spacing: .6pt; margin-bottom: 3mm; }
    .top { display: grid; grid-template-columns: 29% 43% 28%; gap: 0; min-height: 38mm; align-items: start; }
    .brand { color: #294581; font: bold 23pt Arial, sans-serif; line-height: 1.05; margin: 0 0 2mm; }
    .legal { font-size: 7pt; margin-bottom: 2mm; }
    .pre { white-space: pre-line; }
    .company { padding-right: 5mm; line-height: 1.35; }
    .supplier { padding: 3mm 5mm 0; line-height: 1.3; }
    .supplier-title { margin-bottom: 1.5mm; font-weight: bold; }
    h1 { border: .8pt solid #111; text-align: center; font-size: 12pt; padding: 1mm; margin: 0 0 2mm; }
    .document { text-align: center; line-height: 1.5; }
    .number { font-size: 16pt; font-weight: bold; margin: 1mm 0; }
    .date { font-weight: bold; margin-top: 1mm; }
    .metadata { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 2mm 0; font-size: 7.5pt; }
    .metadata td { border: .8pt solid #111; padding: .7mm 1mm; text-align: center; vertical-align: top; }
    .metadata td:first-child { text-align: left; }
    .metadata strong { display: block; }
    .lines { width: 100%; border-collapse: collapse; table-layout: fixed; height: 84mm; font-size: 8pt; }
    .lines thead { display: table-header-group; }
    .lines th { border: .8pt solid #111; padding: 1.2mm .8mm; font-size: 7.5pt; }
    .lines td { border-left: .8pt solid #111; border-right: .8pt solid #111; padding: .7mm 1mm; vertical-align: top; }
    .lines tbody tr { height: 4mm; break-inside: avoid; }
    .lines tbody tr.filler { height: auto; }
    .lines tbody tr:last-child td { border-bottom: .8pt solid #111; }
    .right { text-align: right; } .center { text-align: center; }
    .closing { display: grid; grid-template-columns: 69% 31%; break-inside: avoid; }
    .remarks { border: .8pt solid #111; border-top: 0; padding: 1.2mm; min-height: 34mm; display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 2mm; }
    .remarks p { margin: 0 0 2mm; line-height: 1.3; }
    .remarks .notes { min-height: 9mm; }
    .terms { margin-top: 2mm; }
    .sign { padding: 1mm; line-height: 2; }
    .signature-line { border-bottom: .6pt solid #111; height: 14mm; }
    .totals { width: 100%; border-collapse: collapse; align-self: start; font-size: 8pt; }
    .totals td { padding: 1.5mm 1mm; border-right: .8pt solid #111; }
    .totals td:first-child { text-align: right; font-weight: bold; width: 43%; }
    .totals td:nth-child(2) { width: 14%; }
    .totals td:last-child { text-align: right; font-weight: bold; white-space: nowrap; }
    .totals .grand td { border-top: .8pt solid #111; border-bottom: .8pt solid #111; padding-top: 2mm; padding-bottom: 2mm; }
    footer { margin-top: 2mm; max-width: 80%; text-align: left; font-size: 7pt; }
  </style>
</head>
<body>
  <header class="top">
    <section class="company">
      <div class="brand">{{company.name}}</div>
      <div class="legal">{{company.legal_name}}</div>
      <div class="pre">{{company.address}}</div>
      <div>Tél. : {{company.phone}}</div>
      <div>CC : {{company.tax_id}} &nbsp; RCCM : {{company.rccm}}</div>
    </section>
    <section class="supplier">
      <div class="supplier-title">Adresse fournisseur :</div>
      <div>{{supplier.code}}</div>
      <strong>{{supplier.name}}</strong>
      <div class="pre">{{supplier.address}}</div>
      <div>Contact : {{supplier.contact}}</div>
    </section>
    <section class="document">
      <h1>{{layout.title}}</h1>
      <div>No BON DE COMMANDE</div>
      <div class="number">{{document.number}}</div>
      <div>Date Bon de Commande</div>
      <div class="date">{{document.order_date}}</div>
    </section>
  </header>
  <table class="metadata"><tbody><tr>
    <td style="width:28%"><strong>Contact {{document.buyer_name}}</strong>{{document.buyer_phone}}<br>{{document.buyer_email}}</td>
    <td style="width:20%"><strong>Référence</strong>{{document.reference}}</td>
    <td style="width:32%"><strong>Description</strong>{{document.description}}</td>
    <td style="width:8%"><strong>Exp. par</strong>{{document.shipping_method}}</td>
    <td style="width:12%"><strong>Date disponible</strong>{{document.expected_date}}</td>
  </tr></tbody></table>
  <div class="pre">{{layout.intro}}</div>
  <table class="lines">
    <colgroup><col style="width:10%"><col style="width:15%"><col style="width:41%"><col style="width:8%"><col style="width:7%"><col style="width:10%"><col style="width:9%"></colgroup>
    <thead><tr><th>No Article</th><th>No Manufacturier</th><th>Description</th><th>Qté command.</th><th>U/M</th><th>Coût Unitaire</th><th>Prix total</th></tr></thead>
    <tbody>{{rows}}<tr class="filler"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody>
  </table>
  <section class="closing">
    <div class="remarks">
      <div>
        <p><strong>Remarques :</strong> Prière d'envoyer une copie de la facture à : <strong>{{document.invoice_email}}</strong></p>
        <div class="notes pre">{{document.notes}}</div>
        <div class="terms"><strong>Incoterms</strong><br>{{document.incoterm}}</div>
        <div class="terms"><strong>Modalité</strong><br>{{document.payment_terms}}</div>
      </div>
      <div class="sign">Par : ______________________<br>Date : ____________________<div class="signature-line"></div></div>
    </div>
    <table class="totals"><tbody>
      <tr><td>Sous-total</td><td>{{document.currency}}</td><td>{{document.subtotal}}</td></tr>
      <tr><td>Total - Taxe</td><td></td><td>{{document.tax_amount}}</td></tr>
      <tr class="grand"><td>Total - Bon commande</td><td>{{document.currency}}</td><td>{{document.total}}</td></tr>
    </tbody></table>
  </section>
  <footer>{{layout.footer}}</footer>
</body>
</html>
$po_landscape$;
  ELSE
    _html := $po_standard$<!doctype html>
<html lang="fr" data-po-preset="standard">
<head>
  <meta charset="utf-8">
  <title>Bon de commande {{document.number}}</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <style>
    @page { size: A4; margin: 16mm; @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 7pt Montserrat, sans-serif; color: #526474; } }
    * { box-sizing: border-box; }
    body { margin: 0; color: #172b3a; font: 9pt Montserrat, sans-serif; overflow-wrap: anywhere; }
    .sample { color: #697886; font-size: 7pt; letter-spacing: .8pt; margin-bottom: 8mm; }
    .top { display: grid; grid-template-columns: 1.1fr 1fr; gap: 9mm; border-bottom: 2pt solid #17324d; padding-bottom: 7mm; }
    .company { font: bold 21pt 'Playfair Display', serif; margin-bottom: 3mm; }
    .small { color: #526474; font-size: 8pt; line-height: 1.65; }
    .pre { white-space: pre-line; }
    h1 { font-size: 17pt; margin: 0 0 3mm; }
    .document { text-align: right; }
    .number { font-size: 16pt; font-weight: 700; margin-bottom: 3mm; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin: 7mm 0; }
    .box { border: .6pt solid #cad3dc; border-radius: 3mm; padding: 4mm; line-height: 1.6; }
    h2 { margin: 0 0 2mm; color: #17324d; font-size: 9pt; text-transform: uppercase; letter-spacing: .5pt; }
    .supplier { font-weight: 700; }
    .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4mm; margin: 6mm 0; font-size: 8pt; }
    .label { display: block; color: #526474; font-size: 7pt; text-transform: uppercase; margin-bottom: 1mm; }
    table { width: 100%; border-collapse: collapse; font-size: 8pt; }
    thead { display: table-header-group; background: #17324d; color: white; }
    th { padding: 3mm 2mm; text-align: left; font-weight: 600; }
    td { padding: 3mm 2mm; border-bottom: .6pt solid #d9e0e6; vertical-align: top; }
    tr { break-inside: avoid; }
    .right { text-align: right; white-space: nowrap; }
    .code { width: 20%; } .description { width: 34%; }
    .summary { display: grid; grid-template-columns: 1fr 72mm; gap: 9mm; margin-top: 6mm; break-inside: avoid; }
    .totals { border: .6pt solid #cad3dc; border-radius: 3mm; padding: 3mm 4mm; }
    .amount { display: flex; justify-content: space-between; gap: 3mm; padding: 2mm 0; }
    .grand { font-weight: 700; border-top: 1pt solid #17324d; margin-top: 1mm; padding-top: 3mm; }
    .terms { margin-top: 7mm; break-inside: avoid; }
    .terms p { margin: 1mm 0; line-height: 1.6; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin-top: 9mm; break-inside: avoid; }
    .signature { border-top: .7pt solid #718191; padding-top: 2mm; font-size: 8pt; min-height: 12mm; }
    footer { margin-top: 8mm; padding-top: 3mm; border-top: .6pt solid #cad3dc; font-size: 7pt; color: #526474; line-height: 1.5; }
  </style>
</head>
<body>
  <header class="top">
    <section>
      <div class="company">{{company.name}}</div>
      <div class="small pre">{{company.address}}</div>
      <div class="small">{{company.phone}} · {{company.email}}</div>
      <div class="small">RCCM : {{company.rccm}} · Identifiant fiscal : {{company.tax_id}}</div>
    </section>
    <section class="document">
      <h1>{{layout.title}}</h1>
      <div class="number">{{document.number}}</div>
      <div class="small">Date : {{document.order_date}}</div>
      <div class="small">Devise : {{document.currency}}</div>
    </section>
  </header>
  <div class="parties">
    <section class="box">
      <h2>Fournisseur</h2>
      <div class="supplier">{{supplier.name}}</div>
      <div>Code : {{supplier.code}}</div>
      <div class="pre">{{supplier.address}}</div>
      <div>{{supplier.contact}}</div>
      <div>{{supplier.phone}}</div>
      <div>{{supplier.email}}</div>
    </section>
    <section class="box">
      <h2>Livraison et contact</h2>
      <div class="pre">{{document.delivery_address}}</div>
      <div>Date attendue : {{document.expected_date}}</div>
      <div>{{document.buyer_name}}</div>
      <div>{{document.buyer_phone}}</div>
      <div>{{document.buyer_email}}</div>
    </section>
  </div>
  <section class="meta">
    <div><span class="label">Référence</span>{{document.reference}}</div>
    <div><span class="label">Incoterm</span>{{document.incoterm}}</div>
    <div><span class="label">Conditions de paiement</span>{{document.payment_terms}}</div>
  </section>
  <div class="pre">{{layout.intro}}</div>
  <table>
    <thead><tr><th class="code">Article</th><th class="description">Désignation</th><th class="right">Qté</th><th>U/M</th><th class="right">Prix unitaire</th><th class="right">Montant HT</th></tr></thead>
    <tbody>{{rows}}</tbody>
  </table>
  <section class="summary">
    <div><h2>Observations</h2><div class="pre small">{{document.notes}}</div></div>
    <div class="totals">
      <div class="amount"><span>Sous-total</span><span>{{document.subtotal}} {{document.currency}}</span></div>
      <div class="amount"><span>Taxes</span><span>{{document.tax_amount}} {{document.currency}}</span></div>
      <div class="amount grand"><span>Total commande</span><span>{{document.total}} {{document.currency}}</span></div>
    </div>
  </section>
  <section class="terms">
    <h2>Instructions de facturation</h2>
    <p>Merci de rappeler le numéro {{document.number}} sur vos factures et documents de livraison.</p>
    <p>Adresse de facturation : {{document.invoice_email}}</p>
  </section>
  <section class="signatures">
    <div class="signature">Établi par : {{document.buyer_name}}<br>Date et signature :</div>
    <div class="signature">Approuvé par :<br>Date et signature :</div>
  </section>
  <footer>{{company.legal_name}} · {{company.address}}<br>{{layout.footer}}</footer>
</body>
</html>
$po_standard$;
  END IF;
  _html := replace(_html,'{{layout.title}}',public.document_template_interpolate(_layout->>'title',NULL));
  _html := replace(_html,'{{layout.intro}}',public.document_template_interpolate(_layout->>'intro',NULL));
  _html := replace(_html,'{{layout.footer}}',public.document_template_interpolate(_layout->>'footer',NULL));
  _html := replace(_html,'font: 9pt Montserrat','font: '||(_layout->>'font_size')||'pt Montserrat');
  _html := replace(_html,'font: 8pt Arial','font: '||(_layout->>'font_size')||'pt Arial');
  _html := replace(_html,'#17324d',_layout->>'accent_color');
  RETURN _html;
END $$;

CREATE OR REPLACE FUNCTION public.save_document_template(_id uuid, _name text, _layout jsonb, _reason text) RETURNS jsonb
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
  _doc_type text := coalesce(_layout->>'doc_type','ar_invoice');
  _preset text := coalesce(_layout->>'preset','standard');
BEGIN
  IF _name_clean IS NULL OR char_length(_name_clean) NOT BETWEEN 1 AND 120 OR _reason_clean IS NULL OR char_length(_reason_clean) > 500 THEN
    RAISE EXCEPTION 'Le nom ou le motif du modèle dépasse la longueur autorisée' USING ERRCODE = 'QG038';
  END IF;
  IF jsonb_typeof(_layout) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'La présentation du modèle doit être un objet' USING ERRCODE = 'QG038';
  END IF;
  IF _doc_type NOT IN ('ar_invoice','purchase_order') OR (_doc_type='purchase_order' AND _preset NOT IN ('standard','reference-PO0004821')) THEN
    RAISE EXCEPTION 'Type de document ou presentation non autorise' USING ERRCODE='QG038';
  END IF;
  FOR _field IN SELECT jsonb_object_keys(_layout) LOOP
    IF _field = 'font_size' THEN
      IF jsonb_typeof(_layout->_field) <> 'number' THEN
        RAISE EXCEPTION 'La taille du texte doit être numérique' USING ERRCODE = 'QG038';
      END IF;
    ELSIF _field NOT IN ('title', 'intro', 'footer', 'accent_color','doc_type','preset') OR jsonb_typeof(_layout->_field) <> 'string' THEN
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
  _clean := jsonb_build_object('title', coalesce(_layout->>'title',CASE WHEN _doc_type='purchase_order' THEN 'BON DE COMMANDE' ELSE 'Facture' END), 'intro', coalesce(_layout->>'intro', ''),
    'footer', coalesce(_layout->>'footer', ''), 'accent_color', coalesce(_layout->>'accent_color', '#17324D'),
    'font_size', _font::integer);
  IF _doc_type='purchase_order' THEN
    _clean := _clean || jsonb_build_object('doc_type',_doc_type,'preset',_preset);
    _html := public.document_po_template_html(_clean);
  ELSE
    _html := public.document_template_html(_clean);
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.document_templates (tenant_id, doc_type, name, created_by) VALUES (_tenant, _doc_type, _name_clean, _actor)
      RETURNING * INTO _template;
  ELSE
    UPDATE public.document_templates t SET name = _name_clean WHERE t.id = _id AND t.tenant_id = _tenant AND t.doc_type = _doc_type
      RETURNING * INTO _template;
    IF NOT FOUND THEN RAISE EXCEPTION 'Modèle introuvable' USING ERRCODE = 'QG038'; END IF;
  END IF;
  INSERT INTO public.document_template_versions (tenant_id, template_id, version_no, layout, content_html, sha256, created_by, reason)
  SELECT _tenant, _template.id, coalesce(max(v.version_no), 0) + 1, _clean, _html, public.document_hash(_html), _actor, _reason_clean
    FROM public.document_template_versions v WHERE v.template_id = _template.id AND v.tenant_id = _tenant
  RETURNING * INTO _version;
  RETURN jsonb_build_object('template', to_jsonb(_template), 'version', to_jsonb(_version));
END $$;

CREATE FUNCTION public.install_purchase_order_templates() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 _tenant uuid := public.document_actor_tenant(auth.uid(),'reports.templates');
 _preset text; _id uuid; _saved jsonb; _layout jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('qerp:po-defaults:'||_tenant::text,0));
 FOREACH _preset IN ARRAY ARRAY['standard','reference-PO0004821'] LOOP
   SELECT t.id INTO _id FROM public.document_templates t WHERE t.tenant_id=_tenant AND t.doc_type='purchase_order' AND t.preset_key=_preset;
   IF NOT FOUND THEN
     _layout := jsonb_build_object('doc_type','purchase_order','preset',_preset,'title','BON DE COMMANDE','intro','',
       'footer','Merci de rappeler le numero du bon de commande sur toute correspondance.',
       'accent_color','#17324d','font_size',CASE WHEN _preset='standard' THEN 9 ELSE 8 END);
     _saved := public.save_document_template(NULL,CASE WHEN _preset='standard' THEN 'PO standard' ELSE 'PO paysage - PO0004821' END,_layout,'Installation des deux modeles PO demandes');
     _id := (_saved->'template'->>'id')::uuid;
     UPDATE public.document_templates t SET preset_key=_preset WHERE t.id=_id AND t.tenant_id=_tenant;
     PERFORM public.publish_document_template((_saved->'version'->>'id')::uuid,'Publication initiale du modele PO');
   END IF;
 END LOOP;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('versions',
   (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.version_no DESC),'[]'::jsonb) FROM public.document_template_versions v WHERE v.template_id=t.id AND v.tenant_id=_tenant))
   ORDER BY CASE WHEN t.preset_key='standard' THEN 0 ELSE 1 END),'[]'::jsonb)
   FROM public.document_templates t WHERE t.tenant_id=_tenant AND t.doc_type='purchase_order' AND t.preset_key IS NOT NULL);
END $$;

CREATE FUNCTION public.document_purchase_order_snapshot(_order public.purchase_orders,_reference text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('doc_type','purchase_order',
 'company',jsonb_build_object('name',t.name,'legal_name',t.legal_name,'address',t.address,'phone',t.phone,'email',t.email,'rccm',t.rccm,
 'tax_id',t.tax_id,'tax_regime',t.tax_regime,'tax_office',t.tax_office,'bank_details',t.bank_details),
 'supplier',jsonb_build_object('name',s.name,'code',NULL,'address',s.address,'phone',s.phone,'email',s.email,'tax_id',s.tax_id,'contact',s.contact_name),
 'document',jsonb_build_object('number',_order.po_number,'order_date',to_char(_order.order_date,'YYYY-MM-DD'),
 'expected_date',to_char(_order.expected_date,'YYYY-MM-DD'),'reference',_reference,'description',_order.supplier_reference,
 'currency',coalesce(_order.currency,t.currency),'exchange_rate',_order.exchange_rate,
 'subtotal',CASE WHEN _order.currency IS NULL THEN _order.total ELSE _order.fx_total END,
 'tax_amount','Non calculées','total',CASE WHEN _order.currency IS NULL THEN _order.total ELSE _order.fx_total END,
 'incoterm',_order.incoterm,'payment_terms',CASE WHEN s.payment_terms IS NOT NULL THEN s.payment_terms::text||' jours' END,
 'shipping_method',NULL,'delivery_address',t.address,'buyer_name',p.full_name,'buyer_phone',NULL,'buyer_email',t.email,'invoice_email',t.email,'notes',NULL,'footer',NULL),
 'lines',coalesce((SELECT jsonb_agg(jsonb_build_object('article',i.code,'manufacturer',NULL,'description',l.description,'quantity',l.quantity,'unit',i.unit,
 'unit_cost',CASE WHEN _order.currency IS NULL THEN l.unit_cost ELSE l.fx_unit_cost END,
 'net_amount',CASE WHEN _order.currency IS NULL THEN l.total ELSE l.fx_total END) ORDER BY l.id)
 FROM public.po_lines l LEFT JOIN public.items i ON i.id=l.item_id AND i.tenant_id=_order.tenant_id WHERE l.po_id=_order.id),'[]'::jsonb))
 FROM public.tenants t JOIN public.suppliers s ON s.id=_order.supplier_id AND s.tenant_id=t.id
 LEFT JOIN public.profiles p ON p.id=_order.created_by AND p.tenant_id=t.id WHERE t.id=_order.tenant_id
$$;

CREATE FUNCTION public.request_purchase_order_edition(_po uuid, _template uuid DEFAULT NULL,
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
    ORDER BY v.published_at DESC, t.id LIMIT 1;
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

CREATE OR REPLACE FUNCTION public.retry_document_edition(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _job public.issued_documents;
 _expires_before timestamptz := clock_timestamp()-interval '60 seconds';
BEGIN
 SELECT d.* INTO _job FROM public.issued_documents d WHERE d.id=_id AND d.tenant_id=_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Edition introuvable' USING ERRCODE='QG038'; END IF;
 PERFORM public.document_actor_tenant(auth.uid(),CASE WHEN _job.po_id IS NOT NULL THEN 'procurement.order' ELSE 'ar.invoice' END);
 IF _job.status='queued' AND _job.created_at<_expires_before THEN RETURN to_jsonb(_job); END IF;
 IF _job.status<>'failed' AND NOT (_job.status='rendering' AND _job.started_at<_expires_before) THEN
  RAISE EXCEPTION 'Seule une edition en echec ou expiree peut etre relancee' USING ERRCODE='QG038';
 END IF;
 UPDATE public.issued_documents d SET status='queued',started_at=NULL,finished_at=NULL,error=NULL WHERE d.id=_job.id RETURNING d.* INTO _job;
 RETURN to_jsonb(_job);
END $$;

CREATE OR REPLACE FUNCTION public.document_worker_job(_id uuid,_actor uuid) RETURNS public.issued_documents
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(_actor); _authenticated_actor uuid := auth.uid(); _job public.issued_documents;
BEGIN
 IF (session_user='qerp_api' OR _authenticated_actor IS NOT NULL) AND _authenticated_actor IS DISTINCT FROM _actor THEN
  RAISE EXCEPTION 'Acteur du rendu non autorise' USING ERRCODE='42501';
 END IF;
 SELECT d.* INTO _job FROM public.issued_documents d WHERE d.id=_id AND d.tenant_id=_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acteur du rendu non autorise' USING ERRCODE='42501'; END IF;
 PERFORM public.document_actor_tenant(_actor,CASE WHEN _job.po_id IS NOT NULL THEN 'procurement.order' ELSE 'ar.invoice' END);
 RETURN _job;
END $$;

CREATE OR REPLACE FUNCTION public.document_render_snapshot(_template_html text,_context jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE _rows text; _reference boolean := strpos(_template_html,'data-po-preset="reference-PO0004821"')>0;
BEGIN
 IF _context->>'doc_type'='purchase_order' THEN
  SELECT coalesce(string_agg('<tr><td>'||public.document_html_escape(r.line->>'article')||'</td>'||
    CASE WHEN _reference THEN '<td>'||public.document_html_escape(r.line->>'manufacturer')||'</td>' ELSE '' END||
    '<td>'||public.document_html_escape(r.line->>'description')||'</td><td class="right">'||public.document_html_escape(r.line->>'quantity')||
    '</td><td>'||public.document_html_escape(r.line->>'unit')||'</td><td class="right">'||public.document_html_escape(r.line->>'unit_cost')||
    '</td><td class="right">'||public.document_html_escape(r.line->>'net_amount')||'</td></tr>','' ORDER BY r.seq),'')
  INTO _rows FROM jsonb_array_elements(_context->'lines') WITH ORDINALITY AS r(line,seq);
 ELSE
  SELECT coalesce(string_agg(format('<tr><td>%s</td><td>%s</td><td>%s</td><td>%s %%</td><td>%s</td><td>%s%s</td></tr>',
    public.document_html_escape(r.line->>'description'),public.document_html_escape(r.line->>'quantity'),
    public.document_html_escape(r.line->>'unit_price'),public.document_html_escape(r.line->>'discount_pct'),
    public.document_html_escape(r.line->>'net_amount'),public.document_html_escape(r.line->>'tax_amount'),
    CASE WHEN r.line->>'tax_rate' IS NOT NULL THEN ' ('||public.document_html_escape(r.line->>'tax_rate')||' %)' END
   ),'' ORDER BY r.seq),'<tr><td colspan="6">Facture sans lignes détaillées</td></tr>')
  INTO _rows FROM jsonb_array_elements(_context->'lines') WITH ORDINALITY AS r(line,seq);
 END IF;
 RETURN public.document_template_interpolate(_template_html,_context,_rows);
END $$;

REVOKE ALL ON FUNCTION public.document_po_template_html(jsonb),public.document_purchase_order_snapshot(public.purchase_orders,text),
 public.install_purchase_order_templates(),public.request_purchase_order_edition(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.install_purchase_order_templates(),public.request_purchase_order_edition(uuid,uuid,uuid,text) TO authenticated;
SELECT public.install_tenant_isolation_triggers();
NOTIFY pgrst, 'reload schema';

