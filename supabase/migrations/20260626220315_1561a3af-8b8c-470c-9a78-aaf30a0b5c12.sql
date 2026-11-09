
-- =========================================================
-- Tables
-- =========================================================
CREATE TABLE IF NOT EXISTS public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  address text,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouses TO authenticated;
GRANT ALL ON public.warehouses TO service_role;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "warehouses tenant access" ON public.warehouses;
CREATE POLICY "warehouses tenant access" ON public.warehouses FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.item_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  bin_location text,
  quantity_on_hand numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, warehouse_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_locations TO authenticated;
GRANT ALL ON public.item_locations TO service_role;
ALTER TABLE public.item_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "item_locations tenant access" ON public.item_locations;
CREATE POLICY "item_locations tenant access" ON public.item_locations FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.stock_valuation_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  layer_date date NOT NULL DEFAULT CURRENT_DATE,
  qty_in numeric NOT NULL DEFAULT 0,
  cost_in numeric NOT NULL DEFAULT 0,
  qty_remaining numeric NOT NULL DEFAULT 0,
  source_type text,
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_valuation_layers TO authenticated;
GRANT ALL ON public.stock_valuation_layers TO service_role;
ALTER TABLE public.stock_valuation_layers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "valuation layers tenant access" ON public.stock_valuation_layers;
CREATE POLICY "valuation layers tenant access" ON public.stock_valuation_layers FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  count_number text NOT NULL,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  count_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_by uuid,
  posted_by uuid,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_counts TO authenticated;
GRANT ALL ON public.inventory_counts TO service_role;
ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inv counts tenant access" ON public.inventory_counts;
CREATE POLICY "inv counts tenant access" ON public.inventory_counts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.inventory_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  expected_qty numeric NOT NULL DEFAULT 0,
  counted_qty numeric NOT NULL DEFAULT 0,
  variance numeric GENERATED ALWAYS AS (counted_qty - expected_qty) STORED,
  unit_cost numeric NOT NULL DEFAULT 0,
  variance_value numeric GENERATED ALWAYS AS ((counted_qty - expected_qty) * unit_cost) STORED,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_count_lines TO authenticated;
GRANT ALL ON public.inventory_count_lines TO service_role;
ALTER TABLE public.inventory_count_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inv count lines tenant access" ON public.inventory_count_lines;
CREATE POLICY "inv count lines tenant access" ON public.inventory_count_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.inventory_counts c
    WHERE c.id = count_id AND c.tenant_id = public.get_user_tenant_id(auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.inventory_counts c
    WHERE c.id = count_id AND c.tenant_id = public.get_user_tenant_id(auth.uid())));

