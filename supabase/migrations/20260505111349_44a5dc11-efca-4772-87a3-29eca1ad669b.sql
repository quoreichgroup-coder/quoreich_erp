
DROP VIEW IF EXISTS public.ar_credit_exposure_view;
CREATE VIEW public.ar_credit_exposure_view
WITH (security_invoker = true) AS
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
