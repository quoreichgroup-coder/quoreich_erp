-- V64 — Plan comptable, lot PC-3 (livrable docs/audit-erp/12) : référentiels versionnés et règles de
-- qualité en données ; moteur de contrôle générique ; PCG ajouté.
--
-- 1. accounting_frameworks : nature (légal, ERP, groupe, personnalisé) et pays ; framework_versions
--    (version, date d'application, brouillon / publiée / archivée).
-- 2. Données de référence par référentiel (les tables syscohada_* de V60 restent, inchangées) :
--    framework_reference_accounts, framework_keyword_hints, framework_role_expectations (classes
--    attendues des imputations automatiques), framework_quality_rules (règles, gravité, activation,
--    paramètres — dont le motif des codes) et tenant_quality_rules (activation / gravité par société).
-- 3. chart_of_accounts_issues, la garde des codes de compte et la création des regroupements lisent le
--    référentiel du plan opérationnel de la société : aucune règle propre à SYSCOHADA dans le code.
--    Le motif des codes n'est plus imposé par le code (V60 : chiffres seulement) mais par la règle
--    CODE_FORMAT du référentiel, que la société peut désactiver.
-- 4. Référentiel PCG_FR (plan comptable général français, version 2025) : comptes de référence,
--    comptes et rôles par défaut (411, 707, 44571, 512, 401, 44566, 607, 4191, 37, 6037, 641, 645,
--    421, 431, 4421), indices, classes attendues — à valider par l'expert-comptable.
-- 5. apply_accounting_framework_to renseigne le référentiel et la version du plan opérationnel.

-- ─── 1. Référentiels versionnés ───
ALTER TABLE public.accounting_frameworks
  ADD COLUMN kind text NOT NULL DEFAULT 'legal' CHECK (kind IN ('legal', 'erp', 'group', 'custom')),
  ADD COLUMN country text,
  ADD COLUMN short_label text;
UPDATE public.accounting_frameworks SET country = 'OHADA', short_label = 'SYSCOHADA' WHERE code = 'SYSCOHADA_REVISE';

CREATE TABLE public.framework_versions (
  framework_code text NOT NULL REFERENCES public.accounting_frameworks(code),
  version text NOT NULL,
  effective_from date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  notes text,
  PRIMARY KEY (framework_code, version)
);

INSERT INTO public.accounting_frameworks (code, name, scope, version, is_validated, notes, kind, country, short_label)
SELECT 'PCG_FR', 'Plan comptable général (France)', 'Entreprises soumises au règlement ANC 2014-03', '2025', false,
       'Comptes principaux ; à valider par l''expert-comptable', 'legal', 'FR', 'PCG'
 WHERE NOT EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = 'PCG_FR');
INSERT INTO public.framework_versions (framework_code, version, effective_from, status, notes)
SELECT f.code, v.version, v.d::date, 'published', v.n
  FROM (VALUES ('SYSCOHADA_REVISE', '2017', '2018-01-01', 'Acte uniforme relatif au droit comptable et à l''information financière'),
               ('PCG_FR', '2025', '2025-01-01', 'Règlement ANC 2014-03 modifié')) AS v(code, version, d, n)
  JOIN public.accounting_frameworks f ON f.code = v.code;

