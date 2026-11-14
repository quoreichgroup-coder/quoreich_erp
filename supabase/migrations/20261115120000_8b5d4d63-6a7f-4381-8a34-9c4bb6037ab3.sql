-- V63 — Plan comptable, lot PC-2 (livrable docs/audit-erp/12) : états financiers par rubriques et paie
-- par rôles de comptabilisation.
--
-- 1. États par rubriques, en données : report_layouts (modèle d'état), report_lines (rubriques de détail
--    ou totaux, ordre, sens, formule des totaux), report_line_rules (affectation des comptes par préfixe
--    et, pour le bilan, par sens du solde), tenant_report_line_accounts (exceptions par société : un
--    compte affecté à une autre rubrique ou exclu). report_compute(modèle, société, du, au) calcule
--    chaque rubrique ; financial_statement(modèle, du, au) pour l'écran.
--    Modèles livrés (SYSCOHADA révisé, à valider par l'expert-comptable) : CR_SYSCOHADA (compte de
--    résultat TA … XI, dont marge commerciale, valeur ajoutée, EBE, résultats) et BILAN_SYSCOHADA
--    (AD … DZ ; comptes mixtes au débit à l'actif, au crédit au passif ; résultat de l'exercice en CJ).
-- 2. gl_sig_view reconstruite sur CR_SYSCOHADA. Avant : impôts lus en 63 (au lieu de 64), charges de
--    personnel en 64 (au lieu de 66), 66 compté en charges financières, 63 absent de la valeur ajoutée,
--    classe 8 ignorée, chiffre d'affaires = ventes + production stockée. Colonnes inchangées.
-- 3. Paie (post_payroll_run) : comptes par rôles PAYROLL_* (SYSCOHADA 661, 664, 422, 431, 447) au lieu
--    des numéros 6610 / 6630 / 4210 / 4310 / 4470 codés en dur, sans report silencieux sur le compte du
--    personnel ; rôle manquant = refus QG001 ; taux patronal paramétrable (hr_payroll_settings, 16,4 %
--    par défaut comme avant), droit hr.payroll_settings.

-- ─── 1. Modèles d'états ───
CREATE TABLE public.report_layouts (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]+$'),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income', 'balance')),
  framework_code text REFERENCES public.accounting_frameworks(code),
  description text
);
CREATE TABLE public.report_lines (
  layout_code text NOT NULL REFERENCES public.report_layouts(code) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  line_order integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('detail', 'total')),
  sign text NOT NULL DEFAULT 'debit' CHECK (sign IN ('debit', 'credit')),
  formula jsonb,
  PRIMARY KEY (layout_code, code),
  CONSTRAINT report_lines_formula CHECK ((kind = 'total') = (formula IS NOT NULL))
);
CREATE TABLE public.report_line_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  layout_code text NOT NULL,
  line_code text NOT NULL,
  prefix text NOT NULL CHECK (prefix ~ '^[0-9]+$'),
  balance_side text NOT NULL DEFAULT 'any' CHECK (balance_side IN ('any', 'debit', 'credit')),
  FOREIGN KEY (layout_code, line_code) REFERENCES public.report_lines (layout_code, code) ON DELETE CASCADE,
  UNIQUE (layout_code, prefix, balance_side)
);
CREATE TABLE public.tenant_report_line_accounts (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  layout_code text NOT NULL REFERENCES public.report_layouts(code) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  line_code text,
  PRIMARY KEY (tenant_id, layout_code, account_id),
  FOREIGN KEY (account_id, tenant_id) REFERENCES public.gl_accounts (id, tenant_id),
  FOREIGN KEY (layout_code, line_code) REFERENCES public.report_lines (layout_code, code)
);
COMMENT ON COLUMN public.tenant_report_line_accounts.line_code IS 'NULL : compte exclu de l''état.';

ALTER TABLE public.report_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_line_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture du référentiel" ON public.report_layouts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lecture du référentiel" ON public.report_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lecture du référentiel" ON public.report_line_rules FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.report_layouts, public.report_lines, public.report_line_rules TO authenticated;
ALTER TABLE public.tenant_report_line_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.tenant_report_line_accounts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.tenant_report_line_accounts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart_admin'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart_admin'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_report_line_accounts TO authenticated;

