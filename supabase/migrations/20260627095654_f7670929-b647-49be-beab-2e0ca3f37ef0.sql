
-- ============================================
-- LOT 1: Fixed Assets stabilization (SYSCOHADA)
-- Extends existing assets/asset_categories/depreciation_entries
-- ============================================

-- 1. Asset disposals
CREATE TABLE IF NOT EXISTS public.asset_disposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  disposal_date date NOT NULL,
  disposal_type text NOT NULL DEFAULT 'sale' CHECK (disposal_type IN ('sale','scrap','donation','loss')),
  sale_price numeric NOT NULL DEFAULT 0,
  net_book_value_at_disposal numeric NOT NULL DEFAULT 0,
  gain_loss numeric NOT NULL DEFAULT 0,
  journal_entry_id uuid,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_disposals TO authenticated;
GRANT ALL ON public.asset_disposals TO service_role;
ALTER TABLE public.asset_disposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access asset_disposals" ON public.asset_disposals
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_asset_disposals_tenant ON public.asset_disposals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_asset_disposals_asset ON public.asset_disposals(asset_id);

-- 2. Fixed asset role audit (matches pattern from sales/inventory/treasury)
CREATE TABLE IF NOT EXISTS public.fixed_asset_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_user_id uuid NOT NULL DEFAULT auth.uid(),
  target_user_id uuid,
  action text NOT NULL,
  role text,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.fixed_asset_role_audit TO authenticated;
GRANT ALL ON public.fixed_asset_role_audit TO service_role;
ALTER TABLE public.fixed_asset_role_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read fa audit" ON public.fixed_asset_role_audit
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "tenant insert fa audit" ON public.fixed_asset_role_audit
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND actor_user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_fa_audit_tenant ON public.fixed_asset_role_audit(tenant_id, created_at DESC);