-- ─── 2. Données de référence par référentiel ───
CREATE TABLE public.framework_reference_accounts (
  framework_code text NOT NULL REFERENCES public.accounting_frameworks(code),
  code text NOT NULL CHECK (code ~ '^[0-9A-Za-z]+$'),
  name text NOT NULL,
  account_type text CHECK (account_type IS NULL OR account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  PRIMARY KEY (framework_code, code)
);
CREATE TABLE public.framework_keyword_hints (
  framework_code text NOT NULL,
  pattern text NOT NULL,
  code text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  PRIMARY KEY (framework_code, pattern),
  FOREIGN KEY (framework_code, code) REFERENCES public.framework_reference_accounts (framework_code, code)
);
CREATE TABLE public.framework_role_expectations (
  framework_code text NOT NULL REFERENCES public.accounting_frameworks(code),
  role_code text NOT NULL REFERENCES public.posting_roles(code),
  prefixes text[] NOT NULL,
  PRIMARY KEY (framework_code, role_code)
);
CREATE TABLE public.framework_quality_rules (
  framework_code text NOT NULL REFERENCES public.accounting_frameworks(code),
  rule_code text NOT NULL CHECK (rule_code ~ '^[A-Z_]+$'),
  label text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  enabled boolean NOT NULL DEFAULT true,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (framework_code, rule_code)
);
CREATE TABLE public.tenant_quality_rules (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_code text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  severity text CHECK (severity IN ('error', 'warning', 'info')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, rule_code)
);

DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['framework_versions', 'framework_reference_accounts', 'framework_keyword_hints', 'framework_role_expectations', 'framework_quality_rules'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('CREATE POLICY "Lecture du référentiel" ON public.%I FOR SELECT TO authenticated USING (true)', _t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', _t);
  END LOOP;
END $$;
ALTER TABLE public.tenant_quality_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.tenant_quality_rules FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.tenant_quality_rules FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart_admin'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart_admin'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_quality_rules TO authenticated;

-- SYSCOHADA : reprise des données de V60.
INSERT INTO public.framework_reference_accounts (framework_code, code, name, account_type)
SELECT 'SYSCOHADA_REVISE', code, name, account_type FROM public.syscohada_reference_accounts;
INSERT INTO public.framework_keyword_hints (framework_code, pattern, code, priority)
SELECT 'SYSCOHADA_REVISE', pattern, code, priority FROM public.syscohada_keyword_hints;
INSERT INTO public.framework_role_expectations (framework_code, role_code, prefixes)
SELECT 'SYSCOHADA_REVISE', code, expected_prefixes FROM public.posting_roles WHERE expected_prefixes IS NOT NULL;

-- Règles communes aux référentiels livrés.
INSERT INTO public.framework_quality_rules (framework_code, rule_code, label, severity, params)
SELECT f.code, r.rule_code, r.label, r.severity, r.params::jsonb
  FROM (VALUES ('SYSCOHADA_REVISE'), ('PCG_FR')) AS f(code)
 CROSS JOIN (VALUES
   ('CODE_FORMAT', 'Format du code de compte', 'error', '{"pattern": "^[1-9][0-9]*$"}'),
   ('CODE_OUTSIDE_PLAN', 'Code hors plan du référentiel', 'error', '{}'),
   ('TYPE_MISMATCH', 'Classe et type incohérents', 'error', '{}'),
   ('LABEL_MISMATCH', 'Intitulé différent du compte de référence', 'warning', '{}'),
   ('DUPLICATE_LABEL', 'Doublon d''intitulé', 'warning', '{}'),
   ('PARENT_MISMATCH', 'Compte parent incohérent', 'error', '{}'),
   ('UNLINKED_SUBACCOUNT', 'Sous-compte non rattaché', 'info', '{}'),
   ('ABNORMAL_BALANCE', 'Solde anormal', 'warning', '{}'),
   ('HEADER_POSTED', 'Compte de regroupement mouvementé', 'error', '{}'),
   ('ROLE_OUTSIDE_CLASS', 'Imputation automatique hors classe attendue', 'error', '{}')) AS r(rule_code, label, severity, params);

-- ─── 4. PCG ───
INSERT INTO public.framework_reference_accounts (framework_code, code, name, account_type) VALUES
  ('PCG_FR', '1', 'Comptes de capitaux', NULL), ('PCG_FR', '2', 'Comptes d''immobilisations', 'asset'), ('PCG_FR', '3', 'Comptes de stocks et en-cours', 'asset'),
  ('PCG_FR', '4', 'Comptes de tiers', NULL), ('PCG_FR', '5', 'Comptes financiers', NULL), ('PCG_FR', '6', 'Comptes de charges', 'expense'),
  ('PCG_FR', '7', 'Comptes de produits', 'revenue'),
  ('PCG_FR', '10', 'Capital et réserves', 'equity'), ('PCG_FR', '101', 'Capital', 'equity'), ('PCG_FR', '106', 'Réserves', 'equity'),
  ('PCG_FR', '108', 'Compte de l''exploitant', 'equity'), ('PCG_FR', '11', 'Report à nouveau', 'equity'), ('PCG_FR', '12', 'Résultat de l''exercice', 'equity'),
  ('PCG_FR', '13', 'Subventions d''investissement', 'equity'), ('PCG_FR', '14', 'Provisions réglementées', 'equity'),
  ('PCG_FR', '15', 'Provisions', 'liability'), ('PCG_FR', '16', 'Emprunts et dettes assimilées', 'liability'),
  ('PCG_FR', '164', 'Emprunts auprès des établissements de crédit', 'liability'), ('PCG_FR', '17', 'Dettes rattachées à des participations', 'liability'),
  ('PCG_FR', '18', 'Comptes de liaison des établissements et sociétés en participation', 'liability'),
  ('PCG_FR', '20', 'Immobilisations incorporelles', 'asset'), ('PCG_FR', '205', 'Concessions, brevets, licences, logiciels', 'asset'),
  ('PCG_FR', '207', 'Fonds commercial', 'asset'), ('PCG_FR', '21', 'Immobilisations corporelles', 'asset'), ('PCG_FR', '211', 'Terrains', 'asset'),
  ('PCG_FR', '213', 'Constructions', 'asset'), ('PCG_FR', '215', 'Installations techniques, matériel et outillage industriels', 'asset'),
  ('PCG_FR', '218', 'Autres immobilisations corporelles', 'asset'), ('PCG_FR', '23', 'Immobilisations en cours', 'asset'),
  ('PCG_FR', '26', 'Participations et créances rattachées', 'asset'), ('PCG_FR', '27', 'Autres immobilisations financières', 'asset'),
  ('PCG_FR', '28', 'Amortissements des immobilisations', 'asset'), ('PCG_FR', '29', 'Dépréciations des immobilisations', 'asset'),
  ('PCG_FR', '31', 'Matières premières et fournitures', 'asset'), ('PCG_FR', '33', 'En-cours de production de biens', 'asset'),
  ('PCG_FR', '35', 'Stocks de produits', 'asset'), ('PCG_FR', '37', 'Stocks de marchandises', 'asset'), ('PCG_FR', '39', 'Dépréciations des stocks et en-cours', 'asset'),
  ('PCG_FR', '40', 'Fournisseurs et comptes rattachés', 'liability'), ('PCG_FR', '401', 'Fournisseurs', 'liability'),
  ('PCG_FR', '404', 'Fournisseurs d''immobilisations', 'liability'), ('PCG_FR', '408', 'Fournisseurs, factures non parvenues', 'liability'),
  ('PCG_FR', '409', 'Fournisseurs débiteurs', 'asset'),
  ('PCG_FR', '41', 'Clients et comptes rattachés', 'asset'), ('PCG_FR', '411', 'Clients', 'asset'), ('PCG_FR', '416', 'Clients douteux ou litigieux', 'asset'),
  ('PCG_FR', '418', 'Clients, produits non encore facturés', 'asset'), ('PCG_FR', '419', 'Clients créditeurs', 'liability'),
  ('PCG_FR', '4191', 'Clients, avances et acomptes reçus sur commandes', 'liability'),
  ('PCG_FR', '42', 'Personnel et comptes rattachés', 'liability'), ('PCG_FR', '421', 'Personnel, rémunérations dues', 'liability'),
  ('PCG_FR', '425', 'Personnel, avances et acomptes', 'asset'),
  ('PCG_FR', '43', 'Sécurité sociale et autres organismes sociaux', 'liability'), ('PCG_FR', '431', 'Sécurité sociale', 'liability'),
  ('PCG_FR', '44', 'État et autres collectivités publiques', NULL), ('PCG_FR', '442', 'Contributions, impôts et taxes recouvrés pour le compte de l''État', 'liability'),
  ('PCG_FR', '4421', 'Prélèvements à la source (impôt sur le revenu)', 'liability'), ('PCG_FR', '444', 'État, impôts sur les bénéfices', NULL),
  ('PCG_FR', '445', 'État, taxes sur le chiffre d''affaires', NULL), ('PCG_FR', '4456', 'Taxes sur le chiffre d''affaires déductibles', 'asset'),
  ('PCG_FR', '44562', 'TVA sur immobilisations', 'asset'), ('PCG_FR', '44566', 'TVA sur autres biens et services', 'asset'),
  ('PCG_FR', '4457', 'Taxes sur le chiffre d''affaires collectées', 'liability'), ('PCG_FR', '44571', 'TVA collectée', 'liability'),
  ('PCG_FR', '45', 'Groupe et associés', NULL), ('PCG_FR', '455', 'Associés, comptes courants', 'liability'),
  ('PCG_FR', '46', 'Débiteurs divers et créditeurs divers', NULL), ('PCG_FR', '47', 'Comptes transitoires ou d''attente', NULL),
  ('PCG_FR', '476', 'Différences de conversion – actif', 'asset'), ('PCG_FR', '477', 'Différences de conversion – passif', 'liability'),
  ('PCG_FR', '48', 'Comptes de régularisation', NULL), ('PCG_FR', '486', 'Charges constatées d''avance', 'asset'),
  ('PCG_FR', '487', 'Produits constatés d''avance', 'liability'), ('PCG_FR', '49', 'Dépréciations des comptes de tiers', 'asset'),
  ('PCG_FR', '50', 'Valeurs mobilières de placement', 'asset'), ('PCG_FR', '51', 'Banques, établissements financiers et assimilés', NULL),
  ('PCG_FR', '512', 'Banques', NULL), ('PCG_FR', '53', 'Caisse', 'asset'), ('PCG_FR', '530', 'Caisse', 'asset'),
  ('PCG_FR', '58', 'Virements internes', 'asset'), ('PCG_FR', '59', 'Dépréciations des comptes financiers', 'asset'),
  ('PCG_FR', '60', 'Achats', 'expense'), ('PCG_FR', '601', 'Achats stockés, matières premières et fournitures', 'expense'),
  ('PCG_FR', '603', 'Variations des stocks', 'expense'), ('PCG_FR', '6037', 'Variation des stocks de marchandises', 'expense'),
  ('PCG_FR', '604', 'Achats d''études et prestations de services', 'expense'), ('PCG_FR', '606', 'Achats non stockés de matières et fournitures', 'expense'),
  ('PCG_FR', '607', 'Achats de marchandises', 'expense'),
  ('PCG_FR', '61', 'Services extérieurs', 'expense'), ('PCG_FR', '613', 'Locations', 'expense'), ('PCG_FR', '615', 'Entretien et réparations', 'expense'),
  ('PCG_FR', '616', 'Primes d''assurances', 'expense'), ('PCG_FR', '62', 'Autres services extérieurs', 'expense'),
  ('PCG_FR', '622', 'Rémunérations d''intermédiaires et honoraires', 'expense'), ('PCG_FR', '623', 'Publicité, publications, relations publiques', 'expense'),
  ('PCG_FR', '625', 'Déplacements, missions et réceptions', 'expense'), ('PCG_FR', '626', 'Frais postaux et de télécommunications', 'expense'),
  ('PCG_FR', '627', 'Services bancaires et assimilés', 'expense'), ('PCG_FR', '63', 'Impôts, taxes et versements assimilés', 'expense'),
  ('PCG_FR', '64', 'Charges de personnel', 'expense'), ('PCG_FR', '641', 'Rémunérations du personnel', 'expense'),
  ('PCG_FR', '645', 'Charges de sécurité sociale et de prévoyance', 'expense'), ('PCG_FR', '65', 'Autres charges de gestion courante', 'expense'),
  ('PCG_FR', '66', 'Charges financières', 'expense'), ('PCG_FR', '661', 'Charges d''intérêts', 'expense'),
  ('PCG_FR', '666', 'Pertes de change financières', 'expense'), ('PCG_FR', '67', 'Charges exceptionnelles', 'expense'),
  ('PCG_FR', '68', 'Dotations aux amortissements, dépréciations et provisions', 'expense'),
  ('PCG_FR', '69', 'Participation des salariés, impôts sur les bénéfices et assimilés', 'expense'), ('PCG_FR', '695', 'Impôts sur les bénéfices', 'expense'),
  ('PCG_FR', '70', 'Ventes de produits fabriqués, prestations de services, marchandises', 'revenue'), ('PCG_FR', '701', 'Ventes de produits finis', 'revenue'),
  ('PCG_FR', '706', 'Prestations de services', 'revenue'), ('PCG_FR', '707', 'Ventes de marchandises', 'revenue'),
  ('PCG_FR', '708', 'Produits des activités annexes', 'revenue'), ('PCG_FR', '71', 'Production stockée (ou déstockage)', 'revenue'),
  ('PCG_FR', '72', 'Production immobilisée', 'revenue'), ('PCG_FR', '74', 'Subventions d''exploitation', 'revenue'),
  ('PCG_FR', '75', 'Autres produits de gestion courante', 'revenue'), ('PCG_FR', '76', 'Produits financiers', 'revenue'),
  ('PCG_FR', '766', 'Gains de change financiers', 'revenue'), ('PCG_FR', '77', 'Produits exceptionnels', 'revenue'),
  ('PCG_FR', '78', 'Reprises sur amortissements, dépréciations et provisions', 'revenue');

INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT 'PCG_FR', r.code, r.name, COALESCE(r.account_type, 'asset')
  FROM public.framework_reference_accounts r
 WHERE r.framework_code = 'PCG_FR' AND r.code IN ('411', '707', '44571', '512', '401', '44566', '607', '4191', '37', '6037', '641', '645', '421', '431', '4421');
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT 'PCG_FR', v.r, v.c FROM (VALUES
  ('AR_RECEIVABLE', '411'), ('SALES_REVENUE', '707'), ('VAT_OUTPUT', '44571'), ('BANK', '512'), ('AP_PAYABLE', '401'),
  ('VAT_INPUT', '44566'), ('PURCHASES', '607'), ('CUSTOMER_ADVANCE', '4191'), ('INVENTORY', '37'), ('STOCK_VARIATION', '6037'),
  ('PAYROLL_SALARIES', '641'), ('PAYROLL_EMPLOYER_CHARGES', '645'), ('PAYROLL_NET_PAYABLE', '421'), ('PAYROLL_SOCIAL', '431'),
  ('PAYROLL_TAX', '4421')) AS v(r, c);
INSERT INTO public.framework_role_expectations (framework_code, role_code, prefixes) VALUES
  ('PCG_FR', 'AR_RECEIVABLE', ARRAY['41']), ('PCG_FR', 'SALES_REVENUE', ARRAY['70']), ('PCG_FR', 'VAT_OUTPUT', ARRAY['4457']),
  ('PCG_FR', 'BANK', ARRAY['51', '53']), ('PCG_FR', 'AP_PAYABLE', ARRAY['40']), ('PCG_FR', 'VAT_INPUT', ARRAY['4456']),
  ('PCG_FR', 'PURCHASES', ARRAY['60']), ('PCG_FR', 'CUSTOMER_ADVANCE', ARRAY['419']), ('PCG_FR', 'INVENTORY', ARRAY['3']),
  ('PCG_FR', 'STOCK_VARIATION', ARRAY['603']), ('PCG_FR', 'PAYROLL_SALARIES', ARRAY['64']), ('PCG_FR', 'PAYROLL_EMPLOYER_CHARGES', ARRAY['64']),
  ('PCG_FR', 'PAYROLL_NET_PAYABLE', ARRAY['42']), ('PCG_FR', 'PAYROLL_SOCIAL', ARRAY['43']), ('PCG_FR', 'PAYROLL_TAX', ARRAY['44']);
INSERT INTO public.framework_keyword_hints (framework_code, pattern, code, priority) VALUES
  ('PCG_FR', 'tva (collectee|facturee)', '44571', 10), ('PCG_FR', 'tva (deductible|recuperable)', '44566', 10),
  ('PCG_FR', 'ventes? de marchandises', '707', 20), ('PCG_FR', 'prestations? de services', '706', 20), ('PCG_FR', 'achats? de marchandises', '607', 20),
  ('PCG_FR', 'stocks? de marchandises', '37', 15), ('PCG_FR', 'charges sociales|securite sociale', '645', 25), ('PCG_FR', 'salaires|remunerations|charges de personnel', '641', 30),
  ('PCG_FR', 'loyers?|locations?', '613', 30), ('PCG_FR', 'honoraires', '622', 30), ('PCG_FR', 'capital', '101', 40), ('PCG_FR', 'caisse', '530', 40),
  ('PCG_FR', 'banque', '512', 40), ('PCG_FR', 'clients?', '411', 50), ('PCG_FR', 'fournisseurs?', '401', 50);

-- ─── 3. Moteur générique ───
CREATE OR REPLACE FUNCTION public.chart_framework(_tenant uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT c.framework_code FROM public.charts c WHERE c.tenant_id = _tenant AND c.kind = 'operational' AND c.status = 'active'),
    (SELECT s.framework_code FROM public.tenant_accounting_settings s WHERE s.tenant_id = _tenant),
    'SYSCOHADA_REVISE')
$function$;
REVOKE ALL ON FUNCTION public.chart_framework(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chart_framework(uuid) TO authenticated;

-- Gravité effective d'une règle pour la société (NULL = règle désactivée).
CREATE OR REPLACE FUNCTION public.quality_rule_severity(_tenant uuid, _framework text, _rule text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN t.tenant_id IS NOT NULL AND NOT t.enabled THEN NULL
    WHEN t.tenant_id IS NOT NULL AND t.severity IS NOT NULL THEN t.severity
    WHEN r.framework_code IS NULL OR NOT r.enabled THEN CASE WHEN t.tenant_id IS NOT NULL AND t.enabled THEN COALESCE(t.severity, 'warning') END
    ELSE r.severity END
  FROM (SELECT 1) x
  LEFT JOIN public.framework_quality_rules r ON r.framework_code = _framework AND r.rule_code = _rule
  LEFT JOIN public.tenant_quality_rules t ON t.tenant_id = _tenant AND t.rule_code = _rule
$function$;
REVOKE ALL ON FUNCTION public.quality_rule_severity(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quality_rule_severity(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.framework_reference_of(_framework text, _code text)
 RETURNS public.framework_reference_accounts
 LANGUAGE sql
 STABLE
AS $function$
  SELECT r.* FROM public.framework_reference_accounts r
   WHERE r.framework_code = _framework AND _code LIKE r.code || '%' ORDER BY length(r.code) DESC LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.chart_of_accounts_issues()
 RETURNS TABLE (account_id uuid, code text, name text, severity text, issue text, detail text,
                suggested_code text, suggested_name text, suggested_type text, lines bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _fw text; _fw_name text; _sev text; _pattern text;
  _a record; _ref public.framework_reference_accounts%ROWTYPE; _typed public.framework_reference_accounts%ROWTYPE;
  _hint record; _n bigint; _parent text; _solde numeric;
BEGIN
  IF _tenant IS NULL THEN RETURN; END IF;
  _fw := public.chart_framework(_tenant);
  SELECT COALESCE(f.short_label, f.name) INTO _fw_name FROM public.accounting_frameworks f WHERE f.code = _fw;
  SELECT r.params ->> 'pattern' INTO _pattern FROM public.framework_quality_rules r WHERE r.framework_code = _fw AND r.rule_code = 'CODE_FORMAT';

  FOR _a IN SELECT * FROM public.gl_accounts g WHERE g.tenant_id = _tenant AND g.is_active ORDER BY g.code LOOP
    SELECT count(*) INTO _n FROM public.journal_lines l WHERE l.account_id = _a.id;
    _ref := public.framework_reference_of(_fw, _a.code);
    SELECT r.* INTO _typed FROM public.framework_reference_accounts r
     WHERE r.framework_code = _fw AND _a.code LIKE r.code || '%' AND r.account_type IS NOT NULL ORDER BY length(r.code) DESC LIMIT 1;
    _hint := NULL;
    SELECT h.code AS hcode, r.name AS hname, r.account_type AS htype INTO _hint
      FROM public.framework_keyword_hints h JOIN public.framework_reference_accounts r ON r.framework_code = h.framework_code AND r.code = h.code
     WHERE h.framework_code = _fw AND public.normalize_account_label(_a.name) ~ h.pattern ORDER BY h.priority, length(h.code) DESC LIMIT 1;

    _sev := public.quality_rule_severity(_tenant, _fw, 'CODE_FORMAT');
    IF _sev IS NOT NULL AND _pattern IS NOT NULL AND _a.code !~ _pattern THEN
      account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Format du code de compte';
      detail := 'Le code ne respecte pas le format du référentiel ' || COALESCE(_fw_name, _fw);
      suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
    END IF;

    IF _ref.code IS NULL OR (length(_ref.code) = 1 AND _a.code <> _ref.code) THEN
      _sev := public.quality_rule_severity(_tenant, _fw, 'CODE_OUTSIDE_PLAN');
      IF _sev IS NOT NULL THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Code hors plan ' || COALESCE(_fw_name, _fw);
        detail := 'Aucun compte du référentiel ne correspond au préfixe ' || left(_a.code, 2);
        suggested_code := _hint.hcode; suggested_name := _hint.hname; suggested_type := COALESCE(_hint.htype, _a.account_type); lines := _n; RETURN NEXT;
      END IF;
    ELSE
      IF (_ref.account_type IS NULL AND _a.account_type NOT IN ('asset', 'liability'))
         OR (_ref.account_type IS NOT NULL AND _a.account_type <> _ref.account_type)
         OR (_ref.account_type IS NULL AND _typed.code IS NOT NULL AND length(_typed.code) > 1 AND _typed.account_type <> _a.account_type) THEN
        _sev := public.quality_rule_severity(_tenant, _fw, 'TYPE_MISMATCH');
        IF _sev IS NOT NULL THEN
          account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Classe et type incohérents';
          detail := 'Le compte ' || _ref.code || ' « ' || _ref.name || ' » du référentiel est de type ' || COALESCE(_ref.account_type, 'actif ou passif')
            || ', le compte est déclaré ' || _a.account_type;
          suggested_code := _hint.hcode; suggested_name := _hint.hname; suggested_type := COALESCE(_hint.htype, _a.account_type); lines := _n; RETURN NEXT;
        END IF;
      ELSIF NOT public.labels_compatible(_a.name, _ref.name) THEN
        _sev := public.quality_rule_severity(_tenant, _fw, 'LABEL_MISMATCH');
        IF _sev IS NOT NULL THEN
          account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Intitulé différent du compte ' || COALESCE(_fw_name, _fw);
          detail := 'Le code ' || _a.code || ' relève de ' || _ref.code || ' « ' || _ref.name || ' »';
          suggested_code := _hint.hcode; suggested_name := _hint.hname; suggested_type := COALESCE(_hint.htype, _a.account_type); lines := _n; RETURN NEXT;
        END IF;
      END IF;
    END IF;

    _sev := public.quality_rule_severity(_tenant, _fw, 'DUPLICATE_LABEL');
    IF _sev IS NOT NULL AND EXISTS (SELECT 1 FROM public.gl_accounts o WHERE o.tenant_id = _tenant AND o.is_active AND o.id <> _a.id
                AND public.normalize_account_label(o.name) = public.normalize_account_label(_a.name)) THEN
      account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Doublon d''intitulé';
      SELECT string_agg(o.code, ', ' ORDER BY o.code) INTO detail FROM public.gl_accounts o
       WHERE o.tenant_id = _tenant AND o.is_active AND o.id <> _a.id AND public.normalize_account_label(o.name) = public.normalize_account_label(_a.name);
      detail := 'Même intitulé que ' || detail; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
    END IF;

    IF _a.parent_id IS NOT NULL THEN
      SELECT p.code INTO _parent FROM public.gl_accounts p WHERE p.id = _a.parent_id;
      _sev := public.quality_rule_severity(_tenant, _fw, 'PARENT_MISMATCH');
      IF _sev IS NOT NULL AND NOT (_a.code LIKE _parent || '%') THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Compte parent incohérent';
        detail := 'Parent ' || _parent || ' qui n''est pas un préfixe du code'; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.gl_accounts p WHERE p.tenant_id = _tenant AND p.id <> _a.id AND _a.code LIKE p.code || '%' AND length(p.code) < length(_a.code)) THEN
      _sev := public.quality_rule_severity(_tenant, _fw, 'UNLINKED_SUBACCOUNT');
      IF _sev IS NOT NULL THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Sous-compte non rattaché';
        detail := 'Un compte de regroupement existe : lancer « Rattacher les sous-comptes »'; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
      END IF;
    END IF;

    IF _n > 0 AND NOT _a.is_header THEN
      _sev := public.quality_rule_severity(_tenant, _fw, 'ABNORMAL_BALANCE');
      IF _sev IS NOT NULL THEN
        SELECT COALESCE(sum(l.debit - l.credit), 0) INTO _solde FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.entry_id
         WHERE l.account_id = _a.id AND e.status IN ('posted', 'reversed');
        IF (_a.normal_balance = 'debit' AND _solde < 0) OR (_a.normal_balance = 'credit' AND _solde > 0) THEN
          account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Solde anormal';
          detail := 'Solde ' || CASE WHEN _solde < 0 THEN 'créditeur ' ELSE 'débiteur ' END || to_char(abs(_solde), 'FM999G999G999G990D00')
            || ' pour un compte de sens normal ' || CASE _a.normal_balance WHEN 'debit' THEN 'débiteur' ELSE 'créditeur' END;
          suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
        END IF;
      END IF;
    END IF;

    IF _a.is_header AND _n > 0 THEN
      _sev := public.quality_rule_severity(_tenant, _fw, 'HEADER_POSTED');
      IF _sev IS NOT NULL THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Compte de regroupement mouvementé';
        detail := _n || ' ligne(s) d''écriture sur un compte non imputable'; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
      END IF;
    END IF;
  END LOOP;

  _sev := public.quality_rule_severity(_tenant, _fw, 'ROLE_OUTSIDE_CLASS');
  IF _sev IS NULL THEN RETURN; END IF;
  FOR _a IN
    SELECT g.id, g.code, g.name, r.code AS role, r.label, x.prefixes
      FROM public.tenant_posting_accounts t JOIN public.posting_roles r ON r.code = t.role_code
      JOIN public.framework_role_expectations x ON x.framework_code = _fw AND x.role_code = r.code
      JOIN public.gl_accounts g ON g.id = t.gl_account_id
     WHERE t.tenant_id = _tenant AND NOT EXISTS (SELECT 1 FROM unnest(x.prefixes) p WHERE g.code LIKE p || '%')
  LOOP
    SELECT count(*) INTO _n FROM public.journal_lines l WHERE l.account_id = _a.id;
    account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Imputation automatique hors classe attendue';
    detail := 'Le rôle « ' || _a.label || ' » attend un compte ' || array_to_string(_a.prefixes, ' ou ') || 'x';
    suggested_code := NULL; suggested_name := NULL; suggested_type := NULL;
    SELECT r.code, r.name, r.account_type INTO suggested_code, suggested_name, suggested_type
      FROM public.framework_reference_accounts r WHERE r.framework_code = _fw AND r.code = (
        SELECT d.account_code FROM public.accounting_framework_role_defaults d WHERE d.framework_code = _fw AND d.role_code = _a.role);
    lines := _n; RETURN NEXT;
  END LOOP;
END $function$;

-- Regroupements : depuis le référentiel du plan (et non plus SYSCOHADA en dur).
CREATE OR REPLACE FUNCTION public.create_syscohada_headings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.require_chart_right();
  _fw text := public.chart_framework(_tenant);
  _n integer;
BEGIN
  WITH besoins AS (
    SELECT DISTINCT r.code, r.name, r.account_type
      FROM public.gl_accounts g
      JOIN public.framework_reference_accounts r ON r.framework_code = _fw AND g.code LIKE r.code || '%' AND length(r.code) < length(g.code)
     WHERE g.tenant_id = _tenant AND g.is_active AND NOT g.is_header
       AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts_issues() i WHERE i.account_id = g.id AND i.severity = 'error')
  )
  INSERT INTO public.gl_accounts (tenant_id, code, name, account_type, is_header)
  SELECT _tenant, b.code, b.name,
         COALESCE(b.account_type, CASE WHEN b.code LIKE '4%' OR b.code LIKE '5%' THEN 'asset' WHEN b.code LIKE '1%' THEN 'liability' ELSE 'expense' END), true
    FROM besoins b
   WHERE NOT EXISTS (SELECT 1 FROM public.gl_accounts e WHERE e.tenant_id = _tenant AND e.code = b.code);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $function$;

-- Garde des comptes : le format du code vient de la règle CODE_FORMAT du référentiel (désactivable).
CREATE OR REPLACE FUNCTION public.guard_gl_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _app boolean := current_user IN ('authenticated', 'anon', 'qerp_api');
  _used boolean;
  _parent_code text;
  _fw text;
  _pattern text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.journal_lines WHERE account_id = OLD.id) THEN
      RAISE EXCEPTION 'Compte % mouvementé : il ne se supprime pas (désactivez-le ou remplacez-le)', OLD.code USING ERRCODE = 'QG019';
    END IF;
    RETURN OLD;
  END IF;
  IF _app AND (TG_OP = 'INSERT' OR NEW.code IS DISTINCT FROM OLD.code) THEN
    _fw := public.chart_framework(NEW.tenant_id);
    IF public.quality_rule_severity(NEW.tenant_id, _fw, 'CODE_FORMAT') = 'error' THEN
      SELECT r.params ->> 'pattern' INTO _pattern FROM public.framework_quality_rules r WHERE r.framework_code = _fw AND r.rule_code = 'CODE_FORMAT';
      IF _pattern IS NOT NULL AND NEW.code !~ _pattern THEN
        RAISE EXCEPTION 'Code de compte « % » : format du référentiel non respecté (%)', NEW.code, _pattern
          USING ERRCODE = 'QG019', HINT = 'Le format se règle dans les règles de qualité du plan comptable.';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    _used := EXISTS (SELECT 1 FROM public.journal_lines WHERE account_id = OLD.id);
    IF _used AND (NEW.code IS DISTINCT FROM OLD.code OR NEW.account_type IS DISTINCT FROM OLD.account_type) THEN
      RAISE EXCEPTION 'Compte % mouvementé : son code et son type sont figés (l''historique en dépend) ; créer le compte correct et reclasser le solde', OLD.code
        USING ERRCODE = 'QG019';
    END IF;
    IF _used AND NEW.is_header AND NOT OLD.is_header THEN
      RAISE EXCEPTION 'Compte % mouvementé : il ne peut pas devenir un compte de regroupement', OLD.code USING ERRCODE = 'QG019';
    END IF;
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT code INTO _parent_code FROM public.gl_accounts WHERE id = NEW.parent_id AND tenant_id = NEW.tenant_id;
    IF _parent_code IS NULL OR NEW.parent_id = NEW.id OR NOT (NEW.code LIKE _parent_code || '%' AND length(NEW.code) > length(_parent_code)) THEN
      RAISE EXCEPTION 'Compte parent invalide pour % : le parent doit être un compte de la société dont le code est un préfixe (ex. 41 pour 411)', NEW.code
        USING ERRCODE = 'QG019';
    END IF;
  END IF;
  IF NEW.replaced_by = NEW.id THEN RAISE EXCEPTION 'Un compte ne se remplace pas par lui-même' USING ERRCODE = 'QG019'; END IF;
  RETURN NEW;
END $function$;

-- ─── 5. Le plan opérationnel porte le référentiel appliqué ───
CREATE OR REPLACE FUNCTION public.apply_accounting_framework_to(_tenant uuid, _framework text, _actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actuel text;
  _comptes int;
  _roles int;
  _chart uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = _framework) THEN
    RAISE EXCEPTION 'Référentiel comptable inconnu : %', _framework USING ERRCODE = '22023';
  END IF;
  SELECT framework_code INTO _actuel FROM public.tenant_accounting_settings WHERE tenant_id = _tenant;
  IF _actuel IS NOT NULL AND _actuel <> _framework THEN
    RAISE EXCEPTION 'La société applique déjà le référentiel % ; un changement de référentiel est une migration comptable, pas un paramètre', _actuel
      USING ERRCODE = '23514';
  END IF;

  _chart := public.operational_chart_id(_tenant);
  UPDATE public.charts SET framework_code = _framework,
         framework_version = (SELECT v.version FROM public.framework_versions v WHERE v.framework_code = _framework AND v.status = 'published'
                               ORDER BY v.effective_from DESC LIMIT 1), updated_at = now()
   WHERE id = _chart AND framework_code IS NULL;

  INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
  SELECT _tenant, a.code, a.name, a.account_type
  FROM public.accounting_framework_accounts a
  WHERE a.framework_code = _framework
  ON CONFLICT (tenant_id, code) DO NOTHING;
  GET DIAGNOSTICS _comptes = ROW_COUNT;

  INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id, updated_by)
  SELECT _tenant, d.role_code, g.id, _actor
  FROM public.accounting_framework_role_defaults d
  JOIN public.gl_accounts g ON g.tenant_id = _tenant AND g.code = d.account_code
  WHERE d.framework_code = _framework
  ON CONFLICT (tenant_id, role_code) DO NOTHING;
  GET DIAGNOSTICS _roles = ROW_COUNT;

  INSERT INTO public.tenant_accounting_settings (tenant_id, framework_code, applied_by)
  VALUES (_tenant, _framework, _actor)
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN jsonb_build_object('referentiel', _framework, 'comptes_crees', _comptes,
                            'roles_parametres', _roles);
END;
$function$;

-- Plans existants : référentiel déjà appliqué → version publiée.
UPDATE public.charts c SET framework_version = (SELECT v.version FROM public.framework_versions v WHERE v.framework_code = c.framework_code
                                                AND v.status = 'published' ORDER BY v.effective_from DESC LIMIT 1)
 WHERE c.framework_code IS NOT NULL AND c.framework_version IS NULL;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
