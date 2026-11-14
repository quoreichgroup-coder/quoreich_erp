-- V49 — Acomptes clients, crédits clients (imputation, remboursement) et lettrage (audit
-- docs/audit-erp : G-14, G-15, crédit non imputé laissé par V45).
--
-- Références : SYSCOHADA révisé, compte 4191 « Clients, avances et acomptes reçus » (l'acompte
-- n'est pas un produit : il se loge au passif jusqu'à la facture) ; SAP F-29 / F-39 (acompte
-- client, puis compensation), Sage « règlement en attente d'affectation » ; lettrage SYSCOHADA des
-- comptes de tiers (une facture et les pièces qui la soldent portent le même code).
--
--   * record_customer_advance(client, date, mode, référence, montant, commande) : droit ar.receipt ;
--     écriture BQ : DR Banque / CR Avances clients (rôle CUSTOMER_ADVANCE, SYSCOHADA 4191) ;
--     numéro légal de la série « advance » (ACP-YYYY-####, créée si absente).
--   * apply_customer_credit(facture, 'advance' | 'credit_note', source, montant, date) : droit
--     ar.receipt ; même client, facture émise ouverte, montant ≤ reste dû et ≤ disponible.
--     Acompte → écriture OD DR 4191 / CR 411 + ligne de règlement « ar_advance » ;
--     surplus d'avoir → ligne « ar_credit » (l'avoir a déjà crédité le 411).
--   * refund_customer_credit('advance' | 'credit_note', source, montant, date, mode, référence) :
--     droit ar.refund ; écriture BQ DR 4191 (acompte) ou DR 411 (avoir) / CR Banque.
--   * Lettrage : quand une facture est soldée, elle reçoit un code (AA, AB…, par société) partagé
--     par ses règlements ; les lignes du compte clients de ces écritures reçoivent le même code si
--     elles s'équilibrent exactement (sinon lettrage du livre auxiliaire seul). Une facture qui
--     redevient due (annulation d'encaissement) est délettrée.
--   * L'encours de crédit (V43) déduit les acomptes non imputés.
-- 🧮 TVA sur acomptes : exigible à l'encaissement pour les prestations dans plusieurs pays OHADA ;
-- non traitée ici, à décider avec l'expert-comptable.

-- ─── Droits ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('ar.refund', 'ar', 'refund', 'Rembourser un crédit client (acompte ou avoir non imputé)')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT r, 'ar.refund' FROM (VALUES ('admin'), ('accountant')) AS v(r)
WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code = 'ar.refund' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── Rôle de comptabilisation : avances et acomptes reçus ───
INSERT INTO public.posting_roles (code, label, module, description)
VALUES ('CUSTOMER_ADVANCE', 'Avances clients', 'AR', 'Crédité des acomptes reçus, débité à leur imputation sur facture ou à leur remboursement')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT 'SYSCOHADA_REVISE', '4191', 'Clients, avances et acomptes reçus', 'liability'
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = 'SYSCOHADA_REVISE')
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_accounts WHERE framework_code = 'SYSCOHADA_REVISE' AND code = '4191');
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT 'SYSCOHADA_REVISE', 'CUSTOMER_ADVANCE', '4191'
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = 'SYSCOHADA_REVISE')
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults WHERE framework_code = 'SYSCOHADA_REVISE' AND role_code = 'CUSTOMER_ADVANCE');
-- Sociétés ayant déjà appliqué SYSCOHADA : compte et rôle ajoutés (jamais de choix écrasé).
INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
SELECT s.tenant_id, '4191', 'Clients, avances et acomptes reçus', 'liability'
  FROM public.tenant_accounting_settings s WHERE s.framework_code = 'SYSCOHADA_REVISE'
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, 'CUSTOMER_ADVANCE', g.id
  FROM public.tenant_accounting_settings s
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = '4191'
 WHERE s.framework_code = 'SYSCOHADA_REVISE'
ON CONFLICT (tenant_id, role_code) DO NOTHING;

-- ─── Journaux ───
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
    WHEN 'ar_advance' THEN 'BQ'
    WHEN 'ar_refund' THEN 'BQ'
    WHEN 'ap_payment' THEN 'BQ'
    WHEN 'treasury' THEN 'BQ'
    WHEN 'payroll' THEN 'PA'
    ELSE 'OD'
  END
