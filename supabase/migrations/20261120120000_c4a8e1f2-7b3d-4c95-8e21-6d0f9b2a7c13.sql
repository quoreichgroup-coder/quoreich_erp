-- V123 — Notes annexes SYSCOHADA (écart G-21, seconde tranche).
--
-- Les notes chiffrées sont calculées par la base sur le grand livre, à partir d'un référentiel en données (aucun numéro
-- de compte dans l'écran ni dans le code) :
--   annex_notes        une note : code SYSCOHADA (« 3A »…), titre, nature
--                        'balance'  tableau de mouvements : solde d'ouverture, augmentations, diminutions, solde de clôture
--                        'flow'     montant de la période (charges ou produits), comparatif N-1 à l'écran
--                        'text'     note rédigée (déclaration de conformité, règles et méthodes…)
--                      et sens normal (débit : actif / charges ; crédit : passif / produits) ;
--   annex_note_groups  rubriques d'une note, chacune par préfixes de comptes ; un compte va à la rubrique de son préfixe
--                      le plus long dans la note (pas de double compte).
-- Le commentaire de chaque note (méthodes, événements, précisions) est propre à la société et à la date d'arrêté
-- (annex_note_texts, droit accounting.annex). Brouillons exclus ; l'écriture de détermination du résultat (V121) n'entre
-- pas dans les montants de période. Référentiel à valider par l'expert-comptable ; il ne couvre pas encore les notes
-- non comptables (effectifs, engagements hors bilan), qui se rédigent en texte.

CREATE TABLE public.annex_notes (
  code text PRIMARY KEY CHECK (code ~ '^[0-9]{1,2}[A-Z]?$'),
  framework_code text NOT NULL REFERENCES public.accounting_frameworks(code),
  title text NOT NULL,
  line_order integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('balance', 'flow', 'text')),
  normal_side text NOT NULL DEFAULT 'debit' CHECK (normal_side IN ('debit', 'credit')),
  guidance text
);
CREATE TABLE public.annex_note_groups (
  note_code text NOT NULL REFERENCES public.annex_notes(code) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  prefixes text[] NOT NULL CHECK (cardinality(prefixes) > 0),
  line_order integer NOT NULL,
  PRIMARY KEY (note_code, code)
);
CREATE TABLE public.annex_note_texts (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  note_code text NOT NULL REFERENCES public.annex_notes(code),
  period_end date NOT NULL,
  body text NOT NULL CHECK (length(body) <= 20000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid(),
  PRIMARY KEY (tenant_id, note_code, period_end)
);

ALTER TABLE public.annex_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annex_note_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annex_note_texts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture du référentiel" ON public.annex_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lecture du référentiel" ON public.annex_note_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lecture société" ON public.annex_note_texts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Rédaction habilitée" ON public.annex_note_texts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.annex'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.annex'));
GRANT SELECT ON public.annex_notes, public.annex_note_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.annex_note_texts TO authenticated;

-- ─── Référentiel SYSCOHADA révisé (premier jeu, à valider) ───
INSERT INTO public.annex_notes (code, framework_code, title, line_order, kind, normal_side, guidance) VALUES
  ('1', 'SYSCOHADA_REVISE', 'Déclaration de conformité au SYSCOHADA', 10, 'text', 'debit',
   'Référentiel appliqué, système (normal ou minimal), dérogations éventuelles et leur justification.'),
  ('2', 'SYSCOHADA_REVISE', 'Règles et méthodes comptables', 20, 'text', 'debit',
   'Méthodes d''évaluation (coût historique), d''amortissement, de valorisation des stocks, de dépréciation, de conversion des devises.'),
  ('3A', 'SYSCOHADA_REVISE', 'Immobilisations brutes', 30, 'balance', 'debit', 'Valeurs brutes : acquisitions et sorties de l''exercice.'),
  ('3C', 'SYSCOHADA_REVISE', 'Amortissements', 40, 'balance', 'credit', 'Dotations de l''exercice et amortissements des immobilisations sorties.'),
  ('6', 'SYSCOHADA_REVISE', 'Stocks et en-cours', 50, 'balance', 'debit', 'Méthode de valorisation à préciser (coût moyen pondéré, PEPS).'),
  ('7', 'SYSCOHADA_REVISE', 'Clients', 60, 'balance', 'debit', 'Créances douteuses et avances reçues à commenter.'),
  ('11', 'SYSCOHADA_REVISE', 'Trésorerie', 70, 'balance', 'debit', 'Comptes bancaires, caisses, monnaie électronique ; crédits de trésorerie en solde créditeur.'),
  ('16A', 'SYSCOHADA_REVISE', 'Dettes financières', 80, 'balance', 'credit', 'Emprunts nouveaux, remboursements, échéancier et garanties à commenter.'),
  ('17', 'SYSCOHADA_REVISE', 'Fournisseurs d''exploitation', 90, 'balance', 'credit', 'Factures non parvenues et avances versées.'),
  ('18', 'SYSCOHADA_REVISE', 'Dettes fiscales et sociales', 100, 'balance', 'credit', 'Personnel, organismes sociaux, État.'),
  ('21', 'SYSCOHADA_REVISE', 'Chiffre d''affaires et autres produits', 110, 'flow', 'credit', 'Ventilation par activité et par zone à commenter.'),
  ('22', 'SYSCOHADA_REVISE', 'Achats', 120, 'flow', 'debit', NULL),
  ('25', 'SYSCOHADA_REVISE', 'Impôts et taxes', 130, 'flow', 'debit', NULL),
  ('27', 'SYSCOHADA_REVISE', 'Charges de personnel', 140, 'flow', 'debit', 'Effectifs moyens et rémunérations des dirigeants à indiquer en texte.');

