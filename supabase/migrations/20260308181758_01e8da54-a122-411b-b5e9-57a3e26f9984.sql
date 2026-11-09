
-- ═══════════════════════════════════════════════════════════════
-- QUOREICH ERP — Tier 3 Tables: Treasury, Assets, Budget, Projects, Compliance, Risk
-- ═══════════════════════════════════════════════════════════════

-- ──── TREASURY ────
CREATE TABLE public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  bank_name text NOT NULL,
  account_number text,
  currency text NOT NULL DEFAULT 'XOF',
  balance numeric NOT NULL DEFAULT 0,
  account_type text NOT NULL DEFAULT 'checking', -- checking, savings, petty_cash
  is_active boolean NOT NULL DEFAULT true,
  last_reconciled_at date,
  gl_account_id uuid REFERENCES public.gl_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.bank_accounts FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE public.bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id),
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  amount numeric NOT NULL,
  transaction_type text NOT NULL, -- inflow, outflow, transfer
  reference text,
  is_reconciled boolean NOT NULL DEFAULT false,
  payment_id uuid REFERENCES public.payments(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.bank_transactions FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

-- ──── FIXED ASSETS ────
CREATE TABLE public.asset_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  depreciation_method text NOT NULL DEFAULT 'straight_line', -- straight_line, declining_balance
  useful_life_years integer NOT NULL DEFAULT 5,
  gl_asset_account_id uuid REFERENCES public.gl_accounts(id),
  gl_depreciation_account_id uuid REFERENCES public.gl_accounts(id),
  gl_expense_account_id uuid REFERENCES public.gl_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.asset_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.asset_categories FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  asset_code text NOT NULL,
  name text NOT NULL,
  category_id uuid REFERENCES public.asset_categories(id),
  acquisition_date date NOT NULL,
  acquisition_cost numeric NOT NULL DEFAULT 0,
  salvage_value numeric NOT NULL DEFAULT 0,
  useful_life_months integer NOT NULL DEFAULT 60,
  depreciation_method text NOT NULL DEFAULT 'straight_line',
  accumulated_depreciation numeric NOT NULL DEFAULT 0,
  net_book_value numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active', -- active, disposed, fully_depreciated
  location text,
  assigned_to text,
  warranty_expiry date,
  next_maintenance date,
  disposal_date date,
  disposal_amount numeric,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.assets FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE public.depreciation_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  period_date date NOT NULL,
  amount numeric NOT NULL,
  accumulated numeric NOT NULL,
  net_book_value numeric NOT NULL,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.depreciation_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Access via asset" ON public.depreciation_entries FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assets a WHERE a.id = depreciation_entries.asset_id AND a.tenant_id = get_user_tenant_id(auth.uid())));

-- ──── BUDGET & FORECAST ────
CREATE TABLE public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  fiscal_year text NOT NULL,
  status text NOT NULL DEFAULT 'draft', -- draft, approved, closed
  scenario text NOT NULL DEFAULT 'base', -- base, optimistic, pessimistic
  total_amount numeric NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.budgets FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE public.budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  gl_account_id uuid REFERENCES public.gl_accounts(id),
  department text,
  period text NOT NULL, -- e.g. '2026-01', '2026-02'
  planned_amount numeric NOT NULL DEFAULT 0,
  actual_amount numeric NOT NULL DEFAULT 0,
  variance numeric GENERATED ALWAYS AS (planned_amount - actual_amount) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.budget_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Access via budget" ON public.budget_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.budgets b WHERE b.id = budget_lines.budget_id AND b.tenant_id = get_user_tenant_id(auth.uid())));

-- ──── PROJECT ACCOUNTING ────
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  project_code text NOT NULL,
  name text NOT NULL,
  client text,
  status text NOT NULL DEFAULT 'active', -- active, completed, on_hold, cancelled
  budget numeric NOT NULL DEFAULT 0,
  total_costs numeric NOT NULL DEFAULT 0,
  completion_pct integer NOT NULL DEFAULT 0,
  project_manager text,
  start_date date,
  end_date date,
  department text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.projects FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE public.project_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cost_date date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL, -- labor, materials, subcontract, overhead
  description text,
  amount numeric NOT NULL,
  gl_account_id uuid REFERENCES public.gl_accounts(id),
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.project_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Access via project" ON public.project_costs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_costs.project_id AND p.tenant_id = get_user_tenant_id(auth.uid())));

-- ──── COMPLIANCE ────
CREATE TABLE public.compliance_frameworks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL, -- SOX, OHADA, IFRS, ISO27001
  version text,
  status text NOT NULL DEFAULT 'active',
  total_controls integer NOT NULL DEFAULT 0,
  compliant_controls integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.compliance_frameworks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.compliance_frameworks FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE public.compliance_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id uuid NOT NULL REFERENCES public.compliance_frameworks(id) ON DELETE CASCADE,
  control_code text NOT NULL,
  title text NOT NULL,
  description text,
  category text, -- financial, operational, IT
  owner text,
  status text NOT NULL DEFAULT 'not_tested', -- compliant, non_compliant, not_tested, partially_compliant
  last_tested_at timestamptz,
  next_review_at date,
  risk_level text DEFAULT 'medium', -- low, medium, high, critical
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.compliance_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Access via framework" ON public.compliance_controls FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.compliance_frameworks f WHERE f.id = compliance_controls.framework_id AND f.tenant_id = get_user_tenant_id(auth.uid())));

CREATE TABLE public.compliance_test_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id uuid NOT NULL REFERENCES public.compliance_controls(id) ON DELETE CASCADE,
  test_date date NOT NULL DEFAULT CURRENT_DATE,
  tester text NOT NULL,
  result text NOT NULL, -- pass, fail, partial
  findings integer NOT NULL DEFAULT 0,
  notes text,
  duration text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.compliance_test_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Access via control" ON public.compliance_test_logs FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.compliance_controls c
    JOIN public.compliance_frameworks f ON f.id = c.framework_id
    WHERE c.id = compliance_test_logs.control_id AND f.tenant_id = get_user_tenant_id(auth.uid())
  ));

-- ──── RISK MANAGEMENT ────
CREATE TABLE public.risk_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  risk_code text NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL, -- financial, operational, strategic, compliance, IT
  likelihood integer NOT NULL DEFAULT 3, -- 1-5
  impact integer NOT NULL DEFAULT 3, -- 1-5
  risk_score integer GENERATED ALWAYS AS (likelihood * impact) STORED,
  status text NOT NULL DEFAULT 'open', -- open, mitigated, accepted, closed
  owner text,
  mitigation_plan text,
  residual_likelihood integer,
  residual_impact integer,
  review_date date,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.risk_register ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.risk_register FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE public.risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_id uuid NOT NULL REFERENCES public.risk_register(id) ON DELETE CASCADE,
  assessment_date date NOT NULL DEFAULT CURRENT_DATE,
  assessor text NOT NULL,
  likelihood integer NOT NULL,
  impact integer NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.risk_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Access via risk" ON public.risk_assessments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.risk_register r WHERE r.id = risk_assessments.risk_id AND r.tenant_id = get_user_tenant_id(auth.uid())));
