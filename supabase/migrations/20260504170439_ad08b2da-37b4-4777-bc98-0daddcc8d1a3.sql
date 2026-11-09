
-- 1. Enforce balanced entry on POST
CREATE OR REPLACE FUNCTION public.enforce_balanced_entry()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _dr numeric; _cr numeric; _cnt int;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*)
    INTO _dr, _cr, _cnt
    FROM public.journal_lines WHERE entry_id = NEW.id;

  IF _cnt = 0 THEN
    RAISE EXCEPTION 'JE %: cannot post empty entry', NEW.entry_number;
  END IF;
  IF ROUND(_dr,2) <> ROUND(_cr,2) THEN
    RAISE EXCEPTION 'JE %: unbalanced (DR=% CR=%)', NEW.entry_number, _dr, _cr;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_balanced_entry ON public.journal_entries;
CREATE TRIGGER trg_enforce_balanced_entry
  BEFORE INSERT OR UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_balanced_entry();

-- 2. Immutability of posted entries
CREATE OR REPLACE FUNCTION public.protect_posted_entry()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'posted'
     AND NEW.status NOT IN ('posted','reversed','cancelled') THEN
    RAISE EXCEPTION 'JE %: a posted entry can only be reversed or cancelled', OLD.entry_number;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'posted' THEN
    RAISE EXCEPTION 'JE %: posted entries cannot be deleted (use reversal)', OLD.entry_number;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_protect_posted_entry ON public.journal_entries;
CREATE TRIGGER trg_protect_posted_entry
  BEFORE UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.protect_posted_entry();

-- 3. Protect lines of posted entries
CREATE OR REPLACE FUNCTION public.protect_posted_lines()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _status text;
BEGIN
  SELECT status INTO _status FROM public.journal_entries
   WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF _status = 'posted' THEN
    RAISE EXCEPTION 'Cannot modify lines of a posted journal entry';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_protect_posted_lines ON public.journal_lines;
CREATE TRIGGER trg_protect_posted_lines
  BEFORE UPDATE OR DELETE ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.protect_posted_lines();

-- 4. Trial balance view
CREATE OR REPLACE VIEW public.gl_trial_balance AS
SELECT
  a.tenant_id,
  a.id            AS account_id,
  a.code,
  a.name,
  a.account_type,
  COALESCE(SUM(l.debit),0)  AS total_debit,
  COALESCE(SUM(l.credit),0) AS total_credit,
  COALESCE(SUM(l.debit - l.credit),0) AS balance
FROM public.gl_accounts a
LEFT JOIN public.journal_lines l ON l.account_id = a.id
LEFT JOIN public.journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
GROUP BY a.tenant_id, a.id, a.code, a.name, a.account_type;

ALTER VIEW public.gl_trial_balance SET (security_invoker = true);

-- 5. General ledger detail view (running balance per account)
CREATE OR REPLACE VIEW public.gl_ledger_detail AS
SELECT
  a.tenant_id,
  a.id          AS account_id,
  a.code        AS account_code,
  a.name        AS account_name,
  e.id          AS entry_id,
  e.entry_number,
  e.entry_date,
  e.description AS entry_description,
  e.source,
  l.id          AS line_id,
  l.debit,
  l.credit,
  l.description AS line_description,
  SUM(l.debit - l.credit) OVER (
    PARTITION BY a.id
    ORDER BY e.entry_date, e.entry_number, l.id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM public.journal_lines l
JOIN public.journal_entries e ON e.id = l.entry_id
JOIN public.gl_accounts a ON a.id = l.account_id
WHERE e.status = 'posted';

ALTER VIEW public.gl_ledger_detail SET (security_invoker = true);
