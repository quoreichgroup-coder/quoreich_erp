
-- 1. Attach orphan triggers
DROP TRIGGER IF EXISTS trg_log_journal_entry_audit ON public.journal_entries;
CREATE TRIGGER trg_log_journal_entry_audit
  AFTER INSERT OR UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_journal_entry_audit();

DROP TRIGGER IF EXISTS trg_on_payment_recorded ON public.payments;
CREATE TRIGGER trg_on_payment_recorded
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.on_ap_payment_recorded();

DROP TRIGGER IF EXISTS trg_on_gr_completed ON public.goods_receipts;
CREATE TRIGGER trg_on_gr_completed
  AFTER INSERT OR UPDATE ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.on_gr_completed();

-- 2. AR validation
CREATE OR REPLACE FUNCTION public.validate_ar_invoice()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.subtotal,0) + COALESCE(NEW.tax_amount,0))::numeric, 2);
  IF NEW.amount_paid > NEW.total THEN
    RAISE EXCEPTION 'AR Invoice %: amount_paid (%) > total (%)', NEW.invoice_number, NEW.amount_paid, NEW.total;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_ar_invoice ON public.ar_invoices;
CREATE TRIGGER trg_validate_ar_invoice
  BEFORE INSERT OR UPDATE ON public.ar_invoices
  FOR EACH ROW EXECUTE FUNCTION public.validate_ar_invoice();

-- 3. AR auto-post JE
CREATE OR REPLACE FUNCTION public.on_ar_invoice_posted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _entry_id uuid; _entry_number text;
  _ar uuid; _rev uuid; _vat uuid;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('sent','open','posted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT id INTO _ar  FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4110' LIMIT 1;
  SELECT id INTO _rev FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4000' LIMIT 1;
  SELECT id INTO _vat FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4310' LIMIT 1;

  IF _ar IS NULL OR _rev IS NULL THEN
    RAISE WARNING 'AR Invoice %: missing GL accounts', NEW.invoice_number;
    RETURN NEW;
  END IF;

  _entry_number := 'JE-AR-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by, posted_by, posted_at)
  VALUES (NEW.tenant_id, _entry_number, NEW.invoice_date, 'AR Invoice: '||NEW.invoice_number, 'ar_invoice', 'posted', NEW.created_by, NEW.created_by, now())
  RETURNING id INTO _entry_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _ar, NEW.total, 0, 'DR Clients');
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _rev, 0, NEW.subtotal, 'CR Ventes HT');
  IF COALESCE(NEW.tax_amount,0) > 0 AND _vat IS NOT NULL THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _vat, 0, NEW.tax_amount, 'CR TVA collectée');
  END IF;

  NEW.journal_entry_id := _entry_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_on_ar_invoice_posted ON public.ar_invoices;
CREATE TRIGGER trg_on_ar_invoice_posted
  BEFORE INSERT OR UPDATE ON public.ar_invoices
  FOR EACH ROW EXECUTE FUNCTION public.on_ar_invoice_posted();

-- 4. Recompute AR after payment (logic inside fn, no WHEN clause)
CREATE OR REPLACE FUNCTION public.recompute_ar_invoice_from_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _inv_id uuid; _total numeric; _paid numeric; _due date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.payment_type <> 'ar_receipt' OR OLD.ar_invoice_id IS NULL THEN RETURN OLD; END IF;
    _inv_id := OLD.ar_invoice_id;
  ELSE
    IF NEW.payment_type <> 'ar_receipt' OR NEW.ar_invoice_id IS NULL THEN RETURN NEW; END IF;
    _inv_id := NEW.ar_invoice_id;
  END IF;

  SELECT total, due_date INTO _total, _due FROM public.ar_invoices WHERE id = _inv_id;
  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments
   WHERE ar_invoice_id = _inv_id AND payment_type = 'ar_receipt';

  UPDATE public.ar_invoices
  SET amount_paid = _paid,
      status = CASE
        WHEN _paid >= _total THEN 'paid'
        WHEN _paid > 0 THEN 'partially_paid'
        WHEN _due IS NOT NULL AND _due < CURRENT_DATE THEN 'overdue'
        ELSE status
      END
  WHERE id = _inv_id;

  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_recompute_ar_invoice ON public.payments;
CREATE TRIGGER trg_recompute_ar_invoice
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.recompute_ar_invoice_from_payment();

-- 5. AR Aging view
CREATE OR REPLACE VIEW public.ar_aging_view AS
SELECT
  i.tenant_id,
  i.id AS invoice_id,
  i.invoice_number,
  i.customer_id,
  c.name AS customer_name,
  i.invoice_date,
  i.due_date,
  i.total,
  i.amount_paid,
  GREATEST(i.total - i.amount_paid, 0) AS outstanding,
  GREATEST((CURRENT_DATE - i.due_date)::int, 0) AS days_overdue,
  CASE
    WHEN i.due_date >= CURRENT_DATE THEN 'current'
    WHEN CURRENT_DATE - i.due_date <= 30 THEN '1-30'
    WHEN CURRENT_DATE - i.due_date <= 60 THEN '31-60'
    WHEN CURRENT_DATE - i.due_date <= 90 THEN '61-90'
    ELSE '90+'
  END AS bucket,
  i.status
FROM public.ar_invoices i
LEFT JOIN public.customers c ON c.id = i.customer_id
WHERE i.status <> 'paid' AND i.total > i.amount_paid;
