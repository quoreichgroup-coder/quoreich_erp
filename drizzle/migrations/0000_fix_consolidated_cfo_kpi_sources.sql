CREATE OR REPLACE FUNCTION public.get_consolidated_cfo_kpis(_tenant_ids uuid[])
RETURNS TABLE(tenant_id uuid, tenant_name text, currency text, cash_on_hand numeric, ar_outstanding numeric, ap_outstanding numeric, ar_overdue numeric, ap_overdue numeric, ar_overdue_count integer, ap_overdue_count integer, open_projects integer, open_risks_high integer, unmatched_recon_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_allowed uuid[];
BEGIN
  SELECT array_agg(t.id) INTO v_allowed FROM public.get_accessible_tenants() t WHERE t.id = ANY (_tenant_ids);
  IF v_allowed IS NULL OR array_length(v_allowed, 1) = 0 THEN RETURN; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT t.id AS tid, t.name AS tname, t.currency AS tcur FROM public.tenants t WHERE t.id = ANY (v_allowed)
  ), ar AS (
    SELECT i.tenant_id AS tid,
      COALESCE(SUM(CASE WHEN i.status <> 'paid' THEN i.total - i.amount_paid END), 0) AS outstanding,
      COALESCE(SUM(CASE WHEN i.status <> 'paid' AND i.due_date < CURRENT_DATE THEN i.total - i.amount_paid END), 0) AS overdue,
      COUNT(*) FILTER (WHERE i.status <> 'paid' AND i.due_date < CURRENT_DATE) AS overdue_count
    FROM public.ar_invoices i WHERE i.tenant_id = ANY (v_allowed) GROUP BY i.tenant_id
  ), ap AS (
    SELECT i.tenant_id AS tid,
      COALESCE(SUM(CASE WHEN i.status <> 'paid' THEN i.total - i.amount_paid END), 0) AS outstanding,
      COALESCE(SUM(CASE WHEN i.status <> 'paid' AND i.due_date < CURRENT_DATE THEN i.total - i.amount_paid END), 0) AS overdue,
      COUNT(*) FILTER (WHERE i.status <> 'paid' AND i.due_date < CURRENT_DATE) AS overdue_count
    FROM public.ap_invoices i WHERE i.tenant_id = ANY (v_allowed) GROUP BY i.tenant_id
  ), cash AS (
    SELECT a.tenant_id AS tid, COALESCE(SUM(a.balance), 0) AS bal FROM public.bank_accounts a WHERE a.tenant_id = ANY (v_allowed) GROUP BY a.tenant_id
  ), proj AS (
    SELECT p.tenant_id AS tid, COUNT(*)::int AS n FROM public.projects p WHERE p.tenant_id = ANY (v_allowed) AND p.status = 'active' GROUP BY p.tenant_id
  ), rsk AS (
    SELECT r.tenant_id AS tid, COUNT(*)::int AS n FROM public.risk_register r WHERE r.tenant_id = ANY (v_allowed) AND r.risk_score >= 9 AND r.status <> 'closed' GROUP BY r.tenant_id
  ), rec AS (
    SELECT r.tenant_id AS tid, COUNT(*)::int AS n FROM public.bank_reconciliations r WHERE r.tenant_id = ANY (v_allowed) AND r.status = 'draft' GROUP BY r.tenant_id
  )
  SELECT b.tid, b.tname, b.tcur, COALESCE(cash.bal, 0), COALESCE(ar.outstanding, 0), COALESCE(ap.outstanding, 0), COALESCE(ar.overdue, 0), COALESCE(ap.overdue, 0), COALESCE(ar.overdue_count, 0)::int, COALESCE(ap.overdue_count, 0)::int, COALESCE(proj.n, 0), COALESCE(rsk.n, 0), COALESCE(rec.n, 0)
  FROM base b LEFT JOIN cash ON cash.tid=b.tid LEFT JOIN ar ON ar.tid=b.tid LEFT JOIN ap ON ap.tid=b.tid LEFT JOIN proj ON proj.tid=b.tid LEFT JOIN rsk ON rsk.tid=b.tid LEFT JOIN rec ON rec.tid=b.tid ORDER BY b.tname;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_consolidated_cfo_kpis(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_consolidated_cfo_kpis(uuid[]) TO authenticated, service_role;