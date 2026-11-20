-- V127 — Avances et acomptes versés aux fournisseurs (compte 409, lot I1 ; pratique SYSCOHADA / SAP « acompte
-- fournisseur » F-48 / F-54, Sage « acomptes fournisseurs »).
--   record_supplier_advance   versement (droit ap.pay) : BQ, débit 4091 (rôle SUPPLIER_ADVANCE, jeu de comptes du
--                             fournisseur) / crédit trésorerie ; en devise, contre-valeur au cours du jour ou saisi ;
--                             mêmes contrôles de coordonnées bancaires que les paiements (V56 / V57) ;
--   apply_supplier_advance    imputation sur une facture approuvée et ouverte du même fournisseur : OD, débit 401 /
--                             crédit 4091 ; ligne de règlement « ap_advance » qui réduit le reste dû (comme ap_credit) ;
--   ap_supplier_advances      registre (lecture seule) : versé, imputé, disponible.
-- L'imputation se fait en devise de la société ; une facture en devise voit son reste dû en devise diminuer en
-- proportion. La différence de cours entre l'avance et la facture n'est pas recalculée (l'avance est un élément non
-- monétaire, gardé à son cours historique).

INSERT INTO public.posting_roles (code, label, module, description, expected_prefixes) VALUES
  ('SUPPLIER_ADVANCE', 'Fournisseurs, avances et acomptes versés', 'AP', 'Débité des acomptes versés aux fournisseurs, crédité à leur imputation sur une facture', ARRAY['409'])
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.framework_role_expectations (framework_code, role_code, prefixes)
SELECT v.f, v.r, v.p FROM (VALUES ('SYSCOHADA_REVISE', 'SUPPLIER_ADVANCE', ARRAY['409']), ('PCG_FR', 'SUPPLIER_ADVANCE', ARRAY['409'])) AS v(f, r, p)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
ON CONFLICT (framework_code, role_code) DO NOTHING;
INSERT INTO public.framework_reference_accounts (framework_code, code, name, account_type)
SELECT v.f, '4091', 'Fournisseurs, avances et acomptes versés', 'asset' FROM (VALUES ('SYSCOHADA_REVISE'), ('PCG_FR')) AS v(f)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
ON CONFLICT (framework_code, code) DO NOTHING;
INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT v.f, '4091', 'Fournisseurs, avances et acomptes versés', 'asset' FROM (VALUES ('SYSCOHADA_REVISE'), ('PCG_FR')) AS v(f)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_accounts a WHERE a.framework_code = v.f AND a.code = '4091');
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT v.f, 'SUPPLIER_ADVANCE', '4091' FROM (VALUES ('SYSCOHADA_REVISE'), ('PCG_FR')) AS v(f)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults d WHERE d.framework_code = v.f AND d.role_code = 'SUPPLIER_ADVANCE');
INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
SELECT s.tenant_id, a.code, a.name, a.account_type
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code = 'SUPPLIER_ADVANCE'
  JOIN public.accounting_framework_accounts a ON a.framework_code = d.framework_code AND a.code = d.account_code
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, d.role_code, g.id
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code = 'SUPPLIER_ADVANCE'
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = d.account_code AND g.is_active
ON CONFLICT (tenant_id, role_code) DO NOTHING;
-- Le rôle se paramètre aussi dans les jeux de comptes fournisseurs (V105).
INSERT INTO public.posting_role_set_kinds (kind, role_code, control) VALUES ('supplier', 'SUPPLIER_ADVANCE', true)
ON CONFLICT DO NOTHING;

