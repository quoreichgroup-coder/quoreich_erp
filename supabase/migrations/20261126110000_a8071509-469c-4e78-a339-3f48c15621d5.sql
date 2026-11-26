-- V155 — Langues et formats (PoC i18n, décisions D-I18N-001 à 010, corrections C-01 à C-07).
-- Langue (textes), locale (formats) et fuseau sont trois réglages indépendants. Une valeur NULL veut
-- dire « hériter » : rien ne change pour une société ou un utilisateur qui ne règle rien.
-- Les documents déjà émis ne sont pas touchés (contexte, empreintes et PDF restent tels quels).

-- ─── Référentiels globaux (livrés, lecture seule pour les utilisateurs) ───
CREATE TABLE public.languages (
  code text PRIMARY KEY CHECK (code ~ '^[a-z]{2,3}$'),   -- sous-étiquette de langue BCP 47, forme canonique
  label text NOT NULL CHECK (btrim(label) <> ''),          -- autonyme : « Français », « English »
  direction text NOT NULL DEFAULT 'ltr' CHECK (direction IN ('ltr', 'rtl')),
  default_locale text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  is_source boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  CHECK (NOT is_source OR is_active)
);
-- Une seule langue source, active par construction.
CREATE UNIQUE INDEX languages_one_source ON public.languages ((true)) WHERE is_source;

CREATE TABLE public.supported_locales (
  code text PRIMARY KEY CHECK (code ~ '^[a-z]{2,3}-[A-Z]{2}$'),  -- langue-RÉGION, forme canonique
  language text NOT NULL REFERENCES public.languages (code),
  label text NOT NULL CHECK (btrim(label) <> ''),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100
);

INSERT INTO public.languages (code, label, direction, default_locale, is_active, is_source, sort_order) VALUES
  ('fr', 'Français', 'ltr', 'fr-FR', true, true, 10),
  ('en', 'English', 'ltr', 'en-GB', true, false, 20);
INSERT INTO public.supported_locales (code, language, label, sort_order) VALUES
  ('fr-BF', 'fr', 'Français (Burkina Faso)', 10),
  ('fr-FR', 'fr', 'Français (France)', 20),
  ('en-GB', 'en', 'English (United Kingdom)', 30),
  ('en-US', 'en', 'English (United States)', 40);
ALTER TABLE public.languages ADD CONSTRAINT languages_default_locale_fkey
  FOREIGN KEY (default_locale) REFERENCES public.supported_locales (code) DEFERRABLE INITIALLY DEFERRED;

-- La langue source ne se supprime pas, ne se désactive pas et ne perd pas son rôle.
CREATE FUNCTION public.guard_source_language() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_source THEN RAISE EXCEPTION 'La langue source ne peut pas être supprimée' USING ERRCODE = 'QG039'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_source AND (NOT NEW.is_source OR NOT NEW.is_active OR NEW.code <> OLD.code) THEN
    RAISE EXCEPTION 'La langue source ne peut pas être désactivée ni remplacée' USING ERRCODE = 'QG039';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_source_language BEFORE UPDATE OR DELETE ON public.languages
  FOR EACH ROW EXECUTE FUNCTION public.guard_source_language();

ALTER TABLE public.languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supported_locales ENABLE ROW LEVEL SECURITY;
CREATE POLICY languages_read ON public.languages FOR SELECT TO authenticated USING (true);
CREATE POLICY supported_locales_read ON public.supported_locales FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.languages, public.supported_locales FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.languages, public.supported_locales TO authenticated;

-- ─── Société : défauts et langues autorisées ───
ALTER TABLE public.tenants
  ADD COLUMN default_language text REFERENCES public.languages (code),
  ADD COLUMN default_locale text REFERENCES public.supported_locales (code),
  ADD COLUMN timezone text;

-- Aucune ligne pour une société = toutes les langues actives de la plateforme sont autorisées.
CREATE TABLE public.tenant_languages (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  language text NOT NULL REFERENCES public.languages (code),
  PRIMARY KEY (tenant_id, language)
);
ALTER TABLE public.tenant_languages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_languages_read ON public.tenant_languages FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE ALL ON public.tenant_languages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tenant_languages TO authenticated;