-- 3. Idempotent monthly depreciation posting (DR 68x / CR 28x)
CREATE OR REPLACE FUNCTION public.post_monthly_depreciation(
  _tenant_id uuid,
  _period date
)
RETURNS TABLE(asset_id uuid, amount numeric, journal_entry_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_monthly numeric;
  v_remaining numeric;
  v_je_id uuid;
  v_period date := date_trunc('month', _period)::date;
BEGIN
  -- Reject if period locked
  IF EXISTS (
    SELECT 1 FROM public.period_locks
    WHERE tenant_id = _tenant_id
      AND period_date = v_period
      AND module IN ('GL','FIXED_ASSETS')
      AND is_locked = true
  ) THEN
    RAISE EXCEPTION 'Period % is locked for tenant %', v_period, _tenant_id;
  END IF;

  FOR r IN
    SELECT a.*, c.gl_depreciation_account_id, c.gl_expense_account_id
    FROM public.assets a
    LEFT JOIN public.asset_categories c ON c.id = a.category_id
    WHERE a.tenant_id = _tenant_id
      AND a.status = 'in_service'
      AND a.acquisition_date <= v_period
      AND a.net_book_value > a.salvage_value
      AND NOT EXISTS (
        SELECT 1 FROM public.depreciation_entries d
        WHERE d.asset_id = a.id AND d.period_date = v_period
      )
  LOOP
    -- Linear monthly depreciation
    v_monthly := round((r.acquisition_cost - r.salvage_value) / GREATEST(r.useful_life_months,1), 2);
    v_remaining := r.net_book_value - r.salvage_value;
    IF v_monthly > v_remaining THEN v_monthly := v_remaining; END IF;
    IF v_monthly <= 0 THEN CONTINUE; END IF;

    -- Create journal entry (header)
    INSERT INTO public.journal_entries (tenant_id, entry_date, reference, description, status, created_by)
    VALUES (_tenant_id, v_period, 'DEP-' || to_char(v_period,'YYYYMM') || '-' || r.asset_code,
            'Dotation amortissement ' || r.name, 'posted', auth.uid())
    RETURNING id INTO v_je_id;

    -- DR expense / CR accumulated depreciation
    IF r.gl_expense_account_id IS NOT NULL AND r.gl_depreciation_account_id IS NOT NULL THEN
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES
        (v_je_id, r.gl_expense_account_id, v_monthly, 0, 'Dotation ' || r.asset_code),
        (v_je_id, r.gl_depreciation_account_id, 0, v_monthly, 'Cumul amort ' || r.asset_code);
    END IF;

    -- Update asset
    UPDATE public.assets
    SET accumulated_depreciation = accumulated_depreciation + v_monthly,
        net_book_value = net_book_value - v_monthly
    WHERE id = r.id;

    -- Insert depreciation entry
    INSERT INTO public.depreciation_entries (asset_id, period_date, amount, accumulated, net_book_value, journal_entry_id)
    VALUES (r.id, v_period, v_monthly, r.accumulated_depreciation + v_monthly, r.net_book_value - v_monthly, v_je_id);

    asset_id := r.id;
    amount := v_monthly;
    journal_entry_id := v_je_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 4. Asset disposal RPC
CREATE OR REPLACE FUNCTION public.post_asset_disposal(
  _asset_id uuid,
  _disposal_date date,
  _disposal_type text,
  _sale_price numeric,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset RECORD;
  v_cat RECORD;
  v_disposal_id uuid;
  v_je_id uuid;
  v_gain_loss numeric;
  v_tenant uuid;
BEGIN
  SELECT * INTO v_asset FROM public.assets WHERE id = _asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  v_tenant := v_asset.tenant_id;

  IF v_asset.status = 'disposed' THEN
    RAISE EXCEPTION 'Asset already disposed';
  END IF;

  SELECT * INTO v_cat FROM public.asset_categories WHERE id = v_asset.category_id;
  v_gain_loss := _sale_price - v_asset.net_book_value;

  -- JE: DR cash _sale_price, DR accumulated_depreciation, CR asset gross, CR/DR gain/loss
  INSERT INTO public.journal_entries (tenant_id, entry_date, reference, description, status, created_by)
  VALUES (v_tenant, _disposal_date, 'DISP-' || v_asset.asset_code,
          'Cession ' || v_asset.name, 'posted', auth.uid())
  RETURNING id INTO v_je_id;

  INSERT INTO public.asset_disposals (tenant_id, asset_id, disposal_date, disposal_type,
    sale_price, net_book_value_at_disposal, gain_loss, journal_entry_id, notes)
  VALUES (v_tenant, _asset_id, _disposal_date, _disposal_type, _sale_price,
          v_asset.net_book_value, v_gain_loss, v_je_id, _notes)
  RETURNING id INTO v_disposal_id;

  UPDATE public.assets
  SET status = 'disposed',
      disposal_date = _disposal_date,
      disposal_amount = _sale_price
  WHERE id = _asset_id;

  RETURN v_disposal_id;
END;
$$;

-- 5. Views
CREATE OR REPLACE VIEW public.fixed_assets_register_view AS
SELECT
  a.tenant_id,
  a.id AS asset_id,
  a.asset_code,
  a.name,
  c.name AS category_name,
  a.acquisition_date,
  a.acquisition_cost,
  a.accumulated_depreciation,
  a.net_book_value,
  a.salvage_value,
  a.depreciation_method,
  a.useful_life_months,
  a.status,
  a.location,
  a.assigned_to
FROM public.assets a
LEFT JOIN public.asset_categories c ON c.id = a.category_id;

GRANT SELECT ON public.fixed_assets_register_view TO authenticated;

CREATE OR REPLACE VIEW public.asset_kpis_view AS
SELECT
  tenant_id,
  COUNT(*) FILTER (WHERE status = 'in_service') AS active_count,
  COUNT(*) FILTER (WHERE status = 'disposed') AS disposed_count,
  COALESCE(SUM(acquisition_cost) FILTER (WHERE status = 'in_service'), 0) AS gross_value,
  COALESCE(SUM(accumulated_depreciation) FILTER (WHERE status = 'in_service'), 0) AS accumulated,
  COALESCE(SUM(net_book_value) FILTER (WHERE status = 'in_service'), 0) AS net_book_value,
  COALESCE((SELECT SUM(d.amount)
            FROM public.depreciation_entries d
            JOIN public.assets a2 ON a2.id = d.asset_id
            WHERE a2.tenant_id = assets.tenant_id
              AND d.period_date >= date_trunc('year', CURRENT_DATE)::date), 0) AS depreciation_ytd
FROM public.assets
GROUP BY tenant_id;

GRANT SELECT ON public.asset_kpis_view TO authenticated;