INSERT INTO public.report_layouts (code, name, kind, framework_code, description) VALUES
  ('CR_SYSCOHADA', 'Compte de résultat SYSCOHADA (soldes intermédiaires)', 'income',
   (SELECT code FROM public.accounting_frameworks WHERE code = 'SYSCOHADA_REVISE'), 'Rubriques TA à XI du SYSCOHADA révisé ; à valider par l''expert-comptable'),
  ('BILAN_SYSCOHADA', 'Bilan SYSCOHADA', 'balance',
   (SELECT code FROM public.accounting_frameworks WHERE code = 'SYSCOHADA_REVISE'), 'Rubriques AD à DZ du SYSCOHADA révisé ; à valider par l''expert-comptable');

-- Compte de résultat : rubriques (code, libellé, ordre, nature, sens, formule).
INSERT INTO public.report_lines (layout_code, code, label, line_order, kind, sign, formula) VALUES
  ('CR_SYSCOHADA', 'TA', 'Ventes de marchandises', 10, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'RA', 'Achats de marchandises', 20, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'RB', 'Variation de stocks de marchandises', 30, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'XA', 'MARGE COMMERCIALE', 40, 'total', 'credit', '[["TA",1],["RA",-1],["RB",-1]]'),
  ('CR_SYSCOHADA', 'TB', 'Ventes de produits fabriqués', 50, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'TC', 'Travaux, services vendus', 60, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'TD', 'Produits accessoires', 70, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'XB', 'CHIFFRE D''AFFAIRES', 80, 'total', 'credit', '[["TA",1],["TB",1],["TC",1],["TD",1]]'),
  ('CR_SYSCOHADA', 'TE', 'Production stockée (ou déstockage)', 90, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'TF', 'Production immobilisée', 100, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'TG', 'Subventions d''exploitation', 110, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'TH', 'Autres produits', 120, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'TI', 'Transferts de charges d''exploitation', 130, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'RC', 'Achats de matières premières et fournitures liées', 140, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'RD', 'Variation de stocks de matières premières', 150, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'RE', 'Autres achats', 160, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'RF', 'Variation de stocks d''autres approvisionnements', 170, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'RG', 'Transports', 180, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'RH', 'Services extérieurs', 190, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'RI', 'Impôts et taxes', 200, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'RJ', 'Autres charges', 210, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'XC', 'VALEUR AJOUTÉE', 220, 'total', 'credit',
   '[["XA",1],["TB",1],["TC",1],["TD",1],["TE",1],["TF",1],["TG",1],["TH",1],["TI",1],["RC",-1],["RD",-1],["RE",-1],["RF",-1],["RG",-1],["RH",-1],["RI",-1],["RJ",-1]]'),
  ('CR_SYSCOHADA', 'RK', 'Charges de personnel', 230, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'XD', 'EXCÉDENT BRUT D''EXPLOITATION', 240, 'total', 'credit', '[["XC",1],["RK",-1]]'),
  ('CR_SYSCOHADA', 'TJ', 'Reprises d''amortissements, provisions et dépréciations', 250, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'RL', 'Dotations aux amortissements, provisions et dépréciations', 260, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'XE', 'RÉSULTAT D''EXPLOITATION', 270, 'total', 'credit', '[["XD",1],["TJ",1],["RL",-1]]'),
  ('CR_SYSCOHADA', 'TK', 'Revenus financiers et assimilés', 280, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'TL', 'Reprises de provisions et dépréciations financières', 290, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'TM', 'Transferts de charges financières', 300, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'RM', 'Frais financiers et charges assimilées', 310, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'RN', 'Dotations aux provisions et dépréciations financières', 320, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'XF', 'RÉSULTAT FINANCIER', 330, 'total', 'credit', '[["TK",1],["TL",1],["TM",1],["RM",-1],["RN",-1]]'),
  ('CR_SYSCOHADA', 'XG', 'RÉSULTAT DES ACTIVITÉS ORDINAIRES', 340, 'total', 'credit', '[["XE",1],["XF",1]]'),
  ('CR_SYSCOHADA', 'TN', 'Produits des cessions d''immobilisations', 350, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'TO', 'Autres produits HAO', 360, 'detail', 'credit', NULL),
  ('CR_SYSCOHADA', 'RO', 'Valeurs comptables des cessions d''immobilisations', 370, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'RP', 'Autres charges HAO', 380, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'XH', 'RÉSULTAT HORS ACTIVITÉS ORDINAIRES', 390, 'total', 'credit', '[["TN",1],["TO",1],["RO",-1],["RP",-1]]'),
  ('CR_SYSCOHADA', 'RQ', 'Participation des travailleurs', 400, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'RS', 'Impôts sur le résultat', 410, 'detail', 'debit', NULL),
  ('CR_SYSCOHADA', 'XI', 'RÉSULTAT NET', 420, 'total', 'credit', '[["XG",1],["XH",1],["RQ",-1],["RS",-1]]');