CREATE TABLE public.ap_supplier_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  advance_number text NOT NULL,
  supplier_id uuid NOT NULL,
  po_id uuid,
  paid_date date NOT NULL,
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  fx_amount numeric(18, 2),
  exchange_rate numeric(20, 8) CHECK (exchange_rate > 0),
  payment_method text NOT NULL DEFAULT 'bank_transfer',
  reference text,
  amount_applied numeric(18, 2) NOT NULL DEFAULT 0 CHECK (amount_applied >= 0 AND amount_applied <= amount),
  journal_entry_id uuid REFERENCES public.journal_entries (id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, advance_number),
  FOREIGN KEY (supplier_id) REFERENCES public.suppliers (id),
  FOREIGN KEY (po_id) REFERENCES public.purchase_orders (id)
);
ALTER TABLE public.ap_supplier_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.ap_supplier_advances FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.ap_supplier_advances TO authenticated;

ALTER TABLE public.payments ADD COLUMN source_supplier_advance_id uuid REFERENCES public.ap_supplier_advances (id);

CREATE OR REPLACE FUNCTION public.journal_for_source(_source text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE _source
    WHEN 'ar_invoice' THEN 'VT'
    WHEN 'ar_credit_note' THEN 'VT'
    WHEN 'ap_invoice' THEN 'AC'
    WHEN 'ap_credit_note' THEN 'AC'
    WHEN 'goods_receipt' THEN 'AC'
    WHEN 'grni_return' THEN 'AC'
    WHEN 'ar_receipt' THEN 'BQ'
    WHEN 'ar_advance' THEN 'BQ'
    WHEN 'ar_refund' THEN 'BQ'
    WHEN 'ap_payment' THEN 'BQ'
    WHEN 'ap_advance' THEN 'BQ'
    WHEN 'treasury' THEN 'BQ'
    WHEN 'expense_payment' THEN 'BQ'
    WHEN 'expense_advance' THEN 'BQ'
    WHEN 'expense_advance_refund' THEN 'BQ'
    WHEN 'payroll' THEN 'PA'
    ELSE 'OD'
  END
$function$;

CREATE FUNCTION public.record_supplier_advance(_supplier_id uuid, _paid_date date, _payment_method text, _reference text, _amount numeric,
  _po_id uuid DEFAULT NULL, _bank_account_id uuid DEFAULT NULL, _currency text DEFAULT NULL, _fx_amount numeric DEFAULT NULL,
  _exchange_rate numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := gen_random_uuid();
  _date date := COALESCE(_paid_date, CURRENT_DATE);
  _method text := COALESCE(NULLIF(btrim(_payment_method), ''), 'bank_transfer');
  _s record;
  _p public.procurement_settings%ROWTYPE;
  _base text;
  _cur text := NULLIF(upper(btrim(_currency)), '');
  _rate numeric := _exchange_rate;
  _number text;
  _entry uuid;
  _treso uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'ap.pay') THEN
    RAISE EXCEPTION 'Droit insuffisant : payer les fournisseurs' USING ERRCODE = '42501';
  END IF;
  SELECT name, bank_account, bank_verified INTO _s FROM public.suppliers WHERE id = _supplier_id AND tenant_id = _tenant;
  IF _s.name IS NULL THEN RAISE EXCEPTION 'Fournisseur introuvable dans la société active' USING ERRCODE = 'QG031'; END IF;
  IF _po_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.purchase_orders WHERE id = _po_id AND tenant_id = _tenant AND supplier_id = _supplier_id) THEN
    RAISE EXCEPTION 'La commande citée n''est pas une commande de ce fournisseur' USING ERRCODE = 'QG031';
  END IF;
  _p := public.procurement_setting(_tenant);
  IF _p.bank_dual_control AND _method = ANY (_p.bank_control_methods) AND _s.bank_account IS NOT NULL AND NOT _s.bank_verified THEN
    RAISE EXCEPTION 'Avance refusée : les coordonnées bancaires de « % » ont été modifiées et ne sont pas encore validées par une autre personne', _s.name
      USING ERRCODE = 'QG018';
  END IF;
  SELECT currency INTO _base FROM public.tenants WHERE id = _tenant;
  IF _cur IS NOT NULL AND _cur <> _base THEN
    IF _fx_amount IS NULL OR _fx_amount <= 0 THEN
      RAISE EXCEPTION 'Avance en % : indiquez le montant versé en devise', _cur USING ERRCODE = 'QG030';
    END IF;
    _rate := COALESCE(_rate, public.exchange_rate_at(_tenant, _cur, _date));
    IF _rate IS NULL THEN
      RAISE EXCEPTION 'Aucun cours % au % : saisissez le cours ou enregistrez-le dans Paramètres → Devises et cours', _cur, to_char(_date, 'DD/MM/YYYY')
        USING ERRCODE = 'QG030';
    END IF;
    _amount := round(_fx_amount * _rate, 2);
  ELSE
    _cur := NULL; _rate := NULL; _fx_amount := NULL;
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Le montant de l''avance doit être positif' USING ERRCODE = 'QG031'; END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AP');

  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _tenant, 'supplier_advance', 'ACF-', 'ACF-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _tenant AND doc_type = 'supplier_advance');
  _number := public.next_document_number(_tenant, 'supplier_advance', _date);

  _treso := public.resolve_treasury_account(_tenant, _bank_account_id, _method);
  _entry := public.post_two_line_entry(_tenant, _date, 'ap_advance', 'Avance ' || _number || ' — ' || _s.name,
    public.require_posting_account(_tenant, 'SUPPLIER_ADVANCE', public.supplier_account_set(_supplier_id)),
    public.treasury_gl_account(_tenant, _treso, _method), _amount);
  PERFORM public.record_treasury_line(_tenant, _treso, _date, -_amount, 'advance', 'Avance ' || _number || ' — ' || _s.name,
    COALESCE(NULLIF(btrim(_reference), ''), _number), _entry, NULL);

  INSERT INTO public.ap_supplier_advances (id, tenant_id, advance_number, supplier_id, po_id, paid_date, amount, currency, fx_amount,
                                           exchange_rate, payment_method, reference, journal_entry_id, created_by)
  VALUES (_id, _tenant, _number, _supplier_id, _po_id, _date, _amount, _cur, _fx_amount, _rate, _method, NULLIF(btrim(_reference), ''),
          _entry, auth.uid());
  RETURN _id;
