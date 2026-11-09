CREATE OR REPLACE FUNCTION public.get_consolidated_cfo_trends(_tenant_ids uuid[], _months integer DEFAULT 12)
RETURNS TABLE(month text, revenue numeric, expenses numeric, net_profit numeric, cash_balance numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF _months IS NULL OR _months NOT IN (3, 6, 12) THEN RAISE EXCEPTION 'Period must be 3, 6 or 12 months' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  WITH allowed AS (
    SELECT a.id FROM public.get_accessible_tenants() a WHERE a.id = ANY(_tenant_ids)
  ), periods AS (
    SELECT s::date AS start_date, LEAST((s + interval '1 month - 1 day')::date, CURRENT_DATE) AS end_date
    FROM generate_series(date_trunc('month', CURRENT_DATE) - make_interval(months => _months - 1), date_trunc('month', CURRENT_DATE), interval '1 month') s
    WHERE EXISTS (SELECT 1 FROM allowed)
  ), receipts AS (
    SELECT to_char(p.payment_date, 'YYYY-MM') AS key,
      COALESCE(sum(p.amount) FILTER (WHERE p.payment_type = 'ar_receipt'), 0) AS income,
      COALESCE(sum(p.amount) FILTER (WHERE p.payment_type = 'ap_payment'), 0) AS spending
    FROM public.payments p JOIN allowed a ON a.id = p.tenant_id
    WHERE p.payment_date >= (date_trunc('month', CURRENT_DATE) - make_interval(months => _months - 1))::date AND p.payment_date <= CURRENT_DATE
    GROUP BY to_char(p.payment_date, 'YYYY-MM')
  )
  SELECT to_char(m.start_date, 'YYYY-MM'), COALESCE(r.income, 0), COALESCE(r.spending, 0),
    COALESCE(r.income, 0) - COALESCE(r.spending, 0),
    CASE WHEN count(b.id) = 0 THEN NULL
      WHEN m.start_date = date_trunc('month', CURRENT_DATE)::date THEN sum(b.balance)
      WHEN count(h.closing_balance) = count(b.id) THEN sum(h.closing_balance)
      ELSE NULL END
  FROM periods m
  LEFT JOIN receipts r ON r.key = to_char(m.start_date, 'YYYY-MM')
  LEFT JOIN public.bank_accounts b ON b.tenant_id IN (SELECT a.id FROM allowed a)
    AND b.is_active = true AND b.currency = 'XOF' AND b.created_at::date <= m.end_date
  LEFT JOIN LATERAL (
    SELECT bs.closing_balance FROM public.bank_statements bs
    WHERE bs.tenant_id = b.tenant_id AND bs.bank_account_id = b.id AND bs.period_end = m.end_date
      AND bs.period_start <= m.start_date AND bs.status = 'imported'
    ORDER BY bs.created_at DESC, bs.id DESC LIMIT 1
  ) h ON true
  GROUP BY m.start_date, r.income, r.spending ORDER BY m.start_date;
END;
$$;
REVOKE ALL ON FUNCTION public.get_consolidated_cfo_trends(uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_consolidated_cfo_trends(uuid[], integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_consolidated_cfo_trends(uuid[], integer) IS 'Selected accessible tenants only. Receipt/payment trends, not accrual profit. XOF active bank accounts only for cash: current month snapshot, past months exact imported closing statements for every eligible account; incomplete or absent evidence returns NULL, never copied current balances.';