INSERT INTO public.annex_note_groups (note_code, code, label, prefixes, line_order) VALUES
  ('3A', '21', 'Immobilisations incorporelles', '{21}', 10),
  ('3A', '22', 'Terrains', '{22}', 20),
  ('3A', '23', 'Bâtiments, installations techniques et agencements', '{23}', 30),
  ('3A', '24', 'Matériel, mobilier et actifs biologiques', '{24}', 40),
  ('3A', '25', 'Avances et acomptes versés sur immobilisations', '{25}', 50),
  ('3A', '26', 'Titres de participation', '{26}', 60),
  ('3A', '27', 'Autres immobilisations financières', '{27}', 70),
  ('3C', '281', 'Amortissements des immobilisations incorporelles', '{281}', 10),
  ('3C', '282', 'Amortissements des terrains', '{282}', 20),
  ('3C', '283', 'Amortissements des bâtiments, installations et agencements', '{283}', 30),
  ('3C', '284', 'Amortissements du matériel, mobilier et actifs biologiques', '{284}', 40),
  ('6', '31', 'Marchandises', '{31}', 10),
  ('6', '32', 'Matières premières et fournitures liées', '{32}', 20),
  ('6', '33', 'Autres approvisionnements', '{33}', 30),
  ('6', '34', 'Produits et services en cours', '{34,35}', 40),
  ('6', '36', 'Produits finis et intermédiaires', '{36,37}', 50),
  ('6', '38', 'Stocks en cours de route, en consignation ou en dépôt', '{38}', 60),
  ('7', '411', 'Clients', '{411,412,413,414,415,417}', 10),
  ('7', '416', 'Créances litigieuses ou douteuses', '{416}', 20),
  ('7', '418', 'Clients, produits à recevoir', '{418}', 30),
  ('7', '419', 'Clients créditeurs (avances et acomptes reçus)', '{419}', 40),
  ('11', '50', 'Titres de placement', '{50}', 10),
  ('11', '51', 'Valeurs à encaisser', '{51}', 20),
  ('11', '52', 'Banques, établissements financiers et assimilés', '{52,53,54,55}', 30),
  ('11', '56', 'Banques, crédits de trésorerie et d''escompte', '{56}', 40),
  ('11', '57', 'Caisse', '{57}', 50),
  ('11', '58', 'Régies d''avances et virements internes', '{58}', 60),
  ('16A', '16', 'Emprunts et dettes assimilées', '{16}', 10),
  ('16A', '17', 'Dettes de location-acquisition', '{17}', 20),
  ('16A', '18', 'Dettes liées à des participations et comptes de liaison', '{18}', 30),
  ('17', '401', 'Fournisseurs', '{401,402,403,404,405,406,407}', 10),
  ('17', '408', 'Fournisseurs, factures non parvenues', '{408}', 20),
  ('17', '409', 'Fournisseurs débiteurs (avances et acomptes versés)', '{409}', 30),
  ('18', '42', 'Personnel', '{42}', 10),
  ('18', '43', 'Organismes sociaux', '{43}', 20),
  ('18', '44', 'État et collectivités publiques', '{44}', 30),
  ('21', '701', 'Ventes de marchandises', '{701}', 10),
  ('21', '702', 'Ventes de produits fabriqués', '{702,703,704}', 20),
  ('21', '705', 'Travaux et services vendus', '{705,706}', 30),
  ('21', '707', 'Produits accessoires', '{707}', 40),
  ('21', '71', 'Subventions d''exploitation', '{71}', 50),
  ('21', '75', 'Autres produits', '{75}', 60),
  ('22', '601', 'Achats de marchandises', '{601}', 10),
  ('22', '602', 'Achats de matières premières et fournitures liées', '{602}', 20),
  ('22', '604', 'Autres achats', '{604,605,608}', 30),
  ('22', '603', 'Variations de stocks', '{603}', 40),
  ('25', '64', 'Impôts et taxes', '{64}', 10),
  ('27', '661', 'Rémunérations directes versées au personnel', '{661,662}', 10),
  ('27', '663', 'Indemnités forfaitaires et avantages', '{663,665,667,668}', 20),
  ('27', '664', 'Charges sociales', '{664}', 30),
  ('27', '666', 'Rémunération de l''exploitant individuel', '{666}', 40);

