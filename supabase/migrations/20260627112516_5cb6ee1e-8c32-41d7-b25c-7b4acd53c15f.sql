
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  matricule text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  job_title text,
  department text,
  contract_type text NOT NULL DEFAULT 'CDI',
  hire_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  base_salary numeric(18,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'XOF',
  bank_account text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, matricule)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees tenant scoped"
  ON public.employees FOR ALL
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  period text NOT NULL,
  pay_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  gross_total numeric(18,2) NOT NULL DEFAULT 0,
  net_total numeric(18,2) NOT NULL DEFAULT 0,
  employee_count int NOT NULL DEFAULT 0,
  created_by uuid,
  approved_by uuid,
  executed_by uuid,
  approved_at timestamptz,
  executed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_runs TO authenticated;
GRANT ALL ON public.payroll_runs TO service_role;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payroll_runs tenant scoped"
  ON public.payroll_runs FOR ALL
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  gross numeric(18,2) NOT NULL DEFAULT 0,
  deductions numeric(18,2) NOT NULL DEFAULT 0,
  taxes numeric(18,2) NOT NULL DEFAULT 0,
  net numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_lines TO authenticated;
GRANT ALL ON public.payroll_lines TO service_role;
ALTER TABLE public.payroll_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payroll_lines tenant scoped"
  ON public.payroll_lines FOR ALL
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.hr_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  role text NOT NULL,
  action text NOT NULL,
  performed_by uuid NOT NULL,
  reason text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.hr_role_audit TO authenticated;
GRANT ALL ON public.hr_role_audit TO service_role;
ALTER TABLE public.hr_role_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hr_role_audit tenant read"
  ON public.hr_role_audit FOR SELECT
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "hr_role_audit admin insert"
  ON public.hr_role_audit FOR INSERT
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_payroll_runs_updated_at
  BEFORE UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_employees_tenant ON public.employees(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_period ON public.payroll_runs(tenant_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON public.payroll_lines(run_id);
CREATE INDEX IF NOT EXISTS idx_hr_audit_tenant ON public.hr_role_audit(tenant_id, created_at DESC);
