-- V136 — Retenues à la source appliquées au règlement fournisseur (écart G-31 ; pratique UEMOA : BIC sur prestations de
-- services, loyers, non-résidents… retenus par le client au paiement et reversés à l'administration ; SAP « withholding
-- tax » au paiement, Sage « retenues »).
-- Avant : taux saisis par catégorie (ap_withholding_rates : taux, compte 447x), jamais rattachés ni appliqués.
--   ap_withholding_rates.base      net (HT, par défaut) ou brut (TTC) ;
--   suppliers.withholding_rate_id  catégorie du fournisseur ; reprise sur ses factures, modifiable sur la facture ;
--   ap_invoices                    withholding_rate_id, taux et montant de retenue figés à l'approbation ;
--   payments.withholding_amount    part de la retenue prélevée sur ce paiement (au prorata, le dernier paiement solde
--                                  la retenue) ; la trésorerie ne décaisse que le net ;
--   écriture du paiement           débit 401 (montant soldé) / crédit banque (net décaissé) / crédit 447x (retenue) ;
--   withholding_statement(du, au)  état des retenues pour la déclaration mensuelle (fournisseur, IFU, catégorie, taux,
--                                  base, retenue, compte).

ALTER TABLE public.ap_withholding_rates ADD COLUMN base text NOT NULL DEFAULT 'net' CHECK (base IN ('net', 'gross'));
ALTER TABLE public.ap_withholding_rates ADD CONSTRAINT ap_withholding_rates_id_tenant UNIQUE (id, tenant_id);
ALTER TABLE public.suppliers ADD COLUMN withholding_rate_id uuid REFERENCES public.ap_withholding_rates (id);
ALTER TABLE public.ap_invoices
  ADD COLUMN withholding_rate_id uuid REFERENCES public.ap_withholding_rates (id),
  ADD COLUMN withholding_rate_pct numeric(7, 4),
  ADD COLUMN withholding_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (withholding_amount >= 0);
ALTER TABLE public.payments ADD COLUMN withholding_amount numeric(18, 2) NOT NULL DEFAULT 0;

-- Catégorie reprise du fournisseur à la création ; taux et montant figés quand la facture est approuvée.
CREATE FUNCTION public.ap_invoice_withholding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.ap_withholding_rates%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.withholding_rate_id IS NULL THEN
    SELECT s.withholding_rate_id INTO NEW.withholding_rate_id FROM public.suppliers s WHERE s.id = NEW.supplier_id;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN
    NEW.withholding_rate_id := OLD.withholding_rate_id; NEW.withholding_rate_pct := OLD.withholding_rate_pct; NEW.withholding_amount := OLD.withholding_amount;
    RETURN NEW;
  END IF;
  IF NEW.withholding_rate_id IS NOT NULL THEN
    SELECT * INTO _r FROM public.ap_withholding_rates WHERE id = NEW.withholding_rate_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Catégorie de retenue inconnue dans la société' USING ERRCODE = 'QG034'; END IF;
  END IF;
  IF _r.id IS NULL OR NOT _r.is_active OR COALESCE(_r.rate_pct, 0) <= 0 THEN
    NEW.withholding_rate_pct := NULL; NEW.withholding_amount := 0;
  ELSE
    NEW.withholding_rate_pct := _r.rate_pct;
    NEW.withholding_amount := round((CASE _r.base WHEN 'gross' THEN COALESCE(NEW.subtotal, 0) + COALESCE(NEW.tax_amount, 0) ELSE COALESCE(NEW.subtotal, 0) END)
                                    * _r.rate_pct / 100, 2);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ap_invoice_withholding BEFORE INSERT OR UPDATE ON public.ap_invoices
  FOR EACH ROW EXECUTE FUNCTION public.ap_invoice_withholding();
REVOKE EXECUTE ON FUNCTION public.ap_invoice_withholding() FROM PUBLIC, anon;

