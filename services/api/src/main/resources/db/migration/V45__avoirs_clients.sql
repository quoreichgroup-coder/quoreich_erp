-- V45 — Avoir client (audit docs/audit-erp : G-12, R-O2C-09 ; fin de G-03).
--
-- Depuis V42, une facture émise est figée : il manquait la pièce qui la corrige. Références : SAP
-- (G2 / VA01 type « avoir » avec référence à la facture, écriture inverse), Sage (avoir client lié
-- à la facture, numérotation propre), AUDCIF (une écriture validée ne se modifie pas : on passe une
-- écriture de sens contraire justifiée par une pièce).
--
-- Règles :
--   * create_ar_credit_note(facture, motif, date, lignes) : droit ar.credit_note ; facture émise de
--     la société ; motif obligatoire ; lignes = [{invoice_line_id, quantity}] (avoir partiel) ou
--     NULL (tout ce qui reste à créditer) ; jamais plus que le facturé non encore crédité, par ligne
--     et au total ; une facture d'en-tête (sans lignes) ne se crédite qu'en totalité.
--   * Numéro légal de la série « credit_note » (créée par défaut « AV-YYYY-#### » si absente),
--     attribué à la création : un avoir est émis, jamais brouillon ni modifiable.
--   * Écriture miroir de la facture, journal VT, datée de l'avoir : DR ventes (par compte, analytique
--     de la facture), DR TVA collectée (par compte), CR clients ; période AR ouverte exigée.
--   * Imputation : l'avoir solde d'abord le reste dû de la facture, sous la forme d'une ligne de
--     règlement « ar_credit » (le reste dû, la balance âgée et l'encours la voient sans autre
--     changement) ; le surplus (facture déjà réglée) reste un crédit client non imputé
--     (amount_allocated < total), à rembourser ou imputer plus tard (V46).

-- ─── Droit ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('ar.credit_note', 'ar', 'credit_note', 'Émettre un avoir client')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT r, 'ar.credit_note' FROM (VALUES ('admin'), ('accountant')) AS v(r)
WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code = 'ar.credit_note' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── Tables ───
CREATE TABLE public.ar_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  credit_note_number text NOT NULL,
  invoice_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  credit_date date NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  subtotal numeric(18,2) NOT NULL DEFAULT 0,
  tax_amount numeric(18,2) NOT NULL DEFAULT 0,
  total numeric(18,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  amount_allocated numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount_allocated >= 0),
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ar_credit_notes_tenant_number_key UNIQUE (tenant_id, credit_note_number),
  CONSTRAINT ar_credit_notes_invoice_fkey FOREIGN KEY (invoice_id, tenant_id) REFERENCES public.ar_invoices(id, tenant_id),
  CONSTRAINT ar_credit_notes_allocated_check CHECK (amount_allocated <= total)
);
CREATE INDEX ar_credit_notes_invoice_idx ON public.ar_credit_notes (invoice_id);
CREATE INDEX ar_credit_notes_customer_idx ON public.ar_credit_notes (tenant_id, customer_id);

CREATE TABLE public.ar_credit_note_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  credit_note_id uuid NOT NULL REFERENCES public.ar_credit_notes(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  invoice_line_id uuid REFERENCES public.ar_invoice_lines(id),
  description text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL,
  discount_pct numeric NOT NULL DEFAULT 0,
  tax_code_id uuid REFERENCES public.tax_codes(id),
  revenue_account_id uuid REFERENCES public.gl_accounts(id),
  net_amount numeric(18,2) NOT NULL,
  tax_amount numeric(18,2) NOT NULL,
  UNIQUE (credit_note_id, line_no)
);
CREATE INDEX ar_credit_note_lines_invoice_line_idx ON public.ar_credit_note_lines (invoice_line_id);

