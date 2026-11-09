
-- ───── AP CONFIG TABLES ─────

CREATE TABLE IF NOT EXISTS public.ap_general_settings (
  tenant_id uuid PRIMARY KEY,
  default_currency text DEFAULT 'XOF',
  default_payment_method text DEFAULT 'WIRE',
  po_required text DEFAULT 'mandatory',
  three_way_match boolean DEFAULT true,
  early_payment_discount_pct numeric DEFAULT 2.0,
  discount_window_days integer DEFAULT 10,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ap_general_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ap_general_settings FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ap_numbering_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  doc_type text NOT NULL,
  prefix text NOT NULL,
  format text NOT NULL DEFAULT 'PREFIX-YYYY-####',
  next_number integer NOT NULL DEFAULT 1,
  reset_frequency text NOT NULL DEFAULT 'yearly',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, doc_type)
);
ALTER TABLE public.ap_numbering_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ap_numbering_series FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ap_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, code)
);
ALTER TABLE public.ap_payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ap_payment_methods FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ap_withholding_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  category text NOT NULL,
  rate_pct numeric NOT NULL DEFAULT 0,
  gl_account text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ap_withholding_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ap_withholding_rates FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ap_notification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  recipients text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ap_notification_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ap_notification_rules FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ap_approval_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  level text NOT NULL,
  max_amount numeric,
  approver text NOT NULL,
  sla_hours integer NOT NULL DEFAULT 24,
  doc_types text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, level)
);
ALTER TABLE public.ap_approval_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ap_approval_thresholds FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ap_approval_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  doc_number text NOT NULL,
  doc_type text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  level text NOT NULL,
  requester text NOT NULL,
  request_date date NOT NULL DEFAULT CURRENT_DATE,
  sla_hours integer NOT NULL DEFAULT 24,
  status text NOT NULL DEFAULT 'pending',
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ap_approval_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ap_approval_queue FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- ───── SEED DEFAULTS ON FIRST ACCESS ─────
CREATE OR REPLACE FUNCTION public.seed_ap_defaults(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ap_general_settings(tenant_id) VALUES (_tenant_id) ON CONFLICT DO NOTHING;

  INSERT INTO public.ap_numbering_series(tenant_id, doc_type, prefix, format) VALUES
    (_tenant_id, 'Supplier Invoice', 'APINV-', 'APINV-YYYY-####'),
    (_tenant_id, 'Credit Note', 'APCN-', 'APCN-YYYY-####'),
    (_tenant_id, 'Payment', 'APPAY-', 'APPAY-YYYY-####')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ap_payment_methods(tenant_id, code, label, is_default, is_active) VALUES
    (_tenant_id, 'WIRE', 'Virement bancaire', true, true),
    (_tenant_id, 'CHECK', 'Chèque', false, true),
    (_tenant_id, 'LC', 'Lettre de crédit', false, true),
    (_tenant_id, 'CASH', 'Espèces', false, false)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ap_withholding_rates(tenant_id, category, rate_pct, gl_account, is_active) VALUES
    (_tenant_id, 'Services (BIC)', 7.5, '4471', true),
    (_tenant_id, 'Loyers', 15, '4472', true),
    (_tenant_id, 'Non-résidents', 20, '4473', true),
    (_tenant_id, 'Dividendes', 10, '4474', false);

  INSERT INTO public.ap_notification_rules(tenant_id, event, channel, recipients) VALUES
    (_tenant_id, 'Facture en attente > 48h', 'email', 'AP Manager'),
    (_tenant_id, 'Échéance dans 3 jours', 'email,inapp', 'AP Clerk, Treasury'),
    (_tenant_id, 'Paiement > 50M XOF', 'inapp', 'CFO'),
    (_tenant_id, 'Échec 3-way match', 'email', 'AP Manager');

  INSERT INTO public.ap_approval_thresholds(tenant_id, level, max_amount, approver, sla_hours, doc_types) VALUES
    (_tenant_id, 'L1 — Clerk', 5000000, 'AP Clerk', 4, 'Facture, Avoir'),
    (_tenant_id, 'L2 — Manager', 20000000, 'AP Manager', 24, 'Facture, Paiement'),
    (_tenant_id, 'L3 — Director', 50000000, 'Finance Director', 48, 'Paiement, Contrat'),
    (_tenant_id, 'L4 — CFO', NULL, 'CFO', 72, 'Tous au-dessus du seuil')
  ON CONFLICT DO NOTHING;
END;
$$;