INSERT INTO public.report_line_rules (layout_code, line_code, prefix)
SELECT 'CR_SYSCOHADA', v.l, v.p FROM (VALUES
  ('TA', '701'), ('TA', '70'), ('RA', '601'), ('RB', '6031'), ('RB', '603'), ('TB', '702'), ('TB', '703'), ('TB', '704'),
  ('TC', '705'), ('TC', '706'), ('TD', '707'), ('TE', '73'), ('TF', '72'), ('TG', '71'), ('TH', '75'), ('TH', '7'),
  ('TI', '781'), ('TI', '78'), ('RC', '602'), ('RD', '6032'), ('RE', '604'), ('RE', '605'), ('RE', '608'), ('RE', '60'),
  ('RF', '6033'), ('RG', '61'), ('RH', '62'), ('RH', '63'), ('RI', '64'), ('RJ', '65'), ('RJ', '6'), ('RK', '66'),
  ('TJ', '791'), ('TJ', '798'), ('TJ', '799'), ('TJ', '79'), ('RL', '681'), ('RL', '691'), ('RL', '68'), ('RL', '69'),
  ('TK', '77'), ('TL', '797'), ('TM', '787'), ('RM', '67'), ('RN', '697'),
  ('TN', '82'), ('TO', '84'), ('TO', '86'), ('TO', '88'), ('RO', '81'), ('RP', '83'), ('RP', '85'), ('RQ', '87'), ('RS', '89')) AS v(l, p);

-- Bilan : actif au sens débiteur, passif au sens créditeur ; comptes mixtes selon le sens du solde.
INSERT INTO public.report_lines (layout_code, code, label, line_order, kind, sign, formula) VALUES
  ('BILAN_SYSCOHADA', 'AD', 'Immobilisations incorporelles', 10, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'AI', 'Immobilisations corporelles', 20, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'AP', 'Avances et acomptes versés sur immobilisations', 30, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'AQ', 'Immobilisations financières', 40, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'AZ', 'TOTAL ACTIF IMMOBILISÉ', 50, 'total', 'debit', '[["AD",1],["AI",1],["AP",1],["AQ",1]]'),
  ('BILAN_SYSCOHADA', 'BA', 'Actif circulant HAO', 60, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'BB', 'Stocks et encours', 70, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'BH', 'Fournisseurs, avances versées', 80, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'BI', 'Clients', 90, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'BJ', 'Autres créances', 100, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'BK', 'TOTAL ACTIF CIRCULANT', 110, 'total', 'debit', '[["BA",1],["BB",1],["BH",1],["BI",1],["BJ",1]]'),
  ('BILAN_SYSCOHADA', 'BQ', 'Titres de placement', 120, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'BR', 'Valeurs à encaisser', 130, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'BS', 'Banques, chèques postaux, caisse et assimilés', 140, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'BT', 'TOTAL TRÉSORERIE-ACTIF', 150, 'total', 'debit', '[["BQ",1],["BR",1],["BS",1]]'),
  ('BILAN_SYSCOHADA', 'BU', 'Écart de conversion – actif', 160, 'detail', 'debit', NULL),
  ('BILAN_SYSCOHADA', 'BZ', 'TOTAL GÉNÉRAL ACTIF', 170, 'total', 'debit', '[["AZ",1],["BK",1],["BT",1],["BU",1]]'),
  ('BILAN_SYSCOHADA', 'CA', 'Capital', 200, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'CB', 'Apporteurs capital non appelé', 210, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'CD', 'Primes liées au capital social', 220, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'CE', 'Écarts de réévaluation', 230, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'CF', 'Réserves indisponibles', 240, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'CG', 'Réserves libres', 250, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'CH', 'Report à nouveau', 260, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'CJ', 'Résultat net de l''exercice', 270, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'CL', 'Subventions d''investissement', 280, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'CM', 'Provisions réglementées', 290, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'CP', 'TOTAL CAPITAUX PROPRES ET RESSOURCES ASSIMILÉES', 300, 'total', 'credit',
   '[["CA",1],["CB",1],["CD",1],["CE",1],["CF",1],["CG",1],["CH",1],["CJ",1],["CL",1],["CM",1]]'),
  ('BILAN_SYSCOHADA', 'DA', 'Emprunts et dettes financières diverses', 310, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'DB', 'Dettes de location-acquisition', 320, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'DC', 'Provisions pour risques et charges', 330, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'DD', 'TOTAL DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES', 340, 'total', 'credit', '[["DA",1],["DB",1],["DC",1]]'),
  ('BILAN_SYSCOHADA', 'DF', 'TOTAL RESSOURCES STABLES', 350, 'total', 'credit', '[["CP",1],["DD",1]]'),
  ('BILAN_SYSCOHADA', 'DH', 'Dettes circulantes HAO', 360, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'DI', 'Clients, avances reçues', 370, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'DJ', 'Fournisseurs d''exploitation', 380, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'DK', 'Dettes fiscales et sociales', 390, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'DM', 'Autres dettes', 400, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'DN', 'Provisions pour risques à court terme', 410, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'DP', 'TOTAL PASSIF CIRCULANT', 420, 'total', 'credit', '[["DH",1],["DI",1],["DJ",1],["DK",1],["DM",1],["DN",1]]'),
  ('BILAN_SYSCOHADA', 'DQ', 'Banques, crédits d''escompte', 430, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'DR', 'Banques, établissements financiers et crédits de trésorerie', 440, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'DT', 'TOTAL TRÉSORERIE-PASSIF', 450, 'total', 'credit', '[["DQ",1],["DR",1]]'),
  ('BILAN_SYSCOHADA', 'DV', 'Écart de conversion – passif', 460, 'detail', 'credit', NULL),
  ('BILAN_SYSCOHADA', 'DZ', 'TOTAL GÉNÉRAL PASSIF', 470, 'total', 'credit', '[["DF",1],["DP",1],["DT",1],["DV",1]]');

