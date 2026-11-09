
-- ──────────────────────────────────────────────────────────────────────────
-- Procurement Workflow: approval queue, 3WM decisions, notifications, SLA
-- ──────────────────────────────────────────────────────────────────────────

-- 1) Approval queue
CREATE TABLE IF NOT EXISTS public.procurement_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('PR','PO')),
  doc_id uuid NOT NULL,
  level_order int NOT NULL,
  level_label text NOT NULL,
  approver_role text NOT NULL,
  sla_hours int NOT NULL DEFAULT 24,
  sla_due_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','skipped')),
  decided_by uuid,
  decided_at timestamptz,
  comment text,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proc_appr_doc ON public.procurement_approvals(doc_type, doc_id, level_order);
CREATE INDEX IF NOT EXISTS idx_proc_appr_status ON public.procurement_approvals(tenant_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_approvals TO authenticated;
GRANT ALL ON public.procurement_approvals TO service_role;
ALTER TABLE public.procurement_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_proc_approvals" ON public.procurement_approvals
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- 2) 3-Way Match decisions
CREATE TABLE IF NOT EXISTS public.procurement_match_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('accepted','revision_requested')),
  reason text NOT NULL,
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_match_dec_po ON public.procurement_match_decisions(po_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_match_decisions TO authenticated;
GRANT ALL ON public.procurement_match_decisions TO service_role;
ALTER TABLE public.procurement_match_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_match_dec" ON public.procurement_match_decisions
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- 3) Notification helper (reuse erp_alerts)
CREATE OR REPLACE FUNCTION public.notify_procurement(_tenant_id uuid, _severity text, _title text, _message text, _ref text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.erp_alerts (tenant_id, severity, alert_type, title, message, ref_type, ref_id, module, status)
  VALUES (_tenant_id, _severity, 'procurement', _title, _message, 'procurement', _ref, 'Procurement', 'active');
EXCEPTION WHEN OTHERS THEN
  -- ignore if schema differs
  NULL;
END; $$;

-- 4) Seed approval queue when PR or PO is submitted
CREATE OR REPLACE FUNCTION public.seed_procurement_approval_queue()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _doc_type text;
  _amount numeric;
  _t public.procurement_approval_thresholds%ROWTYPE;
  _order int := 1;
BEGIN
  IF TG_TABLE_NAME = 'purchase_requisitions' THEN
    _doc_type := 'PR'; _amount := COALESCE(NEW.estimated_total, 0);
  ELSE
    _doc_type := 'PO'; _amount := COALESCE(NEW.total, 0);
  END IF;

  -- Only seed when entering pending_approval and queue empty
  IF NEW.status <> 'pending_approval' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.procurement_approvals WHERE doc_type=_doc_type AND doc_id=NEW.id) THEN
    RETURN NEW;
  END IF;

  FOR _t IN
    SELECT * FROM public.procurement_approval_thresholds
     WHERE tenant_id = NEW.tenant_id AND doc_type = _doc_type
     ORDER BY max_amount NULLS LAST
  LOOP
    INSERT INTO public.procurement_approvals
      (tenant_id, doc_type, doc_id, level_order, level_label, approver_role, sla_hours, sla_due_at, amount)
    VALUES
      (NEW.tenant_id, _doc_type, NEW.id, _order, _t.level, _t.approver, _t.sla_hours,
       now() + (_t.sla_hours || ' hours')::interval, _amount);
    _order := _order + 1;
    -- Stop at the threshold that covers the amount (NULL = top tier)
    IF _t.max_amount IS NULL OR _amount <= _t.max_amount THEN EXIT; END IF;
  END LOOP;

  PERFORM public.notify_procurement(
    NEW.tenant_id, 'info',
    _doc_type || ' assignée pour approbation',
    'Document ' || COALESCE(CASE WHEN _doc_type='PR' THEN NEW.pr_number ELSE NEW.po_number END,'') || ' en file d''attente.',
    NEW.id::text);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_seed_pr_approvals ON public.purchase_requisitions;
CREATE TRIGGER trg_seed_pr_approvals
  AFTER INSERT OR UPDATE OF status ON public.purchase_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.seed_procurement_approval_queue();

