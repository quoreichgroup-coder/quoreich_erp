-- V71 — Relevés bancaires et rapprochement (lot T2, suite de V70 ; audit docs/audit-erp/13 §5).
--
-- Constats : tables de relevés et de rapprochement présentes mais aucun écran d'import ni de
-- rapprochement (onglet de démonstration) ; aucun contrôle du relevé (solde initial + lignes = solde
-- final), ni de continuité avec le relevé précédent, ni des lignes déjà importées ; validation d'un
-- rapprochement sans contrôle ; un même mouvement pouvait être rapproché de deux lignes.
--
-- Comme SAP (relevé électronique : contrôle des soldes, rapprochement automatique puis manuel,
-- comptabilisation des postes inconnus de l'ERP) et Sage (rapprochement bancaire, état de
-- rapprochement) :
-- 1. import_bank_statement(compte, fichier, période, solde initial, solde final, lignes) — droit
--    treasury.import_statement : relevé équilibré, continu avec le précédent (paramètre
--    statement_continuity_check), période non chevauchante, lignes jamais importées (empreinte par
--    compte), puis rapprochement automatique.
-- 2. auto_match_statement : une ligne n'est rapprochée que si UN SEUL mouvement non rapproché du compte
--    convient (montant à la tolérance près, date dans la fenêtre, même référence si les deux en ont une).
-- 3. Manuel (droit treasury.match) : rapprocher / annuler par la table (garde V70) ; un mouvement ne se
--    rapproche que d'une ligne. post_statement_line(ligne, contrepartie, libellé) — treasury.create_txn :
--    poste inconnu de l'ERP (frais, agios) comptabilisé en BQ et rapproché.
-- 4. prepare_bank_reconciliation(compte, date) : état de rapprochement (solde du relevé, solde
--    comptable, mouvements en suspens) ; validate_bank_reconciliation — treasury.validate_recon : refusé
--    tant qu'une ligne de relevé de la période n'est pas rapprochée ou que l'écart n'est pas justifié.
-- Erreurs métier : QG023 (V70).

ALTER TABLE public.treasury_settings ADD COLUMN statement_continuity_check boolean NOT NULL DEFAULT true;

ALTER TABLE public.bank_statements ALTER COLUMN status SET DEFAULT 'imported';
ALTER TABLE public.bank_statements ADD CONSTRAINT bank_statements_status_check CHECK (status IN ('imported', 'cancelled'));
ALTER TABLE public.bank_statement_lines
  ADD COLUMN bank_account_id uuid REFERENCES public.bank_accounts(id),
  ADD COLUMN fingerprint text,
  ADD COLUMN line_no integer;
