
-- ── 1. Liste des tenants accessibles à l'utilisateur ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_accessible_tenants()
RETURNS TABLE (id uuid, name text, currency text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT t.id, t.name, t.currency
  FROM public.tenants t
  WHERE t.id IN (
    SELECT tenant_id FROM public.user_role_assignments WHERE user_id = auth.uid()
    UNION
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
  )
  ORDER BY t.name;
$$;

REVOKE EXECUTE ON FUNCTION public.get_accessible_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_accessible_tenants() TO authenticated;

-- ── 2. KPI CFO consolidés multi-tenant (agrégation serveur) ───────────────────
CREATE OR REPLACE FUNCTION public.get_consolidated_cfo_kpis(_tenant_ids uuid[])
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  currency text,
  cash_on_hand numeric,
  ar_outstanding numeric,
  ap_outstanding numeric,
  ar_overdue numeric,
  ap_overdue numeric,
  ar_overdue_count integer,
  ap_overdue_count integer,
  open_projects integer,
  open_risks_high integer,
  unmatched_recon_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed uuid[];
BEGIN
  -- restreindre aux tenants réellement accessibles
  SELECT ARRAY_AGG(t.id) INTO v_allowed
  FROM public.get_accessible_tenants() t
  WHERE t.id = ANY (_tenant_ids);

  IF v_allowed IS NULL OR array_length(v_allowed, 1) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT t.id AS tid, t.name AS tname, t.currency AS tcur
    FROM public.tenants t
    WHERE t.id = ANY (v_allowed)
  ),
  ar AS (
    SELECT tenant_id,
      COALESCE(SUM(CASE WHEN status <> 'paid' THEN total - amount_paid END), 0) AS outstanding,
      COALESCE(SUM(CASE WHEN status <> 'paid' AND due_date < CURRENT_DATE THEN total - amount_paid END), 0) AS overdue,
      COUNT(*) FILTER (WHERE status <> 'paid' AND due_date < CURRENT_DATE) AS overdue_count
    FROM public.ar_invoices WHERE tenant_id = ANY (v_allowed) GROUP BY tenant_id
  ),
  ap AS (
    SELECT tenant_id,
      COALESCE(SUM(CASE WHEN status <> 'paid' THEN total - amount_paid END), 0) AS outstanding,
      COALESCE(SUM(CASE WHEN status <> 'paid' AND due_date < CURRENT_DATE THEN total - amount_paid END), 0) AS overdue,
      COUNT(*) FILTER (WHERE status <> 'paid' AND due_date < CURRENT_DATE) AS overdue_count
    FROM public.ap_invoices WHERE tenant_id = ANY (v_allowed) GROUP BY tenant_id
  ),
  cash AS (
    SELECT tenant_id, COALESCE(SUM(current_balance), 0) AS bal
    FROM public.bank_accounts WHERE tenant_id = ANY (v_allowed) GROUP BY tenant_id
  ),
  proj AS (
    SELECT tenant_id, COUNT(*)::int AS n
    FROM public.projects WHERE tenant_id = ANY (v_allowed) AND status = 'active' GROUP BY tenant_id
  ),
  rsk AS (
    SELECT tenant_id, COUNT(*)::int AS n
    FROM public.risk_register
    WHERE tenant_id = ANY (v_allowed)
      AND severity IN ('high', 'critical')
      AND status <> 'closed'
    GROUP BY tenant_id
  ),
  rec AS (
    SELECT tenant_id, COUNT(*)::int AS n
    FROM public.bank_reconciliations
    WHERE tenant_id = ANY (v_allowed) AND status = 'draft'
    GROUP BY tenant_id
  )
  SELECT
    b.tid, b.tname, b.tcur,
    COALESCE(cash.bal, 0),
    COALESCE(ar.outstanding, 0),
    COALESCE(ap.outstanding, 0),
    COALESCE(ar.overdue, 0),
    COALESCE(ap.overdue, 0),
    COALESCE(ar.overdue_count, 0)::int,
    COALESCE(ap.overdue_count, 0)::int,
    COALESCE(proj.n, 0),
    COALESCE(rsk.n, 0),
    COALESCE(rec.n, 0)
  FROM base b
  LEFT JOIN cash ON cash.tenant_id = b.tid
  LEFT JOIN ar ON ar.tenant_id = b.tid
  LEFT JOIN ap ON ap.tenant_id = b.tid
  LEFT JOIN proj ON proj.tenant_id = b.tid
  LEFT JOIN rsk ON rsk.tenant_id = b.tid
  LEFT JOIN rec ON rec.tenant_id = b.tid
  ORDER BY b.tname;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_consolidated_cfo_kpis(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_consolidated_cfo_kpis(uuid[]) TO authenticated;
