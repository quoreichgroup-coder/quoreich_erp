
-- 1. PO numbering sequence + default
CREATE SEQUENCE IF NOT EXISTS public.po_number_seq START 1;
ALTER TABLE public.purchase_orders
  ALTER COLUMN po_number SET DEFAULT ('PO-' || lpad(nextval('public.po_number_seq')::text, 5, '0'));

-- 2. Auto-compute po_lines.total = quantity * unit_cost
CREATE OR REPLACE FUNCTION public.compute_po_line_total()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_cost,0))::numeric, 2);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_compute_po_line_total ON public.po_lines;
CREATE TRIGGER trg_compute_po_line_total
  BEFORE INSERT OR UPDATE ON public.po_lines
  FOR EACH ROW EXECUTE FUNCTION public.compute_po_line_total();

-- 3. Recompute purchase_orders.total from lines
CREATE OR REPLACE FUNCTION public.recompute_po_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _po uuid;
BEGIN
  _po := COALESCE(NEW.po_id, OLD.po_id);
  UPDATE public.purchase_orders
    SET total = (SELECT COALESCE(SUM(total),0) FROM public.po_lines WHERE po_id = _po)
    WHERE id = _po;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_recompute_po_total ON public.po_lines;
CREATE TRIGGER trg_recompute_po_total
  AFTER INSERT OR UPDATE OR DELETE ON public.po_lines
  FOR EACH ROW EXECUTE FUNCTION public.recompute_po_total();

-- Same for requisition_lines
CREATE OR REPLACE FUNCTION public.compute_req_line_total()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.quantity,0) * COALESCE(NEW.estimated_unit_cost,0))::numeric, 2);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_compute_req_line_total ON public.requisition_lines;
CREATE TRIGGER trg_compute_req_line_total
  BEFORE INSERT OR UPDATE ON public.requisition_lines
  FOR EACH ROW EXECUTE FUNCTION public.compute_req_line_total();

CREATE OR REPLACE FUNCTION public.recompute_pr_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pr uuid;
BEGIN
  _pr := COALESCE(NEW.requisition_id, OLD.requisition_id);
  UPDATE public.purchase_requisitions
    SET estimated_total = (SELECT COALESCE(SUM(total),0) FROM public.requisition_lines WHERE requisition_id = _pr)
    WHERE id = _pr;
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS trg_recompute_pr_total ON public.requisition_lines;
CREATE TRIGGER trg_recompute_pr_total
  AFTER INSERT OR UPDATE OR DELETE ON public.requisition_lines
  FOR EACH ROW EXECUTE FUNCTION public.recompute_pr_total();

-- 4. 3-Way Match view: PO vs GR vs AP Invoice
CREATE OR REPLACE VIEW public.po_three_way_match AS
SELECT
  po.tenant_id,
  po.id              AS po_id,
  po.po_number,
  po.status          AS po_status,
  po.total           AS po_total,
  COALESCE((
    SELECT SUM(grl.quantity_received * pl.unit_cost)
    FROM public.goods_receipts gr
    JOIN public.gr_lines grl ON grl.gr_id = gr.id
    LEFT JOIN public.po_lines pl ON pl.id = grl.po_line_id
    WHERE gr.po_id = po.id AND gr.status = 'completed'
  ), 0) AS gr_total,
  COALESCE((
    SELECT SUM(api.total) FROM public.ap_invoices api
    WHERE api.supplier_id = po.supplier_id
      AND api.invoice_date >= po.order_date
      AND api.invoice_date <= po.order_date + INTERVAL '90 days'
  ), 0) AS ap_total_window,
  CASE
    WHEN po.total = 0 THEN 'no_po'
    WHEN ABS(po.total - COALESCE((
      SELECT SUM(grl.quantity_received * pl.unit_cost)
      FROM public.goods_receipts gr
      JOIN public.gr_lines grl ON grl.gr_id = gr.id
      LEFT JOIN public.po_lines pl ON pl.id = grl.po_line_id
      WHERE gr.po_id = po.id AND gr.status = 'completed'
    ),0)) < 1 THEN 'matched' ELSE 'variance'
  END AS match_status
FROM public.purchase_orders po;
ALTER VIEW public.po_three_way_match SET (security_invoker = true);

-- 5. Budget commitment on PO approval
CREATE OR REPLACE FUNCTION public.commit_budget_on_po()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _budget_id uuid;
  _period text;
BEGIN
  IF NEW.status NOT IN ('approved','ordered') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  _period := to_char(NEW.order_date, 'YYYY-MM');
  SELECT id INTO _budget_id FROM public.budgets
   WHERE tenant_id = NEW.tenant_id AND status = 'approved'
     AND fiscal_year = to_char(NEW.order_date, 'YYYY')
   LIMIT 1;

  IF _budget_id IS NOT NULL THEN
    UPDATE public.budget_lines
      SET actual_amount = COALESCE(actual_amount,0) + NEW.total
     WHERE budget_id = _budget_id AND period = _period;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_commit_budget_on_po ON public.purchase_orders;
CREATE TRIGGER trg_commit_budget_on_po
  AFTER UPDATE OR INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.commit_budget_on_po();