UPDATE public.bank_statement_lines l SET bank_account_id = s.bank_account_id FROM public.bank_statements s WHERE s.id = l.statement_id;
CREATE UNIQUE INDEX bank_statement_lines_fingerprint ON public.bank_statement_lines (bank_account_id, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE UNIQUE INDEX bank_statement_lines_one_match ON public.bank_statement_lines (matched_transaction_id) WHERE matched_transaction_id IS NOT NULL;

ALTER TABLE public.bank_reconciliations
  ADD COLUMN outstanding_receipts numeric(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN outstanding_payments numeric(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN unmatched_statement_lines integer NOT NULL DEFAULT 0,
  ADD COLUMN statement_id uuid REFERENCES public.bank_statements(id);

-- 2. Rapprochement automatique (sans ambiguïté).
CREATE OR REPLACE FUNCTION public.auto_match_statement(_statement uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.bank_statements%ROWTYPE; _l record; _tol numeric; _win int; _cand uuid[]; _n int := 0;
BEGIN
  SELECT * INTO _s FROM public.bank_statements WHERE id = _statement AND tenant_id = public.get_user_tenant_id(auth.uid());
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Relevé introuvable' USING ERRCODE = 'QG023'; END IF;
  IF NOT (public.has_permission(auth.uid(), 'treasury.match') OR public.has_permission(auth.uid(), 'treasury.import_statement')) THEN
    RAISE EXCEPTION 'Droit insuffisant : rapprocher les relevés' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(ts.match_amount_tolerance, 0), COALESCE(ts.match_date_window_days, 3) INTO _tol, _win
    FROM (SELECT 1) x LEFT JOIN public.treasury_settings ts ON ts.tenant_id = _s.tenant_id;
  _tol := COALESCE(_tol, 0); _win := COALESCE(_win, 3);
  FOR _l IN SELECT * FROM public.bank_statement_lines WHERE statement_id = _statement AND matched_transaction_id IS NULL ORDER BY line_date, line_no LOOP
    SELECT array_agg(t.id ORDER BY t.transaction_date) INTO _cand FROM public.bank_transactions t
     WHERE t.bank_account_id = _s.bank_account_id AND NOT t.is_reconciled
       AND abs(t.amount - _l.amount) <= _tol AND abs(t.transaction_date - _l.line_date) <= _win
       AND NOT EXISTS (SELECT 1 FROM public.bank_statement_lines o WHERE o.matched_transaction_id = t.id)
       AND (_l.reference IS NULL OR t.reference IS NULL OR upper(btrim(t.reference)) = upper(btrim(_l.reference))
            OR position(upper(btrim(t.reference)) IN upper(COALESCE(_l.description, '') || ' ' || _l.reference)) > 0);
    IF cardinality(_cand) = 1 THEN
      UPDATE public.bank_statement_lines SET matched_transaction_id = _cand[1], matched_by = auth.uid() WHERE id = _l.id;
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END $function$;
REVOKE ALL ON FUNCTION public.auto_match_statement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_match_statement(uuid) TO authenticated;

-- 1. Import contrôlé. _lines : [{date, label, amount, reference}] (montant signé : + crédit en banque).
CREATE OR REPLACE FUNCTION public.import_bank_statement(_account uuid, _file_name text, _period_start date, _period_end date,
                                                        _opening numeric, _closing numeric, _lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _b public.bank_accounts%ROWTYPE; _id uuid; _sum numeric; _prev public.bank_statements%ROWTYPE; _dup text; _n int; _auto int;
  _continuity boolean;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'treasury.import_statement') THEN
    RAISE EXCEPTION 'Droit insuffisant : importer un relevé bancaire' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _b FROM public.bank_accounts WHERE id = _account AND tenant_id = _tenant AND is_active;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Compte de trésorerie introuvable ou inactif' USING ERRCODE = 'QG023'; END IF;
  IF _period_start IS NULL OR _period_end IS NULL OR _period_end < _period_start THEN RAISE EXCEPTION 'Période du relevé invalide' USING ERRCODE = 'QG023'; END IF;
  IF _opening IS NULL OR _closing IS NULL THEN RAISE EXCEPTION 'Soldes initial et final du relevé obligatoires' USING ERRCODE = 'QG023'; END IF;
  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'Relevé sans ligne' USING ERRCODE = 'QG023'; END IF;
  IF jsonb_array_length(_lines) > 20000 THEN RAISE EXCEPTION 'Relevé trop volumineux (20 000 lignes au plus)' USING ERRCODE = 'QG023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) v WHERE (v ->> 'date') IS NULL OR (v ->> 'amount') IS NULL
               OR (v ->> 'date')::date NOT BETWEEN _period_start AND _period_end) THEN
    RAISE EXCEPTION 'Chaque ligne doit avoir une date dans la période du relevé et un montant' USING ERRCODE = 'QG023';
  END IF;
  SELECT round(sum((v ->> 'amount')::numeric), 2) INTO _sum FROM jsonb_array_elements(_lines) v;
  IF round(_opening + _sum, 2) <> round(_closing, 2) THEN
    RAISE EXCEPTION 'Relevé déséquilibré : solde initial % + mouvements % = %, solde final indiqué %', _opening, _sum, round(_opening + _sum, 2), _closing
      USING ERRCODE = 'QG023', HINT = 'Vérifier le solde final ou les lignes du fichier.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bank_statements s WHERE s.bank_account_id = _account AND s.status = 'imported'
               AND daterange(s.period_start, s.period_end, '[]') && daterange(_period_start, _period_end, '[]')) THEN
    RAISE EXCEPTION 'Un relevé de ce compte couvre déjà tout ou partie de la période' USING ERRCODE = 'QG023';
  END IF;
  SELECT COALESCE((SELECT s.statement_continuity_check FROM public.treasury_settings s WHERE s.tenant_id = _tenant), true) INTO _continuity;
  SELECT * INTO _prev FROM public.bank_statements WHERE bank_account_id = _account AND status = 'imported' AND period_end < _period_start
   ORDER BY period_end DESC LIMIT 1;
  IF _continuity AND _prev.id IS NOT NULL AND _prev.closing_balance <> round(_opening, 2) THEN
    RAISE EXCEPTION 'Solde initial % différent du solde final du relevé précédent (% au %)', _opening, _prev.closing_balance, _prev.period_end
      USING ERRCODE = 'QG023', HINT = 'Contrôle de continuité : paramètre de trésorerie désactivable.';
  END IF;

  INSERT INTO public.bank_statements (tenant_id, bank_account_id, statement_date, period_start, period_end, opening_balance, closing_balance, file_name, status, imported_by)
  VALUES (_tenant, _account, _period_end, _period_start, _period_end, round(_opening, 2), round(_closing, 2), NULLIF(btrim(_file_name), ''), 'imported', auth.uid())
  RETURNING id INTO _id;
  WITH src AS (
    SELECT x.n::int AS line_no, (x.v ->> 'date')::date AS d, left(NULLIF(btrim(x.v ->> 'label'), ''), 500) AS label,
           round((x.v ->> 'amount')::numeric, 2) AS amount, NULLIF(btrim(x.v ->> 'reference'), '') AS ref
      FROM jsonb_array_elements(_lines) WITH ORDINALITY AS x(v, n)),
  fp AS (
    SELECT src.*, md5(d::text || '|' || amount::text || '|' || COALESCE(upper(ref), '') || '|' || COALESCE(upper(label), '') || '|'
             || row_number() OVER (PARTITION BY d, amount, upper(ref), upper(label) ORDER BY line_no)) AS f
      FROM src)
  SELECT string_agg(to_char(fp.d, 'DD/MM/YYYY') || ' ' || fp.amount, ', ') INTO _dup
    FROM fp JOIN public.bank_statement_lines o ON o.bank_account_id = _account AND o.fingerprint = fp.f;
  IF _dup IS NOT NULL THEN
    RAISE EXCEPTION 'Lignes déjà importées dans un relevé précédent : %', left(_dup, 300) USING ERRCODE = 'QG023';
  END IF;
  INSERT INTO public.bank_statement_lines (tenant_id, statement_id, bank_account_id, line_no, line_date, description, amount, reference, fingerprint)
  SELECT _tenant, _id, _account, line_no, d, label, amount, ref,
         md5(d::text || '|' || amount::text || '|' || COALESCE(upper(ref), '') || '|' || COALESCE(upper(label), '') || '|'
             || row_number() OVER (PARTITION BY d, amount, upper(ref), upper(label) ORDER BY line_no))
    FROM (SELECT x.n::int AS line_no, (x.v ->> 'date')::date AS d, left(NULLIF(btrim(x.v ->> 'label'), ''), 500) AS label,
                 round((x.v ->> 'amount')::numeric, 2) AS amount, NULLIF(btrim(x.v ->> 'reference'), '') AS ref
            FROM jsonb_array_elements(_lines) WITH ORDINALITY AS x(v, n)) s;
  GET DIAGNOSTICS _n = ROW_COUNT;
  _auto := public.auto_match_statement(_id);
  RETURN jsonb_build_object('releve', _id, 'lignes', _n, 'rapprochees', _auto);
END $function$;
REVOKE ALL ON FUNCTION public.import_bank_statement(uuid, text, date, date, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bank_statement(uuid, text, date, date, numeric, numeric, jsonb) TO authenticated;

-- Annuler un relevé (aucune ligne rapprochée) pour le réimporter corrigé.
CREATE OR REPLACE FUNCTION public.cancel_bank_statement(_statement uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _s public.bank_statements%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'treasury.import_statement') THEN RAISE EXCEPTION 'Droit insuffisant : importer un relevé bancaire' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _s FROM public.bank_statements WHERE id = _statement AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF _s.id IS NULL OR _s.status <> 'imported' THEN RAISE EXCEPTION 'Relevé introuvable ou déjà annulé' USING ERRCODE = 'QG023'; END IF;
  IF EXISTS (SELECT 1 FROM public.bank_statement_lines WHERE statement_id = _statement AND matched_transaction_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Relevé rapproché : annuler d''abord les rapprochements de ses lignes' USING ERRCODE = 'QG023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bank_reconciliations WHERE statement_id = _statement AND status = 'validated') THEN
    RAISE EXCEPTION 'Relevé cité par un rapprochement validé' USING ERRCODE = 'QG023';
  END IF;
  UPDATE public.bank_statement_lines SET fingerprint = NULL WHERE statement_id = _statement;
  UPDATE public.bank_statements SET status = 'cancelled', updated_at = now() WHERE id = _statement;
END $function$;
REVOKE ALL ON FUNCTION public.cancel_bank_statement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_bank_statement(uuid) TO authenticated;

-- 3. Ligne du relevé inconnue de l'ERP (frais, agios, intérêts) : comptabilisée et rapprochée.
CREATE OR REPLACE FUNCTION public.post_statement_line(_line uuid, _counter_account uuid, _description text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _l public.bank_statement_lines%ROWTYPE; _t uuid;
BEGIN
  SELECT * INTO _l FROM public.bank_statement_lines WHERE id = _line AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF _l.id IS NULL THEN RAISE EXCEPTION 'Ligne de relevé introuvable' USING ERRCODE = 'QG023'; END IF;
  IF _l.matched_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'Ligne déjà rapprochée' USING ERRCODE = 'QG023'; END IF;
  IF NOT public.has_permission(auth.uid(), 'treasury.match') THEN RAISE EXCEPTION 'Droit insuffisant : rapprocher les relevés' USING ERRCODE = '42501'; END IF;
  _t := public.record_treasury_movement(_l.bank_account_id, _l.line_date, _l.amount, _counter_account,
          COALESCE(NULLIF(btrim(_description), ''), _l.description, 'Ligne de relevé'), _l.reference);
  UPDATE public.bank_transactions SET source = 'statement' WHERE id = _t;
  UPDATE public.bank_statement_lines SET matched_transaction_id = _t, matched_by = auth.uid() WHERE id = _line;
  RETURN _t;
END $function$;
REVOKE ALL ON FUNCTION public.post_statement_line(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_statement_line(uuid, uuid, text) TO authenticated;

-- 4. État de rapprochement à une date (brouillon recalculé), puis validation.
CREATE OR REPLACE FUNCTION public.prepare_bank_reconciliation(_account uuid, _date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _b public.bank_accounts%ROWTYPE; _s public.bank_statements%ROWTYPE; _book numeric; _in numeric; _out numeric; _open int; _id uuid; _start date;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'treasury.match') OR public.has_permission(auth.uid(), 'treasury.validate_recon')) THEN
    RAISE EXCEPTION 'Droit insuffisant : rapprocher les relevés' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _b FROM public.bank_accounts WHERE id = _account AND tenant_id = _tenant;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Compte de trésorerie introuvable' USING ERRCODE = 'QG023'; END IF;
  SELECT * INTO _s FROM public.bank_statements WHERE bank_account_id = _account AND status = 'imported' AND period_end <= _date
   ORDER BY period_end DESC LIMIT 1;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Aucun relevé importé à cette date : importer d''abord le relevé de la banque' USING ERRCODE = 'QG023'; END IF;
  _start := COALESCE((SELECT max(r.period_end) + 1 FROM public.bank_reconciliations r WHERE r.bank_account_id = _account AND r.status = 'validated' AND r.period_end < _s.period_end),
                     (SELECT min(x.period_start) FROM public.bank_statements x WHERE x.bank_account_id = _account AND x.status = 'imported'));
  _book := _b.opening_balance + COALESCE((SELECT sum(t.amount) FROM public.bank_transactions t WHERE t.bank_account_id = _account AND t.transaction_date <= _s.period_end), 0);
  -- En suspens : (A) mouvements de l'ERP jusqu'à la date du relevé pas encore passés en banque à cette
  -- date, moins (B) lignes du relevé de la période rapprochées d'un mouvement daté après elle.
  WITH a AS (
    SELECT t.amount FROM public.bank_transactions t
     WHERE t.bank_account_id = _account AND t.transaction_date <= _s.period_end
       AND NOT EXISTS (SELECT 1 FROM public.bank_statement_lines l JOIN public.bank_statements x ON x.id = l.statement_id AND x.status = 'imported'
                        WHERE l.matched_transaction_id = t.id AND l.line_date <= _s.period_end)
    UNION ALL
    SELECT -l.amount FROM public.bank_statement_lines l JOIN public.bank_statements x ON x.id = l.statement_id AND x.status = 'imported'
      JOIN public.bank_transactions t ON t.id = l.matched_transaction_id
     WHERE l.bank_account_id = _account AND l.line_date <= _s.period_end AND t.transaction_date > _s.period_end)
  SELECT COALESCE(sum(a.amount) FILTER (WHERE a.amount > 0), 0), COALESCE(-sum(a.amount) FILTER (WHERE a.amount < 0), 0) INTO _in, _out FROM a;
  SELECT count(*) INTO _open FROM public.bank_statement_lines l JOIN public.bank_statements x ON x.id = l.statement_id
   WHERE l.bank_account_id = _account AND x.status = 'imported' AND l.line_date <= _s.period_end AND l.matched_transaction_id IS NULL;
  SELECT id INTO _id FROM public.bank_reconciliations WHERE bank_account_id = _account AND period_end = _s.period_end AND status = 'draft';
  IF _id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.bank_reconciliations WHERE bank_account_id = _account AND period_end = _s.period_end AND status = 'validated') THEN
      RAISE EXCEPTION 'Rapprochement au % déjà validé', _s.period_end USING ERRCODE = 'QG023';
    END IF;
    INSERT INTO public.bank_reconciliations (tenant_id, bank_account_id, period_start, period_end, book_balance, bank_balance, status,
                                             outstanding_receipts, outstanding_payments, unmatched_statement_lines, statement_id)
    VALUES (_tenant, _account, COALESCE(_start, _s.period_start), _s.period_end, _book, _s.closing_balance, 'draft', _in, _out, _open, _s.id)
    RETURNING id INTO _id;
  ELSE
    UPDATE public.bank_reconciliations SET book_balance = _book, bank_balance = _s.closing_balance, outstanding_receipts = _in, outstanding_payments = _out,
           unmatched_statement_lines = _open, statement_id = _s.id, period_start = COALESCE(_start, _s.period_start), updated_at = now()
     WHERE id = _id;
  END IF;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.prepare_bank_reconciliation(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_bank_reconciliation(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_bank_reconciliation(_reconciliation uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.bank_reconciliations%ROWTYPE; _id uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'treasury.validate_recon') THEN RAISE EXCEPTION 'Droit insuffisant : valider un rapprochement bancaire' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _r FROM public.bank_reconciliations WHERE id = _reconciliation AND tenant_id = public.get_user_tenant_id(auth.uid());
  IF _r.id IS NULL OR _r.status <> 'draft' THEN RAISE EXCEPTION 'Rapprochement introuvable ou déjà validé' USING ERRCODE = 'QG023'; END IF;
  -- Toujours sur des chiffres à jour.
  _id := public.prepare_bank_reconciliation(_r.bank_account_id, _r.period_end);
  SELECT * INTO _r FROM public.bank_reconciliations WHERE id = _id;
  IF _r.unmatched_statement_lines > 0 THEN
    RAISE EXCEPTION 'Rapprochement refusé : % ligne(s) du relevé sans contrepartie (rapprocher ou comptabiliser)', _r.unmatched_statement_lines USING ERRCODE = 'QG023';
  END IF;
  IF round(_r.bank_balance + _r.outstanding_receipts - _r.outstanding_payments, 2) <> round(_r.book_balance, 2) THEN
    RAISE EXCEPTION 'Rapprochement refusé : solde du relevé % + encaissements en suspens % − décaissements en suspens % ≠ solde comptable %',
      _r.bank_balance, _r.outstanding_receipts, _r.outstanding_payments, _r.book_balance USING ERRCODE = 'QG023',
      HINT = 'Vérifier le solde d''ouverture du compte de trésorerie ou les relevés importés.';
  END IF;
  UPDATE public.bank_reconciliations SET status = 'validated', validated_by = auth.uid(), validated_at = now(), updated_at = now() WHERE id = _id;
END $function$;
REVOKE ALL ON FUNCTION public.validate_bank_reconciliation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_bank_reconciliation(uuid) TO authenticated;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
