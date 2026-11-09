
-- ─── Payment Terms ───
CREATE TABLE IF NOT EXISTS public.ar_payment_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  days integer NOT NULL DEFAULT 30,
  discount_percent numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
ALTER TABLE public.ar_payment_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ar_payment_terms FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- ─── Numbering Series ───
CREATE TABLE IF NOT EXISTS public.ar_numbering_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  doc_type text NOT NULL,
  prefix text NOT NULL,
  format text NOT NULL DEFAULT 'PREFIX-YYYY-####',
  next_number integer NOT NULL DEFAULT 1,
  reset_frequency text NOT NULL DEFAULT 'yearly',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, doc_type)
);
ALTER TABLE public.ar_numbering_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ar_numbering_series FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- ─── Dunning Rules ───
CREATE TABLE IF NOT EXISTS public.ar_dunning_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  level integer NOT NULL,
  days_overdue integer NOT NULL,
  action text NOT NULL,
  fee_amount numeric NOT NULL DEFAULT 0,
  template text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, level)
);
ALTER TABLE public.ar_dunning_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ar_dunning_rules FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- ─── Notification Rules ───
CREATE TABLE IF NOT EXISTS public.ar_notification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  trigger_condition text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  recipients text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz,
  trigger_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ar_notification_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ar_notification_rules FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- ─── Notification Log ───
CREATE TABLE IF NOT EXISTS public.ar_notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  rule_id uuid,
  customer_id uuid,
  customer_name text,
  channel text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'delivered',
  sent_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ar_notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ar_notification_log FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- ─── Period Locks ───
CREATE TABLE IF NOT EXISTS public.period_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  period text NOT NULL,
  module text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period, module)
);
ALTER TABLE public.period_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.period_locks FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- ─── Report Templates ───
CREATE TABLE IF NOT EXISTS public.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  module text NOT NULL,
  name text NOT NULL,
  data_source text NOT NULL,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  group_by text,
  status text NOT NULL DEFAULT 'active',
  permission text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.report_templates FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- ─── AR General Settings ───
CREATE TABLE IF NOT EXISTS public.ar_general_settings (
  tenant_id uuid PRIMARY KEY,
  default_payment_term_code text DEFAULT 'NET30',
  default_currency text DEFAULT 'XOF',
  default_credit_limit numeric DEFAULT 10000000,
  auto_numbering boolean DEFAULT true,
  late_payment_interest_pct numeric DEFAULT 1.5,
  grace_period_days integer DEFAULT 5,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ar_general_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ar_general_settings FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- ─── Credit Exposure View ───
CREATE OR REPLACE VIEW public.ar_credit_exposure_view AS
SELECT
  c.tenant_id,
  c.id AS customer_id,
  c.name AS customer_name,
  COALESCE(c.credit_limit, 0) AS credit_limit,
  COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','cancelled') THEN (i.total - i.amount_paid) ELSE 0 END), 0) AS outstanding,
  COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','cancelled') AND i.due_date < CURRENT_DATE THEN (i.total - i.amount_paid) ELSE 0 END), 0) AS overdue,
  COALESCE(ROUND(AVG(CASE WHEN i.status NOT IN ('paid','cancelled') THEN (CURRENT_DATE - i.invoice_date) END))::int, 0) AS dso,
  CASE
    WHEN COALESCE(c.credit_limit, 0) > 0 AND COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','cancelled') THEN (i.total - i.amount_paid) ELSE 0 END), 0) > c.credit_limit THEN 95
    WHEN COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','cancelled') AND i.due_date < CURRENT_DATE - 60 THEN 1 ELSE 0 END), 0) > 0 THEN 80
    WHEN COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','cancelled') AND i.due_date < CURRENT_DATE - 30 THEN 1 ELSE 0 END), 0) > 0 THEN 60
    WHEN COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','cancelled') AND i.due_date < CURRENT_DATE THEN 1 ELSE 0 END), 0) > 0 THEN 40
    ELSE 15
  END AS risk_score
FROM public.customers c
LEFT JOIN public.ar_invoices i ON i.customer_id = c.id
GROUP BY c.tenant_id, c.id, c.name, c.credit_limit;

-- ─── Seed defaults trigger ───
CREATE OR REPLACE FUNCTION public.seed_ar_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ar_payment_terms (tenant_id, code, label, days, discount_percent) VALUES
    (NEW.id, 'NET30', 'Net 30', 30, 0),
    (NEW.id, 'NET60', 'Net 60', 60, 0),
    (NEW.id, '2/10N30', '2% 10 Net 30', 30, 2),
    (NEW.id, 'COD', 'Cash on Delivery', 0, 0)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format) VALUES
    (NEW.id, 'invoice', 'INV-', 'INV-YYYY-####'),
    (NEW.id, 'credit_note', 'CN-', 'CN-YYYY-####'),
    (NEW.id, 'receipt', 'REC-', 'REC-YYYY-####'),
    (NEW.id, 'adjustment', 'ADJ-', 'ADJ-YYYY-####')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ar_dunning_rules (tenant_id, level, days_overdue, action, fee_amount, template) VALUES
    (NEW.id, 1, 7, 'Email reminder', 0, 'Friendly reminder'),
    (NEW.id, 2, 30, 'Formal letter', 15000, 'First notice'),
    (NEW.id, 3, 60, 'Phone + letter', 50000, 'Final notice'),
    (NEW.id, 4, 90, 'Legal action', 150000, 'Legal warning')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ar_general_settings (tenant_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_seed_ar_defaults ON public.tenants;
CREATE TRIGGER trg_seed_ar_defaults
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.seed_ar_defaults();

-- Backfill for existing tenants
DO $$
DECLARE _t record;
BEGIN
  FOR _t IN SELECT id FROM public.tenants LOOP
    INSERT INTO public.ar_payment_terms (tenant_id, code, label, days, discount_percent) VALUES
      (_t.id, 'NET30', 'Net 30', 30, 0),
      (_t.id, 'NET60', 'Net 60', 60, 0),
      (_t.id, '2/10N30', '2% 10 Net 30', 30, 2),
      (_t.id, 'COD', 'Cash on Delivery', 0, 0)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format) VALUES
      (_t.id, 'invoice', 'INV-', 'INV-YYYY-####'),
      (_t.id, 'credit_note', 'CN-', 'CN-YYYY-####'),
      (_t.id, 'receipt', 'REC-', 'REC-YYYY-####'),
      (_t.id, 'adjustment', 'ADJ-', 'ADJ-YYYY-####')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.ar_dunning_rules (tenant_id, level, days_overdue, action, fee_amount, template) VALUES
      (_t.id, 1, 7, 'Email reminder', 0, 'Friendly reminder'),
      (_t.id, 2, 30, 'Formal letter', 15000, 'First notice'),
      (_t.id, 3, 60, 'Phone + letter', 50000, 'Final notice'),
      (_t.id, 4, 90, 'Legal action', 150000, 'Legal warning')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.ar_general_settings (tenant_id) VALUES (_t.id)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