END $$;

CREATE FUNCTION public.apply_supplier_advance(_invoice_id uuid, _advance_id uuid, _amount numeric, _apply_date date DEFAULT CURRENT_DATE)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _inv public.ap_invoices%ROWTYPE;
  _adv public.ap_supplier_advances%ROWTYPE;
  _date date := COALESCE(_apply_date, CURRENT_DATE);
  _entry uuid;
  _pay uuid := gen_random_uuid();
BEGIN
  IF NOT public.has_permission(auth.uid(), 'ap.pay') THEN
    RAISE EXCEPTION 'Droit insuffisant : payer les fournisseurs' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _inv FROM public.ap_invoices WHERE id = _invoice_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable dans la société active' USING ERRCODE = 'QG031'; END IF;
  IF _inv.approval_status IS DISTINCT FROM 'approved' OR _inv.status NOT IN ('open', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'La facture % n''est pas approuvée et ouverte (statut %)', _inv.invoice_number, _inv.status USING ERRCODE = 'QG031';
  END IF;
  SELECT * INTO _adv FROM public.ap_supplier_advances WHERE id = _advance_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avance introuvable dans la société active' USING ERRCODE = 'QG031'; END IF;
  IF _adv.supplier_id <> _inv.supplier_id THEN RAISE EXCEPTION 'L''avance a été versée à un autre fournisseur' USING ERRCODE = 'QG031'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Le montant imputé doit être positif' USING ERRCODE = 'QG031'; END IF;
  IF _amount > _inv.total - _inv.amount_paid THEN
    RAISE EXCEPTION 'Montant (%) supérieur au reste dû de la facture (%)', _amount, _inv.total - _inv.amount_paid USING ERRCODE = 'QG031';
  END IF;
  IF _amount > _adv.amount - _adv.amount_applied THEN
    RAISE EXCEPTION 'Montant supérieur au disponible de l''avance (%)', _adv.amount - _adv.amount_applied USING ERRCODE = 'QG031';
  END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AP');
  _entry := public.post_two_line_entry(_tenant, _date, 'ap_advance_application',
    'Imputation de l''avance ' || _adv.advance_number || ' sur ' || _inv.invoice_number,
    public.require_posting_account(_tenant, 'AP_PAYABLE', public.supplier_account_set(_inv.supplier_id)),
    public.require_posting_account(_tenant, 'SUPPLIER_ADVANCE', public.supplier_account_set(_inv.supplier_id)), _amount);
  UPDATE public.ap_supplier_advances SET amount_applied = amount_applied + _amount WHERE id = _adv.id;
  INSERT INTO public.payments (id, tenant_id, payment_type, ap_invoice_id, amount, payment_date, payment_method, reference,
                               journal_entry_id, created_by, source_supplier_advance_id)
  VALUES (_pay, _tenant, 'ap_advance', _invoice_id, _amount, _date, 'advance', _adv.advance_number, _entry, auth.uid(), _adv.id);
  RETURN _pay;
END $$;

REVOKE EXECUTE ON FUNCTION public.record_supplier_advance(uuid, date, text, text, numeric, uuid, uuid, text, numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_supplier_advance(uuid, uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_advance(uuid, date, text, text, numeric, uuid, uuid, text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_supplier_advance(uuid, uuid, numeric, date) TO authenticated;

-- ─── Règlements : l'imputation d'une avance réduit le reste dû, ne s'annule pas comme un paiement ───
CREATE OR REPLACE FUNCTION public.guard_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _app boolean := current_user IN ('authenticated', 'anon', 'qerp_api');
  _tenant uuid; _status text; _total numeric; _paid numeric; _droit text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF _app THEN
      RAISE EXCEPTION 'Un règlement enregistré ne se modifie pas et ne se supprime pas : l''annuler (contre-passation)'
        USING ERRCODE = 'QG005';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NEW.reversal_of IS NOT NULL THEN
    IF _app THEN
      RAISE EXCEPTION 'Une annulation de règlement passe par la fonction d''annulation' USING ERRCODE = 'QG005';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.payment_type IN ('ar_credit', 'ar_advance') THEN
    -- Imputation d'un avoir (V45) ou d'un acompte (V49) : uniquement par les fonctions dédiées.
    IF _app THEN
      RAISE EXCEPTION 'L''imputation d''un avoir ou d''un acompte passe par la fonction d''imputation' USING ERRCODE = 'QG005';
    END IF;
    SELECT tenant_id INTO _tenant FROM public.ar_invoices WHERE id = NEW.ar_invoice_id;
    IF _tenant IS NULL OR _tenant <> NEW.tenant_id OR NEW.ap_invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'Facture introuvable dans la société du règlement' USING ERRCODE = 'QG005';
    END IF;
    RETURN NEW;
  ELSIF NEW.payment_type IN ('ap_credit', 'ap_advance') THEN
    -- Imputation d'un avoir fournisseur (V52) : uniquement par create_ap_credit_note.
    IF _app THEN
      RAISE EXCEPTION 'L''imputation d''un avoir fournisseur passe par la fonction d''avoir' USING ERRCODE = 'QG005';
    END IF;
    SELECT tenant_id INTO _tenant FROM public.ap_invoices WHERE id = NEW.ap_invoice_id;
    IF _tenant IS NULL OR _tenant <> NEW.tenant_id OR NEW.ar_invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'Facture introuvable dans la société du règlement' USING ERRCODE = 'QG005';
    END IF;
    RETURN NEW;
  ELSIF NEW.payment_type = 'ar_receipt' THEN
    IF NEW.ar_invoice_id IS NULL OR NEW.ap_invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'Un encaissement client cite une facture client, et une seule' USING ERRCODE = 'QG005';
    END IF;
    SELECT tenant_id, status, total, amount_paid INTO _tenant, _status, _total, _paid
      FROM public.ar_invoices WHERE id = NEW.ar_invoice_id;
    _droit := 'ar.receipt';
  ELSIF NEW.payment_type = 'ap_payment' THEN
    IF NEW.ap_invoice_id IS NULL OR NEW.ar_invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'Un paiement fournisseur cite une facture fournisseur, et une seule' USING ERRCODE = 'QG005';
    END IF;
    SELECT tenant_id, status, total, amount_paid INTO _tenant, _status, _total, _paid
      FROM public.ap_invoices WHERE id = NEW.ap_invoice_id;
    _droit := 'ap.pay';
  ELSE
    RAISE EXCEPTION 'Type de règlement inconnu : %', NEW.payment_type USING ERRCODE = 'QG005';
  END IF;

  IF _tenant IS NULL OR _tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Facture introuvable dans la société du règlement' USING ERRCODE = 'QG005';
  END IF;

  IF _app THEN
    IF NEW.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Un règlement est enregistré au nom de l''utilisateur connecté' USING ERRCODE = 'QG005';
    END IF;
    IF NOT public.has_permission(auth.uid(), _droit) THEN
      RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = _droit)
        USING ERRCODE = '42501';
    END IF;
    IF NEW.payment_type = 'ar_receipt' AND _status NOT IN ('sent', 'open', 'posted', 'partially_paid', 'overdue') THEN
      RAISE EXCEPTION 'La facture n''est pas ouverte à l''encaissement (statut %)', _status USING ERRCODE = 'QG005';
    END IF;
    IF NEW.payment_type = 'ap_payment' AND _status NOT IN ('open', 'partially_paid', 'overdue') THEN
      RAISE EXCEPTION 'La facture n''est pas ouverte au paiement (statut %)', _status USING ERRCODE = 'QG005';
    END IF;
    IF NEW.amount > COALESCE(_total, 0) - COALESCE(_paid, 0) THEN
      RAISE EXCEPTION 'Montant (%) supérieur au reste dû (%)', NEW.amount, COALESCE(_total, 0) - COALESCE(_paid, 0)
        USING ERRCODE = 'QG005';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.recompute_ap_invoice_from_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _inv_id uuid; _total numeric; _paid numeric; _due date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.payment_type NOT IN ('ap_payment', 'ap_credit', 'ap_advance') OR OLD.ap_invoice_id IS NULL THEN RETURN OLD; END IF;
    _inv_id := OLD.ap_invoice_id;
  ELSE
    IF NEW.payment_type NOT IN ('ap_payment', 'ap_credit', 'ap_advance') OR NEW.ap_invoice_id IS NULL THEN RETURN NEW; END IF;
    _inv_id := NEW.ap_invoice_id;
  END IF;

  SELECT total, due_date INTO _total, _due FROM public.ap_invoices WHERE id = _inv_id;
  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments
   WHERE ap_invoice_id = _inv_id AND payment_type IN ('ap_payment', 'ap_credit', 'ap_advance');

  UPDATE public.ap_invoices
  SET amount_paid = _paid,
      status = CASE
        WHEN _paid >= _total THEN 'paid'
        WHEN _paid > 0 THEN 'partially_paid'
        WHEN _due IS NOT NULL AND _due < CURRENT_DATE THEN 'overdue'
        WHEN status IN ('paid', 'partially_paid', 'overdue') THEN 'open'
        ELSE status
      END
  WHERE id = _inv_id;

  RETURN COALESCE(NEW, OLD);
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
                               bank_account_id, currency, fx_amount, exchange_rate, cash_amount)
  VALUES (_id, _p.tenant_id, _p.payment_type, _p.ar_invoice_id, _p.ap_invoice_id, -_p.amount, _reversal_date,
          _p.payment_method, left('ANNULATION ' || COALESCE(_p.reference, ''), 200), _entry, auth.uid(), _p.id, btrim(_reason),
          _p.bank_account_id, _p.currency, -_p.fx_amount, _p.exchange_rate, -_p.cash_amount);
  RETURN _id;
END; $function$;

SELECT public.install_tenant_isolation_triggers();