-- Lecture pour la société ; aucune écriture directe (pas de politique d'écriture) : tout passe par
-- create_ar_credit_note.
ALTER TABLE public.ar_credit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ar_credit_notes FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.ar_credit_notes TO authenticated;
ALTER TABLE public.ar_credit_note_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ar_credit_note_lines FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.ar_credit_note_lines TO authenticated;

-- ─── Journal : l'avoir client va au journal des ventes ───
CREATE OR REPLACE FUNCTION public.journal_for_source(_source text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _source
    WHEN 'ar_invoice' THEN 'VT'
    WHEN 'ar_credit_note' THEN 'VT'
    WHEN 'ap_invoice' THEN 'AC'
    WHEN 'ar_receipt' THEN 'BQ'
    WHEN 'ap_payment' THEN 'BQ'
    WHEN 'treasury' THEN 'BQ'
    WHEN 'payroll' THEN 'PA'
    ELSE 'OD'
  END
$function$;

-- ─── Règlements : l'imputation d'un avoir est une ligne « ar_credit » ───
CREATE OR REPLACE FUNCTION public.recompute_ar_invoice_from_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _inv_id uuid; _total numeric; _paid numeric; _due date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.payment_type NOT IN ('ar_receipt', 'ar_credit') OR OLD.ar_invoice_id IS NULL THEN RETURN OLD; END IF;
    _inv_id := OLD.ar_invoice_id;
  ELSE
    IF NEW.payment_type NOT IN ('ar_receipt', 'ar_credit') OR NEW.ar_invoice_id IS NULL THEN RETURN NEW; END IF;
    _inv_id := NEW.ar_invoice_id;
  END IF;
  SELECT total, due_date INTO _total, _due FROM public.ar_invoices WHERE id = _inv_id;
  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments
   WHERE ar_invoice_id = _inv_id AND payment_type IN ('ar_receipt', 'ar_credit');
  UPDATE public.ar_invoices
  SET amount_paid = _paid,
      status = CASE
        WHEN _paid >= _total THEN 'paid'
        WHEN _paid > 0 THEN 'partially_paid'
        WHEN _due IS NOT NULL AND _due < CURRENT_DATE THEN 'overdue'
        WHEN status IN ('paid', 'partially_paid', 'overdue') THEN 'sent'
        ELSE status
      END
  WHERE id = _inv_id;
  RETURN COALESCE(NEW, OLD);
END; $function$;

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

  IF NEW.payment_type = 'ar_credit' THEN
    -- Imputation d'un avoir : uniquement par create_ar_credit_note (V45).
    IF _app THEN
      RAISE EXCEPTION 'L''imputation d''un avoir passe par l''émission de l''avoir' USING ERRCODE = 'QG005';
    END IF;
    SELECT tenant_id INTO _tenant FROM public.ar_invoices WHERE id = NEW.ar_invoice_id;
    IF _tenant IS NULL OR _tenant <> NEW.tenant_id OR NEW.ap_invoice_id IS NOT NULL THEN
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

-- Une imputation d'avoir ne s'annule pas comme un encaissement : seul un nouvel avoir / une
-- facture la corrige.
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
  IF _p.payment_type = 'ar_credit' THEN
    RAISE EXCEPTION 'L''imputation d''un avoir ne s''annule pas : émettre une nouvelle facture si besoin' USING ERRCODE = 'QG005';
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
                               payment_method, reference, journal_entry_id, created_by, reversal_of, reversal_reason)
  VALUES (_id, _p.tenant_id, _p.payment_type, _p.ar_invoice_id, _p.ap_invoice_id, -_p.amount, _reversal_date,
          _p.payment_method, left('ANNULATION ' || COALESCE(_p.reference, ''), 200), _entry, auth.uid(), _p.id, btrim(_reason));
  RETURN _id;
END; $function$;

-- ─── Émission d'un avoir ───
CREATE OR REPLACE FUNCTION public.create_ar_credit_note(_invoice_id uuid, _reason text, _credit_date date DEFAULT CURRENT_DATE,
                                                       _lines jsonb DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _inv public.ar_invoices%ROWTYPE;
  _id uuid := gen_random_uuid();
  _date date := COALESCE(_credit_date, CURRENT_DATE);
  _has_lines boolean;
  _line jsonb;
  _il public.ar_invoice_lines%ROWTYPE;
  _qty numeric; _credited numeric; _net numeric; _tax numeric; _rate numeric;
  _n integer := 0;
  _sub numeric; _vat_total numeric; _total numeric;
  _already numeric;
  _number text;
  _ar uuid; _rev uuid; _vat uuid;
  _entry uuid; _jl uuid;
  _g record;
  _alloc numeric;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'ar.credit_note') THEN
    RAISE EXCEPTION 'Droit insuffisant : émettre un avoir client' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Motif de l''avoir obligatoire' USING ERRCODE = 'QG011';
  END IF;
  SELECT * INTO _inv FROM public.ar_invoices WHERE id = _invoice_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable dans la société active' USING ERRCODE = 'QG011'; END IF;
  IF _inv.status IN ('draft', 'cancelled') THEN
    RAISE EXCEPTION 'Seule une facture émise se corrige par un avoir (un brouillon se modifie ou se supprime)'
      USING ERRCODE = 'QG011';
  END IF;
  IF _date < _inv.invoice_date THEN
    RAISE EXCEPTION 'L''avoir ne peut pas précéder la facture (%)', _inv.invoice_date USING ERRCODE = 'QG011';
  END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AR');

  SELECT COALESCE(SUM(total), 0) INTO _already FROM public.ar_credit_notes WHERE invoice_id = _invoice_id;
  _has_lines := EXISTS (SELECT 1 FROM public.ar_invoice_lines WHERE invoice_id = _invoice_id);

  INSERT INTO public.ar_credit_notes (id, tenant_id, credit_note_number, invoice_id, customer_id, credit_date, reason, created_by)
  VALUES (_id, _tenant, 'AV-PROVISOIRE-' || _id::text, _invoice_id, _inv.customer_id, _date, btrim(_reason), auth.uid());

  IF _has_lines THEN
    -- Sans liste : tout ce qui reste à créditer, ligne par ligne.
    IF _lines IS NULL THEN
      SELECT jsonb_agg(jsonb_build_object('invoice_line_id', l.id, 'quantity', l.quantity - COALESCE(c.q, 0)) ORDER BY l.line_no)
        INTO _lines
        FROM public.ar_invoice_lines l
        LEFT JOIN (SELECT invoice_line_id, SUM(quantity) q FROM public.ar_credit_note_lines GROUP BY 1) c ON c.invoice_line_id = l.id
       WHERE l.invoice_id = _invoice_id AND l.quantity - COALESCE(c.q, 0) > 0;
    END IF;
    IF _lines IS NULL OR jsonb_typeof(_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(_lines) = 0 THEN
      RAISE EXCEPTION 'Rien à créditer sur cette facture' USING ERRCODE = 'QG011';
    END IF;
    FOR _line IN SELECT value FROM jsonb_array_elements(_lines) WITH ORDINALITY AS t(value, k) ORDER BY k LOOP
      SELECT * INTO _il FROM public.ar_invoice_lines
       WHERE id = NULLIF(_line->>'invoice_line_id', '')::uuid AND invoice_id = _invoice_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'La ligne ne fait pas partie de cette facture' USING ERRCODE = 'QG011'; END IF;
      _qty := NULLIF(_line->>'quantity', '')::numeric;
      IF _qty IS NULL OR _qty <= 0 THEN
        RAISE EXCEPTION 'La quantité créditée doit être positive (%)', _il.description USING ERRCODE = 'QG011';
      END IF;
      SELECT COALESCE(SUM(quantity), 0) INTO _credited FROM public.ar_credit_note_lines WHERE invoice_line_id = _il.id;
      IF _credited + _qty > _il.quantity THEN
        RAISE EXCEPTION 'Quantité supérieure au facturé non encore crédité pour « % » (reste %)', _il.description,
          _il.quantity - _credited USING ERRCODE = 'QG011';
      END IF;
      SELECT rate INTO _rate FROM public.tax_codes WHERE id = _il.tax_code_id;
      -- Totalité de la ligne : montants de la facture à l'identique ; sinon même formule (V21).
      IF _credited = 0 AND _qty = _il.quantity THEN
        _net := _il.net_amount; _tax := _il.tax_amount;
      ELSE
        _net := ROUND(_qty * _il.unit_price * (1 - _il.discount_pct / 100), 2);
        _tax := ROUND(_net * COALESCE(_rate, 0) / 100, 2);
      END IF;
      _n := _n + 1;
      INSERT INTO public.ar_credit_note_lines (tenant_id, credit_note_id, line_no, invoice_line_id, description, quantity,
                                              unit_price, discount_pct, tax_code_id, revenue_account_id, net_amount, tax_amount)
      VALUES (_tenant, _id, _n, _il.id, _il.description, _qty, _il.unit_price, _il.discount_pct, _il.tax_code_id,
              _il.revenue_account_id, _net, _tax);
    END LOOP;
  ELSE
    -- Facture d'en-tête : avoir total uniquement.
    IF _lines IS NOT NULL THEN
      RAISE EXCEPTION 'Facture sans lignes : seul un avoir total est possible' USING ERRCODE = 'QG011';
    END IF;
    IF _already > 0 THEN
      RAISE EXCEPTION 'Cette facture a déjà été créditée' USING ERRCODE = 'QG011';
    END IF;
    INSERT INTO public.ar_credit_note_lines (tenant_id, credit_note_id, line_no, description, quantity, unit_price,
                                            net_amount, tax_amount)
    VALUES (_tenant, _id, 1, 'Annulation de la facture ' || _inv.invoice_number, 1, _inv.subtotal, _inv.subtotal, _inv.tax_amount);
  END IF;

  SELECT COALESCE(SUM(net_amount), 0), COALESCE(SUM(tax_amount), 0) INTO _sub, _vat_total
    FROM public.ar_credit_note_lines WHERE credit_note_id = _id;
  _total := _sub + _vat_total;
  IF _total <= 0 THEN RAISE EXCEPTION 'Avoir de montant nul' USING ERRCODE = 'QG011'; END IF;
  IF _already + _total > _inv.total THEN
    RAISE EXCEPTION 'Le total des avoirs (%) dépasserait la facture (%)', _already + _total, _inv.total USING ERRCODE = 'QG011';
  END IF;

  -- Numéro légal (série « credit_note », créée par défaut si la société n'en a pas).
  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _tenant, 'credit_note', 'AV-', 'AV-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _tenant AND doc_type = 'credit_note');
  _number := public.next_document_number(_tenant, 'credit_note', _date);

  -- Écriture miroir de la facture.
  _ar := public.posting_account(_tenant, 'AR_RECEIVABLE');
  _rev := public.posting_account(_tenant, 'SALES_REVENUE');
  _vat := public.posting_account(_tenant, 'VAT_OUTPUT');
  IF _ar IS NULL
     OR (_rev IS NULL AND EXISTS (SELECT 1 FROM public.ar_credit_note_lines WHERE credit_note_id = _id AND revenue_account_id IS NULL))
     OR (_vat IS NULL AND EXISTS (SELECT 1 FROM public.ar_credit_note_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
                                  WHERE l.credit_note_id = _id AND l.tax_amount > 0 AND t.gl_account_id IS NULL)) THEN
    RAISE EXCEPTION 'Paramétrage comptable incomplet : l''avoir ne peut pas être comptabilisé' USING ERRCODE = 'QG001',
      HINT = 'Associer un compte aux rôles Clients, Ventes et TVA collectée dans le paramétrage comptable.';
  END IF;
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-AV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(_id::text, 1, 8), _date,
          'Avoir ' || _number || ' sur facture ' || _inv.invoice_number || ' — ' || btrim(_reason),
          'ar_credit_note', 'draft', auth.uid())
  RETURNING id INTO _entry;
  FOR _g IN
    SELECT COALESCE(revenue_account_id, _rev) AS account, SUM(net_amount) AS amount
      FROM public.ar_credit_note_lines WHERE credit_note_id = _id
     GROUP BY 1 HAVING SUM(net_amount) <> 0 ORDER BY 1
  LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry, _g.account, _g.amount, 0, 'DR Ventes (avoir)') RETURNING id INTO _jl;
    PERFORM public.impute_ar_revenue_line(_jl, _inv);
  END LOOP;
  FOR _g IN
    SELECT COALESCE(t.gl_account_id, _vat) AS account, SUM(l.tax_amount) AS amount
      FROM public.ar_credit_note_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
     WHERE l.credit_note_id = _id AND l.tax_amount > 0
     GROUP BY 1 ORDER BY 1
  LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry, _g.account, _g.amount, 0, 'DR TVA collectée (avoir)');
  END LOOP;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry, _ar, 0, _total, 'CR Clients (avoir)');
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;

  -- Imputation sur le reste dû de la facture.
  _alloc := LEAST(_total, GREATEST(_inv.total - _inv.amount_paid, 0));
  IF _alloc > 0 THEN
    INSERT INTO public.payments (tenant_id, payment_type, ar_invoice_id, amount, payment_date, payment_method,
                                 reference, journal_entry_id, created_by)
    VALUES (_tenant, 'ar_credit', _invoice_id, _alloc, _date, 'credit_note', _number, _entry, auth.uid());
  END IF;

  UPDATE public.ar_credit_notes
     SET credit_note_number = _number, subtotal = _sub, tax_amount = _vat_total, total = _total,
         amount_allocated = _alloc, journal_entry_id = _entry
   WHERE id = _id;
  RETURN _id;
END; $function$;

REVOKE ALL ON FUNCTION public.create_ar_credit_note(uuid, text, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ar_credit_note(uuid, text, date, jsonb) TO authenticated;
