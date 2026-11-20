-- V121 — Clôture d'exercice : détermination du résultat et état des à-nouveaux (écart G-22).
--
-- Avant : close_fiscal_year ne faisait que passer l'exercice à « clôturé » une fois toutes les périodes closes ; le
-- résultat restait dans les comptes de charges et de produits, aucune écriture de détermination du résultat.
-- Références : AUDCIF (art. 8, 25, 26 : arrêté des comptes, résultat de l'exercice), SYSCOHADA révisé (comptes 131
-- « Résultat net : bénéfice », 139 « Résultat net : perte » ; affectation ultérieure en 121 / 129 / 11 par l'assemblée),
-- SAP (report des soldes FAGLGVTR : le résultat passe en capitaux propres, les comptes de bilan se reportent sans
-- pièce), Sage (écriture de détermination du résultat à la clôture).
--
-- Modèle retenu par le propriétaire (20 nov. 2026) : report SANS écritures d'à-nouveaux. Les soldes de bilan sont
-- cumulés par construction (les rapports additionnent l'historique jusqu'à la date) ; la clôture passe UNE écriture
-- de détermination du résultat (source year_end_result, journal OD, datée du dernier jour) qui solde les comptes de
-- charges et de produits sur 131 / 139 (rôles YEAR_RESULT_PROFIT / YEAR_RESULT_LOSS, paramétrables par société).
-- Les calculs sur une période (compte de résultat, réalisé budgétaire, projets, anomalies, balance d'un mapping sur
-- une période) ignorent cette écriture : l'exercice clos montre toujours ses produits et ses charges. L'état des
-- à-nouveaux de l'exercice suivant est calculé (fiscal_year_opening_balances) et s'imprime.
-- Paramètre : fiscal_close_settings.post_result_entry (vrai par défaut ; faux = clôture sans écriture, le résultat
-- reste dans les comptes de gestion, comme avant). Droit : periods.close (existant).

-- ─── Rôles « résultat de l'exercice » ───
INSERT INTO public.posting_roles (code, label, module, description, expected_prefixes) VALUES
  ('YEAR_RESULT_PROFIT', 'Résultat net de l''exercice : bénéfice', 'GL', 'Crédité du bénéfice à la clôture de l''exercice (écriture de détermination du résultat)', ARRAY['13', '12']),
  ('YEAR_RESULT_LOSS', 'Résultat net de l''exercice : perte', 'GL', 'Débité de la perte à la clôture de l''exercice (écriture de détermination du résultat)', ARRAY['13', '12'])
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.framework_role_expectations (framework_code, role_code, prefixes)
SELECT v.f, v.r, v.p FROM (VALUES
  ('SYSCOHADA_REVISE', 'YEAR_RESULT_PROFIT', ARRAY['13']), ('SYSCOHADA_REVISE', 'YEAR_RESULT_LOSS', ARRAY['13']),
  ('PCG_FR', 'YEAR_RESULT_PROFIT', ARRAY['12']), ('PCG_FR', 'YEAR_RESULT_LOSS', ARRAY['12'])) AS v(f, r, p)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
ON CONFLICT (framework_code, role_code) DO NOTHING;
INSERT INTO public.framework_reference_accounts (framework_code, code, name, account_type)
SELECT v.f, v.c, v.n, 'equity' FROM (VALUES
  ('PCG_FR', '120', 'Résultat de l''exercice (bénéfice)'), ('PCG_FR', '129', 'Résultat de l''exercice (perte)')) AS v(f, c, n)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
ON CONFLICT (framework_code, code) DO NOTHING;
INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT v.f, v.c, v.n, 'equity' FROM (VALUES
  ('SYSCOHADA_REVISE', '131', 'Résultat net : bénéfice'), ('SYSCOHADA_REVISE', '139', 'Résultat net : perte'),
  ('PCG_FR', '120', 'Résultat de l''exercice (bénéfice)'), ('PCG_FR', '129', 'Résultat de l''exercice (perte)')) AS v(f, c, n)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_accounts a WHERE a.framework_code = v.f AND a.code = v.c);
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT v.f, v.r, v.c FROM (VALUES
  ('SYSCOHADA_REVISE', 'YEAR_RESULT_PROFIT', '131'), ('SYSCOHADA_REVISE', 'YEAR_RESULT_LOSS', '139'),
  ('PCG_FR', 'YEAR_RESULT_PROFIT', '120'), ('PCG_FR', 'YEAR_RESULT_LOSS', '129')) AS v(f, r, c)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults d WHERE d.framework_code = v.f AND d.role_code = v.r);
INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
SELECT s.tenant_id, a.code, a.name, a.account_type
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code IN ('YEAR_RESULT_PROFIT', 'YEAR_RESULT_LOSS')
  JOIN public.accounting_framework_accounts a ON a.framework_code = d.framework_code AND a.code = d.account_code
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, d.role_code, g.id
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code IN ('YEAR_RESULT_PROFIT', 'YEAR_RESULT_LOSS')
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = d.account_code AND g.is_active
ON CONFLICT (tenant_id, role_code) DO NOTHING;

-- ─── Paramètre et traçabilité de la clôture ───
CREATE TABLE public.fiscal_close_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  post_result_entry boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.fiscal_close_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.fiscal_close_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.fiscal_close_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'periods.close'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'periods.close'));
GRANT SELECT, INSERT, UPDATE ON public.fiscal_close_settings TO authenticated;

ALTER TABLE public.fiscal_years
  ADD COLUMN result_amount numeric(18, 2),
  ADD COLUMN result_entry_id uuid REFERENCES public.journal_entries (id);

-- Exception bornée : seule la clôture (indicateur posé par close_fiscal_year, pour cette société et ce jour) passe
-- une écriture dans les périodes déjà closes de l'exercice.
CREATE OR REPLACE FUNCTION public.assert_fiscal_period_open(_tenant uuid, _date date, _module text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _fy public.fiscal_years%ROWTYPE;
  _code text;
BEGIN
  IF _tenant IS NULL OR _date IS NULL THEN RETURN; END IF;
  IF _module = 'GL' AND COALESCE(current_setting('qerp.year_end_close', true), '') = _tenant::text || ':' || _date::text THEN
    RETURN;
  END IF;
  _code := to_char(_date, 'YYYY-MM');
  IF EXISTS (SELECT 1 FROM public.fiscal_years WHERE tenant_id = _tenant) THEN
    SELECT * INTO _fy FROM public.fiscal_years
     WHERE tenant_id = _tenant AND _date BETWEEN start_date AND end_date;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Aucun exercice ne couvre le % : créez-le dans Paramètres → Exercices et périodes',
        to_char(_date, 'DD/MM/YYYY') USING ERRCODE = 'QG003';
    ELSIF _fy.status = 'not_open' THEN
      RAISE EXCEPTION 'L''exercice % n''est pas encore ouvert : opération du % refusée', _fy.code,
        to_char(_date, 'DD/MM/YYYY') USING ERRCODE = 'QG003';
    ELSIF _fy.status = 'closed' THEN
      RAISE EXCEPTION 'L''exercice % est clôturé : opération du % refusée', _fy.code,
        to_char(_date, 'DD/MM/YYYY') USING ERRCODE = 'QG003';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.period_locks
              WHERE tenant_id = _tenant AND period = _code AND module = _module AND status = 'closed') THEN
    RAISE EXCEPTION 'Période % clôturée pour le module % : opération refusée', _code,
      public.fiscal_module_label(_module) USING ERRCODE = 'QG003';
  END IF;
END $function$;

-- Soldes de gestion d'un exercice (charges et produits), hors écriture de détermination du résultat.
CREATE FUNCTION public.fiscal_year_management_balances(_id uuid)
RETURNS TABLE (account_id uuid, account_code text, account_name text, account_type text, balance numeric)
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT g.id, g.code, g.name, g.account_type, sum(l.debit - l.credit)
    FROM public.fiscal_years y
    JOIN public.journal_entries e ON e.tenant_id = y.tenant_id AND e.status IN ('posted', 'reversed') AND e.source <> 'year_end_result'
                                 AND e.entry_date BETWEEN y.start_date AND y.end_date
    JOIN public.journal_lines l ON l.entry_id = e.id
    JOIN public.gl_accounts g ON g.id = l.account_id AND g.account_type IN ('revenue', 'expense')
   WHERE y.id = _id AND y.tenant_id = public.get_user_tenant_id(auth.uid())
   GROUP BY g.id, g.code, g.name, g.account_type
  HAVING sum(l.debit - l.credit) <> 0
