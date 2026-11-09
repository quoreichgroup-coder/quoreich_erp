
-- 1. AP validation
CREATE OR REPLACE FUNCTION public.validate_ap_invoice()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.subtotal,0) + COALESCE(NEW.tax_amount,0))::numeric, 2);
  IF NEW.amount_paid > NEW.total THEN
    RAISE EXCEPTION 'AP Invoice %: amount_paid (%) > total (%)', NEW.invoice_number, NEW.amount_paid, NEW.total;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_ap_invoice ON public.ap_invoices;
CREATE TRIGGER trg_validate_ap_invoice
  BEFORE INSERT OR UPDATE ON public.ap_invoices
  FOR EACH ROW EXECUTE FUNCTION public.validate_ap_invoice();

-- 2. AP auto-post JE: DR 6010 Achats + DR 4320 TVA déductible / CR 4010 Fournisseurs
CREATE OR REPLACE FUNCTION public.on_ap_invoice_posted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _entry_id uuid; _entry_number text;
  _ap uuid; _exp uuid; _vat uuid;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.approval_status <> 'approved' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','open','posted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status AND OLD.approval_status = NEW.approval_status THEN RETURN NEW; END IF;

  SELECT id INTO _ap  FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4010' LIMIT 1;
  SELECT id INTO _exp FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '6010' LIMIT 1;
  SELECT id INTO _vat FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4320' LIMIT 1;

  IF _ap IS NULL OR _exp IS NULL THEN
    RAISE WARNING 'AP Invoice %: missing GL accounts (4010/6010), JE not posted', NEW.invoice_number;
    RETURN NEW;
  END IF;

  _entry_number := 'JE-AP-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by, posted_by, posted_at)
  VALUES (NEW.tenant_id, _entry_number, NEW.invoice_date, 'AP Invoice: '||NEW.invoice_number, 'ap_invoice', 'posted', NEW.created_by, NEW.created_by, now())
  RETURNING id INTO _entry_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _exp, NEW.subtotal, 0, 'DR Achats HT');
  IF COALESCE(NEW.tax_amount,0) > 0 AND _vat IS NOT NULL THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _vat, NEW.tax_amount, 0, 'DR TVA déductible');
  END IF;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _ap, 0, NEW.total, 'CR Fournisseurs');

  NEW.journal_entry_id := _entry_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_on_ap_invoice_posted ON public.ap_invoices;
CREATE TRIGGER trg_on_ap_invoice_posted
  BEFORE INSERT OR UPDATE ON public.ap_invoices
  FOR EACH ROW EXECUTE FUNCTION public.on_ap_invoice_posted();

-- 3. Block payment if AP not approved
CREATE OR REPLACE FUNCTION public.guard_ap_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _approval text;
BEGIN
  IF NEW.payment_type <> 'ap_payment' OR NEW.ap_invoice_id IS NULL THEN RETURN NEW; END IF;
  SELECT approval_status INTO _approval FROM public.ap_invoices WHERE id = NEW.ap_invoice_id;
  IF _approval IS NULL OR _approval <> 'approved' THEN
    RAISE EXCEPTION 'Cannot pay AP invoice %: approval_status must be approved (got %)', NEW.ap_invoice_id, _approval;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_ap_payment ON public.payments;
CREATE TRIGGER trg_guard_ap_payment
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_ap_payment();

-- 4. Recompute AP after payment
CREATE OR REPLACE FUNCTION public.recompute_ap_invoice_from_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _inv_id uuid; _total numeric; _paid numeric; _due date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.payment_type <> 'ap_payment' OR OLD.ap_invoice_id IS NULL THEN RETURN OLD; END IF;
    _inv_id := OLD.ap_invoice_id;
  ELSE
    IF NEW.payment_type <> 'ap_payment' OR NEW.ap_invoice_id IS NULL THEN RETURN NEW; END IF;
    _inv_id := NEW.ap_invoice_id;
  END IF;

  SELECT total, due_date INTO _total, _due FROM public.ap_invoices WHERE id = _inv_id;
  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments
   WHERE ap_invoice_id = _inv_id AND payment_type = 'ap_payment';

  UPDATE public.ap_invoices
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

DROP TRIGGER IF EXISTS trg_recompute_ap_invoice ON public.payments;
CREATE TRIGGER trg_recompute_ap_invoice
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.recompute_ap_invoice_from_payment();

-- 5. AP Aging view
CREATE OR REPLACE VIEW public.ap_aging_view AS
SELECT
  i.tenant_id,
  i.id AS invoice_id,
  i.invoice_number,
  i.supplier_id,
  s.name AS supplier_name,
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
  i.status,
  i.approval_status
FROM public.ap_invoices i
LEFT JOIN public.suppliers s ON s.id = i.supplier_id
WHERE i.status <> 'paid' AND i.total > i.amount_paid;

ALTER VIEW public.ap_aging_view SET (security_invoker = true);
