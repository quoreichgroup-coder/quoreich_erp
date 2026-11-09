
-- 1. Numbering sequences
CREATE SEQUENCE IF NOT EXISTS public.so_number_seq START 1;
ALTER TABLE public.sales_orders
  ALTER COLUMN so_number SET DEFAULT ('SO-' || lpad(nextval('public.so_number_seq')::text, 5, '0'));

CREATE SEQUENCE IF NOT EXISTS public.quote_number_seq START 1;
ALTER TABLE public.quotations
  ALTER COLUMN quote_number SET DEFAULT ('QUO-' || lpad(nextval('public.quote_number_seq')::text, 5, '0'));

-- 2. Stock movement on SO confirmation
-- We don't have so_lines table per current schema; rely on quotation conversion or future lines.
-- Simple trigger: when SO becomes 'confirmed', emit a generic movement via reference for traceability.
CREATE OR REPLACE FUNCTION public.on_so_confirmed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'confirmed' AND (OLD.status IS NULL OR OLD.status <> 'confirmed') THEN
    -- placeholder traceability event; concrete stock decrement to be wired when so_lines exist
    INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, reference_type, reference_id, created_by)
    SELECT NEW.tenant_id, NULL, 'sale_confirmation', 0, 'sales_order', NEW.id, NEW.created_by
    WHERE NOT EXISTS (
      SELECT 1 FROM public.stock_movements
      WHERE reference_type = 'sales_order' AND reference_id = NEW.id
    );
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_on_so_confirmed ON public.sales_orders;
CREATE TRIGGER trg_on_so_confirmed
  AFTER INSERT OR UPDATE ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.on_so_confirmed();

-- 3. Sales cycle traceability view
CREATE OR REPLACE VIEW public.sales_cycle_view AS
SELECT
  so.tenant_id,
  q.id          AS quote_id,
  q.quote_number,
  q.status      AS quote_status,
  q.total       AS quote_total,
  so.id         AS so_id,
  so.so_number,
  so.status     AS so_status,
  so.total      AS so_total,
  so.customer_id,
  c.name        AS customer_name,
  ari.id        AS ar_invoice_id,
  ari.invoice_number,
  ari.total     AS invoice_total,
  ari.status    AS invoice_status
FROM public.sales_orders so
LEFT JOIN public.quotations q ON q.id = so.quotation_id
LEFT JOIN public.customers c  ON c.id = so.customer_id
LEFT JOIN public.ar_invoices ari ON ari.customer_id = so.customer_id
  AND ari.invoice_date >= so.order_date
  AND ari.invoice_date <= so.order_date + INTERVAL '30 days';
ALTER VIEW public.sales_cycle_view SET (security_invoker = true);