$$;

-- Aperçu avant clôture : résultat, comptes du résultat, points bloquants.
CREATE FUNCTION public.fiscal_year_close_preview(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _fy public.fiscal_years%ROWTYPE;
  _revenue numeric;
  _expense numeric;
  _post boolean;
  _open integer;
  _drafts integer;
  _missing text[] := '{}';
BEGIN
  SELECT * INTO _fy FROM public.fiscal_years WHERE id = _id AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exercice introuvable' USING ERRCODE = '22023'; END IF;
  SELECT COALESCE(-sum(balance) FILTER (WHERE account_type = 'revenue'), 0), COALESCE(sum(balance) FILTER (WHERE account_type = 'expense'), 0)
    INTO _revenue, _expense FROM public.fiscal_year_management_balances(_id);
  SELECT COALESCE((SELECT s.post_result_entry FROM public.fiscal_close_settings s WHERE s.tenant_id = _tenant), true) INTO _post;
  SELECT count(*) INTO _open FROM public.fiscal_periods p CROSS JOIN public.fiscal_modules m
   WHERE p.fiscal_year_id = _id AND NOT EXISTS (SELECT 1 FROM public.period_locks l WHERE l.tenant_id = _tenant AND l.period = p.code
                                                   AND l.module = m.code AND l.status = 'closed');
  SELECT count(*) INTO _drafts FROM public.journal_entries e
   WHERE e.tenant_id = _tenant AND e.status = 'draft' AND e.entry_date BETWEEN _fy.start_date AND _fy.end_date;
  IF _post AND NOT EXISTS (SELECT 1 FROM public.tenant_posting_accounts t JOIN public.gl_accounts g ON g.id = t.gl_account_id AND g.is_active
                   WHERE t.tenant_id = _tenant AND t.role_code = 'YEAR_RESULT_PROFIT') THEN _missing := _missing || 'YEAR_RESULT_PROFIT'; END IF;
  IF _post AND NOT EXISTS (SELECT 1 FROM public.tenant_posting_accounts t JOIN public.gl_accounts g ON g.id = t.gl_account_id AND g.is_active
                   WHERE t.tenant_id = _tenant AND t.role_code = 'YEAR_RESULT_LOSS') THEN _missing := _missing || 'YEAR_RESULT_LOSS'; END IF;
  RETURN jsonb_build_object('fiscal_year', _fy.code, 'status', _fy.status, 'revenue', _revenue, 'expense', _expense,
    'result', _revenue - _expense, 'post_result_entry', _post, 'open_periods', _open, 'draft_entries', _drafts,
    'missing_roles', to_jsonb(_missing), 'result_entry_id', _fy.result_entry_id, 'result_amount', _fy.result_amount);
END;
$$;

-- État des à-nouveaux d'un exercice : soldes des comptes de bilan à la veille de son ouverture (soldes cumulés,
-- écriture de détermination du résultat comprise). Un résultat antérieur jamais déterminé (exercice clos sans
-- écriture, ou historique antérieur au calendrier) apparaît sur une ligne distincte pour que l'état s'équilibre.
CREATE FUNCTION public.fiscal_year_opening_balances(_id uuid)
RETURNS TABLE (account_code text, account_name text, account_type text, debit numeric, credit numeric)
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH y AS (SELECT * FROM public.fiscal_years WHERE id = _id AND tenant_id = public.get_user_tenant_id(auth.uid())),
  s AS (
    SELECT g.code, g.name, g.account_type, sum(l.debit - l.credit) AS b
      FROM y JOIN public.journal_entries e ON e.tenant_id = y.tenant_id AND e.status IN ('posted', 'reversed') AND e.entry_date < y.start_date
      JOIN public.journal_lines l ON l.entry_id = e.id
      JOIN public.gl_accounts g ON g.id = l.account_id
     GROUP BY g.code, g.name, g.account_type
  )
  SELECT code, name, account_type, CASE WHEN b > 0 THEN b ELSE 0 END, CASE WHEN b < 0 THEN -b ELSE 0 END
    FROM s WHERE account_type IN ('asset', 'liability', 'equity') AND b <> 0
  UNION ALL
  SELECT NULL, 'Résultat antérieur non déterminé (comptes de gestion non soldés)', 'equity',
         CASE WHEN sum(b) > 0 THEN sum(b) ELSE 0 END, CASE WHEN sum(b) < 0 THEN -sum(b) ELSE 0 END
    FROM s WHERE account_type IN ('revenue', 'expense') HAVING sum(b) <> 0
  ORDER BY 1 NULLS LAST