-- Part de la retenue prélevée sur un paiement (après la conversion de devise, avant tout autre contrôle).
CREATE FUNCTION public.payment_withholding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv public.ap_invoices%ROWTYPE; _taken numeric; _rest numeric; _out numeric;
BEGIN
  IF NEW.reversal_of IS NOT NULL THEN RETURN NEW; END IF;
  NEW.withholding_amount := 0;
  IF NEW.payment_type <> 'ap_payment' OR NEW.ap_invoice_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO _inv FROM public.ap_invoices WHERE id = NEW.ap_invoice_id;
  IF COALESCE(_inv.withholding_amount, 0) <= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(sum(p.withholding_amount), 0) INTO _taken FROM public.payments p WHERE p.ap_invoice_id = _inv.id AND p.payment_type = 'ap_payment';
  _rest := _inv.withholding_amount - _taken;
  _out := _inv.total - _inv.amount_paid;
  NEW.withholding_amount := least(greatest(CASE WHEN NEW.amount >= _out THEN _rest ELSE round(_inv.withholding_amount * NEW.amount / NULLIF(_inv.total, 0), 2) END, 0),
                                  _rest, NEW.amount);
  NEW.cash_amount := COALESCE(NEW.cash_amount, NEW.amount) - NEW.withholding_amount;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ab_payment_withholding BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payment_withholding();
REVOKE EXECUTE ON FUNCTION public.payment_withholding() FROM PUBLIC, anon;

