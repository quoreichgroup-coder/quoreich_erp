
-- Drop and recreate the trigger function to properly bypass RLS
CREATE OR REPLACE FUNCTION public.on_ap_payment_recorded()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _entry_id uuid;
  _entry_number text;
  _payable_account uuid;
  _bank_account uuid;
BEGIN
  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    SELECT id INTO _payable_account FROM public.gl_accounts
    WHERE tenant_id = NEW.tenant_id AND code = '4010' LIMIT 1;
    
    SELECT id INTO _bank_account FROM public.gl_accounts
    WHERE tenant_id = NEW.tenant_id AND code = '5210' LIMIT 1;
    
    IF _payable_account IS NOT NULL AND _bank_account IS NOT NULL THEN
      _entry_number := 'JE-AP-' || to_char(now(), 'YYYYMMDD') || '-' || substr(NEW.id::text, 1, 8);
      
      INSERT INTO public.journal_entries (tenant_id, entry_number, description, source, status, created_by, posted_by, posted_at)
      VALUES (NEW.tenant_id, _entry_number, 'AP Payment: ' || COALESCE(NEW.reference, NEW.id::text), 'ap_payment', 'posted', NEW.created_by, NEW.created_by, now())
      RETURNING id INTO _entry_id;
      
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _payable_account, NEW.amount, 0, 'AP Payment - DR Trade Payables');
      
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _bank_account, 0, NEW.amount, 'AP Payment - CR Bank');
      
      UPDATE public.payments SET journal_entry_id = _entry_id WHERE id = NEW.id;
    END IF;
  END IF;
  
  IF NEW.payment_type = 'ar_receipt' AND NEW.ar_invoice_id IS NOT NULL THEN
    SELECT id INTO _bank_account FROM public.gl_accounts
    WHERE tenant_id = NEW.tenant_id AND code = '5210' LIMIT 1;
    
    SELECT id INTO _payable_account FROM public.gl_accounts
    WHERE tenant_id = NEW.tenant_id AND code = '4110' LIMIT 1;
    
    IF _payable_account IS NOT NULL AND _bank_account IS NOT NULL THEN
      _entry_number := 'JE-AR-' || to_char(now(), 'YYYYMMDD') || '-' || substr(NEW.id::text, 1, 8);
      
      INSERT INTO public.journal_entries (tenant_id, entry_number, description, source, status, created_by, posted_by, posted_at)
      VALUES (NEW.tenant_id, _entry_number, 'AR Receipt: ' || COALESCE(NEW.reference, NEW.id::text), 'ar_receipt', 'posted', NEW.created_by, NEW.created_by, now())
      RETURNING id INTO _entry_id;
      
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _bank_account, NEW.amount, 0, 'AR Receipt - DR Bank');
      
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _payable_account, 0, NEW.amount, 'AR Receipt - CR Trade Receivables');
      
      UPDATE public.payments SET journal_entry_id = _entry_id WHERE id = NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;