$function$;

-- ─── Tables ───
CREATE TABLE public.ar_customer_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  advance_number text NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  sales_order_id uuid REFERENCES public.sales_orders(id),
  received_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'bank_transfer',
  reference text,
  amount_applied numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount_applied >= 0),
  amount_refunded numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ar_customer_advances_tenant_number_key UNIQUE (tenant_id, advance_number),
  CONSTRAINT ar_customer_advances_available_check CHECK (amount_applied + amount_refunded <= amount)
);
CREATE INDEX ar_customer_advances_customer_idx ON public.ar_customer_advances (tenant_id, customer_id);

ALTER TABLE public.ar_credit_notes ADD COLUMN amount_refunded numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0);
ALTER TABLE public.ar_credit_notes DROP CONSTRAINT ar_credit_notes_allocated_check;
ALTER TABLE public.ar_credit_notes ADD CONSTRAINT ar_credit_notes_allocated_check CHECK (amount_allocated + amount_refunded <= total);

CREATE TABLE public.ar_customer_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  source_type text NOT NULL CHECK (source_type IN ('advance', 'credit_note')),
  advance_id uuid REFERENCES public.ar_customer_advances(id),
  credit_note_id uuid REFERENCES public.ar_credit_notes(id),
  refund_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'bank_transfer',
  reference text,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ar_customer_refunds_source_check CHECK (
    (source_type = 'advance' AND advance_id IS NOT NULL AND credit_note_id IS NULL)
    OR (source_type = 'credit_note' AND credit_note_id IS NOT NULL AND advance_id IS NULL))
);
CREATE INDEX ar_customer_refunds_customer_idx ON public.ar_customer_refunds (tenant_id, customer_id);

ALTER TABLE public.payments
  ADD COLUMN source_advance_id uuid REFERENCES public.ar_customer_advances(id),
  ADD COLUMN source_credit_note_id uuid REFERENCES public.ar_credit_notes(id);
CREATE INDEX payments_source_advance_idx ON public.payments (source_advance_id) WHERE source_advance_id IS NOT NULL;
CREATE INDEX payments_source_credit_note_idx ON public.payments (source_credit_note_id) WHERE source_credit_note_id IS NOT NULL;
-- Imputations d'avoir déjà faites (V45) : la référence porte le numéro de l'avoir.
ALTER TABLE public.payments DISABLE TRIGGER USER;
UPDATE public.payments p SET source_credit_note_id = c.id
  FROM public.ar_credit_notes c
 WHERE p.payment_type = 'ar_credit' AND p.source_credit_note_id IS NULL
   AND c.tenant_id = p.tenant_id AND c.credit_note_number = p.reference AND c.invoice_id = p.ar_invoice_id;
ALTER TABLE public.payments ENABLE TRIGGER USER;

CREATE TABLE public.ar_letterings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  invoice_id uuid NOT NULL UNIQUE REFERENCES public.ar_invoices(id) ON DELETE CASCADE,
  code text NOT NULL,
  gl_lettered boolean NOT NULL DEFAULT false,
  lettered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ar_letterings_tenant_code_key UNIQUE (tenant_id, code)
);
CREATE TABLE public.ar_lettering_counters (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  next_number integer NOT NULL DEFAULT 0
);

ALTER TABLE public.journal_lines ADD COLUMN lettering_code text;
CREATE INDEX journal_lines_lettering_idx ON public.journal_lines (lettering_code) WHERE lettering_code IS NOT NULL;

ALTER TABLE public.ar_customer_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ar_customer_advances FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.ar_customer_advances TO authenticated;
ALTER TABLE public.ar_customer_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ar_customer_refunds FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.ar_customer_refunds TO authenticated;
ALTER TABLE public.ar_letterings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ar_letterings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.ar_letterings TO authenticated;
ALTER TABLE public.ar_lettering_counters ENABLE ROW LEVEL SECURITY;

