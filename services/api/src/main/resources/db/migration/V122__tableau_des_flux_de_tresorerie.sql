-- V122 — Tableau des flux de trésorerie SYSCOHADA (écart G-21, première tranche ; cadrage docs/audit-erp/17).
--
-- Méthode : grand livre, sans contrepartie à deviner. Par la partie double, la variation de la trésorerie nette
-- (comptes du périmètre de trésorerie, solde débiteur) est égale, sur la période, à la somme crédit − débit des
-- mouvements de tous les AUTRES comptes. Chaque mouvement d'un compte hors périmètre est rangé, selon son compte et
-- son sens (débit / crédit), dans une rubrique du TFT par la règle au préfixe le plus long (report_line_rules, même
-- mécanisme que le bilan et le compte de résultat ; balance_side désigne ici le SENS du mouvement). Le tableau est
-- donc équilibré par construction quand tout est classé ; ce qui ne l'est pas reste visible :
--   ZN  opérations sans effet de trésorerie (dotations / amortissements, VNC et sortie des immobilisations
--       cédées, provisions) : nul quand les deux côtés d'une opération sont neutres ;
--   ZU  mouvements non classés (aucune règle) ;
--   ZX  écart = trésorerie calculée (ZH) − trésorerie au bilan (ZK) = −(ZN + ZU).
-- Les brouillons sont exclus ; une contre-passation compte dans sa propre période ; l'écriture de détermination du
-- résultat (V121, source year_end_result) ne fait pas partie des flux. Une société change une affectation par
-- compte dans tenant_report_line_accounts (droit accounting.chart_admin) ; mettre un compte en ZA le place dans le
-- périmètre de trésorerie. Présentation à faire valider par l'expert-comptable avant tout dépôt.

ALTER TABLE public.report_layouts DROP CONSTRAINT report_layouts_kind_check;
ALTER TABLE public.report_layouts ADD CONSTRAINT report_layouts_kind_check CHECK (kind = ANY (ARRAY['income', 'balance', 'cashflow']));
ALTER TABLE public.report_lines DROP CONSTRAINT report_lines_kind_check;
ALTER TABLE public.report_lines ADD CONSTRAINT report_lines_kind_check CHECK (kind = ANY (ARRAY['detail', 'total', 'cash_open', 'cash_close']));

INSERT INTO public.report_layouts (code, name, kind, framework_code, description) VALUES
  ('TFT_SYSCOHADA', 'Tableau des flux de trésorerie SYSCOHADA', 'cashflow', 'SYSCOHADA_REVISE',
   'Flux opérationnels, d''investissement et de financement à partir du grand livre ; périmètre = rubrique ZA ; à valider par l''expert-comptable.');