-- Compte de la retenue : celui de la catégorie (code du plan de la société), actif et imputable.
CREATE FUNCTION public.withholding_account(_tenant uuid, _invoice uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _code text; _id uuid;
BEGIN
  SELECT r.gl_account INTO _code FROM public.ap_invoices i JOIN public.ap_withholding_rates r ON r.id = i.withholding_rate_id WHERE i.id = _invoice;
  SELECT g.id INTO _id FROM public.gl_accounts g WHERE g.tenant_id = _tenant AND g.code = btrim(_code) AND g.is_active AND NOT g.is_header;
  IF _id IS NULL THEN
    RAISE EXCEPTION 'Retenue à la source : compte % introuvable ou inactif dans le plan de la société (Paramètres des comptes fournisseurs → Retenue à la source)', COALESCE(_code, '(non renseigné)')
      USING ERRCODE = 'QG001';
  END IF;
  RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.withholding_account(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.withholding_statement(_from date, _to date)
RETURNS TABLE (payment_date date, supplier_name text, supplier_tax_id text, invoice_number text, category text, rate_pct numeric, base_amount numeric,
               withheld numeric, gl_account text, reference text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.payment_date, s.name, s.tax_id, i.invoice_number, r.category, i.withholding_rate_pct,
         round(p.withholding_amount * 100 / NULLIF(i.withholding_rate_pct, 0), 2), p.withholding_amount, r.gl_account, p.reference
    FROM public.payments p
    JOIN public.ap_invoices i ON i.id = p.ap_invoice_id
    JOIN public.suppliers s ON s.id = i.supplier_id
    LEFT JOIN public.ap_withholding_rates r ON r.id = i.withholding_rate_id
   WHERE p.tenant_id = public.get_user_tenant_id(auth.uid()) AND p.payment_type = 'ap_payment' AND p.withholding_amount <> 0
     AND p.payment_date BETWEEN _from AND _to
   ORDER BY p.payment_date, s.name, i.invoice_number
$$;
REVOKE EXECUTE ON FUNCTION public.withholding_statement(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withholding_statement(date, date) TO authenticated;

-- ─── Paiement : retenue créditée, net décaissé ; annulation symétrique ───
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
  _wh numeric := COALESCE(NEW.withholding_amount, 0);
  _wh_account uuid;
  _fx_account uuid;
BEGIN
  IF NEW.reversal_of IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    _payable := public.posting_account_for(NEW.tenant_id, 'AP_PAYABLE', public.supplier_account_set((SELECT i.supplier_id FROM public.ap_invoices i WHERE i.id = NEW.ap_invoice_id)));
    _bank    := public.treasury_gl_account(NEW.tenant_id, NEW.bank_account_id, NEW.payment_method, false);

    IF _payable IS NULL THEN _manquants := _manquants || 'AP_PAYABLE'::text; END IF;
    IF _bank    IS NULL THEN _manquants := _manquants || public.treasury_role_for_method(NEW.payment_method); END IF;
    -- Retenue à la source (V136) : créditée sur son compte 447x ; l'écart de change se mesure sur décaissé + retenue.
    IF _wh > 0 THEN _wh_account := public.withholding_account(NEW.tenant_id, NEW.ap_invoice_id); END IF;
    -- Paiement en devise (V124) : écart entre la contre-valeur décaissée et la dette soldée au cours de la facture.
    IF _cash + _wh <> NEW.amount THEN
      _fx_account := public.posting_account_for(NEW.tenant_id, CASE WHEN _cash + _wh > NEW.amount THEN 'FX_LOSS' ELSE 'FX_GAIN' END, NULL);
      IF _fx_account IS NULL THEN _manquants := _manquants || CASE WHEN _cash + _wh > NEW.amount THEN 'FX_LOSS' ELSE 'FX_GAIN' END; END IF;
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
    IF _wh > 0 THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _wh_account, 0, _wh, 'CR Retenue à la source');
    END IF;
    IF _cash + _wh > NEW.amount THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _fx_account, _cash + _wh - NEW.amount, 0, 'DR Perte de change ' || COALESCE(NEW.currency, ''));
    ELSIF _cash + _wh < NEW.amount THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _fx_account, 0, NEW.amount - _cash - _wh, 'CR Gain de change ' || COALESCE(NEW.currency, ''));
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

CREATE OR REPLACE FUNCTION public.reverse_settlement(_payment_id uuid, _reason text, _reversal_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _p public.payments%ROWTYPE;
  _droit text;
  _entry uuid;
  _id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO _p FROM public.payments WHERE id = _payment_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Règlement introuvable dans la société active' USING ERRCODE = 'QG005';
  END IF;
  IF _p.payment_type IN ('ar_credit', 'ar_advance', 'ap_credit', 'ap_advance') THEN
    RAISE EXCEPTION 'L''imputation d''un avoir ou d''un acompte ne s''annule pas par contre-passation de règlement' USING ERRCODE = 'QG005';
  END IF;
  _droit := CASE _p.payment_type WHEN 'ar_receipt' THEN 'ar.reverse_receipt' ELSE 'ap.reverse_payment' END;
  IF NOT public.has_permission(auth.uid(), _droit) THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = _droit)
      USING ERRCODE = '42501';
  END IF;
  IF _p.reversal_of IS NOT NULL THEN
    RAISE EXCEPTION 'Une annulation ne s''annule pas' USING ERRCODE = 'QG005';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE reversal_of = _p.id) THEN
    RAISE EXCEPTION 'Ce règlement est déjà annulé' USING ERRCODE = 'QG005';
  END IF;
  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Motif d''annulation obligatoire' USING ERRCODE = 'QG005';
  END IF;
  IF _reversal_date IS NULL OR _reversal_date < _p.payment_date THEN
    RAISE EXCEPTION 'La date d''annulation ne peut pas précéder celle du règlement (%)', _p.payment_date
      USING ERRCODE = 'QG005';
  END IF;
  IF _p.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Écriture du règlement introuvable : annulation impossible sans contre-passation, voir le comptable'
      USING ERRCODE = 'QG005';
  END IF;

  _entry := public.reverse_journal_entry(_p.journal_entry_id, _reversal_date, btrim(_reason));

  INSERT INTO public.payments (id, tenant_id, payment_type, ar_invoice_id, ap_invoice_id, amount, payment_date,
                               payment_method, reference, journal_entry_id, created_by, reversal_of, reversal_reason,
                               bank_account_id, currency, fx_amount, exchange_rate, cash_amount, withholding_amount)
  VALUES (_id, _p.tenant_id, _p.payment_type, _p.ar_invoice_id, _p.ap_invoice_id, -_p.amount, _reversal_date,
          _p.payment_method, left('ANNULATION ' || COALESCE(_p.reference, ''), 200), _entry, auth.uid(), _p.id, btrim(_reason),
          _p.bank_account_id, _p.currency, -_p.fx_amount, _p.exchange_rate, -_p.cash_amount, -_p.withholding_amount);
  RETURN _id;
END; $function$;

SELECT public.install_tenant_isolation_triggers();