DROP TRIGGER IF EXISTS trg_seed_po_approvals ON public.purchase_orders;
CREATE TRIGGER trg_seed_po_approvals
  AFTER INSERT OR UPDATE OF status ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.seed_procurement_approval_queue();

-- 5) Approve / Reject RPC
CREATE OR REPLACE FUNCTION public.approve_procurement_step(_approval_id uuid, _comment text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _a public.procurement_approvals%ROWTYPE;
  _remaining int;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _docnum text;
BEGIN
  SELECT * INTO _a FROM public.procurement_approvals WHERE id = _approval_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approval not found'; END IF;
  IF _a.tenant_id <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _a.status <> 'pending' THEN RAISE EXCEPTION 'Already decided'; END IF;

  UPDATE public.procurement_approvals
     SET status='approved', decided_by=auth.uid(), decided_at=now(), comment=_comment
   WHERE id=_approval_id;

  SELECT count(*) INTO _remaining
    FROM public.procurement_approvals
   WHERE doc_type=_a.doc_type AND doc_id=_a.doc_id AND status='pending';

  IF _remaining = 0 THEN
    IF _a.doc_type='PR' THEN
      UPDATE public.purchase_requisitions
         SET status='approved', approved_by=auth.uid(), approved_at=now()
       WHERE id=_a.doc_id RETURNING pr_number INTO _docnum;
    ELSE
      UPDATE public.purchase_orders
         SET status='approved', approved_by=auth.uid()
       WHERE id=_a.doc_id RETURNING po_number INTO _docnum;
    END IF;
    PERFORM public.notify_procurement(_a.tenant_id, 'success',
      _a.doc_type || ' approuvée', 'Document ' || COALESCE(_docnum,'') || ' entièrement approuvé.',
      _a.doc_id::text);
  ELSE
    PERFORM public.notify_procurement(_a.tenant_id, 'info',
      _a.level_label || ' approuvé', 'Étape franchie pour ' || _a.doc_type, _a.doc_id::text);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.reject_procurement_step(_approval_id uuid, _comment text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _a public.procurement_approvals%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  SELECT * INTO _a FROM public.procurement_approvals WHERE id = _approval_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approval not found'; END IF;
  IF _a.tenant_id <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _a.status <> 'pending' THEN RAISE EXCEPTION 'Already decided'; END IF;
  IF _comment IS NULL OR length(trim(_comment))=0 THEN RAISE EXCEPTION 'Comment required for rejection'; END IF;

  UPDATE public.procurement_approvals
     SET status='rejected', decided_by=auth.uid(), decided_at=now(), comment=_comment
   WHERE id=_approval_id;

  -- Skip subsequent pending steps
  UPDATE public.procurement_approvals
     SET status='skipped', decided_at=now()
   WHERE doc_type=_a.doc_type AND doc_id=_a.doc_id AND status='pending';

  IF _a.doc_type='PR' THEN
    UPDATE public.purchase_requisitions SET status='rejected' WHERE id=_a.doc_id;
  ELSE
    UPDATE public.purchase_orders SET status='rejected' WHERE id=_a.doc_id;
  END IF;

  PERFORM public.notify_procurement(_a.tenant_id, 'critical',
    _a.doc_type || ' rejetée', 'Motif: ' || _comment, _a.doc_id::text);
END; $$;

-- 6) Convert PR → PO
CREATE OR REPLACE FUNCTION public.convert_pr_to_po(_pr_id uuid, _supplier_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _pr public.purchase_requisitions%ROWTYPE;
  _po_id uuid;
  _po_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  SELECT * INTO _pr FROM public.purchase_requisitions WHERE id=_pr_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PR not found'; END IF;
  IF _pr.tenant_id <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _pr.status NOT IN ('approved') THEN RAISE EXCEPTION 'PR must be approved (status=%)', _pr.status; END IF;
  IF _pr.po_id IS NOT NULL THEN RAISE EXCEPTION 'PR already converted to PO'; END IF;

  _po_number := 'PO-' || to_char(now(),'YYYY') || '-' || lpad((floor(random()*9999))::text, 4, '0');

  INSERT INTO public.purchase_orders (tenant_id, po_number, supplier_id, order_date, total, status, created_by)
  VALUES (_pr.tenant_id, _po_number, _supplier_id, CURRENT_DATE, COALESCE(_pr.estimated_total,0), 'draft', auth.uid())
  RETURNING id INTO _po_id;

  INSERT INTO public.po_lines (po_id, item_id, description, quantity, unit_cost, total)
  SELECT _po_id, rl.item_id, rl.description, rl.quantity, rl.estimated_unit_cost, rl.total
    FROM public.requisition_lines rl WHERE rl.requisition_id = _pr_id;

  UPDATE public.purchase_requisitions SET po_id=_po_id, status='converted' WHERE id=_pr_id;

  PERFORM public.notify_procurement(_pr.tenant_id, 'info',
    'PR → PO converti', _pr.pr_number || ' → ' || _po_number, _po_id::text);
  RETURN _po_id;
END; $$;

-- 7) 3-Way Match decision RPC
CREATE OR REPLACE FUNCTION public.record_match_decision(_po_id uuid, _decision text, _reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id uuid;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _po_tenant uuid;
  _po_number text;
BEGIN
  IF _decision NOT IN ('accepted','revision_requested') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  IF _reason IS NULL OR length(trim(_reason))=0 THEN RAISE EXCEPTION 'Reason required'; END IF;

  SELECT tenant_id, po_number INTO _po_tenant, _po_number FROM public.purchase_orders WHERE id=_po_id;
  IF _po_tenant IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;
  IF _po_tenant <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;

  INSERT INTO public.procurement_match_decisions (tenant_id, po_id, decision, reason, decided_by)
  VALUES (_tenant, _po_id, _decision, _reason, auth.uid())
  RETURNING id INTO _id;

  PERFORM public.notify_procurement(_tenant,
    CASE WHEN _decision='accepted' THEN 'success' ELSE 'warning' END,
    '3WM ' || _decision || ' — ' || _po_number, _reason, _po_id::text);
  RETURN _id;
END; $$;

-- 8) SLA dashboard view
CREATE OR REPLACE VIEW public.procurement_sla_view AS
SELECT
  po.id AS po_id,
  po.tenant_id,
  po.po_number,
  pr.pr_number,
  pr.request_date AS pr_date,
  pr.approved_at AS pr_approved_at,
  po.order_date AS po_date,
  (SELECT MIN(gr.receipt_date) FROM public.goods_receipts gr WHERE gr.po_id = po.id AND gr.status='completed') AS gr_date,
  (SELECT MIN(ap.invoice_date) FROM public.ap_invoices ap WHERE ap.po_id = po.id) AS ap_date,
  EXTRACT(EPOCH FROM (pr.approved_at - (pr.request_date::timestamp)))/3600 AS pr_cycle_hours,
  EXTRACT(EPOCH FROM (po.order_date::timestamp - pr.approved_at))/3600 AS pr_to_po_hours,
  EXTRACT(EPOCH FROM (
    (SELECT MIN(gr.receipt_date) FROM public.goods_receipts gr WHERE gr.po_id=po.id AND gr.status='completed')::timestamp
    - po.order_date::timestamp))/24 AS po_to_gr_days,
  EXTRACT(EPOCH FROM (
    (SELECT MIN(ap.invoice_date) FROM public.ap_invoices ap WHERE ap.po_id=po.id)::timestamp
    - (SELECT MIN(gr.receipt_date) FROM public.goods_receipts gr WHERE gr.po_id=po.id AND gr.status='completed')::timestamp))/24 AS gr_to_ap_days,
  po.status AS po_status,
  pr.status AS pr_status
FROM public.purchase_orders po
LEFT JOIN public.purchase_requisitions pr ON pr.po_id = po.id;

ALTER VIEW public.procurement_sla_view SET (security_invoker = true);
GRANT SELECT ON public.procurement_sla_view TO authenticated;

-- 9) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.procurement_approvals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.procurement_match_decisions;
