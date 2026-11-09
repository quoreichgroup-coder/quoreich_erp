
-- ══════════════════════════════════════════════════
-- P2P FLOW: Requisitions table + triggers
-- ══════════════════════════════════════════════════

-- 1. Purchase Requisitions
CREATE TABLE IF NOT EXISTS public.purchase_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  pr_number text NOT NULL,
  requested_by uuid NOT NULL,
  request_date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  estimated_total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft', -- draft, submitted, approved, rejected, converted
  approved_by uuid,
  approved_at timestamptz,
  po_id uuid REFERENCES public.purchase_orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_requisitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.purchase_requisitions
FOR ALL TO authenticated
USING (tenant_id = get_user_tenant_id(auth.uid()));

-- 2. Requisition lines
CREATE TABLE IF NOT EXISTS public.requisition_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL REFERENCES public.purchase_requisitions(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items(id),
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  estimated_unit_cost numeric NOT NULL DEFAULT 0,
  total numeric GENERATED ALWAYS AS (quantity * estimated_unit_cost) STORED
);

ALTER TABLE public.requisition_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access via requisition" ON public.requisition_lines
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.purchase_requisitions pr
  WHERE pr.id = requisition_lines.requisition_id
  AND pr.tenant_id = get_user_tenant_id(auth.uid())
));

-- 3. PO Lines table
CREATE TABLE IF NOT EXISTS public.po_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items(id),
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_cost numeric NOT NULL DEFAULT 0,
  total numeric GENERATED ALWAYS AS (quantity * unit_cost) STORED
);

ALTER TABLE public.po_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access via PO" ON public.po_lines
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.purchase_orders po
  WHERE po.id = po_lines.po_id
  AND po.tenant_id = get_user_tenant_id(auth.uid())
));

-- 4. GR Lines table
CREATE TABLE IF NOT EXISTS public.gr_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gr_id uuid NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  po_line_id uuid REFERENCES public.po_lines(id),
  item_id uuid REFERENCES public.items(id),
  quantity_received numeric NOT NULL DEFAULT 0,
  quantity_rejected numeric NOT NULL DEFAULT 0
);

ALTER TABLE public.gr_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access via GR" ON public.gr_lines
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.goods_receipts gr
  WHERE gr.id = gr_lines.gr_id
  AND gr.tenant_id = get_user_tenant_id(auth.uid())
));

-- 5. Trigger: When GR is completed, auto-update PO status  
CREATE OR REPLACE FUNCTION public.on_gr_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    -- Update PO status to received
    UPDATE public.purchase_orders
    SET status = 'received'
    WHERE id = NEW.po_id AND status = 'approved';
    
    -- Update stock quantities for received items
    INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, reference_type, reference_id, created_by)
    SELECT NEW.tenant_id, gl.item_id, 'receipt', gl.quantity_received, 'goods_receipt', NEW.id, NEW.received_by
    FROM public.gr_lines gl
    WHERE gl.gr_id = NEW.id AND gl.item_id IS NOT NULL;
    
    -- Update item quantities
    UPDATE public.items i
    SET quantity_on_hand = i.quantity_on_hand + gl.quantity_received
    FROM public.gr_lines gl
    WHERE gl.gr_id = NEW.id AND gl.item_id = i.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gr_completed
AFTER INSERT OR UPDATE ON public.goods_receipts
FOR EACH ROW EXECUTE FUNCTION public.on_gr_completed();

-- 6. Trigger: When AP payment is recorded, create GL journal entry
CREATE OR REPLACE FUNCTION public.on_ap_payment_recorded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _entry_id uuid;
  _entry_number text;
  _payable_account uuid;
  _bank_account uuid;
BEGIN
  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    -- Find GL accounts (Trade Payables and Bank)
    SELECT id INTO _payable_account FROM public.gl_accounts
    WHERE tenant_id = NEW.tenant_id AND code = '4010' LIMIT 1;
    
    SELECT id INTO _bank_account FROM public.gl_accounts
    WHERE tenant_id = NEW.tenant_id AND code = '5210' LIMIT 1;
    
    IF _payable_account IS NOT NULL AND _bank_account IS NOT NULL THEN
      _entry_number := 'JE-AP-' || to_char(now(), 'YYYYMMDD') || '-' || substr(NEW.id::text, 1, 8);
      
      INSERT INTO public.journal_entries (tenant_id, entry_number, description, source, status, created_by)
      VALUES (NEW.tenant_id, _entry_number, 'AP Payment: ' || COALESCE(NEW.reference, NEW.id::text), 'ap_payment', 'posted', NEW.created_by)
      RETURNING id INTO _entry_id;
      
      -- DR Trade Payables
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _payable_account, NEW.amount, 0, 'AP Payment');
      
      -- CR Bank
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _bank_account, 0, NEW.amount, 'AP Payment');
      
      -- Link journal entry to payment
      UPDATE public.payments SET journal_entry_id = _entry_id WHERE id = NEW.id;
    END IF;
  END IF;
  
  -- Same for AR receipts
  IF NEW.payment_type = 'ar_receipt' AND NEW.ar_invoice_id IS NOT NULL THEN
    SELECT id INTO _bank_account FROM public.gl_accounts
    WHERE tenant_id = NEW.tenant_id AND code = '5210' LIMIT 1;
    
    SELECT id INTO _payable_account FROM public.gl_accounts
    WHERE tenant_id = NEW.tenant_id AND code = '4110' LIMIT 1;
    
    IF _payable_account IS NOT NULL AND _bank_account IS NOT NULL THEN
      _entry_number := 'JE-AR-' || to_char(now(), 'YYYYMMDD') || '-' || substr(NEW.id::text, 1, 8);
      
      INSERT INTO public.journal_entries (tenant_id, entry_number, description, source, status, created_by)
      VALUES (NEW.tenant_id, _entry_number, 'AR Receipt: ' || COALESCE(NEW.reference, NEW.id::text), 'ar_receipt', 'posted', NEW.created_by)
      RETURNING id INTO _entry_id;
      
      -- DR Bank
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _bank_account, NEW.amount, 0, 'AR Receipt');
      
      -- CR Trade Receivables
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _payable_account, 0, NEW.amount, 'AR Receipt');
      
      UPDATE public.payments SET journal_entry_id = _entry_id WHERE id = NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_gl_posting
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.on_ap_payment_recorded();