$$;

-- ─── Clôture : contrôles inchangés, puis écriture de détermination du résultat ───
CREATE OR REPLACE FUNCTION public.close_fiscal_year(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _fy public.fiscal_years%ROWTYPE;
  _ouvertes integer;
  _post boolean;
  _result numeric;
  _entry uuid;
  _r record;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'periods.close') THEN
    RAISE EXCEPTION 'Droit requis : gérer les exercices (periods.close)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _fy FROM public.fiscal_years WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exercice introuvable' USING ERRCODE = '22023'; END IF;
  IF _fy.status <> 'open' THEN
    RAISE EXCEPTION 'Seul un exercice ouvert se clôture (% est %)', _fy.code, _fy.status USING ERRCODE = 'QG003';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fiscal_years WHERE tenant_id = _tenant AND start_date < _fy.start_date AND status <> 'closed') THEN
    RAISE EXCEPTION 'Clôturez d''abord les exercices antérieurs' USING ERRCODE = 'QG003';
  END IF;
  SELECT count(*) INTO _ouvertes
    FROM public.fiscal_periods p CROSS JOIN public.fiscal_modules m
   WHERE p.fiscal_year_id = _id
     AND NOT EXISTS (SELECT 1 FROM public.period_locks l WHERE l.tenant_id = _tenant AND l.period = p.code
                       AND l.module = m.code AND l.status = 'closed');
  IF _ouvertes > 0 THEN
    RAISE EXCEPTION 'L''exercice % a encore % période(s) ouverte(s), tous modules confondus', _fy.code, _ouvertes
      USING ERRCODE = 'QG003';
  END IF;
  IF EXISTS (SELECT 1 FROM public.journal_entries e WHERE e.tenant_id = _tenant AND e.status = 'draft'
                AND e.entry_date BETWEEN _fy.start_date AND _fy.end_date) THEN
    RAISE EXCEPTION 'L''exercice % contient des écritures en brouillon : comptabilisez-les ou supprimez-les avant la clôture', _fy.code
      USING ERRCODE = 'QG003';
  END IF;

  SELECT COALESCE((SELECT s.post_result_entry FROM public.fiscal_close_settings s WHERE s.tenant_id = _tenant), true) INTO _post;
  SELECT COALESCE(-sum(balance), 0) INTO _result FROM public.fiscal_year_management_balances(_id);
  IF _post AND EXISTS (SELECT 1 FROM public.fiscal_year_management_balances(_id)) THEN
    INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
    VALUES (_tenant, 'CLO-' || _fy.code, _fy.end_date, 'Détermination du résultat de l''exercice ' || _fy.code, 'year_end_result', 'draft', auth.uid())
    RETURNING id INTO _entry;
    FOR _r IN SELECT * FROM public.fiscal_year_management_balances(_id) LOOP
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry, _r.account_id, CASE WHEN _r.balance < 0 THEN -_r.balance ELSE 0 END, CASE WHEN _r.balance > 0 THEN _r.balance ELSE 0 END,
              'Solde du compte ' || _r.account_code || ' — clôture ' || _fy.code);
    END LOOP;
    IF _result > 0 THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry, public.require_posting_account(_tenant, 'YEAR_RESULT_PROFIT'), 0, _result, 'Résultat net de l''exercice ' || _fy.code || ' : bénéfice');
    ELSIF _result < 0 THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry, public.require_posting_account(_tenant, 'YEAR_RESULT_LOSS'), -_result, 0, 'Résultat net de l''exercice ' || _fy.code || ' : perte');
    END IF;
    PERFORM set_config('qerp.year_end_close', _tenant::text || ':' || _fy.end_date::text, true);
    UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;
    PERFORM set_config('qerp.year_end_close', '', true);
  END IF;

  UPDATE public.fiscal_years SET status = 'closed', closed_at = now(), closed_by = auth.uid(), result_amount = _result, result_entry_id = _entry
   WHERE id = _id;
  INSERT INTO public.fiscal_calendar_audit (tenant_id, actor_id, action, fiscal_year_code, reason)
  VALUES (_tenant, auth.uid(), 'fiscal_year_closed', _fy.code,
          'Résultat ' || to_char(_result, 'FM999G999G999G990D00') || CASE WHEN _entry IS NULL THEN ' (sans écriture de détermination)' ELSE '' END);
