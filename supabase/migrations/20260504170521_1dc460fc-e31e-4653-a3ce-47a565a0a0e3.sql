
-- AR
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

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, _entry_number, NEW.invoice_date, 'AR Invoice: '||NEW.invoice_number, 'ar_invoice', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _ar, NEW.total, 0, 'DR Clients');
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _rev, 0, NEW.subtotal, 'CR Ventes HT');
  IF COALESCE(NEW.tax_amount,0) > 0 AND _vat IS NOT NULL THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _vat, 0, NEW.tax_amount, 'CR TVA collectée');
  END IF;

  UPDATE public.journal_entries
    SET status = 'posted', posted_by = NEW.created_by, posted_at = now()
    WHERE id = _entry_id;

  NEW.journal_entry_id := _entry_id;
  RETURN NEW;
END; $$;

-- AP
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
    RAISE WARNING 'AP Invoice %: missing GL accounts', NEW.invoice_number;
    RETURN NEW;
  END IF;

  _entry_number := 'JE-AP-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, _entry_number, NEW.invoice_date, 'AP Invoice: '||NEW.invoice_number, 'ap_invoice', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _exp, NEW.subtotal, 0, 'DR Achats HT');
  IF COALESCE(NEW.tax_amount,0) > 0 AND _vat IS NOT NULL THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _vat, NEW.tax_amount, 0, 'DR TVA déductible');
  END IF;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _ap, 0, NEW.total, 'CR Fournisseurs');

  UPDATE public.journal_entries
    SET status = 'posted', posted_by = NEW.created_by, posted_at = now()
    WHERE id = _entry_id;

  NEW.journal_entry_id := _entry_id;
  RETURN NEW;
END; $$;

-- Payments JE function (rewrite same pattern)
CREATE OR REPLACE FUNCTION public.on_ap_payment_recorded()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _entry_id uuid; _entry_number text;
  _payable uuid; _bank uuid; _ar uuid;
BEGIN
  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    SELECT id INTO _payable FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4010' LIMIT 1;
    SELECT id INTO _bank    FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '5210' LIMIT 1;

    IF _payable IS NOT NULL AND _bank IS NOT NULL THEN
      _entry_number := 'JE-PAY-AP-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
      INSERT INTO public.journal_entries (tenant_id, entry_number, description, source, status, created_by)
      VALUES (NEW.tenant_id, _entry_number, 'AP Payment: '||COALESCE(NEW.reference, NEW.id::text), 'ap_payment', 'draft', NEW.created_by)
      RETURNING id INTO _entry_id;
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _payable, NEW.amount, 0, 'DR Fournisseurs');
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _bank, 0, NEW.amount, 'CR Banque');
      UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
    END IF;
  END IF;

  IF NEW.payment_type = 'ar_receipt' AND NEW.ar_invoice_id IS NOT NULL THEN
    SELECT id INTO _bank FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '5210' LIMIT 1;
    SELECT id INTO _ar   FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4110' LIMIT 1;

    IF _ar IS NOT NULL AND _bank IS NOT NULL THEN
      _entry_number := 'JE-REC-AR-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
      INSERT INTO public.journal_entries (tenant_id, entry_number, description, source, status, created_by)
      VALUES (NEW.tenant_id, _entry_number, 'AR Receipt: '||COALESCE(NEW.reference, NEW.id::text), 'ar_receipt', 'draft', NEW.created_by)
      RETURNING id INTO _entry_id;
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _bank, NEW.amount, 0, 'DR Banque');
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _ar, 0, NEW.amount, 'CR Clients');
      UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
    END IF;
  END IF;

  RETURN NEW;
END; $$;