-- ─── Lignes d'une écriture comptabilisée : seul le code de lettrage change, par la base ───
CREATE OR REPLACE FUNCTION public.protect_posted_lines()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _status text;
BEGIN
  SELECT status INTO _status FROM public.journal_entries
   WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF _status IN ('posted', 'reversed', 'cancelled') THEN
    -- Lettrage (V49) : code posé ou retiré par la fonction de lettrage, montants et comptes intacts.
    IF TG_OP = 'UPDATE' AND current_user NOT IN ('authenticated', 'anon', 'qerp_api')
       AND (NEW.entry_id, NEW.account_id, NEW.debit, NEW.credit, NEW.description, NEW.cost_center, NEW.department, NEW.project)
           IS NOT DISTINCT FROM (OLD.entry_id, OLD.account_id, OLD.debit, OLD.credit, OLD.description, OLD.cost_center, OLD.department, OLD.project) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Cannot modify lines of a posted journal entry';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $function$;

-- ─── Règlements : imputations d'acompte et d'avoir ───
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
    IF OLD.payment_type NOT IN ('ar_receipt', 'ar_credit', 'ar_advance') OR OLD.ar_invoice_id IS NULL THEN RETURN OLD; END IF;
    _inv_id := OLD.ar_invoice_id;
  ELSE
    IF NEW.payment_type NOT IN ('ar_receipt', 'ar_credit', 'ar_advance') OR NEW.ar_invoice_id IS NULL THEN RETURN NEW; END IF;
    _inv_id := NEW.ar_invoice_id;
  END IF;
  SELECT total, due_date INTO _total, _due FROM public.ar_invoices WHERE id = _inv_id;
  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments
   WHERE ar_invoice_id = _inv_id AND payment_type IN ('ar_receipt', 'ar_credit', 'ar_advance');
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

-- Une imputation d'acompte ne s'annule pas comme un encaissement (comme celle d'un avoir, V45).
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
  IF _p.payment_type IN ('ar_credit', 'ar_advance') THEN
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
                               payment_method, reference, journal_entry_id, created_by, reversal_of, reversal_reason)
  VALUES (_id, _p.tenant_id, _p.payment_type, _p.ar_invoice_id, _p.ap_invoice_id, -_p.amount, _reversal_date,
          _p.payment_method, left('ANNULATION ' || COALESCE(_p.reference, ''), 200), _entry, auth.uid(), _p.id, btrim(_reason));
  RETURN _id;
END; $function$;

-- ─── Écriture à deux lignes, comptabilisée (outil interne) ───
CREATE OR REPLACE FUNCTION public.post_two_line_entry(_tenant uuid, _date date, _source text, _label text,
                                                     _debit_account uuid, _credit_account uuid, _amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
BEGIN
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-' || upper(left(_source, 6)) || '-' || to_char(now(), 'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text, 1, 6),
          _date, _label, _source, 'draft', auth.uid())
  RETURNING id INTO _id;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_id, _debit_account, _amount, 0, _label), (_id, _credit_account, 0, _amount, _label);
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _id;
  RETURN _id;