CREATE TABLE IF NOT EXISTS public.inventory_settings (
  tenant_id uuid PRIMARY KEY,
  valuation_method text NOT NULL DEFAULT 'CMP',
  negative_stock_allowed boolean NOT NULL DEFAULT false,
  auto_je_on_movement boolean NOT NULL DEFAULT true,
  stock_account_code text NOT NULL DEFAULT '3100',
  variance_account_code text NOT NULL DEFAULT '6580',
  cogs_account_code text NOT NULL DEFAULT '6010',
  low_stock_alerts_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_settings TO authenticated;
GRANT ALL ON public.inventory_settings TO service_role;
ALTER TABLE public.inventory_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inv settings tenant access" ON public.inventory_settings;
CREATE POLICY "inv settings tenant access" ON public.inventory_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.inventory_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  action text NOT NULL CHECK (action IN ('assign','revoke')),
  performed_by uuid,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.inventory_role_audit TO authenticated;
GRANT ALL ON public.inventory_role_audit TO service_role;
ALTER TABLE public.inventory_role_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inv role audit read" ON public.inventory_role_audit;
CREATE POLICY "inv role audit read" ON public.inventory_role_audit FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
DROP POLICY IF EXISTS "inv role audit insert via definer" ON public.inventory_role_audit;
CREATE POLICY "inv role audit insert via definer" ON public.inventory_role_audit FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- =========================================================
-- Extensions des tables existantes
-- =========================================================
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS valuation_method text NOT NULL DEFAULT 'CMP',
  ADD COLUMN IF NOT EXISTS default_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS safety_stock numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_stock numeric,
  ADD COLUMN IF NOT EXISTS abc_class text,
  ADD COLUMN IF NOT EXISTS average_cost numeric NOT NULL DEFAULT 0;

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted';

CREATE INDEX IF NOT EXISTS idx_stock_mov_item ON public.stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_wh ON public.stock_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_date ON public.stock_movements(movement_date);

-- =========================================================
-- Triggers utilitaires
-- =========================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_warehouses_touch ON public.warehouses;
CREATE TRIGGER trg_warehouses_touch BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_item_loc_touch ON public.item_locations;
CREATE TRIGGER trg_item_loc_touch BEFORE UPDATE ON public.item_locations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_inv_counts_touch ON public.inventory_counts;
CREATE TRIGGER trg_inv_counts_touch BEFORE UPDATE ON public.inventory_counts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_inv_settings_touch ON public.inventory_settings;
CREATE TRIGGER trg_inv_settings_touch BEFORE UPDATE ON public.inventory_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Notify helper
CREATE OR REPLACE FUNCTION public.notify_inventory(_tenant_id uuid, _severity text, _title text, _message text, _ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.erp_alerts (tenant_id, severity, alert_type, title, message, ref_type, ref_id, module, status)
  VALUES (_tenant_id, _severity, 'inventory', _title, _message, 'inventory', _ref, 'Inventory', 'active');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Compute value
CREATE OR REPLACE FUNCTION public.compute_stock_movement_value()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.unit_cost IS NULL THEN NEW.unit_cost := 0; END IF;
  NEW.total_value := ROUND((ABS(COALESCE(NEW.quantity,0)) * COALESCE(NEW.unit_cost,0))::numeric, 2);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stock_mov_value ON public.stock_movements;
CREATE TRIGGER trg_stock_mov_value BEFORE INSERT OR UPDATE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.compute_stock_movement_value();

-- Apply movement: CMP, on_hand, item_locations, low-stock alert
CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _settings public.inventory_settings%ROWTYPE;
  _item public.items%ROWTYPE;
  _qty numeric := COALESCE(NEW.quantity, 0);
  _abs numeric := ABS(_qty);
  _is_in boolean := _qty > 0;
  _new_qty numeric;
  _new_avg numeric;
  _wh uuid := NEW.warehouse_id;
  _remaining numeric;
  _layer record;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  IF _qty = 0 THEN RETURN NEW; END IF;

  SELECT * INTO _settings FROM public.inventory_settings WHERE tenant_id = NEW.tenant_id;
  SELECT * INTO _item FROM public.items WHERE id = NEW.item_id;
  IF _item.id IS NULL THEN RETURN NEW; END IF;

  IF NOT _is_in AND NOT COALESCE(_settings.negative_stock_allowed, false) THEN
    IF COALESCE(_item.quantity_on_hand,0) < _abs THEN
      RAISE EXCEPTION 'Stock insuffisant pour % (dispo=%, demandé=%)', _item.code, _item.quantity_on_hand, _abs;
    END IF;
  END IF;

  IF _is_in AND COALESCE(NEW.unit_cost,0) > 0 THEN
    _new_qty := COALESCE(_item.quantity_on_hand,0) + _abs;
    IF _new_qty > 0 THEN
      _new_avg := ((COALESCE(_item.quantity_on_hand,0) * COALESCE(_item.average_cost,0))
                   + (_abs * NEW.unit_cost)) / _new_qty;
      UPDATE public.items SET average_cost = ROUND(_new_avg::numeric, 4) WHERE id = NEW.item_id;
    END IF;
    INSERT INTO public.stock_valuation_layers(tenant_id, item_id, warehouse_id, layer_date, qty_in, cost_in, qty_remaining, source_type, source_id)
    VALUES (NEW.tenant_id, NEW.item_id, _wh, COALESCE(NEW.movement_date, CURRENT_DATE),
            _abs, NEW.unit_cost, _abs, NEW.reference_type, NEW.reference_id);
  ELSIF NOT _is_in THEN
    _remaining := _abs;
    FOR _layer IN SELECT * FROM public.stock_valuation_layers
                   WHERE item_id = NEW.item_id AND qty_remaining > 0
                     AND (_wh IS NULL OR warehouse_id IS NOT DISTINCT FROM _wh)
                   ORDER BY layer_date, created_at
    LOOP
      EXIT WHEN _remaining <= 0;
      IF _layer.qty_remaining >= _remaining THEN
        UPDATE public.stock_valuation_layers SET qty_remaining = qty_remaining - _remaining WHERE id = _layer.id;
        _remaining := 0;
      ELSE
        _remaining := _remaining - _layer.qty_remaining;
        UPDATE public.stock_valuation_layers SET qty_remaining = 0 WHERE id = _layer.id;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.items SET quantity_on_hand = COALESCE(quantity_on_hand,0) + _qty WHERE id = NEW.item_id;

  IF _wh IS NOT NULL THEN
    INSERT INTO public.item_locations(tenant_id, item_id, warehouse_id, quantity_on_hand)
    VALUES (NEW.tenant_id, NEW.item_id, _wh, _qty)
    ON CONFLICT (item_id, warehouse_id)
    DO UPDATE SET quantity_on_hand = public.item_locations.quantity_on_hand + EXCLUDED.quantity_on_hand,
                  updated_at = now();
  END IF;

  IF COALESCE(_settings.low_stock_alerts_enabled, true) THEN
    PERFORM 1 FROM public.items WHERE id = NEW.item_id
      AND quantity_on_hand <= COALESCE(NULLIF(safety_stock,0), reorder_level, 0)
      AND COALESCE(NULLIF(safety_stock,0), reorder_level, 0) > 0;
    IF FOUND THEN
      PERFORM public.notify_inventory(NEW.tenant_id, 'warning',
        'Stock bas — ' || _item.code,
        'Article ' || _item.name || ' sous le seuil de réapprovisionnement.',
        NEW.item_id::text);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_apply_stock_mov ON public.stock_movements;
CREATE TRIGGER trg_apply_stock_mov AFTER INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

-- Period lock
CREATE OR REPLACE FUNCTION public.enforce_inventory_period_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _period text; _date date; _locked boolean;
BEGIN
  _date := COALESCE(NEW.movement_date, CURRENT_DATE);
  _period := to_char(_date, 'YYYY-MM');
  SELECT (status='closed') INTO _locked FROM public.period_locks
    WHERE tenant_id = NEW.tenant_id AND module = 'Inventory' AND period = _period LIMIT 1;
  IF COALESCE(_locked,false) THEN
    RAISE EXCEPTION 'Période stock % verrouillée', _period;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inv_period_lock ON public.stock_movements;
CREATE TRIGGER trg_inv_period_lock BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_inventory_period_lock();

-- Auto JE on movement
CREATE OR REPLACE FUNCTION public.on_stock_movement_je()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _settings public.inventory_settings%ROWTYPE;
  _entry_id uuid; _entry_number text;
  _stock_acc uuid; _other_acc uuid;
  _value numeric := COALESCE(NEW.total_value, 0);
  _is_in boolean := COALESCE(NEW.quantity,0) > 0;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  IF _value <= 0 THEN RETURN NEW; END IF;

  SELECT * INTO _settings FROM public.inventory_settings WHERE tenant_id = NEW.tenant_id;
  IF NOT COALESCE(_settings.auto_je_on_movement, true) THEN RETURN NEW; END IF;

  SELECT id INTO _stock_acc FROM public.gl_accounts
    WHERE tenant_id = NEW.tenant_id AND code = COALESCE(_settings.stock_account_code,'3100') LIMIT 1;

  IF NEW.movement_type IN ('delivery','sale','issue') OR (NEW.reference_type = 'delivery_note') THEN
    SELECT id INTO _other_acc FROM public.gl_accounts
      WHERE tenant_id = NEW.tenant_id AND code = COALESCE(_settings.cogs_account_code,'6010') LIMIT 1;
  ELSIF NEW.movement_type = 'adjustment' THEN
    SELECT id INTO _other_acc FROM public.gl_accounts
      WHERE tenant_id = NEW.tenant_id AND code = COALESCE(_settings.variance_account_code,'6580') LIMIT 1;
  ELSE
    SELECT id INTO _other_acc FROM public.gl_accounts
      WHERE tenant_id = NEW.tenant_id AND code = '4010' LIMIT 1;
  END IF;

  IF _stock_acc IS NULL OR _other_acc IS NULL THEN RETURN NEW; END IF;

  _entry_number := 'JE-STK-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
  INSERT INTO public.journal_entries(tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, _entry_number, COALESCE(NEW.movement_date, CURRENT_DATE),
          'Stock ' || NEW.movement_type || ' — ' || COALESCE(NEW.reference_type,''),
          'stock_movement', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  IF _is_in THEN
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _stock_acc, _value, 0, 'DR Stock');
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _other_acc, 0, _value, 'CR Contrepartie');
  ELSE
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _other_acc, _value, 0, 'DR Contrepartie');
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _stock_acc, 0, _value, 'CR Stock');
  END IF;

  UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  UPDATE public.stock_movements SET journal_entry_id = _entry_id WHERE id = NEW.id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stock_mov_je ON public.stock_movements;
