-- V125 — Devises sur les ventes : factures clients et encaissements en devise, écart de change réalisé
-- (écart G-25, deuxième tranche ; même principe que V124 pour les achats).
--
-- Tous les montants existants restent dans la devise de la société (encours, relances, exposition, lettrage,
-- écritures au cours de la facture). La facture porte currency / exchange_rate (vide = cours du jour de la facture,
-- figé à l'émission) et ses montants en devise ; l'encaissement porte le montant reçu en devise et le cours du jour :
-- la créance 411 est soldée à sa valeur d'origine (le lettrage reste exact), la trésorerie à la contre-valeur reçue,
-- l'écart en gain (776, FX_GAIN) quand on reçoit plus que la créance, en perte (676, FX_LOSS) sinon.

ALTER TABLE public.ar_invoices
  ADD COLUMN currency text CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN exchange_rate numeric(20, 8) CHECK (exchange_rate > 0),
  ADD COLUMN fx_subtotal numeric(18, 2),
  ADD COLUMN fx_tax_amount numeric(18, 2),
  ADD COLUMN fx_total numeric(18, 2);
ALTER TABLE public.ar_invoice_lines
  ADD COLUMN fx_unit_price numeric(18, 4),
  ADD COLUMN fx_net_amount numeric(18, 2),
  ADD COLUMN fx_tax_amount numeric(18, 2);

CREATE FUNCTION public.ar_invoice_currency()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _base text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'draft' THEN
    NEW.currency := OLD.currency; NEW.exchange_rate := OLD.exchange_rate;
    NEW.fx_subtotal := OLD.fx_subtotal; NEW.fx_tax_amount := OLD.fx_tax_amount; NEW.fx_total := OLD.fx_total;
    RETURN NEW;
  END IF;
  SELECT t.currency INTO _base FROM public.tenants t WHERE t.id = NEW.tenant_id;
  NEW.currency := NULLIF(upper(btrim(NEW.currency)), '');
  IF NEW.currency IS NULL OR NEW.currency = _base THEN
    NEW.currency := NULL; NEW.exchange_rate := NULL; NEW.fx_subtotal := NULL; NEW.fx_tax_amount := NULL; NEW.fx_total := NULL;
    RETURN NEW;
  END IF;
  IF NEW.exchange_rate IS NULL
     OR (TG_OP = 'UPDATE' AND (NEW.currency IS DISTINCT FROM OLD.currency OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date)
         AND NEW.exchange_rate IS NOT DISTINCT FROM OLD.exchange_rate) THEN
    NEW.exchange_rate := public.exchange_rate_at(NEW.tenant_id, NEW.currency, NEW.invoice_date);
    IF NEW.exchange_rate IS NULL THEN
      RAISE EXCEPTION 'Aucun cours % / % au % : saisissez le cours de la facture ou enregistrez-le dans Paramètres → Devises et cours',
        NEW.currency, _base, to_char(NEW.invoice_date, 'DD/MM/YYYY') USING ERRCODE = 'QG030';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ar_invoice_lines l WHERE l.invoice_id = NEW.id) THEN
    NEW.fx_total := COALESCE(NEW.fx_subtotal, 0) + COALESCE(NEW.fx_tax_amount, 0);
  ELSE
    NEW.fx_subtotal := round(COALESCE(NEW.fx_subtotal, 0), 2);
    NEW.fx_tax_amount := round(COALESCE(NEW.fx_tax_amount, 0), 2);
    NEW.fx_total := NEW.fx_subtotal + NEW.fx_tax_amount;
    NEW.subtotal := round(NEW.fx_subtotal * NEW.exchange_rate, 2);
    NEW.tax_amount := round(NEW.fx_tax_amount * NEW.exchange_rate, 2);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ar_invoice_currency BEFORE INSERT OR UPDATE ON public.ar_invoices
  FOR EACH ROW EXECUTE FUNCTION public.ar_invoice_currency();

CREATE FUNCTION public.ar_invoice_currency_lines()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate THEN
    UPDATE public.ar_invoice_lines SET fx_unit_price = fx_unit_price WHERE invoice_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_ar_invoice_currency_lines AFTER UPDATE OF currency, exchange_rate ON public.ar_invoices
  FOR EACH ROW EXECUTE FUNCTION public.ar_invoice_currency_lines();

