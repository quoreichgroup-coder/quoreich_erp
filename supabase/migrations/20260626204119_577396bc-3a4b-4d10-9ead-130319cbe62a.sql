
-- Procurement stabilization: PR→PO link, AP→PO link, 3-Way Match view, approval thresholds & settings

-- 1) Link AP invoice to PO (for 3WM)
ALTER TABLE public.ap_invoices ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES public.purchase_orders(id);
CREATE INDEX IF NOT EXISTS idx_ap_invoices_po ON public.ap_invoices(po_id);

-- 2) PR → PO conversion trigger: when a PO is created from a PR, mark PR converted
CREATE OR REPLACE FUNCTION public.on_pr_converted_to_po()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.po_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.po_id IS DISTINCT FROM NEW.po_id) THEN
    NEW.status := 'converted';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_pr_converted ON public.purchase_requisitions;
CREATE TRIGGER trg_pr_converted
  BEFORE INSERT OR UPDATE OF po_id ON public.purchase_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.on_pr_converted_to_po();

-- 3) Block PO approval when PR not approved (when linked)
CREATE OR REPLACE FUNCTION public.guard_po_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _pr_status text;
BEGIN
  IF NEW.status IN ('approved','ordered') AND (TG_OP='INSERT' OR OLD.status <> NEW.status) THEN
    SELECT status INTO _pr_status FROM public.purchase_requisitions WHERE po_id = NEW.id LIMIT 1;
    IF _pr_status IS NOT NULL AND _pr_status NOT IN ('approved','converted') THEN
      RAISE EXCEPTION 'PO %: linked PR must be approved first (current: %)', NEW.po_number, _pr_status;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_po_approval ON public.purchase_orders;
CREATE TRIGGER trg_guard_po_approval
  BEFORE INSERT OR UPDATE OF status ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_po_approval();

-- 4) Procurement settings (3WM tolerance, approval thresholds)
CREATE TABLE IF NOT EXISTS public.procurement_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  three_way_tolerance_pct numeric NOT NULL DEFAULT 2.0,
  three_way_tolerance_amount numeric NOT NULL DEFAULT 5000,
  require_pr_before_po boolean NOT NULL DEFAULT true,
  require_gr_before_ap boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_settings TO authenticated;
GRANT ALL ON public.procurement_settings TO service_role;
ALTER TABLE public.procurement_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_procurement_settings" ON public.procurement_settings
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.procurement_approval_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('PR','PO')),
  level text NOT NULL,
  max_amount numeric,
  approver text NOT NULL,
  sla_hours int NOT NULL DEFAULT 24,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_approval_thresholds TO authenticated;