CREATE TRIGGER trg_stock_mov_je AFTER INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.on_stock_movement_je();

-- =========================================================
-- RBAC helper & assignment
-- =========================================================
CREATE OR REPLACE FUNCTION public.has_inventory_perm(_user_id uuid, _action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR CASE _action
      WHEN 'move'      THEN public.has_role(_user_id,'inventory_clerk'::public.app_role)
                         OR public.has_role(_user_id,'inventory_manager'::public.app_role)
                         OR public.has_role(_user_id,'inventory_controller'::public.app_role)
      WHEN 'adjust'    THEN public.has_role(_user_id,'inventory_manager'::public.app_role)
                         OR public.has_role(_user_id,'inventory_controller'::public.app_role)
      WHEN 'transfer'  THEN public.has_role(_user_id,'inventory_clerk'::public.app_role)
                         OR public.has_role(_user_id,'inventory_manager'::public.app_role)
                         OR public.has_role(_user_id,'inventory_controller'::public.app_role)
      WHEN 'count'     THEN public.has_role(_user_id,'inventory_clerk'::public.app_role)
                         OR public.has_role(_user_id,'inventory_manager'::public.app_role)
                         OR public.has_role(_user_id,'inventory_controller'::public.app_role)
      WHEN 'post_count' THEN public.has_role(_user_id,'inventory_manager'::public.app_role)
                          OR public.has_role(_user_id,'inventory_controller'::public.app_role)
      ELSE false
    END
$$;

CREATE OR REPLACE FUNCTION public.assign_inventory_role(_target_user uuid, _role public.app_role, _action text, _comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _t uuid;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RAISE EXCEPTION 'Admin only'; END IF;
  IF _action NOT IN ('assign','revoke') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  IF _role::text NOT IN ('inventory_clerk','inventory_manager','inventory_controller') THEN
    RAISE EXCEPTION 'Not an inventory role';
  END IF;
  SELECT tenant_id INTO _t FROM public.profiles WHERE id = _target_user;
  IF _t IS NULL OR _t <> _tenant THEN RAISE EXCEPTION 'Target user not in your tenant'; END IF;

  IF _action = 'assign' THEN
    INSERT INTO public.user_roles(user_id, role, tenant_id) VALUES (_target_user, _role, _tenant)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _target_user AND role = _role AND tenant_id = _tenant;
  END IF;

  INSERT INTO public.inventory_role_audit(tenant_id, target_user_id, role, action, performed_by, comment)
  VALUES (_tenant, _target_user, _role, _action, auth.uid(), _comment);
END $$;

-- Transfer & post_count RPCs (after has_inventory_perm exists)
CREATE OR REPLACE FUNCTION public.transfer_stock(_item_id uuid, _from_wh uuid, _to_wh uuid, _qty numeric, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _avg numeric;
BEGIN
  IF NOT public.has_inventory_perm(auth.uid(), 'transfer') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'Quantité doit être > 0'; END IF;
  IF _from_wh = _to_wh THEN RAISE EXCEPTION 'Entrepôts identiques'; END IF;

  SELECT average_cost INTO _avg FROM public.items WHERE id = _item_id;

  INSERT INTO public.stock_movements(tenant_id, item_id, movement_type, quantity, unit_cost, warehouse_id, reference_type, created_by, status)
  VALUES (_tenant, _item_id, 'transfer_out', -_qty, COALESCE(_avg,0), _from_wh, 'transfer', auth.uid(), 'posted');
  INSERT INTO public.stock_movements(tenant_id, item_id, movement_type, quantity, unit_cost, warehouse_id, reference_type, created_by, status)
  VALUES (_tenant, _item_id, 'transfer_in',  _qty, COALESCE(_avg,0), _to_wh,   'transfer', auth.uid(), 'posted');

  PERFORM public.notify_inventory(_tenant, 'info', 'Transfert stock', _qty || ' unités déplacées', _item_id::text);
END $$;

CREATE OR REPLACE FUNCTION public.post_inventory_count(_count_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _c public.inventory_counts%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _line record;
BEGIN
  IF NOT public.has_inventory_perm(auth.uid(), 'post_count') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  SELECT * INTO _c FROM public.inventory_counts WHERE id = _count_id;
  IF _c.tenant_id <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _c.status = 'posted' THEN RAISE EXCEPTION 'Inventaire déjà validé'; END IF;

  FOR _line IN SELECT l.*, i.average_cost FROM public.inventory_count_lines l
                 JOIN public.items i ON i.id = l.item_id
                 WHERE l.count_id = _count_id AND l.counted_qty <> l.expected_qty
  LOOP
    INSERT INTO public.stock_movements(tenant_id, item_id, movement_type, quantity, unit_cost, warehouse_id, reference_type, reference_id, created_by, status)
    VALUES (_tenant, _line.item_id, 'adjustment', _line.counted_qty - _line.expected_qty,
            COALESCE(_line.unit_cost, _line.average_cost, 0), _c.warehouse_id, 'inventory_count', _count_id, auth.uid(), 'posted');
  END LOOP;

  UPDATE public.inventory_counts SET status='posted', posted_by=auth.uid(), posted_at=now() WHERE id=_count_id;
  PERFORM public.notify_inventory(_tenant, 'success', 'Inventaire validé', _c.count_number, _count_id::text);
END $$;

-- =========================================================
-- Seed defaults
-- =========================================================
CREATE OR REPLACE FUNCTION public.seed_inventory_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.inventory_settings(tenant_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.warehouses(tenant_id, code, name, is_default)
  VALUES (NEW.id, 'MAIN', 'Entrepôt principal', true) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_seed_inv_defaults ON public.tenants;
CREATE TRIGGER trg_seed_inv_defaults AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.seed_inventory_defaults();

INSERT INTO public.inventory_settings(tenant_id)
  SELECT id FROM public.tenants ON CONFLICT DO NOTHING;
INSERT INTO public.warehouses(tenant_id, code, name, is_default)
  SELECT id, 'MAIN', 'Entrepôt principal', true FROM public.tenants
  ON CONFLICT DO NOTHING;

-- =========================================================
-- Realtime publish
-- =========================================================
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_movements;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_counts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.item_locations;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_role_audit;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.warehouses;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- Views
-- =========================================================
CREATE OR REPLACE VIEW public.stock_valuation_view AS
SELECT
  i.tenant_id, i.id AS item_id, i.code, i.name, i.unit,
  COALESCE(il.warehouse_id, i.default_warehouse_id) AS warehouse_id,
  w.code AS warehouse_code, w.name AS warehouse_name,
  COALESCE(il.quantity_on_hand, i.quantity_on_hand) AS quantity_on_hand,
  i.average_cost,
  ROUND((COALESCE(il.quantity_on_hand, i.quantity_on_hand) * COALESCE(i.average_cost,0))::numeric, 2) AS stock_value
FROM public.items i
LEFT JOIN public.item_locations il ON il.item_id = i.id
LEFT JOIN public.warehouses w ON w.id = COALESCE(il.warehouse_id, i.default_warehouse_id);
GRANT SELECT ON public.stock_valuation_view TO authenticated;

CREATE OR REPLACE VIEW public.low_stock_alerts_view AS
SELECT i.tenant_id, i.id AS item_id, i.code, i.name, i.unit,
       i.quantity_on_hand,
       COALESCE(NULLIF(i.safety_stock,0), i.reorder_level, 0) AS threshold,
       (COALESCE(NULLIF(i.safety_stock,0), i.reorder_level, 0) - i.quantity_on_hand) AS gap
FROM public.items i
WHERE COALESCE(NULLIF(i.safety_stock,0), i.reorder_level, 0) > 0
  AND i.quantity_on_hand <= COALESCE(NULLIF(i.safety_stock,0), i.reorder_level, 0);
GRANT SELECT ON public.low_stock_alerts_view TO authenticated;

CREATE OR REPLACE VIEW public.stock_movements_audit_view AS
SELECT sm.id, sm.tenant_id, sm.movement_date, sm.movement_type, sm.quantity,
       sm.unit_cost, sm.total_value, sm.reference_type, sm.reference_id,
       sm.warehouse_id, w.code AS warehouse_code,
       sm.item_id, i.code AS item_code, i.name AS item_name,
       sm.journal_entry_id, je.entry_number,
       sm.created_by, sm.created_at, sm.status
FROM public.stock_movements sm
LEFT JOIN public.items i ON i.id = sm.item_id
LEFT JOIN public.warehouses w ON w.id = sm.warehouse_id
LEFT JOIN public.journal_entries je ON je.id = sm.journal_entry_id;
GRANT SELECT ON public.stock_movements_audit_view TO authenticated;

CREATE OR REPLACE VIEW public.inventory_kpis_view AS
SELECT
  i.tenant_id,
  COUNT(*) FILTER (WHERE i.status = 'active') AS active_items,
  COUNT(*) FILTER (WHERE i.quantity_on_hand <= COALESCE(NULLIF(i.safety_stock,0), i.reorder_level, 0)
                      AND COALESCE(NULLIF(i.safety_stock,0), i.reorder_level, 0) > 0) AS low_stock_items,
  COUNT(*) FILTER (WHERE i.quantity_on_hand <= 0) AS out_of_stock_items,
  ROUND(COALESCE(SUM(i.quantity_on_hand * i.average_cost),0)::numeric, 2) AS total_stock_value
FROM public.items i
GROUP BY i.tenant_id;
GRANT SELECT ON public.inventory_kpis_view TO authenticated;

CREATE OR REPLACE VIEW public.abc_analysis_view AS
WITH sales AS (
  SELECT dn.tenant_id, dnl.item_id, SUM(dnl.total) AS revenue_12m
  FROM public.dn_lines dnl
  JOIN public.delivery_notes dn ON dn.id = dnl.dn_id
  WHERE dn.delivery_date >= CURRENT_DATE - INTERVAL '12 months'
  GROUP BY dn.tenant_id, dnl.item_id
), ranked AS (
  SELECT s.*, SUM(revenue_12m) OVER (PARTITION BY tenant_id) AS total_rev,
         SUM(revenue_12m) OVER (PARTITION BY tenant_id ORDER BY revenue_12m DESC) AS cum_rev
  FROM sales s
)
SELECT tenant_id, item_id, revenue_12m,
       CASE WHEN cum_rev <= total_rev * 0.8 THEN 'A'
            WHEN cum_rev <= total_rev * 0.95 THEN 'B'
            ELSE 'C' END AS abc_class
FROM ranked;
GRANT SELECT ON public.abc_analysis_view TO authenticated;