-- ─── Calcul : une ligne par compte mouvementé ou soldé, rattaché à la rubrique de son préfixe le plus long ───
CREATE FUNCTION public.annex_note_lines(_note text, _from date, _to date)
RETURNS TABLE (group_code text, group_label text, group_order integer, account_code text, account_name text,
               opening numeric, increase numeric, decrease numeric, closing numeric)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE _n public.annex_notes%ROWTYPE; _s numeric;
BEGIN
  SELECT * INTO _n FROM public.annex_notes WHERE code = _note;
  IF NOT FOUND THEN RAISE EXCEPTION 'Note annexe inconnue : %', _note USING ERRCODE = 'QG019'; END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN RAISE EXCEPTION 'Période invalide pour la note annexe' USING ERRCODE = '22023'; END IF;
  IF _n.kind = 'text' THEN RETURN; END IF;
  _s := CASE WHEN _n.normal_side = 'debit' THEN 1 ELSE -1 END;
  RETURN QUERY
  WITH acc AS (
    SELECT g.id, g.code, g.name,
           (SELECT ng.code FROM public.annex_note_groups ng, unnest(ng.prefixes) p
             WHERE ng.note_code = _note AND g.code LIKE p || '%' ORDER BY length(p) DESC, ng.line_order LIMIT 1) AS grp
      FROM public.gl_accounts g
     WHERE g.tenant_id = public.get_user_tenant_id(auth.uid())),
  mv AS (
    SELECT a.id, a.code, a.name, a.grp,
           COALESCE(sum(jl.debit - jl.credit) FILTER (WHERE je.entry_date < _from), 0) AS ouverture,
           COALESCE(sum(jl.debit) FILTER (WHERE je.entry_date BETWEEN _from AND _to AND (_n.kind = 'balance' OR je.source <> 'year_end_result')), 0) AS d,
           COALESCE(sum(jl.credit) FILTER (WHERE je.entry_date BETWEEN _from AND _to AND (_n.kind = 'balance' OR je.source <> 'year_end_result')), 0) AS c
      FROM acc a
      JOIN public.journal_lines jl ON jl.account_id = a.id
      JOIN public.journal_entries je ON je.id = jl.entry_id AND je.status IN ('posted', 'reversed') AND je.entry_date <= _to
     WHERE a.grp IS NOT NULL
     GROUP BY a.id, a.code, a.name, a.grp)
  SELECT ng.code, ng.label, ng.line_order, m.code, m.name,
         CASE WHEN _n.kind = 'balance' THEN round(_s * m.ouverture, 2) ELSE 0 END,
         round(CASE WHEN _s > 0 THEN m.d ELSE m.c END, 2),
         round(CASE WHEN _s > 0 THEN m.c ELSE m.d END, 2),
         round(CASE WHEN _n.kind = 'balance' THEN _s * m.ouverture ELSE 0 END + _s * (m.d - m.c), 2)
    FROM mv m JOIN public.annex_note_groups ng ON ng.note_code = _note AND ng.code = m.grp
   WHERE (_n.kind = 'balance' AND m.ouverture <> 0) OR m.d <> 0 OR m.c <> 0
   ORDER BY ng.line_order, m.code;
END $$;
REVOKE EXECUTE ON FUNCTION public.annex_note_lines(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.annex_note_lines(text, date, date) TO authenticated;

-- ─── Droit de rédaction ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('accounting.annex', 'accounting', 'annex', 'Rédiger les notes annexes des états financiers')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code) VALUES
  ('admin', 'accounting.annex'), ('accountant', 'accounting.annex')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND sp.permission_code = 'accounting.annex'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

SELECT public.install_tenant_isolation_triggers();