END $function$;


-- ─── Suppression d'un brouillon : tracée dans la chaîne, plus bloquée par la piste d'audit ───
-- La clé gl_audit_logs → journal_entries (sans règle de suppression) interdisait de supprimer toute écriture, puisque
-- chacune a son événement « Created » : un brouillon incomplet ne se retirait pas (use-journal-data) et
-- run_depreciation échouait sur un mois sans dotation (il supprime son écriture vide). La piste garde la référence
-- historique ; la suppression d'un brouillon (seul cas permis par protect_posted_entry) devient l'événement
-- « Deleted », chaîné comme les autres.
ALTER TABLE public.gl_audit_logs DROP CONSTRAINT gl_audit_logs_entry_id_fkey;
CREATE OR REPLACE FUNCTION public.log_journal_entry_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _action text;
  _details text;
  _batch_id text;
  _prev text;
  _seq bigint;
  _at timestamptz := clock_timestamp();
  _snapshot jsonb;
  _debit numeric;
  _credit numeric;
  _e public.journal_entries%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN _e := OLD; ELSE _e := NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    _action := 'Deleted';
    _details := 'Draft entry deleted: ' || OLD.entry_number || COALESCE(' — ' || OLD.description, '');
  ELSIF TG_OP = 'INSERT' THEN
    _action := 'Created';
    _details := 'Journal entry created: ' || NEW.entry_number || COALESCE(' — ' || NEW.description, '');
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> NEW.status THEN
      CASE NEW.status
        WHEN 'posted' THEN _action := 'Posted'; _details := 'Posted to GL by ' || COALESCE(NEW.posted_by::text, 'System');
        WHEN 'validated' THEN _action := 'Approved'; _details := 'Approved for posting';
        WHEN 'rejected' THEN _action := 'Rejected'; _details := 'Entry rejected';
        WHEN 'cancelled' THEN _action := 'Cancelled'; _details := 'Entry cancelled';
        WHEN 'reversed' THEN _action := 'Reversed'; _details := 'Entry reversed — compensating entry created';
        ELSE _action := 'Updated'; _details := 'Status changed from ' || OLD.status || ' to ' || NEW.status;
      END CASE;
    ELSE
      _action := 'Updated';
      _details := 'Entry modified: ' || NEW.entry_number;
    END IF;
  END IF;

  _batch_id := 'GLB-' || UPPER(COALESCE(
    CASE _e.source
      WHEN 'ar_receipt' THEN 'AR'
      WHEN 'ar_invoice' THEN 'AR'
      WHEN 'ap_payment' THEN 'AP'
      WHEN 'ap_invoice' THEN 'AP'
      WHEN 'manual' THEN 'GL'
      ELSE UPPER(LEFT(_e.source, 4))
    END, 'GL')) || '-' || to_char(_e.entry_date, 'YYYYMMDD');

  SELECT COALESCE(sum(l.debit), 0), COALESCE(sum(l.credit), 0) INTO _debit, _credit
    FROM public.journal_lines l WHERE l.entry_id = _e.id;
  _snapshot := jsonb_build_object('entry_number', _e.entry_number, 'piece_number', _e.piece_number, 'journal_code', _e.journal_code,
    'entry_date', _e.entry_date, 'status', _e.status, 'source', _e.source, 'description', _e.description,
    'total_debit', _debit, 'total_credit', _credit);

  -- Une chaîne par société : verrou transactionnel le temps de lire le dernier maillon et d'ajouter le nouveau.
  PERFORM pg_advisory_xact_lock(hashtextextended('qerp.gl_audit:' || _e.tenant_id::text, 0));
  SELECT a.hash INTO _prev FROM public.gl_audit_logs a WHERE a.tenant_id = _e.tenant_id ORDER BY a.seq DESC LIMIT 1;
  _prev := COALESCE(_prev, repeat('0', 64));
  _seq := nextval(pg_get_serial_sequence('public.gl_audit_logs', 'seq'));

  INSERT INTO public.gl_audit_logs (seq, tenant_id, batch_id, entry_id, action, user_name, details, snapshot, created_at, hash, prev_hash, hash_version)
  OVERRIDING SYSTEM VALUE
  VALUES (_seq, _e.tenant_id, _batch_id, _e.id, _action, COALESCE(_e.created_by::text, 'System'), _details, _snapshot, _at,
          public.gl_audit_hash(_e.tenant_id, _seq, _batch_id, _e.id, _action, COALESCE(_e.created_by::text, 'System'), _details, _snapshot, _at, _prev),
          _prev, 2);
  RETURN COALESCE(NEW, OLD);