INSERT INTO public.report_lines (layout_code, code, label, line_order, kind, formula) VALUES
  ('TFT_SYSCOHADA', 'ZA', 'Trésorerie nette au début de la période (A)', 10, 'cash_open', NULL),
  ('TFT_SYSCOHADA', 'FA', 'Capacité d''autofinancement globale (CAFG)', 20, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FB', 'Variation de l''actif circulant HAO', 30, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FC', 'Variation des stocks', 40, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FD', 'Variation des créances', 50, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FE', 'Variation du passif circulant', 60, 'detail', NULL),
  ('TFT_SYSCOHADA', 'ZB', 'Flux de trésorerie provenant des activités opérationnelles (B)', 70, 'total',
   '[["FA",1],["FB",1],["FC",1],["FD",1],["FE",1]]'),
  ('TFT_SYSCOHADA', 'FF', 'Décaissements liés aux acquisitions d''immobilisations incorporelles', 80, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FG', 'Décaissements liés aux acquisitions d''immobilisations corporelles', 90, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FH', 'Décaissements liés aux acquisitions d''immobilisations financières', 100, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FI', 'Encaissements liés aux cessions d''immobilisations incorporelles et corporelles', 110, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FJ', 'Encaissements liés aux cessions d''immobilisations financières', 120, 'detail', NULL),
  ('TFT_SYSCOHADA', 'ZC', 'Flux de trésorerie provenant des activités d''investissement (C)', 130, 'total',
   '[["FF",1],["FG",1],["FH",1],["FI",1],["FJ",1]]'),
  ('TFT_SYSCOHADA', 'FK', 'Augmentations de capital par apports nouveaux', 140, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FL', 'Subventions d''investissement reçues', 150, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FM', 'Prélèvements sur le capital', 160, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FN', 'Dividendes versés', 170, 'detail', NULL),
  ('TFT_SYSCOHADA', 'ZD', 'Flux de trésorerie provenant des capitaux propres (D)', 180, 'total',
   '[["FK",1],["FL",1],["FM",1],["FN",1]]'),
  ('TFT_SYSCOHADA', 'FO', 'Emprunts', 190, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FP', 'Autres dettes financières', 200, 'detail', NULL),
  ('TFT_SYSCOHADA', 'FQ', 'Remboursements des emprunts et autres dettes financières', 210, 'detail', NULL),
  ('TFT_SYSCOHADA', 'ZE', 'Flux de trésorerie provenant des capitaux étrangers (E)', 220, 'total', '[["FO",1],["FP",1],["FQ",1]]'),
  ('TFT_SYSCOHADA', 'ZF', 'Flux de trésorerie provenant des activités de financement (F = D + E)', 230, 'total', '[["ZD",1],["ZE",1]]'),
  ('TFT_SYSCOHADA', 'ZG', 'Variation de la trésorerie nette de la période (G = B + C + F)', 240, 'total', '[["ZB",1],["ZC",1],["ZF",1]]'),
  ('TFT_SYSCOHADA', 'ZH', 'Trésorerie nette à la fin de la période (H = G + A)', 250, 'total', '[["ZG",1],["ZA",1]]'),
  ('TFT_SYSCOHADA', 'ZK', 'Contrôle : trésorerie nette au bilan à la fin de la période', 260, 'cash_close', NULL),
  ('TFT_SYSCOHADA', 'ZN', 'Contrôle : opérations sans effet de trésorerie (doit être nul)', 270, 'detail', NULL),
  ('TFT_SYSCOHADA', 'ZU', 'Contrôle : mouvements non classés (doit être nul)', 280, 'detail', NULL),
  ('TFT_SYSCOHADA', 'ZX', 'Écart à justifier (H − trésorerie au bilan)', 290, 'total', '[["ZH",1],["ZK",-1]]');

-- Règles par défaut (référentiel SYSCOHADA révisé). Préfixe le plus long, puis le sens exact avant « any ».
INSERT INTO public.report_line_rules (layout_code, line_code, prefix, balance_side)
SELECT 'TFT_SYSCOHADA', r.line, r.prefix, r.side FROM (VALUES
  -- Périmètre de trésorerie : classe 5 (titres de placement, banques, caisse, virements internes, crédits de trésorerie).
  ('ZA', '5', 'any'),
  -- Exploitation : charges et produits encaissables / décaissables ; les éléments calculés sont neutralisés plus bas.
  ('FA', '6', 'any'), ('FA', '7', 'any'), ('FA', '8', 'any'),
  ('FB', '488', 'any'),
  ('FC', '3', 'any'),
  ('FD', '409', 'any'), ('FD', '41', 'any'), ('FD', '445', 'any'), ('FD', '476', 'any'),
  ('FE', '4', 'any'), ('FE', '40', 'any'), ('FE', '419', 'any'),
  -- Investissement : acquisitions au débit, dettes sur acquisitions dans la même rubrique (décaissement réel).
  ('FF', '20', 'any'), ('FF', '21', 'debit'), ('FG', '22', 'debit'), ('FG', '23', 'debit'), ('FG', '24', 'debit'), ('FG', '25', 'debit'),
  ('FG', '481', 'any'), ('FG', '482', 'any'),
  ('FH', '26', 'debit'), ('FH', '27', 'debit'),
  ('FI', '82', 'any'), ('FI', '485', 'any'),
  ('FJ', '826', 'any'), ('FJ', '27', 'credit'),
  -- Financement.
  ('FK', '10', 'credit'), ('FM', '10', 'debit'),
  ('FL', '14', 'credit'),
  ('FN', '11', 'any'), ('FN', '12', 'any'), ('FN', '13', 'any'), ('FN', '465', 'any'),
  ('FO', '16', 'credit'), ('FP', '17', 'credit'), ('FP', '18', 'credit'),
  ('FQ', '16', 'debit'), ('FQ', '17', 'debit'), ('FQ', '18', 'debit'),
  -- Sans effet de trésorerie : dotations et reprises, VNC et sortie des immobilisations cédées, amortissements,
  -- dépréciations et provisions, quote-part de subvention virée au résultat.
  ('ZN', '68', 'any'), ('ZN', '69', 'any'), ('ZN', '79', 'any'), ('ZN', '81', 'any'), ('ZN', '85', 'any'), ('ZN', '86', 'any'),
  ('ZN', '28', 'any'), ('ZN', '29', 'any'), ('ZN', '39', 'any'), ('ZN', '49', 'any'), ('ZN', '15', 'any'), ('ZN', '19', 'any'),
  ('ZN', '21', 'credit'), ('ZN', '22', 'credit'), ('ZN', '23', 'credit'), ('ZN', '24', 'credit'), ('ZN', '25', 'credit'),
  ('ZN', '26', 'credit'), ('ZN', '14', 'debit')
) AS r(line, prefix, side);

-- Rubrique d'un mouvement (compte × sens) : exception de la société, sinon règle au préfixe le plus long, sinon ZU.
CREATE FUNCTION public.cash_flow_line_of(_layout text, _tenant uuid, _account uuid, _code text, _side text)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT COALESCE(o.line_code, 'ZU') FROM public.tenant_report_line_accounts o
      WHERE o.tenant_id = _tenant AND o.layout_code = _layout AND o.account_id = _account),
    (SELECT r.line_code FROM public.report_line_rules r
      WHERE r.layout_code = _layout AND _code LIKE r.prefix || '%' AND r.balance_side IN ('any', _side)
      ORDER BY length(r.prefix) DESC, (r.balance_side <> 'any') DESC LIMIT 1),
    'ZU')