-- Une langue est utilisable par une société si elle est active et autorisée (liste vide = toutes).
CREATE FUNCTION public.language_allowed(_tenant uuid, _language text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.languages l WHERE l.code = _language AND l.is_active)
     AND (NOT EXISTS (SELECT 1 FROM public.tenant_languages t WHERE t.tenant_id = _tenant)
          OR EXISTS (SELECT 1 FROM public.tenant_languages t WHERE t.tenant_id = _tenant AND t.language = _language)
          OR EXISTS (SELECT 1 FROM public.languages s WHERE s.code = _language AND s.is_source))
$$;
REVOKE EXECUTE ON FUNCTION public.language_allowed(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.is_known_timezone(_tz text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT _tz IS NULL OR EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names n WHERE n.name = _tz)
$$;

-- Le fuseau est contrôlé sur tous les chemins d'écriture, pas seulement par la fonction de réglage.
CREATE FUNCTION public.guard_tenant_language_settings() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT public.is_known_timezone(NEW.timezone) THEN
    RAISE EXCEPTION 'Fuseau horaire inconnu : %', left(NEW.timezone, 64) USING ERRCODE = 'QG039',
      HINT = 'errors:i18n.timezone_invalid', DETAIL = jsonb_build_object('timezone', left(NEW.timezone, 64))::text;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_tenant_language_settings BEFORE INSERT OR UPDATE OF timezone ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_language_settings();

-- ─── Utilisateur et tiers ───
-- Un utilisateur appartient à une seule société (profiles.tenant_id) : ses préférences sont les siennes.
ALTER TABLE public.profiles
  ADD COLUMN language text REFERENCES public.languages (code),
  ADD COLUMN locale text REFERENCES public.supported_locales (code);
ALTER TABLE public.customers ADD COLUMN document_language text REFERENCES public.languages (code);

-- La préférence doit être autorisée par la société, sur tous les chemins (y compris la mise à jour
-- directe du profil que permet la politique d'origine). Pas SECURITY DEFINER : le garde V24 reste seul
-- juge de tenant_id.
CREATE FUNCTION public.guard_profile_language() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.language IS NOT NULL AND NEW.language IS DISTINCT FROM OLD.language
     AND NOT public.language_allowed(NEW.tenant_id, NEW.language) THEN
    RAISE EXCEPTION 'Langue non autorisée pour cette société : %', NEW.language USING ERRCODE = 'QG039',
      HINT = 'errors:i18n.language_not_allowed', DETAIL = jsonb_build_object('language', NEW.language)::text;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_profile_language BEFORE UPDATE OF language ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_language();

-- ─── Droit du catalogue ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('languages.settings', 'languages', 'settings', 'Régler les langues, formats et fuseau horaire de la société')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT r.code, 'languages.settings' FROM public.erp_system_roles r WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND sp.permission_code = 'languages.settings'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── Lecture et réglage ───
-- Résolution côté serveur : préférence utilisateur autorisée > société > plateforme > source.
-- Une langue désactivée ou retirée de la société est ignorée (repli), jamais réécrite.
CREATE FUNCTION public.my_language_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _p public.profiles;
  _t public.tenants;
  _source text := (SELECT code FROM public.languages WHERE is_source);
  _lang text;
  _locale text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Session requise' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = _uid;
  SELECT * INTO _t FROM public.tenants WHERE id = _p.tenant_id;
  _lang := CASE
    WHEN _p.language IS NOT NULL AND public.language_allowed(_p.tenant_id, _p.language) THEN _p.language
    WHEN _t.default_language IS NOT NULL AND public.language_allowed(_t.id, _t.default_language) THEN _t.default_language
    ELSE _source END;
  -- La locale suit son propre ordre ; une locale d'une autre langue reste permise (dates FR, interface EN).
  _locale := coalesce(
    (SELECT s.code FROM public.supported_locales s WHERE s.code = _p.locale AND s.is_active),
    (SELECT s.code FROM public.supported_locales s WHERE s.code = _t.default_locale AND s.is_active),
    (SELECT l.default_locale FROM public.languages l WHERE l.code = _lang));
  RETURN jsonb_build_object(
    'language', _lang, 'locale', _locale, 'timezone', _t.timezone, 'source_language', _source,
    'user_language', _p.language, 'user_locale', _p.locale,
    'tenant_language', _t.default_language, 'tenant_locale', _t.default_locale,
    'allowed_languages', coalesce((SELECT jsonb_agg(l.code ORDER BY l.sort_order) FROM public.languages l
       WHERE _p.tenant_id IS NOT NULL AND public.language_allowed(_p.tenant_id, l.code)),
       (SELECT jsonb_agg(l.code ORDER BY l.sort_order) FROM public.languages l WHERE l.is_active)),
    'tenant_languages', coalesce((SELECT jsonb_agg(x.language ORDER BY x.language) FROM public.tenant_languages x
       WHERE x.tenant_id = _p.tenant_id), '[]'::jsonb));
END $$;

CREATE FUNCTION public.set_my_language_preferences(_language text, _locale text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(_uid);
BEGIN
  IF _uid IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'Session requise' USING ERRCODE = '42501'; END IF;
  IF _language IS NOT NULL AND NOT public.language_allowed(_tenant, _language) THEN
    RAISE EXCEPTION 'Langue non autorisée pour cette société : %', left(_language, 16) USING ERRCODE = 'QG039',
      HINT = 'errors:i18n.language_not_allowed', DETAIL = jsonb_build_object('language', left(_language, 16))::text;
  END IF;
  IF _locale IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.supported_locales s WHERE s.code = _locale AND s.is_active) THEN
    RAISE EXCEPTION 'Format régional non pris en charge : %', left(_locale, 16) USING ERRCODE = 'QG039',
      HINT = 'errors:i18n.locale_invalid', DETAIL = jsonb_build_object('locale', left(_locale, 16))::text;
  END IF;
  UPDATE public.profiles SET language = _language, locale = _locale, updated_at = now() WHERE id = _uid;
  RETURN public.my_language_context();
END $$;

CREATE FUNCTION public.set_company_language_settings(_default_language text, _default_locale text,
  _timezone text, _languages text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(_uid);
  _source text := (SELECT code FROM public.languages WHERE is_source);
  _list text[] := (SELECT array_agg(DISTINCT x) FROM unnest(coalesce(_languages, '{}'::text[])) x WHERE x IS NOT NULL);
  _bad text;
BEGIN
  IF _uid IS NULL OR _tenant IS NULL OR NOT public.has_permission(_uid, 'languages.settings') THEN
    RAISE EXCEPTION 'Droit requis : languages.settings' USING ERRCODE = '42501';
  END IF;
  SELECT x INTO _bad FROM unnest(coalesce(_list, '{}'::text[])) x
   WHERE NOT EXISTS (SELECT 1 FROM public.languages l WHERE l.code = x AND l.is_active) LIMIT 1;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'Langue inconnue ou inactive : %', left(_bad, 16) USING ERRCODE = 'QG039',
      HINT = 'errors:i18n.language_not_allowed', DETAIL = jsonb_build_object('language', left(_bad, 16))::text;
  END IF;
  -- Une liste non vide contient toujours la langue source (repli garanti).
  IF cardinality(_list) > 0 AND NOT _source = ANY(_list) THEN _list := _list || _source; END IF;
  IF _default_language IS NOT NULL AND NOT (
       EXISTS (SELECT 1 FROM public.languages l WHERE l.code = _default_language AND l.is_active)
       AND (coalesce(cardinality(_list), 0) = 0 OR _default_language = ANY(_list))) THEN
    RAISE EXCEPTION 'Langue non autorisée pour cette société : %', left(_default_language, 16) USING ERRCODE = 'QG039',
      HINT = 'errors:i18n.language_not_allowed', DETAIL = jsonb_build_object('language', left(_default_language, 16))::text;
  END IF;
  IF _default_locale IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.supported_locales s WHERE s.code = _default_locale AND s.is_active) THEN
    RAISE EXCEPTION 'Format régional non pris en charge : %', left(_default_locale, 16) USING ERRCODE = 'QG039',
      HINT = 'errors:i18n.locale_invalid', DETAIL = jsonb_build_object('locale', left(_default_locale, 16))::text;
  END IF;
  UPDATE public.tenants SET default_language = _default_language, default_locale = _default_locale,
    timezone = nullif(btrim(_timezone), ''), updated_at = now() WHERE id = _tenant;
  DELETE FROM public.tenant_languages WHERE tenant_id = _tenant;
  INSERT INTO public.tenant_languages (tenant_id, language) SELECT _tenant, x FROM unnest(coalesce(_list, '{}'::text[])) x;
  RETURN public.my_language_context();
END $$;

REVOKE ALL ON FUNCTION public.my_language_context(), public.set_my_language_preferences(text, text),
  public.set_company_language_settings(text, text, text, text[]), public.is_known_timezone(text),
  public.guard_source_language(), public.guard_tenant_language_settings(), public.guard_profile_language()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_language_context(), public.set_my_language_preferences(text, text),
  public.set_company_language_settings(text, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_known_timezone(text) TO authenticated;

-- ─── Documents : langue du modèle, langue figée de l'édition ───
-- Les modèles existants ont un HTML généré en français (document_template_html de V141) : 'fr' est leur
-- langue réelle, pas une supposition.
ALTER TABLE public.document_templates ADD COLUMN language text NOT NULL DEFAULT 'fr' REFERENCES public.languages (code);
-- Éditions antérieures : NULL = héritée (française, non renseignée). Aucune ligne existante n'est modifiée.
ALTER TABLE public.issued_documents
  ADD COLUMN language text REFERENCES public.languages (code),
  ADD COLUMN locale text REFERENCES public.supported_locales (code),
  ADD CONSTRAINT issued_documents_language_locale CHECK ((language IS NULL) = (locale IS NULL));

-- Gabarit HTML par langue. La version française est identique octet pour octet à celle de V141.
CREATE FUNCTION public.document_template_html(_layout jsonb, _language text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN _language = 'en' THEN format($html$<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Invoice {{document.number}}</title>
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
  <div>Invoice {{document.number}} · Issue {{document.reference}}</div>
  <div class="identity">
    <section><h2>{{company.name}}</h2><div>{{company.legal_name}}</div>
      <div class="text">{{company.address}}</div><div>{{company.email}}</div><div>{{company.phone}}</div>
      <div>RCCM · {{company.rccm}}</div><div>Tax ID · {{company.tax_id}}</div>
      <div>{{company.tax_regime}}</div><div>{{company.tax_office}}</div><div class="text">{{company.bank_details}}</div></section>
    <section><h2>Customer</h2><div>{{customer.name}}</div><div class="text">{{customer.address}}</div>
      <div>{{customer.email}}</div><div>{{customer.phone}}</div><div>Tax ID · {{customer.tax_id}}</div></section>
  </div>
  <div class="dates">Issued on {{document.invoice_date}} · Due {{document.due_date}}</div>
  <div class="text">%s</div>
  <table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Discount</th><th>Net amount</th><th>VAT</th></tr></thead>
    <tbody>{{rows}}</tbody></table>
  <div class="totals"><div>Net · {{document.subtotal}} {{document.currency}}</div>
    <div>VAT · {{document.tax_amount}} {{document.currency}}</div>
    <div><strong>Total incl. VAT · {{document.total}} {{document.currency}}</strong></div></div>
  <footer class="text">%s</footer>
</body></html>$html$, _layout->>'font_size', _layout->>'accent_color',
    public.document_template_interpolate(_layout->>'title', NULL), public.document_template_interpolate(_layout->>'intro', NULL),
    public.document_template_interpolate(_layout->>'footer', NULL))
  ELSE public.document_template_html(_layout) END
$$;

-- Ligne de remplacement quand la facture n'a pas de lignes : dans la langue figée de l'édition.
-- Un contexte sans 'meta' (édition antérieure) garde le texte français d'origine.
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
   ),'' ORDER BY r.seq),
   CASE WHEN _context #>> '{meta,language}' = 'en' THEN '<tr><td colspan="6">Invoice without detailed lines</td></tr>'
        ELSE '<tr><td colspan="6">Facture sans lignes détaillées</td></tr>' END)
  INTO _rows FROM jsonb_array_elements(_context->'lines') WITH ORDINALITY AS r(line,seq);
 END IF;
 RETURN public.document_template_interpolate(_template_html,_context,_rows);
END $$;

-- Enregistrement d'un modèle : la langue est fixée à la création et ne change plus (une autre langue =
-- un autre modèle). Signature élargie d'un paramètre facultatif : les appels existants restent valides.
DROP FUNCTION public.save_document_template(uuid, text, jsonb, text);
CREATE FUNCTION public.save_document_template(_id uuid, _name text, _layout jsonb, _reason text,
  _language text DEFAULT NULL) RETURNS jsonb
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
  _lang text;
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

  IF _id IS NULL THEN
    _lang := coalesce(_language, (SELECT code FROM public.languages WHERE is_source));
    -- Bons de commande : un seul gabarit (français) tant que leur version anglaise n'existe pas.
    IF NOT public.language_allowed(_tenant, _lang) OR (_doc_type = 'purchase_order' AND _lang <> 'fr') THEN
      RAISE EXCEPTION 'Langue non autorisée pour ce modèle : %', left(_lang, 16) USING ERRCODE = 'QG039',
        HINT = 'errors:i18n.language_not_allowed', DETAIL = jsonb_build_object('language', left(_lang, 16))::text;
    END IF;
  ELSE
    SELECT t.language INTO _lang FROM public.document_templates t WHERE t.id = _id AND t.tenant_id = _tenant;
    IF _language IS NOT NULL AND _language IS DISTINCT FROM _lang THEN
      RAISE EXCEPTION 'La langue d’un modèle ne change pas : créez un modèle dans l’autre langue' USING ERRCODE = 'QG039',
        HINT = 'errors:documents.template_language_frozen', DETAIL = jsonb_build_object('language', _lang)::text;
    END IF;
  END IF;

  _clean := jsonb_build_object('title', coalesce(_layout->>'title',CASE WHEN _doc_type='purchase_order' THEN 'BON DE COMMANDE'
      WHEN _lang = 'en' THEN 'Invoice' ELSE 'Facture' END), 'intro', coalesce(_layout->>'intro', ''),
    'footer', coalesce(_layout->>'footer', ''), 'accent_color', coalesce(_layout->>'accent_color', '#17324D'),
    'font_size', _font::integer);
  IF _doc_type='purchase_order' THEN
    _clean := _clean || jsonb_build_object('doc_type',_doc_type,'preset',_preset);
    _html := public.document_po_template_html(_clean);
  ELSE
    _html := public.document_template_html(_clean, _lang);
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.document_templates (tenant_id, doc_type, name, created_by, language) VALUES (_tenant, _doc_type, _name_clean, _actor, _lang)
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