END;
$function$;
DROP TRIGGER trg_log_journal_entry_audit ON public.journal_entries;
CREATE TRIGGER trg_log_journal_entry_audit AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_journal_entry_audit();

SELECT public.install_tenant_isolation_triggers();

-- ─── Calculs sur une période : l'écriture de détermination du résultat n'y entre pas ───
CREATE OR REPLACE FUNCTION public.report_compute(_layout text, _tenant uuid, _from date, _to date)
 RETURNS TABLE(line_code text, label text, line_order integer, kind text, amount numeric)
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
         AND je.entry_date <= _to AND (_kind = 'balance' OR (je.entry_date >= _from AND je.source <> 'year_end_result'))
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

CREATE OR REPLACE FUNCTION public.budget_actual(_tenant uuid, _code text, _from date, _to date, _value uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(CASE WHEN g.normal_balance = 'credit' THEN l.credit - l.debit ELSE l.debit - l.credit END), 0)
    FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.entry_id
    JOIN public.gl_accounts g ON g.id = l.account_id
   WHERE e.tenant_id = _tenant AND e.status IN ('posted', 'reversed') AND e.source <> 'year_end_result' AND e.entry_date BETWEEN _from AND _to AND g.code LIKE _code || '%'
     AND (_value IS NULL OR EXISTS (SELECT 1 FROM public.journal_line_analytics la WHERE la.line_id = l.id AND la.value_id = ANY (public.analytic_value_scope(_value))))
$function$;