CREATE FUNCTION public.ar_invoice_fx_outstanding(_invoice uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN i.currency IS NULL THEN NULL ELSE round((i.total - i.amount_paid) / i.exchange_rate, 2) END
    FROM public.ar_invoices i WHERE i.id = _invoice
$$;
REVOKE EXECUTE ON FUNCTION public.ar_invoice_fx_outstanding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ar_invoice_fx_outstanding(uuid) TO authenticated;

-- Encaissement ou paiement d'une facture en devise (clients depuis V125, fournisseurs depuis V124).
CREATE OR REPLACE FUNCTION public.payment_currency()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _number text; _cur text; _irate numeric; _total numeric; _paid numeric; _out numeric; _fx_out numeric;
BEGIN
  IF NEW.reversal_of IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    SELECT invoice_number, currency, exchange_rate, total, amount_paid INTO _number, _cur, _irate, _total, _paid
      FROM public.ap_invoices WHERE id = NEW.ap_invoice_id;
  ELSIF NEW.payment_type = 'ar_receipt' AND NEW.ar_invoice_id IS NOT NULL THEN
    SELECT invoice_number, currency, exchange_rate, total, amount_paid INTO _number, _cur, _irate, _total, _paid
      FROM public.ar_invoices WHERE id = NEW.ar_invoice_id;
  END IF;
  IF _cur IS NULL THEN
    NEW.currency := NULL; NEW.fx_amount := NULL; NEW.exchange_rate := NULL; NEW.cash_amount := NULL;
    RETURN NEW;
  END IF;
  IF NEW.fx_amount IS NULL OR NEW.fx_amount <= 0 THEN
    RAISE EXCEPTION 'Facture % en % : indiquez le montant réglé en devise', _number, _cur USING ERRCODE = 'QG030';
  END IF;
  NEW.fx_amount := round(NEW.fx_amount, 2);
  _out := _total - _paid;
  _fx_out := round(_out / _irate, 2);
  IF NEW.fx_amount > _fx_out THEN
    RAISE EXCEPTION 'Facture % : % % réglés pour un restant dû de % %', _number, NEW.fx_amount, _cur, _fx_out, _cur USING ERRCODE = 'QG005';
  END IF;
  NEW.currency := _cur;
  NEW.exchange_rate := COALESCE(NEW.exchange_rate, public.exchange_rate_at(NEW.tenant_id, _cur, COALESCE(NEW.payment_date, CURRENT_DATE)));
  IF NEW.exchange_rate IS NULL THEN
    RAISE EXCEPTION 'Aucun cours % au % : saisissez le cours du règlement ou enregistrez-le dans Paramètres → Devises et cours',
      _cur, to_char(COALESCE(NEW.payment_date, CURRENT_DATE), 'DD/MM/YYYY') USING ERRCODE = 'QG030';
  END IF;
  NEW.amount := CASE WHEN NEW.fx_amount = _fx_out THEN _out ELSE least(round(NEW.fx_amount * _irate, 2), _out) END;
  NEW.cash_amount := round(NEW.fx_amount * NEW.exchange_rate, 2);
  RETURN NEW;
END $$;

-- ─── Fonctions existantes étendues aux ventes en devise ───
CREATE OR REPLACE FUNCTION public.compute_ar_invoice_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _status text;
  _cur text;
  _xrate numeric;
  _rate numeric;
  _active boolean;
BEGIN
  SELECT status, currency, exchange_rate INTO _status, _cur, _xrate FROM public.ar_invoices
   WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  -- Suppression en cascade de la facture elle-même : elle n'est déjà plus visible.
  IF TG_OP = 'DELETE' AND NOT FOUND THEN RETURN OLD; END IF;
  IF _status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Les lignes d''une facture émise sont figées (créer un avoir pour corriger)'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.tax_code_id IS NOT NULL THEN
    SELECT rate, is_active INTO _rate, _active FROM public.tax_codes WHERE id = NEW.tax_code_id;
    IF NOT _active THEN
      RAISE EXCEPTION 'Code TVA inactif : il ne peut plus être utilisé sur une facture' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF _cur IS NOT NULL THEN
    -- Facture en devise (V125) : prix saisi en devise, chaque ligne convertie au cours de la facture.
    NEW.fx_unit_price := COALESCE(NEW.fx_unit_price, NEW.unit_price);
    NEW.fx_net_amount := ROUND(NEW.quantity * NEW.fx_unit_price * (1 - NEW.discount_pct / 100), 2);
    NEW.fx_tax_amount := ROUND(NEW.fx_net_amount * COALESCE(_rate, 0) / 100, 2);
    NEW.unit_price := ROUND(NEW.fx_unit_price * _xrate, 2);
    NEW.net_amount := ROUND(NEW.fx_net_amount * _xrate, 2);
    NEW.tax_amount := ROUND(NEW.fx_tax_amount * _xrate, 2);
  ELSE
    NEW.fx_unit_price := NULL; NEW.fx_net_amount := NULL; NEW.fx_tax_amount := NULL;
    NEW.net_amount := ROUND(NEW.quantity * NEW.unit_price * (1 - NEW.discount_pct / 100), 2);
    NEW.tax_amount := ROUND(NEW.net_amount * COALESCE(_rate, 0) / 100, 2);
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.sum_ar_invoice_lines()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _invoice uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  UPDATE public.ar_invoices i
     SET subtotal = s.net, tax_amount = s.tax, fx_subtotal = s.fx_net, fx_tax_amount = s.fx_tax
    FROM (SELECT COALESCE(SUM(net_amount), 0) AS net, COALESCE(SUM(tax_amount), 0) AS tax,
                 SUM(fx_net_amount) AS fx_net, SUM(fx_tax_amount) AS fx_tax
            FROM public.ar_invoice_lines WHERE invoice_id = _invoice) s
   WHERE i.id = _invoice;
  RETURN NULL;
END; $function$;

CREATE OR REPLACE FUNCTION public.on_ap_payment_recorded()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _entry_id uuid; _entry_number text;
  _payable uuid; _bank uuid; _ar uuid;
  _manquants text[] := '{}';
  _date date := COALESCE(NEW.payment_date, CURRENT_DATE);
  _cash numeric := COALESCE(NEW.cash_amount, NEW.amount);
  _fx_account uuid;
BEGIN
  IF NEW.reversal_of IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    _payable := public.posting_account_for(NEW.tenant_id, 'AP_PAYABLE', public.supplier_account_set((SELECT i.supplier_id FROM public.ap_invoices i WHERE i.id = NEW.ap_invoice_id)));
    _bank    := public.treasury_gl_account(NEW.tenant_id, NEW.bank_account_id, NEW.payment_method, false);

    IF _payable IS NULL THEN _manquants := _manquants || 'AP_PAYABLE'::text; END IF;
    IF _bank    IS NULL THEN _manquants := _manquants || public.treasury_role_for_method(NEW.payment_method); END IF;
    -- Paiement en devise (V124) : écart entre la contre-valeur décaissée et la dette soldée au cours de la facture.
    IF _cash <> NEW.amount THEN
      _fx_account := public.posting_account_for(NEW.tenant_id, CASE WHEN _cash > NEW.amount THEN 'FX_LOSS' ELSE 'FX_GAIN' END, NULL);
      IF _fx_account IS NULL THEN _manquants := _manquants || CASE WHEN _cash > NEW.amount THEN 'FX_LOSS' ELSE 'FX_GAIN' END; END IF;
    END IF;
    IF cardinality(_manquants) > 0 THEN
      RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; le paiement fournisseur ne peut pas être enregistré',
        public.posting_roles_label(_manquants)
        USING ERRCODE = 'QG001',
              HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable.';
    END IF;

    _entry_number := 'JE-PAY-AP-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
    INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
    VALUES (NEW.tenant_id, _entry_number, _date, 'AP Payment: '||COALESCE(NEW.reference, NEW.id::text), 'ap_payment', 'draft', NEW.created_by)
    RETURNING id INTO _entry_id;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _payable, NEW.amount, 0, 'DR Fournisseurs');
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _bank, 0, _cash, 'CR Trésorerie');
    IF _cash > NEW.amount THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _fx_account, _cash - NEW.amount, 0, 'DR Perte de change ' || COALESCE(NEW.currency, ''));
    ELSIF _cash < NEW.amount THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _fx_account, 0, NEW.amount - _cash, 'CR Gain de change ' || COALESCE(NEW.currency, ''));
    END IF;
    UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  END IF;

  IF NEW.payment_type = 'ar_receipt' AND NEW.ar_invoice_id IS NOT NULL THEN
    _bank := public.treasury_gl_account(NEW.tenant_id, NEW.bank_account_id, NEW.payment_method, false);
    _ar   := public.posting_account_for(NEW.tenant_id, 'AR_RECEIVABLE', public.customer_account_set((SELECT i.customer_id FROM public.ar_invoices i WHERE i.id = NEW.ar_invoice_id)));

    IF _bank IS NULL THEN _manquants := _manquants || public.treasury_role_for_method(NEW.payment_method); END IF;
    IF _ar   IS NULL THEN _manquants := _manquants || 'AR_RECEIVABLE'::text; END IF;
    -- Encaissement en devise (V125) : on reçoit plus que la créance = gain, moins = perte.
    IF _cash <> NEW.amount THEN
      _fx_account := public.posting_account_for(NEW.tenant_id, CASE WHEN _cash > NEW.amount THEN 'FX_GAIN' ELSE 'FX_LOSS' END, NULL);
      IF _fx_account IS NULL THEN _manquants := _manquants || CASE WHEN _cash > NEW.amount THEN 'FX_GAIN' ELSE 'FX_LOSS' END; END IF;
    END IF;
    IF cardinality(_manquants) > 0 THEN
      RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; l''encaissement ne peut pas être enregistré',
        public.posting_roles_label(_manquants)
        USING ERRCODE = 'QG001',
              HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable.';
    END IF;

    _entry_number := 'JE-REC-AR-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
    INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
    VALUES (NEW.tenant_id, _entry_number, _date, 'AR Receipt: '||COALESCE(NEW.reference, NEW.id::text), 'ar_receipt', 'draft', NEW.created_by)
    RETURNING id INTO _entry_id;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _bank, _cash, 0, 'DR Trésorerie');
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _ar, 0, NEW.amount, 'CR Clients');
    IF _cash > NEW.amount THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _fx_account, 0, _cash - NEW.amount, 'CR Gain de change ' || COALESCE(NEW.currency, ''));
    ELSIF _cash < NEW.amount THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _fx_account, NEW.amount - _cash, 0, 'DR Perte de change ' || COALESCE(NEW.currency, ''));
    END IF;
    UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  END IF;

  IF _entry_id IS NOT NULL THEN
    UPDATE public.payments SET journal_entry_id = _entry_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.payment_treasury_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _entry uuid; _label text;
