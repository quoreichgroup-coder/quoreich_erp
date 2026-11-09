
-- ============ TREASURY 2.0 — SCHEMA ============

DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'treasury_clerk';
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'treasury_manager';
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'treasury_controller';
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cash_admin';
EXCEPTION WHEN others THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.bank_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  statement_date date NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  opening_balance numeric(18,2) NOT NULL DEFAULT 0,
  closing_balance numeric(18,2) NOT NULL DEFAULT 0,
  file_name text,
  status text NOT NULL DEFAULT 'imported',
  imported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statements TO authenticated;
GRANT ALL ON public.bank_statements TO service_role;
ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_bank_statements" ON public.bank_statements;
CREATE POLICY "tenant_bank_statements" ON public.bank_statements FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  statement_id uuid NOT NULL REFERENCES public.bank_statements(id) ON DELETE CASCADE,
  line_date date NOT NULL,
  description text,
  amount numeric(18,2) NOT NULL,
  reference text,
  matched_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  matched_at timestamptz,
  matched_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statement_lines TO authenticated;
GRANT ALL ON public.bank_statement_lines TO service_role;
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_bank_statement_lines" ON public.bank_statement_lines;
CREATE POLICY "tenant_bank_statement_lines" ON public.bank_statement_lines FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_bsl_statement ON public.bank_statement_lines(statement_id);
CREATE INDEX IF NOT EXISTS idx_bsl_matched ON public.bank_statement_lines(matched_transaction_id);

CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  book_balance numeric(18,2) NOT NULL DEFAULT 0,
  bank_balance numeric(18,2) NOT NULL DEFAULT 0,
  difference numeric(18,2) GENERATED ALWAYS AS (bank_balance - book_balance) STORED,
  status text NOT NULL DEFAULT 'in_progress',
  validated_by uuid,
  validated_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_reconciliations TO authenticated;
GRANT ALL ON public.bank_reconciliations TO service_role;
ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_bank_reconciliations" ON public.bank_reconciliations;
CREATE POLICY "tenant_bank_reconciliations" ON public.bank_reconciliations FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.cashflow_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  week_start date NOT NULL,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  category text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inflow','outflow')),
  amount_forecast numeric(18,2) NOT NULL DEFAULT 0,
  amount_actual numeric(18,2) NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashflow_forecasts TO authenticated;
GRANT ALL ON public.cashflow_forecasts TO service_role;
ALTER TABLE public.cashflow_forecasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_cashflow_forecasts" ON public.cashflow_forecasts;
CREATE POLICY "tenant_cashflow_forecasts" ON public.cashflow_forecasts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_cff_week ON public.cashflow_forecasts(tenant_id, week_start);

