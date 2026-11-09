
-- ============================================================
-- 1. Period lock enforcement on journal_entries
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_period_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _period text;
  _locked boolean;
BEGIN
  -- Only check when the entry is or becomes posted
  IF NEW.status NOT IN ('posted','reversed') THEN RETURN NEW; END IF;

  _period := to_char(NEW.entry_date, 'YYYY-MM');
  SELECT (status = 'closed') INTO _locked
    FROM public.period_locks
   WHERE tenant_id = NEW.tenant_id
     AND module = 'GL'
     AND period = _period
   LIMIT 1;

  IF COALESCE(_locked, false) THEN
    RAISE EXCEPTION 'GL period % is closed — entry % cannot be posted/modified', _period, NEW.entry_number;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_period_lock ON public.journal_entries;
CREATE TRIGGER trg_enforce_period_lock
  BEFORE INSERT OR UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();

-- ============================================================
-- 2. Close / Reopen GL period
-- ============================================================
CREATE OR REPLACE FUNCTION public.close_gl_period(_period text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid;
  _unbalanced int;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can close GL periods';
  END IF;

  -- Refuse close if draft/unbalanced entries exist in the period
  SELECT count(*) INTO _unbalanced
    FROM public.journal_entries je
   WHERE je.tenant_id = _tenant
     AND to_char(je.entry_date,'YYYY-MM') = _period
     AND je.status IN ('draft','validated');
  IF _unbalanced > 0 THEN
    RAISE EXCEPTION 'Cannot close % : % entries are still draft/validated', _period, _unbalanced;
  END IF;

  INSERT INTO public.period_locks (tenant_id, period, module, status, closed_by, closed_at)
  VALUES (_tenant, _period, 'GL', 'closed', auth.uid(), now())
  ON CONFLICT (tenant_id, period, module)
  DO UPDATE SET status = 'closed', closed_by = auth.uid(), closed_at = now()
  RETURNING id INTO _id;

  RETURN _id;
END; $$;

CREATE OR REPLACE FUNCTION public.reopen_gl_period(_period text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can reopen GL periods';
  END IF;

  UPDATE public.period_locks
     SET status = 'open', closed_by = NULL, closed_at = NULL
   WHERE tenant_id = _tenant AND module = 'GL' AND period = _period;
END; $$;

-- ============================================================
-- 3. Reverse journal entry (contre-passation)
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
  _entry_id uuid,
  _reverse_date date DEFAULT CURRENT_DATE,
  _reason text DEFAULT 'Contre-passation'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _src public.journal_entries%ROWTYPE;
  _new_id uuid;
  _new_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  SELECT * INTO _src FROM public.journal_entries WHERE id = _entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF _src.tenant_id <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _src.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted entries can be reversed (status=%)', _src.status;
  END IF;

  _new_number := 'REV-' || _src.entry_number || '-' || to_char(now(),'YYYYMMDDHH24MISS');

  INSERT INTO public.journal_entries
    (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES
    (_src.tenant_id, _new_number, _reverse_date,
     'Reversal of '||_src.entry_number||' — '||COALESCE(_reason,''),
     'reversal', 'draft', auth.uid())
  RETURNING id INTO _new_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  SELECT _new_id, jl.account_id, jl.credit, jl.debit,
         'Reversal: '||COALESCE(jl.description,'')
    FROM public.journal_lines jl
   WHERE jl.entry_id = _src.id;

  UPDATE public.journal_entries
     SET status='posted', posted_by=auth.uid(), posted_at=now()
   WHERE id = _new_id;

  UPDATE public.journal_entries
     SET status='reversed'
   WHERE id = _src.id;

  RETURN _new_id;
END; $$;

-- ============================================================
-- 4. GL Periods view (for Control UI)
-- ============================================================
CREATE OR REPLACE VIEW public.gl_periods_view
WITH (security_invoker = true)
AS
SELECT
  je.tenant_id,
  to_char(je.entry_date,'YYYY-MM') AS period,
  COALESCE(pl.status, 'open') AS status,
  pl.closed_by,
  pl.closed_at,
  COUNT(*) FILTER (WHERE je.status = 'posted') AS posted_count,
  COUNT(*) FILTER (WHERE je.status = 'draft') AS draft_count,
  COUNT(*) FILTER (WHERE je.status = 'reversed') AS reversed_count,
  COALESCE(SUM(jl.debit) FILTER (WHERE je.status = 'posted'), 0) AS total_debit,
  COALESCE(SUM(jl.credit) FILTER (WHERE je.status = 'posted'), 0) AS total_credit
FROM public.journal_entries je
LEFT JOIN public.journal_lines jl ON jl.entry_id = je.id
LEFT JOIN public.period_locks pl
       ON pl.tenant_id = je.tenant_id
      AND pl.module = 'GL'
      AND pl.period = to_char(je.entry_date,'YYYY-MM')
GROUP BY je.tenant_id, to_char(je.entry_date,'YYYY-MM'), pl.status, pl.closed_by, pl.closed_at;

GRANT SELECT ON public.gl_periods_view TO authenticated;

-- ============================================================
-- 5. SIG view (Soldes Intermédiaires de Gestion — SYSCOHADA)
-- Classes: 6 = Charges, 7 = Produits
--   70 Ventes, 71 Production stockée, 72 Production immobilisée
--   60 Achats consommés, 61/62 Services extérieurs
--   63 Impôts et taxes, 64 Charges de personnel
--   65 Autres charges, 66 Charges financières, 67 Charges HAO, 68 Dotations
--   75 Autres produits, 77 Produits financiers, 78 Reprises
-- ============================================================
CREATE OR REPLACE VIEW public.gl_sig_view
WITH (security_invoker = true)
AS
WITH base AS (
  SELECT
    je.tenant_id,
    to_char(je.entry_date,'YYYY-MM') AS period,
    LEFT(a.code, 2) AS class2,
    LEFT(a.code, 1) AS class1,
    SUM(jl.debit)  AS dr,
    SUM(jl.credit) AS cr
  FROM public.journal_entries je
  JOIN public.journal_lines jl ON jl.entry_id = je.id
  JOIN public.gl_accounts a    ON a.id = jl.account_id
  WHERE je.status = 'posted'
  GROUP BY je.tenant_id, to_char(je.entry_date,'YYYY-MM'), LEFT(a.code,2), LEFT(a.code,1)
),
agg AS (
  SELECT
    tenant_id, period,
    SUM(CASE WHEN class2 = '70' THEN cr - dr ELSE 0 END) AS ventes,
    SUM(CASE WHEN class2 IN ('71','72') THEN cr - dr ELSE 0 END) AS production_stockee,
    SUM(CASE WHEN class2 = '60' THEN dr - cr ELSE 0 END) AS achats_consommes,
    SUM(CASE WHEN class2 IN ('61','62') THEN dr - cr ELSE 0 END) AS services_ext,
    SUM(CASE WHEN class2 = '63' THEN dr - cr ELSE 0 END) AS impots_taxes,
    SUM(CASE WHEN class2 = '64' THEN dr - cr ELSE 0 END) AS charges_personnel,
    SUM(CASE WHEN class2 = '68' THEN dr - cr ELSE 0 END) AS dotations,
    SUM(CASE WHEN class2 IN ('65','75') THEN
        CASE WHEN class2='65' THEN dr-cr ELSE -(cr-dr) END ELSE 0 END) AS autres_net,
    SUM(CASE WHEN class2 IN ('66','67') THEN dr-cr ELSE 0 END) AS charges_fin_hao,
    SUM(CASE WHEN class2 IN ('77','78') THEN cr-dr ELSE 0 END) AS produits_fin_reprises
  FROM base
  GROUP BY tenant_id, period
)
SELECT
  tenant_id, period,
  ventes,
  production_stockee,
  achats_consommes,
  services_ext,
  impots_taxes,
  charges_personnel,
  dotations,
  (ventes - achats_consommes)                                         AS marge_commerciale,
  (ventes + production_stockee)                                       AS chiffre_affaires,
  (ventes + production_stockee - achats_consommes - services_ext)     AS valeur_ajoutee,
  (ventes + production_stockee - achats_consommes - services_ext
     - impots_taxes - charges_personnel)                              AS ebe,
  (ventes + production_stockee - achats_consommes - services_ext
     - impots_taxes - charges_personnel - dotations - autres_net)     AS resultat_exploitation,
  (ventes + production_stockee - achats_consommes - services_ext
     - impots_taxes - charges_personnel - dotations - autres_net
     - charges_fin_hao + produits_fin_reprises)                       AS resultat_net
FROM agg;

GRANT SELECT ON public.gl_sig_view TO authenticated;