INSERT INTO public.report_line_rules (layout_code, line_code, prefix, balance_side)
SELECT 'BILAN_SYSCOHADA', v.l, v.p, v.s FROM (VALUES
  ('AD', '21', 'any'), ('AD', '281', 'any'), ('AD', '291', 'any'),
  ('AI', '22', 'any'), ('AI', '23', 'any'), ('AI', '24', 'any'), ('AI', '282', 'any'), ('AI', '283', 'any'), ('AI', '284', 'any'),
  ('AI', '292', 'any'), ('AI', '293', 'any'), ('AI', '294', 'any'), ('AP', '25', 'any'), ('AP', '295', 'any'),
  ('AQ', '26', 'any'), ('AQ', '27', 'any'), ('AQ', '296', 'any'), ('AQ', '297', 'any'), ('AI', '28', 'any'), ('AI', '29', 'any'), ('AI', '2', 'any'),
  ('BA', '485', 'debit'), ('BA', '488', 'debit'), ('BB', '3', 'any'),
  ('BH', '409', 'debit'), ('BH', '40', 'debit'), ('DJ', '40', 'credit'),
  ('BI', '41', 'debit'), ('BI', '491', 'any'), ('DI', '41', 'credit'),
  ('BJ', '42', 'debit'), ('DK', '42', 'credit'), ('BJ', '43', 'debit'), ('DK', '43', 'credit'), ('BJ', '44', 'debit'), ('DK', '44', 'credit'),
  ('BJ', '4', 'debit'), ('DM', '4', 'credit'), ('DH', '481', 'credit'), ('DH', '482', 'credit'), ('DH', '484', 'credit'),
  ('BJ', '49', 'any'), ('DN', '499', 'any'), ('BU', '478', 'any'), ('DV', '479', 'any'),
  ('BQ', '50', 'any'), ('BQ', '590', 'any'), ('BR', '51', 'any'),
  ('BS', '5', 'debit'), ('DR', '5', 'credit'), ('DQ', '564', 'credit'), ('DQ', '565', 'credit'), ('DR', '56', 'any'),
  ('CA', '101', 'any'), ('CA', '102', 'any'), ('CA', '103', 'any'), ('CA', '104', 'any'), ('CA', '10', 'any'), ('CB', '109', 'any'),
  ('CD', '105', 'any'), ('CE', '106', 'any'), ('CF', '111', 'any'), ('CF', '112', 'any'), ('CF', '113', 'any'), ('CG', '11', 'any'),
  ('CH', '12', 'any'), ('CJ', '13', 'any'), ('CJ', '6', 'any'), ('CJ', '7', 'any'), ('CJ', '8', 'any'), ('CL', '14', 'any'), ('CM', '15', 'any'),
  ('DA', '16', 'any'), ('DA', '18', 'any'), ('DB', '17', 'any'), ('DC', '19', 'any'), ('DA', '1', 'any')) AS v(l, p, s);