-- Émission : la langue est choisie (ou proposée depuis le client), puis figée avec la locale et la
-- version du modèle dans le contexte AVANT le hachage. Sans modèle publié dans cette langue, l'émission
-- est refusée : jamais de pièce silencieusement dans une autre langue.
DROP FUNCTION public.request_document_edition(uuid, uuid, uuid, text);
CREATE FUNCTION public.request_document_edition(_invoice uuid, _template uuid DEFAULT NULL,
  _replace uuid DEFAULT NULL, _reason text DEFAULT NULL, _language text DEFAULT NULL) RETURNS jsonb
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
  _lang text;
  _locale text;
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

  -- Langue : choix explicite > modèle choisi > édition remplacée > client > société > source.
  _lang := coalesce(nullif(btrim(_language), ''),
    (SELECT t.language FROM public.document_templates t WHERE t.id = _template AND t.tenant_id = _tenant),
    (SELECT t.language FROM public.issued_documents d JOIN public.document_template_versions v ON v.id = d.template_version_id
       JOIN public.document_templates t ON t.id = v.template_id WHERE d.id = _replace AND d.tenant_id = _tenant),
    (SELECT c.document_language FROM public.customers c WHERE c.id = _inv.customer_id AND c.tenant_id = _tenant),
    (SELECT t.default_language FROM public.tenants t WHERE t.id = _tenant),
    (SELECT l.code FROM public.languages l WHERE l.is_source));
  IF NOT public.language_allowed(_tenant, _lang) THEN
    RAISE EXCEPTION 'Langue non autorisée pour cette société : %', left(_lang, 16) USING ERRCODE = 'QG039',
      HINT = 'errors:i18n.language_not_allowed', DETAIL = jsonb_build_object('language', left(_lang, 16))::text;
  END IF;
  _locale := coalesce(
    (SELECT s.code FROM public.tenants t JOIN public.supported_locales s ON s.code = t.default_locale
      WHERE t.id = _tenant AND s.language = _lang AND s.is_active),
    (SELECT l.default_locale FROM public.languages l WHERE l.code = _lang));

  SELECT v.id INTO _version FROM public.document_templates t JOIN public.document_template_versions v
    ON v.id = t.current_version_id AND v.template_id = t.id AND v.tenant_id = t.tenant_id
    WHERE t.tenant_id = _tenant AND t.doc_type = 'ar_invoice' AND v.published_at IS NOT NULL AND t.language = _lang
      AND (_template IS NULL OR t.id = _template)
    ORDER BY CASE WHEN _template IS NULL AND t.is_default THEN 0 ELSE 1 END, v.published_at DESC, t.id LIMIT 1;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.document_templates t WHERE t.tenant_id = _tenant AND t.doc_type = 'ar_invoice'
                 AND t.current_version_id IS NOT NULL AND (_template IS NULL OR t.id = _template)) THEN
      RAISE EXCEPTION 'Aucun modèle de facture publié dans la langue « % »', _lang USING ERRCODE = 'QG038',
        HINT = 'errors:documents.template_missing_language', DETAIL = jsonb_build_object('language', _lang)::text;
    END IF;
    RAISE EXCEPTION 'Aucun modèle de facture publié disponible' USING ERRCODE = 'QG038';
  END IF;

  SELECT _inv.invoice_number || '/ED-' || (count(*) + 1) INTO _reference
    FROM public.issued_documents d WHERE d.ar_invoice_id = _inv.id AND d.tenant_id = _tenant;
  _snapshot := public.document_invoice_snapshot(_inv, _reference);
  IF _snapshot IS NULL OR _snapshot #>> '{document,total}' IS NULL THEN
    RAISE EXCEPTION 'Les données nécessaires à l’édition de la facture sont incomplètes' USING ERRCODE = 'QG038';
  END IF;
  _snapshot := _snapshot || jsonb_build_object('meta', jsonb_build_object('language', _lang, 'locale', _locale,
    'template_version_id', _version));
  INSERT INTO public.issued_documents (tenant_id, ar_invoice_id, template_version_id, context, context_sha256,
    reference, created_by, replaces_id, replacement_reason, language, locale)
  VALUES (_tenant, _inv.id, _version, _snapshot, public.document_hash(_snapshot::text), _reference, _actor, _replace,
    CASE WHEN _replace IS NOT NULL THEN _reason_clean END, _lang, _locale) RETURNING * INTO _edition;
  RETURN to_jsonb(_edition);