$$;

-- Détail par compte et par sens : rubrique, montant (crédit = +, débit = −). Les comptes du périmètre n'y figurent pas.
CREATE FUNCTION public.cash_flow_details(_layout text, _from date, _to date)
RETURNS TABLE (line_code text, account_code text, account_name text, side text, amount numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (SELECT public.get_user_tenant_id(auth.uid()) AS id),
  mvt AS (
    SELECT g.id, g.code, g.name, sum(jl.debit) AS debit, sum(jl.credit) AS credit
      FROM public.journal_lines jl
      JOIN public.journal_entries je ON je.id = jl.entry_id
      JOIN public.gl_accounts g ON g.id = jl.account_id
     WHERE je.tenant_id = (SELECT id FROM t) AND je.status IN ('posted', 'reversed') AND je.source <> 'year_end_result'
       AND je.entry_date BETWEEN _from AND _to
     GROUP BY g.id, g.code, g.name),
  sides AS (
    SELECT m.id, m.code, m.name, 'debit'::text AS side, -m.debit AS amount FROM mvt m WHERE m.debit <> 0
    UNION ALL
    SELECT m.id, m.code, m.name, 'credit', m.credit FROM mvt m WHERE m.credit <> 0),
  classed AS (
    SELECT public.cash_flow_line_of(_layout, (SELECT id FROM t), s.id, s.code, s.side) AS lc, s.* FROM sides s)
  SELECT c.lc, c.code, c.name, c.side, round(c.amount, 2) FROM classed c
   WHERE c.lc <> 'ZA' ORDER BY c.lc, c.code, c.side
$$;

-- Solde du périmètre de trésorerie à une date (incluse).
CREATE FUNCTION public.cash_flow_cash_balance(_layout text, _tenant uuid, _at date)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(sum(s.solde), 0) FROM (
    SELECT g.id, g.code, sum(jl.debit - jl.credit) AS solde
      FROM public.journal_lines jl
      JOIN public.journal_entries je ON je.id = jl.entry_id
      JOIN public.gl_accounts g ON g.id = jl.account_id
     WHERE je.tenant_id = _tenant AND je.status IN ('posted', 'reversed') AND je.entry_date <= _at
     GROUP BY g.id, g.code) s
   WHERE public.cash_flow_line_of(_layout, _tenant, s.id, s.code, 'debit') = 'ZA'
$$;

CREATE FUNCTION public.cash_flow_compute(_layout text, _tenant uuid, _from date, _to date)
RETURNS TABLE (line_code text, label text, line_order integer, kind text, amount numeric)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  _l record; _vals jsonb := '{}'::jsonb; _v numeric; _f jsonb;
BEGIN
  IF _tenant IS DISTINCT FROM public.get_user_tenant_id(auth.uid()) THEN
    RAISE EXCEPTION 'Société non autorisée' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.report_layouts rl WHERE rl.code = _layout AND rl.kind = 'cashflow') THEN
    RAISE EXCEPTION 'Modèle de tableau des flux inconnu : %', _layout USING ERRCODE = 'QG019';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'Période invalide pour le tableau des flux' USING ERRCODE = '22023';
  END IF;
  FOR _l IN SELECT d.line_code AS lc, sum(d.amount) AS v FROM public.cash_flow_details(_layout, _from, _to) d GROUP BY 1 LOOP
    _vals := _vals || jsonb_build_object(_l.lc, _l.v);
  END LOOP;
  FOR _l IN SELECT * FROM public.report_lines r WHERE r.layout_code = _layout ORDER BY r.line_order LOOP
    IF _l.kind = 'cash_open' THEN
      _v := public.cash_flow_cash_balance(_layout, _tenant, _from - 1);
    ELSIF _l.kind = 'cash_close' THEN
      _v := public.cash_flow_cash_balance(_layout, _tenant, _to);
    ELSIF _l.kind = 'detail' THEN
      _v := COALESCE((_vals ->> _l.code)::numeric, 0);
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
END $$;

-- Même point d'entrée que le bilan et le compte de résultat : l'écran et l'API choisissent un modèle.
CREATE OR REPLACE FUNCTION public.financial_statement(_layout text, _from date, _to date)
RETURNS TABLE(line_code text, label text, line_order integer, kind text, amount numeric)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.report_layouts rl WHERE rl.code = _layout AND rl.kind = 'cashflow') THEN
    RETURN QUERY SELECT * FROM public.cash_flow_compute(_layout, public.get_user_tenant_id(auth.uid()), _from, COALESCE(_to, CURRENT_DATE));
  ELSE
    RETURN QUERY SELECT * FROM public.report_compute(_layout, public.get_user_tenant_id(auth.uid()), COALESCE(_from, '1900-01-01'::date), COALESCE(_to, CURRENT_DATE));
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.cash_flow_line_of(text, uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cash_flow_cash_balance(text, uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cash_flow_compute(text, uuid, date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cash_flow_details(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_flow_line_of(text, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_flow_cash_balance(text, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_flow_compute(text, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_flow_details(text, date, date) TO authenticated;
