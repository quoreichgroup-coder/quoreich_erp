
CREATE OR REPLACE VIEW public.inventory_abc_view AS
WITH outbound AS (
  SELECT sm.tenant_id, sm.item_id,
         SUM(ABS(sm.quantity) * COALESCE(sm.unit_cost, i.unit_cost, 0)) AS revenue_12m,
         SUM(ABS(sm.quantity)) AS qty_12m
  FROM public.stock_movements sm
  JOIN public.items i ON i.id = sm.item_id
  WHERE sm.movement_date >= (CURRENT_DATE - INTERVAL '12 months')
    AND sm.quantity < 0
    AND sm.movement_type NOT IN ('transfer_in','transfer_out','transfer','adjust_in','adjust_out')
  GROUP BY sm.tenant_id, sm.item_id
),
ranked AS (
  SELECT o.*, i.code, i.name, i.category,
         SUM(o.revenue_12m) OVER (PARTITION BY o.tenant_id) AS total_rev,
         SUM(o.revenue_12m) OVER (PARTITION BY o.tenant_id ORDER BY o.revenue_12m DESC
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_rev
  FROM outbound o
  JOIN public.items i ON i.id = o.item_id
)
SELECT tenant_id, item_id, code, name, category, revenue_12m, qty_12m,
       CASE WHEN total_rev = 0 THEN 0 ELSE ROUND((cum_rev / total_rev) * 100, 2) END AS cum_pct,
       CASE
         WHEN total_rev = 0 THEN 'C'
         WHEN (cum_rev / total_rev) <= 0.80 THEN 'A'
         WHEN (cum_rev / total_rev) <= 0.95 THEN 'B'
         ELSE 'C'
       END AS abc_class
FROM ranked;

CREATE OR REPLACE VIEW public.inventory_slow_moving_view AS
SELECT i.tenant_id, i.id AS item_id, i.code, i.name, i.category,
       i.quantity_on_hand,
       COALESCE(i.average_cost, i.unit_cost, 0) AS unit_cost,
       i.quantity_on_hand * COALESCE(i.average_cost, i.unit_cost, 0) AS stock_value,
       (SELECT MAX(sm.movement_date) FROM public.stock_movements sm
        WHERE sm.item_id = i.id AND sm.quantity < 0
          AND sm.movement_type NOT IN ('transfer_in','transfer_out','transfer','adjust_in','adjust_out')
       ) AS last_outbound_date,
       CASE
         WHEN (SELECT MAX(sm.movement_date) FROM public.stock_movements sm
               WHERE sm.item_id = i.id AND sm.quantity < 0) IS NULL THEN 'Dormant'
         WHEN (SELECT MAX(sm.movement_date) FROM public.stock_movements sm
               WHERE sm.item_id = i.id AND sm.quantity < 0) < CURRENT_DATE - INTERVAL '180 days' THEN 'Mort'
         WHEN (SELECT MAX(sm.movement_date) FROM public.stock_movements sm
               WHERE sm.item_id = i.id AND sm.quantity < 0) < CURRENT_DATE - INTERVAL '90 days' THEN 'Lent'
         ELSE 'Actif'
       END AS movement_class
FROM public.items i
WHERE i.quantity_on_hand > 0 AND i.status = 'active';

CREATE OR REPLACE VIEW public.inventory_variance_view AS
SELECT c.id AS count_id, c.tenant_id, c.count_number, c.count_date, c.status,
       w.code AS warehouse_code, w.name AS warehouse_name,
       COUNT(l.id) AS items_checked,
       COUNT(*) FILTER (WHERE COALESCE(l.variance, 0) = 0) AS items_matched,
       COUNT(*) FILTER (WHERE COALESCE(l.variance, 0) <> 0) AS items_variance,
       COALESCE(SUM(l.variance_value), 0) AS total_value_diff
FROM public.inventory_counts c
LEFT JOIN public.warehouses w ON w.id = c.warehouse_id
LEFT JOIN public.inventory_count_lines l ON l.count_id = c.id
GROUP BY c.id, c.tenant_id, c.count_number, c.count_date, c.status, w.code, w.name;

CREATE TABLE IF NOT EXISTS public.inventory_period_closes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  period TEXT NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by UUID,
  total_value NUMERIC NOT NULL DEFAULT 0,
  total_qty NUMERIC NOT NULL DEFAULT 0,
  items_count INTEGER NOT NULL DEFAULT 0,
  snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period)
);

GRANT SELECT, INSERT ON public.inventory_period_closes TO authenticated;
GRANT ALL ON public.inventory_period_closes TO service_role;
ALTER TABLE public.inventory_period_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read inventory closes" ON public.inventory_period_closes;
CREATE POLICY "tenant read inventory closes"
  ON public.inventory_period_closes FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "service write inventory closes" ON public.inventory_period_closes;
CREATE POLICY "service write inventory closes"
  ON public.inventory_period_closes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.close_inventory_period(_period TEXT)
RETURNS public.inventory_period_closes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant UUID := public.get_user_tenant_id(auth.uid());
  _user UUID := auth.uid();
  _existing public.inventory_period_closes;
  _row public.inventory_period_closes;
  _snapshot JSONB;
  _total_value NUMERIC;
  _total_qty NUMERIC;
  _items_count INTEGER;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;
  IF NOT public.has_inventory_perm(_user, 'close') THEN
    RAISE EXCEPTION 'forbidden: requires inventory close permission';
  END IF;
  IF _period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid period format, expected YYYY-MM';
  END IF;

  SELECT * INTO _existing FROM public.inventory_period_closes
   WHERE tenant_id = _tenant AND period = _period;
  IF FOUND THEN RETURN _existing; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'item_id', item_id, 'code', code, 'name', name, 'category', category,
            'qty', quantity_on_hand, 'unit_cost', unit_cost, 'value', stock_value)), '[]'::jsonb),
         COALESCE(SUM(stock_value), 0),
         COALESCE(SUM(quantity_on_hand), 0),
         COUNT(*)
    INTO _snapshot, _total_value, _total_qty, _items_count
    FROM public.inventory_slow_moving_view
   WHERE tenant_id = _tenant;

  INSERT INTO public.inventory_period_closes
    (tenant_id, period, closed_by, total_value, total_qty, items_count, snapshot)
  VALUES (_tenant, _period, _user, _total_value, _total_qty, _items_count, _snapshot)
  RETURNING * INTO _row;

  INSERT INTO public.period_locks (tenant_id, period, module, locked_by, locked_at)
  VALUES (_tenant, _period, 'inventory', _user, now())
  ON CONFLICT DO NOTHING;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.close_inventory_period(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_inventory_period(TEXT) TO authenticated;