END $$;

REVOKE ALL ON FUNCTION public.document_template_html(jsonb, text),
  public.save_document_template(uuid, text, jsonb, text, text),
  public.request_document_edition(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_document_template(uuid, text, jsonb, text, text),
  public.request_document_edition(uuid, uuid, uuid, text, text) TO authenticated;

-- ─── Refus métier porteurs d'une clé (D-I18N-004, C-01) ───
-- HINT = clé canonique « errors:… » ; DETAIL = objet JSON des seuls paramètres publics.
-- Le texte français reste le message : il sert de repli partout où la clé n'est pas connue.
CREATE OR REPLACE FUNCTION public.require_posting_account(_tenant uuid, _role text, _set uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _a uuid := public.posting_account_for(_tenant, _role, _set);
BEGIN
  IF _a IS NULL THEN
    RAISE EXCEPTION 'Paramétrage comptable incomplet : %', public.posting_roles_label(ARRAY[_role])
      USING ERRCODE = 'QG001', HINT = 'errors:posting.account_missing',
            DETAIL = jsonb_build_object('roles', jsonb_build_array(_role))::text;
  END IF;
  RETURN _a;
END $$;

-- Émission d'une facture client : même corps que V105, le refus QG001 porte désormais la clé et ses paramètres.
CREATE OR REPLACE FUNCTION public.on_ar_invoice_posted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _entry_id uuid; _entry_number text; _line uuid;
  _ar uuid; _rev uuid; _vat uuid;
  _has_lines boolean;
  _manquants text[] := '{}';
  _g record;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('sent','open','posted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  _has_lines := EXISTS (SELECT 1 FROM public.ar_invoice_lines WHERE invoice_id = NEW.id);
  _ar  := public.posting_account_for(NEW.tenant_id, 'AR_RECEIVABLE', public.customer_account_set(NEW.customer_id));
  _rev := public.posting_account_for(NEW.tenant_id, 'SALES_REVENUE', public.customer_account_set(NEW.customer_id));
  _vat := public.posting_account(NEW.tenant_id, 'VAT_OUTPUT');

  IF _ar IS NULL THEN _manquants := _manquants || 'AR_RECEIVABLE'::text; END IF;
  -- Le rôle Ventes n'est requis que si une ligne (ou l'en-tête) n'a pas son propre compte.
  IF _rev IS NULL AND (NOT _has_lines OR EXISTS (
       SELECT 1 FROM public.ar_invoice_lines WHERE invoice_id = NEW.id AND revenue_account_id IS NULL)) THEN
    _manquants := _manquants || 'SALES_REVENUE'::text;
  END IF;
  -- Même logique pour la TVA : requise si un montant de TVA n'a pas de compte propre.
  IF _vat IS NULL AND (
       (NOT _has_lines AND COALESCE(NEW.tax_amount,0) > 0)
    OR EXISTS (SELECT 1 FROM public.ar_invoice_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
               WHERE l.invoice_id = NEW.id AND l.tax_amount > 0 AND t.gl_account_id IS NULL)) THEN
    _manquants := _manquants || 'VAT_OUTPUT'::text;
  END IF;
  IF cardinality(_manquants) > 0 THEN
    RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; la facture % ne peut pas être émise',
      public.posting_roles_label(_manquants), NEW.invoice_number
      USING ERRCODE = 'QG001',
            HINT = 'errors:posting.account_missing',
            DETAIL = jsonb_build_object('roles', to_jsonb(_manquants), 'document', NEW.invoice_number)::text;
  END IF;

  _entry_number := 'JE-AR-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, _entry_number, NEW.invoice_date, 'AR Invoice: '||NEW.invoice_number, 'ar_invoice', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _ar, NEW.total, 0, 'DR Clients');

  IF _has_lines THEN
    -- Produits : une ligne d'écriture par compte de vente.
    FOR _g IN
      SELECT COALESCE(l.revenue_account_id, _rev) AS account, SUM(l.net_amount) AS amount
      FROM public.ar_invoice_lines l WHERE l.invoice_id = NEW.id
      GROUP BY 1 HAVING SUM(l.net_amount) <> 0 ORDER BY 1
    LOOP
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _g.account, 0, _g.amount, 'CR Ventes HT')
      RETURNING id INTO _line;
      PERFORM public.impute_ar_revenue_line(_line, NEW);
    END LOOP;
    -- TVA : une ligne d'écriture par compte de TVA.
    FOR _g IN
      SELECT COALESCE(t.gl_account_id, _vat) AS account, SUM(l.tax_amount) AS amount
      FROM public.ar_invoice_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
      WHERE l.invoice_id = NEW.id AND l.tax_amount > 0
      GROUP BY 1 ORDER BY 1
    LOOP
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _g.account, 0, _g.amount, 'CR TVA collectée');
    END LOOP;
  ELSE
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _rev, 0, NEW.subtotal, 'CR Ventes HT')
    RETURNING id INTO _line;
    PERFORM public.impute_ar_revenue_line(_line, NEW);
    IF COALESCE(NEW.tax_amount,0) > 0 THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _vat, 0, NEW.tax_amount, 'CR TVA collectée');
    END IF;
  END IF;

  UPDATE public.journal_entries
    SET status = 'posted', posted_by = NEW.created_by, posted_at = now()
    WHERE id = _entry_id;

  NEW.journal_entry_id := _entry_id;
  RETURN NEW;
END; $function$;

SELECT public.install_tenant_isolation_triggers();
NOTIFY pgrst, 'reload schema';