GRANT ALL ON public.procurement_approval_thresholds TO service_role;
ALTER TABLE public.procurement_approval_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_proc_thresholds" ON public.procurement_approval_thresholds
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- 5) Seed defaults on tenant creation
CREATE OR REPLACE FUNCTION public.seed_procurement_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.procurement_settings (tenant_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.procurement_approval_thresholds (tenant_id, doc_type, level, max_amount, approver, sla_hours) VALUES
    (NEW.id, 'PR', 'L1 — Manager', 2000000, 'Department Manager', 24),
    (NEW.id, 'PR', 'L2 — Director', 10000000, 'Procurement Director', 48),
    (NEW.id, 'PR', 'L3 — CFO', NULL, 'CFO', 72),
    (NEW.id, 'PO', 'L1 — Buyer', 5000000, 'Senior Buyer', 24),
    (NEW.id, 'PO', 'L2 — Procurement Mgr', 25000000, 'Procurement Manager', 48),
    (NEW.id, 'PO', 'L3 — CFO', NULL, 'CFO', 72)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_seed_procurement_defaults ON public.tenants;
CREATE TRIGGER trg_seed_procurement_defaults
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.seed_procurement_defaults();

-- Backfill existing tenants
INSERT INTO public.procurement_settings (tenant_id)
SELECT id FROM public.tenants ON CONFLICT DO NOTHING;

INSERT INTO public.procurement_approval_thresholds (tenant_id, doc_type, level, max_amount, approver, sla_hours)
SELECT t.id, v.doc_type, v.level, v.max_amount, v.approver, v.sla_hours
FROM public.tenants t
CROSS JOIN (VALUES
  ('PR','L1 — Manager', 2000000::numeric, 'Department Manager', 24),
  ('PR','L2 — Director', 10000000::numeric, 'Procurement Director', 48),
  ('PR','L3 — CFO', NULL::numeric, 'CFO', 72),
  ('PO','L1 — Buyer', 5000000::numeric, 'Senior Buyer', 24),
  ('PO','L2 — Procurement Mgr', 25000000::numeric, 'Procurement Manager', 48),
  ('PO','L3 — CFO', NULL::numeric, 'CFO', 72)
) AS v(doc_type, level, max_amount, approver, sla_hours)
WHERE NOT EXISTS (
  SELECT 1 FROM public.procurement_approval_thresholds p
  WHERE p.tenant_id = t.id AND p.doc_type = v.doc_type AND p.level = v.level
);

-- 6) 3-Way Match view: PO total vs Σ GR (qty × po unit_cost) vs AP subtotal
CREATE OR REPLACE VIEW public.three_way_match_view AS
WITH gr_agg AS (
  SELECT gr.po_id, gr.tenant_id,
         COALESCE(SUM(grl.quantity_received * pol.unit_cost), 0) AS received_value,
         COALESCE(SUM(grl.quantity_received), 0) AS qty_received
  FROM public.goods_receipts gr
  JOIN public.gr_lines grl ON grl.gr_id = gr.id
  LEFT JOIN public.po_lines pol ON pol.id = grl.po_line_id
  WHERE gr.status = 'completed'
  GROUP BY gr.po_id, gr.tenant_id
),
ap_agg AS (
  SELECT po_id, tenant_id, COALESCE(SUM(subtotal),0) AS invoiced_value, COUNT(*) AS invoice_count
  FROM public.ap_invoices
  WHERE po_id IS NOT NULL
  GROUP BY po_id, tenant_id
)
SELECT
  po.id AS po_id,
  po.tenant_id,
  po.po_number,
  po.order_date,
  po.status AS po_status,
  s.name AS supplier_name,
  po.total AS po_total,
  COALESCE(g.received_value, 0) AS gr_value,
  COALESCE(g.qty_received, 0) AS gr_qty,
  COALESCE(a.invoiced_value, 0) AS ap_value,
  COALESCE(a.invoice_count, 0) AS ap_invoice_count,
  (po.total - COALESCE(g.received_value, 0)) AS po_vs_gr_diff,
  (COALESCE(g.received_value, 0) - COALESCE(a.invoiced_value, 0)) AS gr_vs_ap_diff,
  CASE
    WHEN COALESCE(g.received_value,0) = 0 AND COALESCE(a.invoiced_value,0) = 0 THEN 'pending'
    WHEN ABS(po.total - COALESCE(g.received_value,0)) <= GREATEST(ps.three_way_tolerance_amount, po.total * ps.three_way_tolerance_pct/100)
     AND ABS(COALESCE(g.received_value,0) - COALESCE(a.invoiced_value,0)) <= GREATEST(ps.three_way_tolerance_amount, po.total * ps.three_way_tolerance_pct/100)
     THEN 'matched'
    ELSE 'discrepancy'
  END AS match_status
FROM public.purchase_orders po
LEFT JOIN public.suppliers s ON s.id = po.supplier_id
LEFT JOIN gr_agg g ON g.po_id = po.id
LEFT JOIN ap_agg a ON a.po_id = po.id
LEFT JOIN public.procurement_settings ps ON ps.tenant_id = po.tenant_id;

GRANT SELECT ON public.three_way_match_view TO authenticated;

-- 7) Procurement KPIs view
CREATE OR REPLACE VIEW public.procurement_kpis_view AS
SELECT
  t.id AS tenant_id,
  (SELECT COUNT(*) FROM public.purchase_requisitions WHERE tenant_id=t.id AND status IN ('draft','pending_approval')) AS pr_open,
  (SELECT COUNT(*) FROM public.purchase_orders WHERE tenant_id=t.id AND status IN ('draft','pending_approval')) AS po_pending,
  (SELECT COUNT(*) FROM public.goods_receipts WHERE tenant_id=t.id AND receipt_date = CURRENT_DATE) AS gr_today,
  (SELECT COUNT(*) FROM public.three_way_match_view WHERE tenant_id=t.id AND match_status='discrepancy') AS tw_discrepancies,
  (SELECT COALESCE(SUM(total),0) FROM public.purchase_orders WHERE tenant_id=t.id AND status='approved' AND order_date >= date_trunc('month',CURRENT_DATE)) AS po_value_mtd
FROM public.tenants t;

GRANT SELECT ON public.procurement_kpis_view TO authenticated;
