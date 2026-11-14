-- V60 — Plan comptable SYSCOHADA : protection, référentiel, contrôle de cohérence et corrections
-- non destructives (demande du propriétaire, 14 nov. 2026 : « analyse et corrige le paramétrage du
-- plan comptable SYSCOHADA … sans supprimer les comptes existants ni modifier les données
-- historiques … cohérence des écritures et des imputations automatiques »).
--
-- Constats (production, 14 nov.) :
--   · gl_accounts « FOR ALL » à tout membre : un lecteur pouvait renommer, retyper, supprimer un compte ;
--   · aucune contrainte sur account_type ; aucun compte parent renseigné ;
--   · un compte mouvementé pouvait changer de code ou de type (ce qui réécrit l'historique des états) ;
--   · plan de ROXGOLD SANGO hors structure SYSCOHADA (caisse et banques en classe 1, clients en 11/12,
--     fournisseurs et immobilisations en 20, ventes et produits financiers en classe 4, TVA en 431/432
--     = organismes sociaux, loyers en 61 = transports, dotations en 62, prestations en 71 = subventions…)
--     et doublons (Caisse ×2, Ventes de marchandises ×2, Charges de personnel ×2, Clients ×3,
--     Fournisseurs ×2) ; imputations automatiques Ventes → 4000 et TVA collectée → 4310.
--
-- Ce que fait V60 (aucune donnée de compte ni écriture existante n'est modifiée par la migration) :
--   1. droit accounting.chart (administrateur, comptable) pour écrire le plan ; types limités à
--      asset / liability / equity / revenue / expense ; compte mouvementé : code et type figés (QG019) ;
--      parent = compte de la société dont le code est un préfixe strict ; nouvelle ligne d'écriture
--      refusée sur un compte inactif ou de regroupement ;
--   2. référentiel syscohada_reference_accounts (classes, comptes à 2 chiffres, principaux sous-comptes)
--      et syscohada_keyword_hints (intitulé → compte proposé), modifiables comme données, non validés
--      par un expert-comptable ; posting_roles.expected_prefixes (classes attendues des imputations) ;
--   3. chart_of_accounts_issues() : anomalies du plan de la société (code hors plan, classe / type
--      incohérents, intitulé différent du compte SYSCOHADA, doublon, parent incohérent, imputation
--      automatique hors classe, regroupement mouvementé) avec la correction proposée ;
--   4. corrections non destructives (droit accounting.chart) : replace_gl_account (crée ou reprend le
--      compte SYSCOHADA, rattache l'ancien par replaced_by, le désactive, redirige les imputations
--      automatiques), create_syscohada_headings (comptes de regroupement), link_gl_account_parents,
--      reclassify_gl_account_balance (écriture OD nouvelle ; l'historique reste intact).
-- Erreurs métier : QG019.

-- ─── 1. Protection ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('accounting.chart', 'accounting', 'chart', 'Paramétrer le plan comptable')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, 'accounting.chart' FROM (VALUES ('admin'), ('accountant')) AS v(r)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code = 'accounting.chart' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

ALTER TABLE public.gl_accounts
  ADD CONSTRAINT gl_accounts_account_type_check CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  ADD COLUMN is_header boolean NOT NULL DEFAULT false,
  ADD COLUMN replaced_by uuid,
  ADD CONSTRAINT gl_accounts_replaced_by_fkey FOREIGN KEY (replaced_by, tenant_id) REFERENCES public.gl_accounts (id, tenant_id);

DROP POLICY "Tenant isolation" ON public.gl_accounts;
CREATE POLICY "Lecture société" ON public.gl_accounts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.gl_accounts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart'));

CREATE OR REPLACE FUNCTION public.guard_gl_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _app boolean := current_user IN ('authenticated', 'anon', 'qerp_api');
  _used boolean;
  _parent_code text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.journal_lines WHERE account_id = OLD.id) THEN
      RAISE EXCEPTION 'Compte % mouvementé : il ne se supprime pas (désactivez-le ou remplacez-le)', OLD.code USING ERRCODE = 'QG019';
    END IF;
    RETURN OLD;
  END IF;
  IF _app AND NEW.code !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'Code de compte « % » : chiffres uniquement, commençant par la classe SYSCOHADA (1 à 9)', NEW.code USING ERRCODE = 'QG019';
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
CREATE TRIGGER trg_guard_gl_account BEFORE INSERT OR UPDATE OR DELETE ON public.gl_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_gl_account();

-- Nouvelle ligne : jamais sur un compte inactif ou de regroupement (l'historique n'est pas touché).
CREATE OR REPLACE FUNCTION public.guard_journal_line_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _a record;
BEGIN
  SELECT code, is_active, is_header INTO _a FROM public.gl_accounts WHERE id = NEW.account_id;
  IF _a.is_header THEN
    RAISE EXCEPTION 'Compte % : compte de regroupement, non imputable (choisir un sous-compte)', _a.code USING ERRCODE = 'QG019';
  END IF;
  IF NOT _a.is_active THEN
    RAISE EXCEPTION 'Compte % inactif : imputation refusée', _a.code USING ERRCODE = 'QG019';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_journal_line_account BEFORE INSERT ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_journal_line_account();

-- ─── 2. Référentiel SYSCOHADA révisé (données, à valider par l'expert-comptable) ───
CREATE TABLE public.syscohada_reference_accounts (
  code text PRIMARY KEY CHECK (code ~ '^[1-9][0-9]*$'),
  name text NOT NULL,
  account_type text CHECK (account_type IS NULL OR account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense'))
);
COMMENT ON COLUMN public.syscohada_reference_accounts.account_type IS 'NULL : compte mixte (débiteur ou créditeur selon le solde : actif ou passif).';
ALTER TABLE public.syscohada_reference_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture du référentiel" ON public.syscohada_reference_accounts FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.syscohada_reference_accounts TO authenticated;

INSERT INTO public.syscohada_reference_accounts (code, name, account_type) VALUES
  -- Classes
  ('1', 'Comptes de ressources durables', NULL), ('2', 'Comptes d''actif immobilisé', 'asset'), ('3', 'Comptes de stocks', 'asset'),
  ('4', 'Comptes de tiers', NULL), ('5', 'Comptes de trésorerie', NULL), ('6', 'Comptes de charges des activités ordinaires', 'expense'),
  ('7', 'Comptes de produits des activités ordinaires', 'revenue'), ('8', 'Comptes des autres charges et des autres produits', NULL),
  -- Classe 1
  ('10', 'Capital', 'equity'), ('101', 'Capital social', 'equity'), ('104', 'Compte de l''exploitant', 'equity'), ('106', 'Écarts de réévaluation', 'equity'),
  ('11', 'Réserves', 'equity'), ('111', 'Réserve légale', 'equity'), ('118', 'Autres réserves', 'equity'),
  ('12', 'Report à nouveau', 'equity'), ('121', 'Report à nouveau créditeur', 'equity'), ('129', 'Report à nouveau débiteur', 'equity'),
  ('13', 'Résultat net de l''exercice', 'equity'), ('131', 'Résultat net : bénéfice', 'equity'), ('139', 'Résultat net : perte', 'equity'),
  ('14', 'Subventions d''investissement', 'equity'), ('15', 'Provisions réglementées et fonds assimilés', 'equity'),
  ('16', 'Emprunts et dettes assimilées', 'liability'), ('162', 'Emprunts et dettes auprès des établissements de crédit', 'liability'),
  ('17', 'Dettes de location-acquisition', 'liability'), ('18', 'Dettes liées à des participations et comptes de liaison', 'liability'),
  ('19', 'Provisions pour risques et charges', 'liability'),
  -- Classe 2
  ('21', 'Immobilisations incorporelles', 'asset'), ('211', 'Frais de développement', 'asset'), ('212', 'Brevets, licences, concessions et droits similaires', 'asset'),
  ('213', 'Logiciels et sites internet', 'asset'), ('215', 'Fonds commercial', 'asset'),
  ('22', 'Terrains', 'asset'), ('23', 'Bâtiments, installations techniques et agencements', 'asset'),
  ('24', 'Matériel, mobilier et actifs biologiques', 'asset'), ('241', 'Matériel et outillage industriel et commercial', 'asset'),
  ('244', 'Matériel et mobilier', 'asset'), ('245', 'Matériel de transport', 'asset'),
  ('25', 'Avances et acomptes versés sur immobilisations', 'asset'), ('26', 'Titres de participation', 'asset'),
  ('27', 'Autres immobilisations financières', 'asset'), ('28', 'Amortissements', 'asset'), ('29', 'Dépréciations des immobilisations', 'asset'),
  -- Classe 3
  ('31', 'Marchandises', 'asset'), ('311', 'Marchandises', 'asset'), ('32', 'Matières premières et fournitures liées', 'asset'),
  ('321', 'Matières premières', 'asset'), ('33', 'Autres approvisionnements', 'asset'), ('34', 'Produits en cours', 'asset'),
  ('35', 'Services en cours', 'asset'), ('36', 'Produits finis', 'asset'), ('37', 'Produits intermédiaires et résiduels', 'asset'),
  ('38', 'Stocks en cours de route, en consignation ou en dépôt', 'asset'), ('39', 'Dépréciations des stocks et encours de production', 'asset'),
  -- Classe 4
  ('40', 'Fournisseurs et comptes rattachés', 'liability'), ('401', 'Fournisseurs, dettes en compte', 'liability'),
  ('402', 'Fournisseurs, effets à payer', 'liability'), ('408', 'Fournisseurs, factures non parvenues', 'liability'),
  ('409', 'Fournisseurs débiteurs', 'asset'),
  ('41', 'Clients et comptes rattachés', 'asset'), ('411', 'Clients', 'asset'), ('412', 'Clients, effets à recevoir en portefeuille', 'asset'),
  ('416', 'Créances clients litigieuses ou douteuses', 'asset'), ('418', 'Clients, produits à recevoir', 'asset'),
  ('419', 'Clients créditeurs', 'liability'), ('4191', 'Clients, avances et acomptes reçus', 'liability'),
  ('42', 'Personnel', 'liability'), ('421', 'Personnel, avances et acomptes', 'asset'), ('422', 'Personnel, rémunérations dues', 'liability'),
  ('43', 'Organismes sociaux', 'liability'), ('431', 'Sécurité sociale', 'liability'), ('432', 'Caisses de retraite complémentaire', 'liability'),
  ('44', 'État et collectivités publiques', NULL), ('441', 'État, impôt sur les bénéfices', 'liability'),
  ('443', 'État, TVA facturée', 'liability'), ('4431', 'État, TVA facturée sur ventes', 'liability'),
  ('4432', 'État, TVA facturée sur prestations de services', 'liability'), ('445', 'État, TVA récupérable', 'asset'),
  ('4451', 'État, TVA récupérable sur immobilisations', 'asset'), ('4452', 'État, TVA récupérable sur achats', 'asset'),
  ('4453', 'État, TVA récupérable sur transport', 'asset'), ('4454', 'État, TVA récupérable sur services extérieurs et autres charges', 'asset'),
  ('447', 'État, impôts retenus à la source', 'liability'),
  ('45', 'Organismes internationaux', NULL), ('46', 'Apporteurs, associés et groupe', NULL), ('47', 'Débiteurs et créditeurs divers', NULL),
  ('476', 'Charges constatées d''avance', 'asset'), ('477', 'Produits constatés d''avance', 'liability'),
  ('478', 'Écarts de conversion – actif', 'asset'), ('479', 'Écarts de conversion – passif', 'liability'),
  ('48', 'Créances et dettes hors activités ordinaires', NULL), ('49', 'Dépréciations et provisions pour risques à court terme', NULL),
  -- Classe 5
  ('50', 'Titres de placement', 'asset'), ('51', 'Valeurs à encaisser', 'asset'), ('52', 'Banques', 'asset'), ('521', 'Banques locales', 'asset'),
  ('53', 'Établissements financiers et assimilés', 'asset'), ('54', 'Instruments de trésorerie', 'asset'),
  ('56', 'Banques, crédits de trésorerie et d''escompte', 'liability'), ('57', 'Caisse', 'asset'), ('571', 'Caisse siège social', 'asset'),
  ('58', 'Régies d''avances, accréditifs et virements internes', 'asset'), ('59', 'Dépréciations et provisions pour risque à court terme', NULL),
  -- Classe 6
  ('60', 'Achats et variations de stocks', 'expense'), ('601', 'Achats de marchandises', 'expense'),
  ('602', 'Achats de matières premières et fournitures liées', 'expense'), ('603', 'Variations des stocks de biens achetés', 'expense'),
  ('6031', 'Variations des stocks de marchandises', 'expense'), ('604', 'Achats stockés de matières et fournitures consommables', 'expense'),
  ('605', 'Autres achats', 'expense'), ('608', 'Achats d''emballages', 'expense'),
  ('61', 'Transports', 'expense'), ('611', 'Transports sur achats', 'expense'), ('612', 'Transports sur ventes', 'expense'),
  ('62', 'Services extérieurs A', 'expense'), ('621', 'Sous-traitance générale', 'expense'), ('622', 'Locations et charges locatives', 'expense'),
  ('624', 'Entretien, réparations et maintenance', 'expense'), ('625', 'Primes d''assurance', 'expense'),
  ('627', 'Publicité, publications, relations publiques', 'expense'), ('628', 'Frais de télécommunications', 'expense'),
  ('63', 'Services extérieurs B', 'expense'), ('631', 'Frais bancaires', 'expense'), ('632', 'Rémunérations d''intermédiaires et de conseils', 'expense'),
  ('638', 'Autres charges externes', 'expense'),
  ('64', 'Impôts et taxes', 'expense'), ('65', 'Autres charges', 'expense'),
  ('66', 'Charges de personnel', 'expense'), ('661', 'Rémunérations directes versées au personnel national', 'expense'),
  ('664', 'Charges sociales', 'expense'),
  ('67', 'Frais financiers et charges assimilées', 'expense'), ('671', 'Intérêts des emprunts', 'expense'), ('676', 'Pertes de change', 'expense'),
  ('68', 'Dotations aux amortissements', 'expense'), ('681', 'Dotations aux amortissements d''exploitation', 'expense'),
  ('69', 'Dotations aux provisions et aux dépréciations', 'expense'), ('691', 'Dotations aux provisions et dépréciations d''exploitation', 'expense'),
  ('697', 'Dotations aux provisions et dépréciations financières', 'expense'),
  -- Classe 7
  ('70', 'Ventes', 'revenue'), ('701', 'Ventes de marchandises', 'revenue'), ('702', 'Ventes de produits finis', 'revenue'),
  ('705', 'Travaux facturés', 'revenue'), ('706', 'Services vendus', 'revenue'), ('707', 'Produits accessoires', 'revenue'),
  ('71', 'Subventions d''exploitation', 'revenue'), ('72', 'Production immobilisée', 'revenue'),
  ('73', 'Variations des stocks de biens et de services produits', 'revenue'), ('75', 'Autres produits', 'revenue'),
  ('77', 'Revenus financiers et produits assimilés', 'revenue'), ('771', 'Intérêts de prêts', 'revenue'), ('776', 'Gains de change', 'revenue'),
  ('78', 'Transferts de charges', 'revenue'), ('79', 'Reprises de provisions, de dépréciations et autres', 'revenue'),
  -- Classe 8
  ('81', 'Valeurs comptables des cessions d''immobilisations', 'expense'), ('82', 'Produits des cessions d''immobilisations', 'revenue'),
  ('83', 'Charges hors activités ordinaires', 'expense'), ('84', 'Produits hors activités ordinaires', 'revenue'),
  ('85', 'Dotations hors activités ordinaires', 'expense'), ('86', 'Reprises hors activités ordinaires', 'revenue'),
  ('87', 'Participation des travailleurs', 'expense'), ('88', 'Subventions d''équilibre', 'revenue'), ('89', 'Impôts sur le résultat', 'expense');

-- Intitulé → compte SYSCOHADA proposé (motif sur l'intitulé normalisé ; le premier par priorité gagne).
CREATE TABLE public.syscohada_keyword_hints (
  pattern text PRIMARY KEY,
  code text NOT NULL REFERENCES public.syscohada_reference_accounts(code),
  priority integer NOT NULL DEFAULT 100
);
ALTER TABLE public.syscohada_keyword_hints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture du référentiel" ON public.syscohada_keyword_hints FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.syscohada_keyword_hints TO authenticated;
INSERT INTO public.syscohada_keyword_hints (pattern, code, priority) VALUES
  ('tva (collectee|facturee)', '4431', 10), ('tva (deductible|recuperable)', '4452', 10),
  ('creances? douteuses?', '416', 10), ('dotations? aux amortissements', '681', 10), ('dotations? aux provisions', '691', 10),
  ('ventes? de marchandises', '701', 20), ('prestations? de services|services vendus', '706', 20),
  ('achats? de marchandises', '601', 20), ('(achats? de )?matieres premieres', '602', 30), ('stocks? de marchandises', '311', 15),
  ('stocks? de matieres', '321', 15), ('immobilisations? corporelles', '24', 20), ('immobilisations? incorporelles', '21', 20),
  ('capital', '101', 40), ('caisse', '571', 40), ('banque', '521', 40), ('clients?|creances clients', '411', 50),
  ('fournisseurs?', '401', 50), ('produits financiers', '771', 30), ('charges financieres', '671', 30), ('dettes fiscales', '44', 30),
  ('dettes sociales', '43', 30), ('charges de personnel|salaires', '661', 30), ('loyers?|charges locatives', '622', 30),
  ('services exterieurs|charges externes', '638', 60);

ALTER TABLE public.posting_roles ADD COLUMN expected_prefixes text[];
UPDATE public.posting_roles SET expected_prefixes = v.p
  FROM (VALUES ('AR_RECEIVABLE', ARRAY['41']), ('SALES_REVENUE', ARRAY['70']), ('VAT_OUTPUT', ARRAY['443']), ('BANK', ARRAY['52', '53', '57']),
               ('AP_PAYABLE', ARRAY['40']), ('VAT_INPUT', ARRAY['445']), ('PURCHASES', ARRAY['60']), ('CUSTOMER_ADVANCE', ARRAY['419']),
               ('INVENTORY', ARRAY['3']), ('STOCK_VARIATION', ARRAY['603'])) AS v(r, p)
 WHERE posting_roles.code = v.r;
COMMENT ON COLUMN public.posting_roles.expected_prefixes IS 'Préfixes SYSCOHADA attendus du compte associé (contrôle de cohérence) ; NULL = non contrôlé.';

-- ─── 3. Contrôle de cohérence ───
CREATE OR REPLACE FUNCTION public.normalize_account_label(_t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT btrim(regexp_replace(translate(lower(COALESCE(_t, '')), 'àâäéèêëîïôöùûüç''’-–,.', 'aaaeeeeiioouuuc      '), '\s+', ' ', 'g'))
$function$;

CREATE OR REPLACE FUNCTION public.labels_compatible(_a text, _b text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- Au moins un mot significatif commun (5 premières lettres, pour accepter pluriels et accords).
  SELECT EXISTS (
    SELECT 1 FROM unnest(string_to_array(public.normalize_account_label(_a), ' ')) x(w)
      JOIN unnest(string_to_array(public.normalize_account_label(_b), ' ')) y(w)
        ON length(x.w) > 3 AND length(y.w) > 3 AND left(x.w, 5) = left(y.w, 5)
     WHERE x.w NOT IN ('comptes', 'compte', 'autres', 'divers', 'leurs', 'entre') )
$function$;

CREATE OR REPLACE FUNCTION public.syscohada_reference_of(_code text)
 RETURNS public.syscohada_reference_accounts
 LANGUAGE sql
 STABLE
AS $function$
  SELECT r.* FROM public.syscohada_reference_accounts r
   WHERE _code LIKE r.code || '%' ORDER BY length(r.code) DESC LIMIT 1
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
  _a record; _ref public.syscohada_reference_accounts%ROWTYPE; _typed public.syscohada_reference_accounts%ROWTYPE;
  _hint record; _n bigint; _parent text;
BEGIN
  IF _tenant IS NULL THEN RETURN; END IF;
  FOR _a IN SELECT * FROM public.gl_accounts g WHERE g.tenant_id = _tenant AND g.is_active ORDER BY g.code LOOP
    SELECT count(*) INTO _n FROM public.journal_lines l WHERE l.account_id = _a.id;
    _ref := public.syscohada_reference_of(_a.code);
    SELECT r.* INTO _typed FROM public.syscohada_reference_accounts r
     WHERE _a.code LIKE r.code || '%' AND r.account_type IS NOT NULL ORDER BY length(r.code) DESC LIMIT 1;
    SELECT h.code AS hcode, r.name AS hname, r.account_type AS htype INTO _hint
      FROM public.syscohada_keyword_hints h JOIN public.syscohada_reference_accounts r ON r.code = h.code
     WHERE public.normalize_account_label(_a.name) ~ h.pattern ORDER BY h.priority, length(h.code) DESC LIMIT 1;

    IF _ref.code IS NULL OR length(_ref.code) = 1 THEN
      account_id := _a.id; code := _a.code; name := _a.name; severity := 'error'; issue := 'Code hors plan SYSCOHADA';
      detail := 'Aucun compte SYSCOHADA à deux chiffres ne correspond au préfixe ' || left(_a.code, 2);
      suggested_code := _hint.hcode; suggested_name := _hint.hname; suggested_type := COALESCE(_hint.htype, _a.account_type); lines := _n; RETURN NEXT;
    ELSE
      IF (_ref.account_type IS NULL AND _a.account_type NOT IN ('asset', 'liability'))
         OR (_ref.account_type IS NOT NULL AND _a.account_type <> _ref.account_type)
         OR (_ref.account_type IS NULL AND _typed.code IS NOT NULL AND length(_typed.code) > 1 AND _typed.account_type <> _a.account_type) THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := 'error'; issue := 'Classe et type incohérents';
        detail := 'Le compte SYSCOHADA ' || _ref.code || ' « ' || _ref.name || ' » est de type ' || COALESCE(_ref.account_type, 'actif ou passif')
          || ', le compte est déclaré ' || _a.account_type;
        suggested_code := _hint.hcode; suggested_name := _hint.hname; suggested_type := COALESCE(_hint.htype, _a.account_type); lines := _n; RETURN NEXT;
      ELSIF NOT public.labels_compatible(_a.name, _ref.name) THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := 'warning'; issue := 'Intitulé différent du compte SYSCOHADA';
        detail := 'Le code ' || _a.code || ' relève de ' || _ref.code || ' « ' || _ref.name || ' »';
        suggested_code := _hint.hcode; suggested_name := _hint.hname; suggested_type := COALESCE(_hint.htype, _a.account_type); lines := _n; RETURN NEXT;
      END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM public.gl_accounts o WHERE o.tenant_id = _tenant AND o.is_active AND o.id <> _a.id
                AND public.normalize_account_label(o.name) = public.normalize_account_label(_a.name)) THEN
      account_id := _a.id; code := _a.code; name := _a.name; severity := 'warning'; issue := 'Doublon d''intitulé';
      SELECT string_agg(o.code, ', ' ORDER BY o.code) INTO detail FROM public.gl_accounts o
       WHERE o.tenant_id = _tenant AND o.is_active AND o.id <> _a.id AND public.normalize_account_label(o.name) = public.normalize_account_label(_a.name);
      detail := 'Même intitulé que ' || detail; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
    END IF;

    IF _a.parent_id IS NOT NULL THEN
      SELECT p.code INTO _parent FROM public.gl_accounts p WHERE p.id = _a.parent_id;
      IF NOT (_a.code LIKE _parent || '%') THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := 'error'; issue := 'Compte parent incohérent';
        detail := 'Parent ' || _parent || ' qui n''est pas un préfixe du code'; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.gl_accounts p WHERE p.tenant_id = _tenant AND p.id <> _a.id AND _a.code LIKE p.code || '%' AND length(p.code) < length(_a.code)) THEN
      account_id := _a.id; code := _a.code; name := _a.name; severity := 'info'; issue := 'Sous-compte non rattaché';
      detail := 'Un compte de regroupement existe : lancer « Rattacher les sous-comptes »'; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
    END IF;

    IF _a.is_header AND _n > 0 THEN
      account_id := _a.id; code := _a.code; name := _a.name; severity := 'error'; issue := 'Compte de regroupement mouvementé';
      detail := _n || ' ligne(s) d''écriture sur un compte non imputable'; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
    END IF;
  END LOOP;

  -- Imputations automatiques hors classe attendue.
  FOR _a IN
    SELECT g.id, g.code, g.name, r.code AS role, r.label, r.expected_prefixes
      FROM public.tenant_posting_accounts t JOIN public.posting_roles r ON r.code = t.role_code
      JOIN public.gl_accounts g ON g.id = t.gl_account_id
     WHERE t.tenant_id = _tenant AND r.expected_prefixes IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM unnest(r.expected_prefixes) p WHERE g.code LIKE p || '%')
  LOOP
    SELECT count(*) INTO _n FROM public.journal_lines l WHERE l.account_id = _a.id;
    account_id := _a.id; code := _a.code; name := _a.name; severity := 'error'; issue := 'Imputation automatique hors classe attendue';
    detail := 'Le rôle « ' || _a.label || ' » attend un compte ' || array_to_string(_a.expected_prefixes, ' ou ') || 'x';
    SELECT r.code, r.name, r.account_type INTO suggested_code, suggested_name, suggested_type
      FROM public.syscohada_reference_accounts r WHERE r.code = (
        SELECT d.account_code FROM public.accounting_framework_role_defaults d WHERE d.framework_code = 'SYSCOHADA_REVISE' AND d.role_code = _a.role);
    lines := _n; RETURN NEXT;
  END LOOP;
END $function$;
REVOKE ALL ON FUNCTION public.chart_of_accounts_issues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chart_of_accounts_issues() TO authenticated;

-- ─── 4. Corrections non destructives ───
CREATE OR REPLACE FUNCTION public.require_chart_right()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'accounting.chart') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'accounting.chart') USING ERRCODE = '42501';
  END IF;
  RETURN _tenant;
END $function$;
REVOKE ALL ON FUNCTION public.require_chart_right() FROM PUBLIC, anon, authenticated;

-- Remplace un compte erroné par le compte SYSCOHADA (créé s'il n'existe pas) : l'ancien est conservé,
-- désactivé, relié par replaced_by ; les imputations automatiques sont redirigées. Rien n'est supprimé
-- et aucune écriture n'est modifiée ; un solde éventuel se reclasse par reclassify_gl_account_balance.
CREATE OR REPLACE FUNCTION public.replace_gl_account(_account_id uuid, _new_code text, _new_name text, _new_type text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.require_chart_right();
  _old public.gl_accounts%ROWTYPE;
  _new uuid;
BEGIN
  SELECT * INTO _old FROM public.gl_accounts WHERE id = _account_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte introuvable dans la société active' USING ERRCODE = 'QG019'; END IF;
  IF _new_code IS NULL OR _new_code !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'Code du compte de remplacement invalide' USING ERRCODE = 'QG019'; END IF;
  IF _new_code = _old.code THEN RAISE EXCEPTION 'Le compte de remplacement doit avoir un autre code' USING ERRCODE = 'QG019'; END IF;
  SELECT id INTO _new FROM public.gl_accounts WHERE tenant_id = _tenant AND code = _new_code;
  IF _new IS NULL THEN
    IF _new_type IS NULL OR _new_type NOT IN ('asset', 'liability', 'equity', 'revenue', 'expense') THEN
      RAISE EXCEPTION 'Type du compte de remplacement requis' USING ERRCODE = 'QG019';
    END IF;
    INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
    VALUES (_tenant, _new_code, COALESCE(NULLIF(btrim(_new_name), ''), _old.name), _new_type) RETURNING id INTO _new;
  ELSE
    UPDATE public.gl_accounts SET is_active = true WHERE id = _new AND NOT is_active;
  END IF;
  UPDATE public.tenant_posting_accounts SET gl_account_id = _new, updated_at = now(), updated_by = auth.uid()
   WHERE tenant_id = _tenant AND gl_account_id = _old.id;
  UPDATE public.gl_accounts SET replaced_by = _new, is_active = false WHERE id = _old.id;
  RETURN _new;
END $function$;
REVOKE ALL ON FUNCTION public.replace_gl_account(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_gl_account(uuid, text, text, text) TO authenticated;

-- Comptes de regroupement (classe, compte à deux chiffres, compte à trois chiffres du référentiel)
-- au-dessus des comptes de la société dont la classe et le type sont cohérents.
CREATE OR REPLACE FUNCTION public.create_syscohada_headings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.require_chart_right();
  _n integer;
BEGIN
  WITH besoins AS (
    SELECT DISTINCT r.code, r.name, r.account_type
      FROM public.gl_accounts g
      JOIN public.syscohada_reference_accounts r ON g.code LIKE r.code || '%' AND length(r.code) < length(g.code)
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
REVOKE ALL ON FUNCTION public.create_syscohada_headings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_syscohada_headings() TO authenticated;

-- Rattache chaque compte sans parent au compte de la société dont le code est le plus long préfixe strict.
CREATE OR REPLACE FUNCTION public.link_gl_account_parents()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.require_chart_right();
  _n integer;
BEGIN
  UPDATE public.gl_accounts g SET parent_id = (
      SELECT p.id FROM public.gl_accounts p
       WHERE p.tenant_id = _tenant AND p.id <> g.id AND g.code LIKE p.code || '%' AND length(p.code) < length(g.code)
       ORDER BY length(p.code) DESC LIMIT 1)
   WHERE g.tenant_id = _tenant AND g.parent_id IS NULL
     AND EXISTS (SELECT 1 FROM public.gl_accounts p WHERE p.tenant_id = _tenant AND p.id <> g.id
                  AND g.code LIKE p.code || '%' AND length(p.code) < length(g.code));
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $function$;
REVOKE ALL ON FUNCTION public.link_gl_account_parents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_gl_account_parents() TO authenticated;

-- Reclassement du solde d'un compte remplacé vers son remplaçant : écriture OD nouvelle, datée, motivée.
CREATE OR REPLACE FUNCTION public.reclassify_gl_account_balance(_account_id uuid, _entry_date date, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.require_chart_right();
  _old public.gl_accounts%ROWTYPE;
  _target public.gl_accounts%ROWTYPE;
  _solde numeric;
  _entry uuid;
  _date date := COALESCE(_entry_date, CURRENT_DATE);
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Motif du reclassement obligatoire' USING ERRCODE = 'QG019'; END IF;
  SELECT * INTO _old FROM public.gl_accounts WHERE id = _account_id AND tenant_id = _tenant;
  IF NOT FOUND OR _old.replaced_by IS NULL THEN
    RAISE EXCEPTION 'Seul un compte remplacé se reclasse (remplacez-le d''abord par le compte SYSCOHADA)' USING ERRCODE = 'QG019';
  END IF;
  SELECT * INTO _target FROM public.gl_accounts WHERE id = _old.replaced_by;
  SELECT COALESCE(sum(l.debit - l.credit), 0) INTO _solde
    FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.entry_id
   WHERE l.account_id = _old.id AND e.status IN ('posted', 'reversed');
  IF _solde = 0 THEN RAISE EXCEPTION 'Compte % soldé : rien à reclasser', _old.code USING ERRCODE = 'QG019'; END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'GL');

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-RECL-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6), _date,
          'Reclassement ' || _old.code || ' → ' || _target.code || ' — ' || btrim(_reason), 'manual', 'draft', auth.uid())
  RETURNING id INTO _entry;
  -- Le compte remplacé est inactif : la garde d'imputation le refuserait ; l'écriture de reclassement
  -- est la seule exception, ouverte le temps de l'insertion.
  UPDATE public.gl_accounts SET is_active = true WHERE id = _old.id;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry, _target.id, GREATEST(_solde, 0), GREATEST(-_solde, 0), 'Reclassement depuis ' || _old.code),
         (_entry, _old.id, GREATEST(-_solde, 0), GREATEST(_solde, 0), 'Reclassement vers ' || _target.code);
  UPDATE public.gl_accounts SET is_active = false WHERE id = _old.id;
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;
  RETURN _entry;
END $function$;
REVOKE ALL ON FUNCTION public.reclassify_gl_account_balance(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reclassify_gl_account_balance(uuid, date, text) TO authenticated;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
