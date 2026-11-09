
-- ============================================================
-- Inventory Reporting — analytical views
-- ============================================================

-- 1) Valuation by category (Avg Cost from items + FIFO-style from layers)
CREATE OR REPLACE VIEW public.inventory_valuation_by_category_view
WITH (security_invoker = on) AS
WITH fifo AS (
  SELECT i.tenant_id, COALESCE(NULLIF(i.category, ''), 'Sans catégorie') AS category,
         SUM(l.qty_remaining * l.cost_in) AS fifo_value
  FROM public.items i
  LEFT JOIN public.stock_valuation_layers l ON l.item_id = i.id
  GROUP BY i.tenant_id, COALESCE(NULLIF(i.category, ''), 'Sans catégorie')
),
avgc AS (
  SELECT i.tenant_id, COALESCE(NULLIF(i.category, ''), 'Sans catégorie') AS category,
         COUNT(*) AS items_count,
         SUM(i.quantity_on_hand) AS total_qty,
         SUM(i.quantity_on_hand * COALESCE(i.average_cost, i.unit_cost, 0)) AS avg_cost_value
  FROM public.items i
  WHERE i.status = 'active'
  GROUP BY i.tenant_id, COALESCE(NULLIF(i.category, ''), 'Sans catégorie')
)
SELECT a.tenant_id, a.category, a.items_count, a.total_qty,
       COALESCE(f.fifo_value, 0) AS fifo_value,
       a.avg_cost_value,
       COALESCE(f.fifo_value, 0) - a.avg_cost_value AS variance
FROM avgc a
LEFT JOIN fifo f ON f.tenant_id = a.tenant_id AND f.category = a.category;

-- 2) Turnover by category (last 365 days)
CREATE OR REPLACE VIEW public.inventory_turnover_view
WITH (security_invoker = on) AS
WITH cogs AS (
  SELECT i.tenant_id, COALESCE(NULLIF(i.category, ''), 'Sans catégorie') AS category,
         SUM(ABS(m.quantity) * COALESCE(m.unit_cost, i.average_cost, i.unit_cost, 0)) AS cogs_12m
  FROM public.stock_movements m
  JOIN public.items i ON i.id = m.item_id
  WHERE m.quantity < 0
    AND m.movement_date >= (CURRENT_DATE - INTERVAL '365 days')
    AND m.movement_type NOT IN ('transfer_in','transfer_out','transfer')
  GROUP BY i.tenant_id, COALESCE(NULLIF(i.category, ''), 'Sans catégorie')
),
inv AS (
  SELECT tenant_id, COALESCE(NULLIF(category, ''), 'Sans catégorie') AS category,
         SUM(quantity_on_hand * COALESCE(average_cost, unit_cost, 0)) AS inv_value
  FROM public.items WHERE status = 'active'
  GROUP BY tenant_id, COALESCE(NULLIF(category, ''), 'Sans catégorie')
)
SELECT inv.tenant_id, inv.category, inv.inv_value,
       COALESCE(c.cogs_12m, 0) AS cogs_12m,
       CASE WHEN inv.inv_value > 0 THEN ROUND((COALESCE(c.cogs_12m, 0) / inv.inv_value)::numeric, 2) ELSE 0 END AS turnover_ratio,
       CASE WHEN COALESCE(c.cogs_12m, 0) > 0 THEN ROUND((365.0 * inv.inv_value / c.cogs_12m)::numeric, 0) ELSE NULL END AS days_on_hand
FROM inv LEFT JOIN cogs c ON c.tenant_id = inv.tenant_id AND c.category = inv.category;

-- 3) Stock aging (FIFO layers bucketed by layer_date age)
CREATE OR REPLACE VIEW public.stock_aging_view
WITH (security_invoker = on) AS
SELECT l.tenant_id,
       CASE
         WHEN (CURRENT_DATE - l.layer_date) <= 30  THEN '0-30 jours'
         WHEN (CURRENT_DATE - l.layer_date) <= 60  THEN '31-60 jours'
         WHEN (CURRENT_DATE - l.layer_date) <= 90  THEN '61-90 jours'
         ELSE '90+ jours'
       END AS age_bucket,
       SUM(l.qty_remaining * l.cost_in) AS stock_value,
       SUM(l.qty_remaining) AS qty_remaining,
       COUNT(DISTINCT l.item_id) AS items_count
FROM public.stock_valuation_layers l
WHERE l.qty_remaining > 0
GROUP BY l.tenant_id,
  CASE
    WHEN (CURRENT_DATE - l.layer_date) <= 30  THEN '0-30 jours'
    WHEN (CURRENT_DATE - l.layer_date) <= 60  THEN '31-60 jours'
    WHEN (CURRENT_DATE - l.layer_date) <= 90  THEN '61-90 jours'
    ELSE '90+ jours'
  END;

GRANT SELECT ON public.inventory_valuation_by_category_view TO authenticated, service_role;
GRANT SELECT ON public.inventory_turnover_view TO authenticated, service_role;
GRANT SELECT ON public.stock_aging_view TO authenticated, service_role;
