
-- ============================================================
-- LOT 5a — Sales integrations: auto-invoice, period locks, alerts
-- + Realtime publication
-- ============================================================

-- 1) AUTO-INVOICE on delivery completion (respects sales_settings)
CREATE OR REPLACE FUNCTION public.auto_invoice_on_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _auto boolean;
  _inv_id uuid; _inv_number text;
  _subtotal numeric;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF (TG_OP='UPDATE' AND OLD.status = 'completed') THEN RETURN NEW; END IF;
  IF NEW.ar_invoice_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT auto_invoice_on_delivery INTO _auto FROM public.sales_settings WHERE tenant_id = NEW.tenant_id;
  IF NOT COALESCE(_auto, false) THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(total),0) INTO _subtotal FROM public.dn_lines WHERE dn_id = NEW.id;
  IF _subtotal <= 0 THEN RETURN NEW; END IF;

  _inv_number := 'INV-'||to_char(now(),'YYYY')||'-'||lpad((floor(random()*99999))::text,5,'0');

  INSERT INTO public.ar_invoices(tenant_id, invoice_number, customer_id, invoice_date, due_date,
    subtotal, tax_amount, total, amount_paid, status, so_id, dn_id, created_by)
  VALUES (NEW.tenant_id, _inv_number, NEW.customer_id, CURRENT_DATE, CURRENT_DATE+30,
    _subtotal, 0, _subtotal, 0, 'sent', NEW.so_id, NEW.id, NEW.created_by)
  RETURNING id INTO _inv_id;

  NEW.ar_invoice_id := _inv_id;

  PERFORM public.notify_sales(NEW.tenant_id, 'success',
    'Facture auto-générée', _inv_number || ' depuis ' || NEW.dn_number, _inv_id::text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_invoice_on_delivery ON public.delivery_notes;
CREATE TRIGGER trg_auto_invoice_on_delivery
BEFORE INSERT OR UPDATE OF status ON public.delivery_notes
FOR EACH ROW EXECUTE FUNCTION public.auto_invoice_on_delivery();


-- 2) SALES PERIOD LOCK enforcement on quotations/sales_orders/delivery_notes
CREATE OR REPLACE FUNCTION public.enforce_sales_period_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _period text;
  _date date;
  _locked boolean;
BEGIN
  _date := CASE TG_TABLE_NAME
    WHEN 'quotations' THEN NEW.quote_date
    WHEN 'sales_orders' THEN NEW.order_date
    WHEN 'delivery_notes' THEN NEW.delivery_date
  END;
  IF _date IS NULL THEN RETURN NEW; END IF;

  _period := to_char(_date, 'YYYY-MM');
  SELECT (status='closed') INTO _locked
    FROM public.period_locks
   WHERE tenant_id = NEW.tenant_id AND module = 'Sales' AND period = _period
   LIMIT 1;

  IF COALESCE(_locked, false) THEN
    RAISE EXCEPTION 'Sales period % is closed — operation refused on %', _period, TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quotations_period_lock ON public.quotations;
CREATE TRIGGER trg_quotations_period_lock
BEFORE INSERT OR UPDATE ON public.quotations
FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_period_lock();

DROP TRIGGER IF EXISTS trg_so_period_lock ON public.sales_orders;
CREATE TRIGGER trg_so_period_lock
BEFORE INSERT OR UPDATE ON public.sales_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_period_lock();

DROP TRIGGER IF EXISTS trg_dn_period_lock ON public.delivery_notes;
CREATE TRIGGER trg_dn_period_lock
BEFORE INSERT OR UPDATE ON public.delivery_notes
FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_period_lock();


-- 3) CREDIT LIMIT ALERT on SO confirmation
CREATE OR REPLACE FUNCTION public.check_customer_credit_on_so()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _limit numeric; _outstanding numeric; _name text;
BEGIN
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status = 'confirmed' THEN RETURN NEW; END IF;

  SELECT credit_limit, name INTO _limit, _name FROM public.customers WHERE id = NEW.customer_id;
  IF _limit IS NULL OR _limit <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(total - amount_paid),0) INTO _outstanding
    FROM public.ar_invoices
   WHERE customer_id = NEW.customer_id
     AND status NOT IN ('paid','cancelled');

  IF (_outstanding + NEW.total) > _limit THEN
    PERFORM public.notify_sales(NEW.tenant_id, 'critical',
      'Limite de crédit dépassée — ' || COALESCE(_name,''),
      'Encours ' || _outstanding::text || ' + commande ' || NEW.total::text ||
      ' > limite ' || _limit::text, NEW.id::text);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_so_credit_check ON public.sales_orders;
CREATE TRIGGER trg_so_credit_check
AFTER INSERT OR UPDATE OF status ON public.sales_orders
FOR EACH ROW EXECUTE FUNCTION public.check_customer_credit_on_so();


-- 4) REALTIME publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.quotations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_role_audit;
ALTER PUBLICATION supabase_realtime ADD TABLE public.erp_alerts;