CREATE OR REPLACE FUNCTION public.project_financials(_from date DEFAULT NULL::date, _to date DEFAULT NULL::date)
 RETURNS TABLE(project_id uuid, budget_costs numeric, budget_revenue numeric, actual_costs numeric, actual_revenue numeric, committed numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH t AS (SELECT public.get_user_tenant_id(auth.uid()) AS id),
  s AS (SELECT COALESCE((SELECT include_requisitions_in_commitments FROM public.project_settings, t WHERE tenant_id = t.id), false) AS pr),
  p AS (SELECT pr.id, pr.analytic_value_id FROM public.projects pr, t WHERE pr.tenant_id = t.id AND pr.analytic_value_id IS NOT NULL),
  act AS (
    SELECT p.id AS project_id,
      SUM(CASE WHEN g.account_type = 'expense' THEN l.debit - l.credit ELSE 0 END) AS costs,
      SUM(CASE WHEN g.account_type = 'revenue' THEN l.credit - l.debit ELSE 0 END) AS revenue
      FROM p
      JOIN public.journal_line_analytics a ON a.value_id = ANY (public.analytic_value_scope(p.analytic_value_id))
      JOIN public.journal_lines l ON l.id = a.line_id
      JOIN public.journal_entries e ON e.id = l.entry_id AND e.status IN ('posted', 'reversed') AND e.source <> 'year_end_result'
      JOIN public.gl_accounts g ON g.id = l.account_id
     WHERE (_from IS NULL OR e.entry_date >= _from) AND (_to IS NULL OR e.entry_date <= _to)
     GROUP BY p.id
  ),
  com AS (
    SELECT p.id AS project_id, SUM(public.document_amount_in_scope('PO', po.id, p.analytic_value_id)) AS amount
      FROM p, t, public.purchase_orders po
     WHERE po.tenant_id = t.id AND po.status IN ('approved', 'ordered', 'partially_received')
     GROUP BY p.id
    UNION ALL
    SELECT p.id, SUM(public.document_amount_in_scope('PR', r.id, p.analytic_value_id))
      FROM p, t, s, public.purchase_requisitions r
     WHERE s.pr AND r.tenant_id = t.id AND r.status = 'approved' AND r.po_id IS NULL
     GROUP BY p.id
  ),
  bud AS (
    SELECT b.project_id,
      SUM(CASE WHEN g.account_type = 'expense' THEN b.amount ELSE 0 END) AS costs,
      SUM(CASE WHEN g.account_type = 'revenue' THEN b.amount ELSE 0 END) AS revenue
      FROM public.project_budget_lines b JOIN public.gl_accounts g ON g.id = b.gl_account_id, t
     WHERE b.tenant_id = t.id GROUP BY b.project_id
  )
  SELECT p.id, COALESCE(bud.costs, 0), COALESCE(bud.revenue, 0), COALESCE(act.costs, 0), COALESCE(act.revenue, 0),
         COALESCE((SELECT SUM(c.amount) FROM com c WHERE c.project_id = p.id), 0)
    FROM p LEFT JOIN act ON act.project_id = p.id LEFT JOIN bud ON bud.project_id = p.id
$function$;

CREATE OR REPLACE FUNCTION public.gl_control_findings(_from date, _to date)
 RETURNS TABLE(check_code text, severity text, entry_id uuid, piece_number text, entry_date date, amount numeric, detail text, reviewed boolean, review_comment text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH s AS (SELECT * FROM public.gl_control_setting()),
  e AS (
    SELECT je.id, je.piece_number, je.entry_date, je.source, je.status, je.description, je.created_by, je.posted_by, je.posted_at,
           COALESCE((SELECT SUM(l.debit) FROM public.journal_lines l WHERE l.entry_id = je.id), 0) AS debit,
           COALESCE((SELECT SUM(l.credit) FROM public.journal_lines l WHERE l.entry_id = je.id), 0) AS credit
      FROM public.journal_entries je
     WHERE je.tenant_id = public.get_user_tenant_id(auth.uid()) AND je.entry_date BETWEEN _from AND _to AND je.source <> 'year_end_result'
  ),
  f AS (
    SELECT 'UNBALANCED'::text AS check_code, 'critical'::text AS severity, e.id, e.piece_number, e.entry_date, e.debit AS amount,
           format('Débit %s ≠ crédit %s', e.debit, e.credit) AS detail
      FROM e WHERE e.status IN ('posted', 'reversed') AND e.debit <> e.credit
    UNION ALL
    SELECT 'EMPTY_POSTED', 'critical', e.id, e.piece_number, e.entry_date, 0, 'Écriture comptabilisée sans ligne'
      FROM e WHERE e.status IN ('posted', 'reversed') AND NOT EXISTS (SELECT 1 FROM public.journal_lines l WHERE l.entry_id = e.id)
    UNION ALL
    SELECT 'LARGE_ENTRY', 'warning', e.id, e.piece_number, e.entry_date, e.debit,
           format('Montant au-delà du seuil paramétré (%s)', s.large_entry_threshold)
      FROM e, s WHERE s.large_entry_threshold IS NOT NULL AND e.status = 'posted' AND e.debit >= s.large_entry_threshold
    UNION ALL
    SELECT 'DUPLICATE', 'warning', e.id, e.piece_number, e.entry_date, e.debit,
           'Écriture manuelle semblable : ' || (SELECT string_agg(d.piece_number, ', ' ORDER BY d.piece_number) FROM e d
             WHERE d.id <> e.id AND d.source = 'manual' AND d.status = 'posted' AND d.debit = e.debit
               AND lower(btrim(COALESCE(d.description, ''))) = lower(btrim(COALESCE(e.description, '')))
               AND abs(d.entry_date - e.entry_date) <= s.duplicate_window_days)
      FROM e, s WHERE e.source = 'manual' AND e.status = 'posted' AND e.debit > 0
       AND EXISTS (SELECT 1 FROM e d WHERE d.id <> e.id AND d.source = 'manual' AND d.status = 'posted' AND d.debit = e.debit
                     AND lower(btrim(COALESCE(d.description, ''))) = lower(btrim(COALESCE(e.description, '')))
                     AND abs(d.entry_date - e.entry_date) <= s.duplicate_window_days)
    UNION ALL
    SELECT 'SOD', 'warning', e.id, e.piece_number, e.entry_date, e.debit, 'Écriture manuelle saisie et comptabilisée par la même personne'
      FROM e WHERE e.source = 'manual' AND e.status = 'posted' AND e.created_by IS NOT NULL AND e.created_by = e.posted_by
    UNION ALL
    SELECT 'BACKDATED', 'info', e.id, e.piece_number, e.entry_date, e.debit,
           format('Comptabilisée %s jour(s) après la date de pièce', (e.posted_at::date - e.entry_date))
      FROM e, s WHERE s.backdating_days IS NOT NULL AND e.source = 'manual' AND e.status = 'posted'
       AND e.posted_at IS NOT NULL AND e.posted_at::date - e.entry_date > s.backdating_days
    UNION ALL
    SELECT 'INACTIVE_ACCOUNT', 'info', e.id, e.piece_number, e.entry_date, e.debit,
           'Ligne sur un compte désormais inactif : ' || (SELECT string_agg(DISTINCT g.code, ', ') FROM public.journal_lines l
             JOIN public.gl_accounts g ON g.id = l.account_id WHERE l.entry_id = e.id AND NOT g.is_active)
      FROM e WHERE e.status = 'posted' AND EXISTS (SELECT 1 FROM public.journal_lines l JOIN public.gl_accounts g ON g.id = l.account_id
                                                     WHERE l.entry_id = e.id AND NOT g.is_active)
  )
  SELECT f.check_code, f.severity, f.id, f.piece_number, f.entry_date, f.amount, f.detail,
         r.id IS NOT NULL, r.comment
    FROM f CROSS JOIN s
    LEFT JOIN public.gl_control_reviews r ON r.tenant_id = s.tenant_id AND r.check_code = f.check_code AND r.entry_id = f.id
   WHERE NOT (f.check_code = ANY (s.disabled_checks))
   ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, f.entry_date DESC, f.piece_number
$function$;

CREATE OR REPLACE FUNCTION public.mapped_trial_balance(_mapping uuid, _from date, _to date)
 RETURNS TABLE(target_code text, target_name text, target_type text, debit numeric, credit numeric, balance numeric, sources text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH mouvements AS (
    SELECT j.account_id, sum(j.debit) AS debit, sum(j.credit) AS credit
      FROM public.journal_lines j JOIN public.journal_entries e ON e.id = j.entry_id
      JOIN public.chart_mappings m ON m.id = _mapping AND m.tenant_id = e.tenant_id
     WHERE e.status IN ('posted', 'reversed') AND (_from IS NULL OR (e.entry_date >= _from AND e.source <> 'year_end_result')) AND e.entry_date <= _to
     GROUP BY j.account_id)
  SELECT l.target_code, min(l.target_name), min(l.target_type),
         round(sum(mv.debit * l.ratio / 100), 2), round(sum(mv.credit * l.ratio / 100), 2),
         round(sum((mv.debit - mv.credit) * l.ratio / 100), 2), string_agg(DISTINCT g.code, ', ')
    FROM public.chart_mapping_lines l
    JOIN mouvements mv ON mv.account_id = l.source_account_id
    JOIN public.gl_accounts g ON g.id = l.source_account_id
   WHERE l.mapping_id = _mapping AND l.status = 'validated'
   GROUP BY l.target_code
   ORDER BY l.target_code
$function$;