CREATE TABLE IF NOT EXISTS public.treasury_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  action text NOT NULL CHECK (action IN ('assign','revoke')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.treasury_role_audit TO authenticated;
GRANT ALL ON public.treasury_role_audit TO service_role;
ALTER TABLE public.treasury_role_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_treasury_audit_read" ON public.treasury_role_audit;
DROP POLICY IF EXISTS "tenant_treasury_audit_insert" ON public.treasury_role_audit;
CREATE POLICY "tenant_treasury_audit_read" ON public.treasury_role_audit FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "tenant_treasury_audit_insert" ON public.treasury_role_audit FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND actor_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.treasury_settings (
  tenant_id uuid PRIMARY KEY,
  pivot_currency text NOT NULL DEFAULT 'XOF',
  match_amount_tolerance numeric(18,2) NOT NULL DEFAULT 0,
  match_date_window_days int NOT NULL DEFAULT 3,
  unreconciled_alert_days int NOT NULL DEFAULT 7,
  low_cash_threshold numeric(18,2) NOT NULL DEFAULT 0,
  auto_je_on_reconciliation boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.treasury_settings TO authenticated;
GRANT ALL ON public.treasury_settings TO service_role;
ALTER TABLE public.treasury_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_treasury_settings" ON public.treasury_settings;
CREATE POLICY "tenant_treasury_settings" ON public.treasury_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.trg_bank_recon_validated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status = 'validated' AND (OLD.status IS DISTINCT FROM 'validated') THEN
    UPDATE public.bank_accounts SET last_reconciled_at = NEW.period_end WHERE id = NEW.bank_account_id;
    NEW.validated_at := COALESCE(NEW.validated_at, now());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_bank_recon_validated ON public.bank_reconciliations;
CREATE TRIGGER trg_bank_recon_validated BEFORE UPDATE ON public.bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.trg_bank_recon_validated();

CREATE OR REPLACE FUNCTION public.trg_bsl_match_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.matched_transaction_id IS NOT NULL AND (OLD.matched_transaction_id IS DISTINCT FROM NEW.matched_transaction_id) THEN
    UPDATE public.bank_transactions SET is_reconciled = true WHERE id = NEW.matched_transaction_id;
    NEW.matched_at := COALESCE(NEW.matched_at, now());
  ELSIF NEW.matched_transaction_id IS NULL AND OLD.matched_transaction_id IS NOT NULL THEN
    UPDATE public.bank_transactions SET is_reconciled = false WHERE id = OLD.matched_transaction_id;
    NEW.matched_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_bsl_match_sync ON public.bank_statement_lines;
CREATE TRIGGER trg_bsl_match_sync BEFORE UPDATE ON public.bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_bsl_match_sync();

CREATE OR REPLACE FUNCTION public.suggest_bank_matches(p_line_id uuid)
RETURNS TABLE(transaction_id uuid, transaction_date date, description text, amount numeric, score numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid;
  v_account uuid;
  v_amount numeric;
  v_date date;
  v_tol numeric := 0;
  v_window int := 3;
BEGIN
  SELECT l.tenant_id, s.bank_account_id, l.amount, l.line_date
    INTO v_tenant, v_account, v_amount, v_date
  FROM public.bank_statement_lines l
  JOIN public.bank_statements s ON s.id = l.statement_id
  WHERE l.id = p_line_id;

  IF v_tenant IS NULL OR v_tenant <> public.get_user_tenant_id(auth.uid()) THEN
    RETURN;
  END IF;

  SELECT ts.match_amount_tolerance, ts.match_date_window_days
    INTO v_tol, v_window
  FROM public.treasury_settings ts WHERE ts.tenant_id = v_tenant;
  v_tol := COALESCE(v_tol, 0);
  v_window := COALESCE(v_window, 3);

  RETURN QUERY
  SELECT t.id, t.transaction_date, t.description, t.amount,
    (100 - LEAST(100, ABS(t.amount - v_amount)::numeric)
        - LEAST(50, ABS(t.transaction_date - v_date) * 5))::numeric AS score
  FROM public.bank_transactions t
  WHERE t.tenant_id = v_tenant
    AND t.bank_account_id = v_account
    AND t.is_reconciled = false
    AND ABS(t.amount - v_amount) <= GREATEST(v_tol, 0.01)
    AND ABS(t.transaction_date - v_date) <= v_window
  ORDER BY score DESC
  LIMIT 10;
END $$;

CREATE OR REPLACE VIEW public.treasury_cash_position_view AS
SELECT
  a.tenant_id,
  a.id AS bank_account_id,
  a.name,
  a.bank_name,
  a.currency,
  a.balance AS current_balance,
  COALESCE(SUM(CASE WHEN t.transaction_date >= CURRENT_DATE - 7 THEN t.amount END), 0) AS net_7d,
  COALESCE(SUM(CASE WHEN t.transaction_date >= CURRENT_DATE - 30 THEN t.amount END), 0) AS net_30d,
  a.last_reconciled_at
FROM public.bank_accounts a
LEFT JOIN public.bank_transactions t ON t.bank_account_id = a.id
WHERE a.is_active = true
GROUP BY a.id;
GRANT SELECT ON public.treasury_cash_position_view TO authenticated;

CREATE OR REPLACE VIEW public.treasury_reconciliation_status_view AS
SELECT
  a.tenant_id,
  a.id AS bank_account_id,
  a.name,
  COUNT(t.id) FILTER (WHERE t.is_reconciled = false) AS unreconciled_count,
  COUNT(t.id) AS total_count,
  CASE WHEN COUNT(t.id) > 0
    THEN ROUND(100.0 * COUNT(t.id) FILTER (WHERE t.is_reconciled) / COUNT(t.id), 1)
    ELSE 100 END AS reconciled_pct,
  MAX(CASE WHEN t.is_reconciled = false THEN CURRENT_DATE - t.transaction_date END) AS oldest_unreconciled_days,
  a.last_reconciled_at
FROM public.bank_accounts a
LEFT JOIN public.bank_transactions t ON t.bank_account_id = a.id
GROUP BY a.id;
GRANT SELECT ON public.treasury_reconciliation_status_view TO authenticated;

CREATE OR REPLACE VIEW public.treasury_13w_forecast_view AS
WITH weeks AS (
  SELECT (date_trunc('week', CURRENT_DATE)::date + (w * 7)) AS week_start, w AS week_index
  FROM generate_series(0, 12) w
),
ar AS (
  SELECT date_trunc('week', i.due_date)::date AS week_start, i.tenant_id,
    SUM(i.total - COALESCE(i.amount_paid, 0)) AS amount
  FROM public.ar_invoices i
  WHERE i.status IN ('open','overdue','sent','partial')
    AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 91
  GROUP BY 1, i.tenant_id
),
ap AS (
  SELECT date_trunc('week', i.due_date)::date AS week_start, i.tenant_id,
    SUM(i.total - COALESCE(i.amount_paid, 0)) AS amount
  FROM public.ap_invoices i
  WHERE i.status IN ('open','overdue','approved','partial')
    AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 91
  GROUP BY 1, i.tenant_id
),
manual_in AS (
  SELECT f.week_start, f.tenant_id, SUM(f.amount_forecast) AS amount
  FROM public.cashflow_forecasts f WHERE f.direction = 'inflow' GROUP BY 1, 2
),
manual_out AS (
  SELECT f.week_start, f.tenant_id, SUM(f.amount_forecast) AS amount
  FROM public.cashflow_forecasts f WHERE f.direction = 'outflow' GROUP BY 1, 2
),
tenants AS (SELECT DISTINCT tenant_id FROM public.bank_accounts)
SELECT
  t.tenant_id, w.week_start, w.week_index,
  COALESCE(ar.amount, 0) AS inflow_ar,
  COALESCE(mi.amount, 0) AS inflow_manual,
  COALESCE(ap.amount, 0) AS outflow_ap,
  COALESCE(mo.amount, 0) AS outflow_manual,
  (COALESCE(ar.amount,0) + COALESCE(mi.amount,0))
    - (COALESCE(ap.amount,0) + COALESCE(mo.amount,0)) AS net_flow
FROM tenants t
CROSS JOIN weeks w
LEFT JOIN ar ON ar.week_start = w.week_start AND ar.tenant_id = t.tenant_id
LEFT JOIN ap ON ap.week_start = w.week_start AND ap.tenant_id = t.tenant_id
LEFT JOIN manual_in mi ON mi.week_start = w.week_start AND mi.tenant_id = t.tenant_id
LEFT JOIN manual_out mo ON mo.week_start = w.week_start AND mo.tenant_id = t.tenant_id;
GRANT SELECT ON public.treasury_13w_forecast_view TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_treasury_role(
  p_target_user uuid,
  p_role public.app_role,
  p_action text,
  p_comment text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  IF NOT (public.has_role(auth.uid(), 'cash_admin') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  IF p_role NOT IN ('treasury_clerk','treasury_manager','treasury_controller','cash_admin') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;
  IF p_action = 'assign' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (p_target_user, p_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSIF p_action = 'revoke' THEN
    DELETE FROM public.user_roles WHERE user_id = p_target_user AND role = p_role;
  ELSE
    RAISE EXCEPTION 'invalid_action';
  END IF;
  INSERT INTO public.treasury_role_audit(tenant_id, actor_id, target_user_id, role, action, comment)
  VALUES (v_tenant, auth.uid(), p_target_user, p_role, p_action, p_comment);
END $$;
GRANT EXECUTE ON FUNCTION public.assign_treasury_role(uuid, public.app_role, text, text) TO authenticated;