END; $function$;
REVOKE ALL ON FUNCTION public.post_two_line_entry(uuid, date, text, text, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;

-- Rôles requis, refus QG001 s'il en manque un.
CREATE OR REPLACE FUNCTION public.require_posting_account(_tenant uuid, _role text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _a uuid := public.posting_account(_tenant, _role);
BEGIN
  IF _a IS NULL THEN
    RAISE EXCEPTION 'Paramétrage comptable incomplet : %', public.posting_roles_label(ARRAY[_role])
      USING ERRCODE = 'QG001', HINT = 'Associer un compte actif à ce rôle dans le paramétrage comptable.';
  END IF;
  RETURN _a;
END; $function$;
REVOKE ALL ON FUNCTION public.require_posting_account(uuid, text) FROM PUBLIC, anon, authenticated;

-- ─── Acompte reçu ───
CREATE OR REPLACE FUNCTION public.record_customer_advance(_customer_id uuid, _received_date date, _payment_method text,
                                                         _reference text, _amount numeric, _sales_order_id uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := gen_random_uuid();
  _date date := COALESCE(_received_date, CURRENT_DATE);
  _number text;
  _entry uuid;
  _client text;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'ar.receipt') THEN
    RAISE EXCEPTION 'Droit insuffisant : enregistrer un encaissement client' USING ERRCODE = '42501';
  END IF;
  SELECT name INTO _client FROM public.customers WHERE id = _customer_id AND tenant_id = _tenant;
  IF _client IS NULL THEN RAISE EXCEPTION 'Client introuvable dans la société active' USING ERRCODE = 'QG012'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Le montant de l''acompte doit être positif' USING ERRCODE = 'QG012'; END IF;
  IF _sales_order_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.sales_orders WHERE id = _sales_order_id AND tenant_id = _tenant AND customer_id = _customer_id) THEN
    RAISE EXCEPTION 'La commande citée n''est pas une commande de ce client' USING ERRCODE = 'QG012';
  END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AR');

  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _tenant, 'advance', 'ACP-', 'ACP-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _tenant AND doc_type = 'advance');
  _number := public.next_document_number(_tenant, 'advance', _date);

  _entry := public.post_two_line_entry(_tenant, _date, 'ar_advance', 'Acompte ' || _number || ' — ' || _client,
    public.require_posting_account(_tenant, 'BANK'), public.require_posting_account(_tenant, 'CUSTOMER_ADVANCE'), _amount);

  INSERT INTO public.ar_customer_advances (id, tenant_id, advance_number, customer_id, sales_order_id, received_date, amount,
                                          payment_method, reference, journal_entry_id, created_by)
  VALUES (_id, _tenant, _number, _customer_id, _sales_order_id, _date, _amount, COALESCE(NULLIF(btrim(_payment_method), ''), 'bank_transfer'),
          NULLIF(btrim(_reference), ''), _entry, auth.uid());
  RETURN _id;
END; $function$;

-- ─── Imputation d'un crédit client (acompte ou surplus d'avoir) sur une facture ───
CREATE OR REPLACE FUNCTION public.apply_customer_credit(_invoice_id uuid, _source_type text, _source_id uuid,
                                                       _amount numeric, _apply_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _inv public.ar_invoices%ROWTYPE;
  _adv public.ar_customer_advances%ROWTYPE;
  _cn public.ar_credit_notes%ROWTYPE;
  _date date := COALESCE(_apply_date, CURRENT_DATE);
  _dispo numeric;
  _entry uuid;
  _pay uuid := gen_random_uuid();
BEGIN
  IF NOT public.has_permission(auth.uid(), 'ar.receipt') THEN
    RAISE EXCEPTION 'Droit insuffisant : enregistrer un encaissement client' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _inv FROM public.ar_invoices WHERE id = _invoice_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable dans la société active' USING ERRCODE = 'QG012'; END IF;
  IF _inv.status NOT IN ('sent', 'open', 'posted', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'La facture n''est pas ouverte (statut %)', _inv.status USING ERRCODE = 'QG012';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Le montant imputé doit être positif' USING ERRCODE = 'QG012'; END IF;
  IF _amount > _inv.total - _inv.amount_paid THEN
    RAISE EXCEPTION 'Montant (%) supérieur au reste dû de la facture (%)', _amount, _inv.total - _inv.amount_paid USING ERRCODE = 'QG012';
  END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AR');

  IF _source_type = 'advance' THEN
    SELECT * INTO _adv FROM public.ar_customer_advances WHERE id = _source_id AND tenant_id = _tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Acompte introuvable dans la société active' USING ERRCODE = 'QG012'; END IF;
    IF _adv.customer_id <> _inv.customer_id THEN RAISE EXCEPTION 'L''acompte appartient à un autre client' USING ERRCODE = 'QG012'; END IF;
    _dispo := _adv.amount - _adv.amount_applied - _adv.amount_refunded;
    IF _amount > _dispo THEN RAISE EXCEPTION 'Montant supérieur au disponible de l''acompte (%)', _dispo USING ERRCODE = 'QG012'; END IF;
    _entry := public.post_two_line_entry(_tenant, _date, 'ar_advance_application',
      'Imputation de l''acompte ' || _adv.advance_number || ' sur ' || _inv.invoice_number,
      public.require_posting_account(_tenant, 'CUSTOMER_ADVANCE'), public.require_posting_account(_tenant, 'AR_RECEIVABLE'), _amount);
    UPDATE public.ar_customer_advances SET amount_applied = amount_applied + _amount WHERE id = _adv.id;
    INSERT INTO public.payments (id, tenant_id, payment_type, ar_invoice_id, amount, payment_date, payment_method, reference,
                                 journal_entry_id, created_by, source_advance_id)
    VALUES (_pay, _tenant, 'ar_advance', _invoice_id, _amount, _date, 'advance', _adv.advance_number, _entry, auth.uid(), _adv.id);
  ELSIF _source_type = 'credit_note' THEN
    SELECT * INTO _cn FROM public.ar_credit_notes WHERE id = _source_id AND tenant_id = _tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Avoir introuvable dans la société active' USING ERRCODE = 'QG012'; END IF;
    IF _cn.customer_id <> _inv.customer_id THEN RAISE EXCEPTION 'L''avoir appartient à un autre client' USING ERRCODE = 'QG012'; END IF;
    _dispo := _cn.total - _cn.amount_allocated - _cn.amount_refunded;
    IF _amount > _dispo THEN RAISE EXCEPTION 'Montant supérieur au crédit disponible de l''avoir (%)', _dispo USING ERRCODE = 'QG012'; END IF;
    -- L'avoir a déjà crédité le compte clients : l'imputation ne passe pas de nouvelle écriture.
    UPDATE public.ar_credit_notes SET amount_allocated = amount_allocated + _amount WHERE id = _cn.id;
    INSERT INTO public.payments (id, tenant_id, payment_type, ar_invoice_id, amount, payment_date, payment_method, reference,
                                 journal_entry_id, created_by, source_credit_note_id)
    VALUES (_pay, _tenant, 'ar_credit', _invoice_id, _amount, _date, 'credit_note', _cn.credit_note_number, _cn.journal_entry_id, auth.uid(), _cn.id);
  ELSE
    RAISE EXCEPTION 'Source de crédit inconnue : %', _source_type USING ERRCODE = 'QG012';
  END IF;
  RETURN _pay;
END; $function$;

-- ─── Remboursement d'un crédit client ───
CREATE OR REPLACE FUNCTION public.refund_customer_credit(_source_type text, _source_id uuid, _amount numeric,
                                                        _refund_date date DEFAULT CURRENT_DATE, _payment_method text DEFAULT 'bank_transfer',
                                                        _reference text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _adv public.ar_customer_advances%ROWTYPE;
  _cn public.ar_credit_notes%ROWTYPE;
  _date date := COALESCE(_refund_date, CURRENT_DATE);
  _dispo numeric;
  _entry uuid;
  _id uuid := gen_random_uuid();
BEGIN
  IF NOT public.has_permission(auth.uid(), 'ar.refund') THEN
    RAISE EXCEPTION 'Droit insuffisant : rembourser un crédit client' USING ERRCODE = '42501';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Le montant remboursé doit être positif' USING ERRCODE = 'QG012'; END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AR');
  IF _source_type = 'advance' THEN
    SELECT * INTO _adv FROM public.ar_customer_advances WHERE id = _source_id AND tenant_id = _tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Acompte introuvable dans la société active' USING ERRCODE = 'QG012'; END IF;
    _dispo := _adv.amount - _adv.amount_applied - _adv.amount_refunded;
    IF _amount > _dispo THEN RAISE EXCEPTION 'Montant supérieur au disponible de l''acompte (%)', _dispo USING ERRCODE = 'QG012'; END IF;
    _entry := public.post_two_line_entry(_tenant, _date, 'ar_refund', 'Remboursement de l''acompte ' || _adv.advance_number,
      public.require_posting_account(_tenant, 'CUSTOMER_ADVANCE'), public.require_posting_account(_tenant, 'BANK'), _amount);
    UPDATE public.ar_customer_advances SET amount_refunded = amount_refunded + _amount WHERE id = _adv.id;
    INSERT INTO public.ar_customer_refunds (id, tenant_id, customer_id, source_type, advance_id, refund_date, amount,
                                           payment_method, reference, journal_entry_id, created_by)
    VALUES (_id, _tenant, _adv.customer_id, 'advance', _adv.id, _date, _amount, COALESCE(NULLIF(btrim(_payment_method), ''), 'bank_transfer'),
            NULLIF(btrim(_reference), ''), _entry, auth.uid());
  ELSIF _source_type = 'credit_note' THEN
    SELECT * INTO _cn FROM public.ar_credit_notes WHERE id = _source_id AND tenant_id = _tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Avoir introuvable dans la société active' USING ERRCODE = 'QG012'; END IF;
    _dispo := _cn.total - _cn.amount_allocated - _cn.amount_refunded;
    IF _amount > _dispo THEN RAISE EXCEPTION 'Montant supérieur au crédit disponible de l''avoir (%)', _dispo USING ERRCODE = 'QG012'; END IF;
    _entry := public.post_two_line_entry(_tenant, _date, 'ar_refund', 'Remboursement de l''avoir ' || _cn.credit_note_number,
      public.require_posting_account(_tenant, 'AR_RECEIVABLE'), public.require_posting_account(_tenant, 'BANK'), _amount);
    UPDATE public.ar_credit_notes SET amount_refunded = amount_refunded + _amount WHERE id = _cn.id;
    INSERT INTO public.ar_customer_refunds (id, tenant_id, customer_id, source_type, credit_note_id, refund_date, amount,
                                           payment_method, reference, journal_entry_id, created_by)
    VALUES (_id, _tenant, _cn.customer_id, 'credit_note', _cn.id, _date, _amount, COALESCE(NULLIF(btrim(_payment_method), ''), 'bank_transfer'),
            NULLIF(btrim(_reference), ''), _entry, auth.uid());
  ELSE
    RAISE EXCEPTION 'Source de crédit inconnue : %', _source_type USING ERRCODE = 'QG012';
  END IF;
  RETURN _id;
END; $function$;

REVOKE ALL ON FUNCTION public.record_customer_advance(uuid, date, text, text, numeric, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_customer_credit(uuid, text, uuid, numeric, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refund_customer_credit(text, uuid, numeric, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_advance(uuid, date, text, text, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_customer_credit(uuid, text, uuid, numeric, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_customer_credit(text, uuid, numeric, date, text, text) TO authenticated;

-- ─── Émission d'un avoir (V45) : lien vers l'avoir sur son imputation, avoir complété d'abord ───
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

  -- Imputation sur le reste dû de la facture. L'avoir est complété AVANT la ligne de règlement :
  -- le lettrage automatique (V49) le lit quand la facture devient soldée.
  _alloc := LEAST(_total, GREATEST(_inv.total - _inv.amount_paid, 0));
  UPDATE public.ar_credit_notes
     SET credit_note_number = _number, subtotal = _sub, tax_amount = _vat_total, total = _total,
         amount_allocated = _alloc, journal_entry_id = _entry
   WHERE id = _id;
  IF _alloc > 0 THEN
    INSERT INTO public.payments (tenant_id, payment_type, ar_invoice_id, amount, payment_date, payment_method,
                                 reference, journal_entry_id, created_by, source_credit_note_id)
    VALUES (_tenant, 'ar_credit', _invoice_id, _alloc, _date, 'credit_note', _number, _entry, auth.uid(), _id);
  END IF;
  RETURN _id;
END; $function$;

-- ─── Encours de crédit : moins les acomptes non imputés ───
CREATE OR REPLACE FUNCTION public.customer_credit_exposure(_customer_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT SUM(total - amount_paid) FROM public.ar_invoices
                    WHERE customer_id = _customer_id AND status NOT IN ('draft', 'paid', 'cancelled')), 0)
       - COALESCE((SELECT SUM(amount - amount_applied - amount_refunded) FROM public.ar_customer_advances
                    WHERE customer_id = _customer_id), 0);
$function$;

-- ─── Lettrage ───
CREATE OR REPLACE FUNCTION public.lettering_code_of(_n integer)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  _k integer := _n;
  _out text := '';
  _len integer := 2;
  _cap integer := 676;
BEGIN
  -- AA…ZZ (676 codes), puis AAA…ZZZ, etc.
  WHILE _k >= _cap LOOP _k := _k - _cap; _len := _len + 1; _cap := _cap * 26; END LOOP;
  FOR i IN 1.._len LOOP
    _out := chr(65 + (_k % 26)) || _out;
    _k := _k / 26;
  END LOOP;
  RETURN _out;
END; $function$;

CREATE OR REPLACE FUNCTION public.letter_ar_invoice(_invoice_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _inv public.ar_invoices%ROWTYPE;
  _ar uuid;
  _n integer;
  _code text;
  _entries uuid[];
  _debit numeric; _credit numeric;
  _gl boolean := false;
BEGIN
  SELECT * INTO _inv FROM public.ar_invoices WHERE id = _invoice_id;
  IF NOT FOUND OR _inv.status <> 'paid' OR EXISTS (SELECT 1 FROM public.ar_letterings WHERE invoice_id = _invoice_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.ar_lettering_counters (tenant_id) VALUES (_inv.tenant_id) ON CONFLICT DO NOTHING;
  UPDATE public.ar_lettering_counters SET next_number = next_number + 1 WHERE tenant_id = _inv.tenant_id
  RETURNING next_number - 1 INTO _n;
  _code := public.lettering_code_of(_n);

  -- Écritures concernées : la facture, ses encaissements (annulations comprises), ses imputations
  -- d'acompte, et l'avoir s'il est entièrement imputé sur cette facture.
  SELECT array_agg(DISTINCT e) INTO _entries FROM (
    SELECT _inv.journal_entry_id AS e
    UNION ALL SELECT p.journal_entry_id FROM public.payments p
     WHERE p.ar_invoice_id = _invoice_id AND p.payment_type IN ('ar_receipt', 'ar_advance') AND p.journal_entry_id IS NOT NULL
    UNION ALL SELECT c.journal_entry_id FROM public.payments p JOIN public.ar_credit_notes c ON c.id = p.source_credit_note_id
     WHERE p.ar_invoice_id = _invoice_id AND p.payment_type = 'ar_credit'
       AND c.amount_allocated = c.total AND c.amount_refunded = 0
       AND NOT EXISTS (SELECT 1 FROM public.payments q WHERE q.source_credit_note_id = c.id AND q.ar_invoice_id <> _invoice_id)
  ) x WHERE e IS NOT NULL;

  _ar := public.posting_account(_inv.tenant_id, 'AR_RECEIVABLE');
  IF _ar IS NOT NULL AND _entries IS NOT NULL THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) INTO _debit, _credit
      FROM public.journal_lines WHERE entry_id = ANY(_entries) AND account_id = _ar AND lettering_code IS NULL;
    -- Lettrage du grand livre seulement s'il est exact (sinon : livre auxiliaire seul, à revoir).
    IF _debit > 0 AND _debit = _credit THEN
      UPDATE public.journal_lines SET lettering_code = _code
       WHERE entry_id = ANY(_entries) AND account_id = _ar AND lettering_code IS NULL;
      _gl := true;
    END IF;
  END IF;
  INSERT INTO public.ar_letterings (tenant_id, customer_id, invoice_id, code, gl_lettered)
  VALUES (_inv.tenant_id, _inv.customer_id, _invoice_id, _code, _gl);
  RETURN _code;
END; $function$;
REVOKE ALL ON FUNCTION public.letter_ar_invoice(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.on_ar_invoice_lettering()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _code text;
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    PERFORM public.letter_ar_invoice(NEW.id);
  ELSIF OLD.status = 'paid' AND NEW.status IS DISTINCT FROM 'paid' THEN
    -- Délettrage : la facture redevient due (annulation d'encaissement).
    DELETE FROM public.ar_letterings WHERE invoice_id = NEW.id RETURNING code INTO _code;
    IF _code IS NOT NULL THEN
      UPDATE public.journal_lines l SET lettering_code = NULL
        FROM public.journal_entries e
       WHERE e.id = l.entry_id AND e.tenant_id = NEW.tenant_id AND l.lettering_code = _code;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE TRIGGER trg_ar_invoice_lettering
  AFTER UPDATE OF status ON public.ar_invoices
  FOR EACH ROW EXECUTE FUNCTION public.on_ar_invoice_lettering();

-- Historique : lettrage des factures déjà soldées, dans l'ordre de leur date.
SELECT count(public.letter_ar_invoice(id)) AS factures_lettrees FROM (SELECT id FROM public.ar_invoices WHERE status = 'paid' ORDER BY invoice_date, created_at) f;