-- Rubrique d'un compte : exception de la société, sinon règle au préfixe le plus long (sens du solde
-- compris pour les règles qui le précisent).
CREATE OR REPLACE FUNCTION public.report_line_of_account(_layout text, _tenant uuid, _account uuid, _code text, _balance numeric)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.tenant_report_line_accounts o WHERE o.tenant_id = _tenant AND o.layout_code = _layout AND o.account_id = _account)
    THEN (SELECT o.line_code FROM public.tenant_report_line_accounts o WHERE o.tenant_id = _tenant AND o.layout_code = _layout AND o.account_id = _account)
    ELSE (SELECT r.line_code FROM public.report_line_rules r
           WHERE r.layout_code = _layout AND _code LIKE r.prefix || '%'
             AND (r.balance_side = 'any' OR (r.balance_side = 'debit' AND _balance >= 0) OR (r.balance_side = 'credit' AND _balance < 0))
           ORDER BY length(r.prefix) DESC, (r.balance_side <> 'any') DESC LIMIT 1)
  END
$function$;

-- Montant de chaque rubrique (exécutée avec les droits de l'appelant : la RLS limite aux données de sa société).
CREATE OR REPLACE FUNCTION public.report_compute(_layout text, _tenant uuid, _from date, _to date)
 RETURNS TABLE (line_code text, label text, line_order integer, kind text, amount numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _kind text; _l record; _vals jsonb := '{}'::jsonb; _v numeric; _f jsonb;
BEGIN
  SELECT rl.kind INTO _kind FROM public.report_layouts rl WHERE rl.code = _layout;
  IF _kind IS NULL THEN RAISE EXCEPTION 'Modèle d''état inconnu : %', _layout USING ERRCODE = 'QG019'; END IF;
  FOR _l IN
    WITH soldes AS (
      SELECT g.id, g.code, sum(jl.debit - jl.credit) AS solde
        FROM public.journal_lines jl
        JOIN public.journal_entries je ON je.id = jl.entry_id
        JOIN public.gl_accounts g ON g.id = jl.account_id
       WHERE je.tenant_id = _tenant AND je.status IN ('posted', 'reversed')
         AND je.entry_date <= _to AND (_kind = 'balance' OR je.entry_date >= _from)
       GROUP BY g.id, g.code)
    SELECT public.report_line_of_account(_layout, _tenant, s.id, s.code, s.solde) AS lc, sum(s.solde) AS solde
      FROM soldes s GROUP BY 1
  LOOP
    IF _l.lc IS NOT NULL THEN _vals := _vals || jsonb_build_object(_l.lc, _l.solde); END IF;
  END LOOP;
  FOR _l IN SELECT * FROM public.report_lines r WHERE r.layout_code = _layout ORDER BY r.line_order LOOP
    IF _l.kind = 'detail' THEN
      _v := COALESCE((_vals ->> _l.code)::numeric, 0) * CASE WHEN _l.sign = 'credit' THEN -1 ELSE 1 END;
    ELSE
      _v := 0;
      FOR _f IN SELECT * FROM jsonb_array_elements(_l.formula) LOOP
        _v := _v + COALESCE((_vals ->> ('=' || (_f ->> 0)))::numeric, 0) * (_f ->> 1)::numeric;
      END LOOP;
    END IF;
    _vals := _vals || jsonb_build_object('=' || _l.code, _v);
    line_code := _l.code; label := _l.label; line_order := _l.line_order; kind := _l.kind; amount := round(_v, 2);
    RETURN NEXT;
  END LOOP;
END $function$;
GRANT EXECUTE ON FUNCTION public.report_compute(text, uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.financial_statement(_layout text, _from date, _to date)
 RETURNS TABLE (line_code text, label text, line_order integer, kind text, amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.report_compute(_layout, public.get_user_tenant_id(auth.uid()), COALESCE(_from, '1900-01-01'::date), COALESCE(_to, CURRENT_DATE))
$function$;
GRANT EXECUTE ON FUNCTION public.financial_statement(text, date, date) TO authenticated;

-- ─── 2. SIG sur les rubriques (mêmes colonnes) ───
CREATE OR REPLACE VIEW public.gl_sig_view WITH (security_invoker = true) AS
WITH periodes AS (
  SELECT DISTINCT je.tenant_id, to_char(je.entry_date::timestamp with time zone, 'YYYY-MM') AS period
    FROM public.journal_entries je WHERE je.status = 'posted'
), calc AS (
  SELECT p.tenant_id, p.period, r.line_code, r.amount
    FROM periodes p
    CROSS JOIN LATERAL public.report_compute('CR_SYSCOHADA', p.tenant_id, to_date(p.period || '-01', 'YYYY-MM-DD'),
                                             (to_date(p.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date) r
)
SELECT tenant_id, period,
       COALESCE(sum(amount) FILTER (WHERE line_code = 'XB'), 0) AS ventes,
       COALESCE(sum(amount) FILTER (WHERE line_code = 'TE'), 0) AS production_stockee,
       COALESCE(sum(amount) FILTER (WHERE line_code IN ('RA', 'RB', 'RC', 'RD', 'RE', 'RF')), 0) AS achats_consommes,
       COALESCE(sum(amount) FILTER (WHERE line_code IN ('RG', 'RH')), 0) AS services_ext,
       COALESCE(sum(amount) FILTER (WHERE line_code = 'RI'), 0) AS impots_taxes,
       COALESCE(sum(amount) FILTER (WHERE line_code = 'RK'), 0) AS charges_personnel,
       COALESCE(sum(amount) FILTER (WHERE line_code = 'RL'), 0) AS dotations,
       COALESCE(sum(amount) FILTER (WHERE line_code = 'XA'), 0) AS marge_commerciale,
       COALESCE(sum(amount) FILTER (WHERE line_code = 'XB'), 0) AS chiffre_affaires,
       COALESCE(sum(amount) FILTER (WHERE line_code = 'XC'), 0) AS valeur_ajoutee,
       COALESCE(sum(amount) FILTER (WHERE line_code = 'XD'), 0) AS ebe,
       COALESCE(sum(amount) FILTER (WHERE line_code = 'XE'), 0) AS resultat_exploitation,
       COALESCE(sum(amount) FILTER (WHERE line_code = 'XI'), 0) AS resultat_net
  FROM calc
 GROUP BY tenant_id, period;

-- ─── 3. Paie par rôles de comptabilisation ───
INSERT INTO public.posting_roles (code, label, module, description, expected_prefixes) VALUES
  ('PAYROLL_SALARIES', 'Rémunérations du personnel', 'PAY', 'Débité du salaire brut à la comptabilisation de la paie', ARRAY['66']),
  ('PAYROLL_EMPLOYER_CHARGES', 'Charges sociales patronales', 'PAY', 'Débité des cotisations patronales', ARRAY['66']),
  ('PAYROLL_NET_PAYABLE', 'Personnel, rémunérations dues', 'PAY', 'Crédité du net à payer', ARRAY['42']),
  ('PAYROLL_SOCIAL', 'Organismes sociaux', 'PAY', 'Crédité des cotisations salariales et patronales', ARRAY['43']),
  ('PAYROLL_TAX', 'État, impôts retenus à la source', 'PAY', 'Crédité de l''impôt sur salaires retenu', ARRAY['44'])
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT 'SYSCOHADA_REVISE', v.code, v.name, v.t
  FROM (VALUES ('661', 'Rémunérations directes versées au personnel national', 'expense'), ('664', 'Charges sociales', 'expense'),
               ('422', 'Personnel, rémunérations dues', 'liability'), ('431', 'Sécurité sociale', 'liability'),
               ('447', 'État, impôts retenus à la source', 'liability')) AS v(code, name, t)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = 'SYSCOHADA_REVISE')
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_accounts a WHERE a.framework_code = 'SYSCOHADA_REVISE' AND a.code = v.code);
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT 'SYSCOHADA_REVISE', v.r, v.c
  FROM (VALUES ('PAYROLL_SALARIES', '661'), ('PAYROLL_EMPLOYER_CHARGES', '664'), ('PAYROLL_NET_PAYABLE', '422'),
               ('PAYROLL_SOCIAL', '431'), ('PAYROLL_TAX', '447')) AS v(r, c)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = 'SYSCOHADA_REVISE')
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults d WHERE d.framework_code = 'SYSCOHADA_REVISE' AND d.role_code = v.r);
INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
SELECT s.tenant_id, v.code, v.name, v.t
  FROM public.tenant_accounting_settings s
 CROSS JOIN (VALUES ('661', 'Rémunérations directes versées au personnel national', 'expense'), ('664', 'Charges sociales', 'expense'),
                    ('422', 'Personnel, rémunérations dues', 'liability'), ('431', 'Sécurité sociale', 'liability'),
                    ('447', 'État, impôts retenus à la source', 'liability')) AS v(code, name, t)
 WHERE s.framework_code = 'SYSCOHADA_REVISE'
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, v.r, g.id
  FROM public.tenant_accounting_settings s
 CROSS JOIN (VALUES ('PAYROLL_SALARIES', '661'), ('PAYROLL_EMPLOYER_CHARGES', '664'), ('PAYROLL_NET_PAYABLE', '422'),
                    ('PAYROLL_SOCIAL', '431'), ('PAYROLL_TAX', '447')) AS v(r, c)
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = v.c
 WHERE s.framework_code = 'SYSCOHADA_REVISE'
ON CONFLICT (tenant_id, role_code) DO NOTHING;

INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('hr.payroll_settings', 'hr', 'payroll_settings', 'Modifier les paramètres de paie')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, 'hr.payroll_settings' FROM (VALUES ('admin'), ('hr_admin')) AS v(r)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code = 'hr.payroll_settings' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

CREATE TABLE public.hr_payroll_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  employer_contribution_pct numeric NOT NULL DEFAULT 16.4 CHECK (employer_contribution_pct BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_payroll_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.hr_payroll_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.hr_payroll_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'hr.payroll_settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'hr.payroll_settings'));
GRANT SELECT, INSERT, UPDATE ON public.hr_payroll_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.post_payroll_run(_run_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.payroll_runs%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _entry_id uuid; _entry_number text;
  _gross numeric; _ded numeric; _tax numeric; _net numeric; _patronal numeric; _rate numeric;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'execute_payroll') THEN
    RAISE EXCEPTION 'Permission refusée: rôle Officier de Paie requis';
  END IF;
  SELECT * INTO _r FROM public.payroll_runs WHERE id = _run_id;
  IF _r.tenant_id IS NULL OR _r.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _r.status = 'posted' THEN RAISE EXCEPTION 'Cycle déjà comptabilisé'; END IF;
  IF _r.status <> 'approved' THEN RAISE EXCEPTION 'Le cycle doit être approuvé avant comptabilisation'; END IF;

  SELECT COALESCE(SUM(gross), 0), COALESCE(SUM(deductions), 0), COALESCE(SUM(taxes), 0), COALESCE(SUM(net), 0)
    INTO _gross, _ded, _tax, _net FROM public.payroll_lines WHERE run_id = _run_id;
  IF _gross <= 0 THEN RAISE EXCEPTION 'Cycle vide — aucune ligne à comptabiliser'; END IF;
  SELECT employer_contribution_pct INTO _rate FROM public.hr_payroll_settings WHERE tenant_id = _tenant;
  _patronal := ROUND(_gross * COALESCE(_rate, 16.4) / 100, 2);

  _entry_number := 'JE-PAY-' || _r.period || '-' || substr(_run_id::text, 1, 8);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, _entry_number, _r.pay_date, 'Paie ' || _r.period, 'payroll', 'draft', auth.uid())
  RETURNING id INTO _entry_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_SALARIES'), _gross, 0, 'Salaires bruts');
  IF _patronal > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_EMPLOYER_CHARGES'), _patronal, 0, 'Charges patronales');
  END IF;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_NET_PAYABLE'), 0, _net, 'Personnel — rémunérations dues');
  IF (_ded + _patronal) > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_SOCIAL'), 0, _ded + _patronal, 'Organismes sociaux');
  END IF;
  IF _tax > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_TAX'), 0, _tax, 'État — impôt sur salaires');
  END IF;

  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry_id;
  UPDATE public.payroll_runs
     SET status = 'posted', executed_by = auth.uid(), executed_at = now(), notes = COALESCE(notes, '') || ' | JE=' || _entry_number
   WHERE id = _run_id;
  RETURN _entry_id;
END $function$;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