BEGIN
  IF NEW.bank_account_id IS NULL OR NEW.payment_type NOT IN ('ar_receipt', 'ap_payment') THEN RETURN NULL; END IF;
  SELECT journal_entry_id INTO _entry FROM public.payments WHERE id = NEW.id;
  SELECT CASE WHEN NEW.payment_type = 'ar_receipt' THEN 'Encaissement ' || COALESCE(i.invoice_number, '') || ' — ' || COALESCE(c.name, '')
              ELSE 'Paiement ' || COALESCE(a.invoice_number, '') || ' — ' || COALESCE(s.name, '') END
    INTO _label
    FROM (SELECT 1) x
    LEFT JOIN public.ar_invoices i ON i.id = NEW.ar_invoice_id LEFT JOIN public.customers c ON c.id = i.customer_id
    LEFT JOIN public.ap_invoices a ON a.id = NEW.ap_invoice_id LEFT JOIN public.suppliers s ON s.id = a.supplier_id;
  PERFORM public.record_treasury_line(NEW.tenant_id, NEW.bank_account_id, NEW.payment_date,
    CASE WHEN NEW.payment_type = 'ar_receipt' THEN COALESCE(NEW.cash_amount, NEW.amount) ELSE -COALESCE(NEW.cash_amount, NEW.amount) END, 'payment',
    CASE WHEN NEW.reversal_of IS NOT NULL THEN 'Annulation — ' ELSE '' END || _label, NEW.reference, _entry, NEW.id);
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.record_settlement(_kind text, _party_id uuid, _payment_date date, _payment_method text, _reference text, _allocations jsonb, _bank_account_id uuid DEFAULT NULL::uuid, _exchange_rate numeric DEFAULT NULL::numeric)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _a jsonb;
  _invoice uuid;
  _amount numeric;
  _number text;
  _party uuid;
  _status text;
  _approval text;
  _outstanding numeric;
  _seen uuid[] := '{}';
  _ids uuid[] := '{}';
  _id uuid;
  _cur text;
  _irate numeric;
  _fx numeric;
  _fx_out numeric;
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'Connexion et société requises' USING ERRCODE = '42501';
  END IF;
  IF _kind NOT IN ('ar', 'ap') THEN
    RAISE EXCEPTION 'Type de règlement inconnu : % (ar ou ap)', _kind USING ERRCODE = '22023';
  END IF;
  IF _party_id IS NULL THEN
    RAISE EXCEPTION 'Choisissez d''abord le %', CASE WHEN _kind = 'ar' THEN 'client' ELSE 'fournisseur' END
      USING ERRCODE = 'QG005';
  END IF;
  IF _allocations IS NULL OR jsonb_typeof(_allocations) <> 'array' OR jsonb_array_length(_allocations) = 0 THEN
    RAISE EXCEPTION 'Imputez le règlement sur au moins une facture' USING ERRCODE = 'QG005';
  END IF;

  FOR _a IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    _invoice := (_a ->> 'invoice_id')::uuid;
    _amount := round((_a ->> 'amount')::numeric, 2);
    IF _invoice = ANY (_seen) THEN
      RAISE EXCEPTION 'La même facture apparaît deux fois dans le règlement' USING ERRCODE = 'QG005';
    END IF;
    _seen := _seen || _invoice;

    _cur := NULL; _irate := NULL; _fx := NULL;
    IF _kind = 'ar' THEN
      SELECT invoice_number, customer_id, status, NULL, total - amount_paid, currency, exchange_rate
        INTO _number, _party, _status, _approval, _outstanding, _cur, _irate
        FROM public.ar_invoices WHERE id = _invoice AND tenant_id = _tenant FOR UPDATE;
    ELSE
      SELECT invoice_number, supplier_id, status, approval_status, total - amount_paid, currency, exchange_rate
        INTO _number, _party, _status, _approval, _outstanding, _cur, _irate
        FROM public.ap_invoices WHERE id = _invoice AND tenant_id = _tenant FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Facture introuvable dans la société' USING ERRCODE = 'QG005';
    END IF;
    IF _party IS DISTINCT FROM _party_id THEN
      RAISE EXCEPTION 'La facture % n''appartient pas au % choisi', _number,
        CASE WHEN _kind = 'ar' THEN 'client' ELSE 'fournisseur' END USING ERRCODE = 'QG005';
    END IF;
    IF _status IN ('draft', 'paid', 'cancelled', 'void') THEN
      RAISE EXCEPTION 'La facture % n''est pas ouverte au règlement (statut : %)', _number, _status USING ERRCODE = 'QG005';
    END IF;
    IF _kind = 'ap' AND _approval IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'La facture fournisseur % n''est pas approuvée : paiement refusé', _number USING ERRCODE = 'QG005';
    END IF;
    -- Facture en devise (V124) : l'imputation se donne en devise ; la part de facture soldée est calculée au cours de
    -- la facture (le solde exact quand tout est réglé), comme le fait payment_currency pour tout paiement.
    IF _cur IS NOT NULL THEN
      _fx := round((_a ->> 'fx_amount')::numeric, 2);
      _fx_out := round(_outstanding / _irate, 2);
      IF _fx IS NULL OR _fx <= 0 THEN
        RAISE EXCEPTION 'Facture % en % : indiquez le montant réglé en devise', _number, _cur USING ERRCODE = 'QG030';
      END IF;
      IF _fx > _fx_out THEN
        RAISE EXCEPTION 'Facture % : % % réglés pour un restant dû de % %', _number, _fx, _cur, _fx_out, _cur USING ERRCODE = 'QG005';
      END IF;
      _amount := CASE WHEN _fx = _fx_out THEN _outstanding ELSE least(round(_fx * _irate, 2), _outstanding) END;
    END IF;
    IF _amount IS NULL OR _amount <= 0 THEN
      RAISE EXCEPTION 'Montant imputé invalide sur la facture %', _number USING ERRCODE = 'QG005';
    END IF;
    IF _amount > _outstanding THEN
      RAISE EXCEPTION 'Facture % : % imputé pour un restant dû de %', _number, _amount, _outstanding USING ERRCODE = 'QG005';
    END IF;

    INSERT INTO public.payments (tenant_id, payment_type, ar_invoice_id, ap_invoice_id, amount, payment_date,
                                 payment_method, reference, created_by, bank_account_id, fx_amount, exchange_rate)
    VALUES (_tenant, CASE WHEN _kind = 'ar' THEN 'ar_receipt' ELSE 'ap_payment' END,
            CASE WHEN _kind = 'ar' THEN _invoice END, CASE WHEN _kind = 'ap' THEN _invoice END,
            _amount, COALESCE(_payment_date, CURRENT_DATE), COALESCE(NULLIF(_payment_method, ''), 'bank_transfer'),
            NULLIF(btrim(_reference), ''), auth.uid(), _bank_account_id, _fx, CASE WHEN _cur IS NOT NULL THEN _exchange_rate END)
    RETURNING id INTO _id;
    _ids := _ids || _id;
  END LOOP;
  RETURN _ids;
END $function$;

SELECT public.install_tenant_isolation_triggers();
