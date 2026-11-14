-- V42 — Ventes et clients : sécurisation (audit docs/audit-erp, écarts G-01, G-02, G-03, G-06, G-07).
--
-- Constats prouvés le 14 nov. 2026 sur la copie réelle, en tant qu'utilisateur « Lecteur » :
--   * un paiement pouvait citer la facture d'une AUTRE société, que la recomputation SECURITY
--     DEFINER modifiait (S13) ; un paiement se supprimait ou se modifiait sans que l'écriture
--     bancaire suive (S3, S4) ;
--   * une facture client émise se modifiait ou s'« annulait » sans avoir ni contre-passation (S1, S12) ;
--   * post_delivery décrémentait le stock deux fois (mise à jour directe + mouvement « posted »
--     appliqué par apply_stock_movement), au coût 0, et refusait toute livraison de plus de la
--     moitié du stock (le contrôle de disponibilité voyait la quantité déjà décrémentée) ;
--   * la facture issue d'une livraison était émise d'office, sans lignes, avec une TVA à 0.
--
-- Règles posées :
--   1. Règlements (table payments, partagée AR / AP) : enregistrés par l'utilisateur connecté, avec
--      le droit ar.receipt / ap.pay, sur une facture ouverte de SA société, sans dépasser le reste
--      dû ; jamais modifiés ni supprimés. Une erreur se corrige par reverse_settlement : ligne de
--      règlement négative liée à l'origine + contre-passation de l'écriture (droits
--      ar.reverse_receipt / ap.reverse_payment, motif obligatoire). Chaque règlement garde le lien
--      vers son écriture (journal_entry_id, jamais renseigné jusqu'ici).
--   2. Facture client : brouillon modifiable et supprimable par l'administrateur ou le comptable ;
--      émise, elle est figée (en-tête et lignes). L'annulation passera par l'avoir (lot suivant).
--   3. Livraison : un seul mouvement de stock, valorisé au coût moyen de l'article.
--   4. Facture issue d'une livraison : BROUILLON reprenant les lignes livrées, échéance selon les
--      conditions du client ; le comptable choisit les codes TVA puis l'émet (numéro légal V22).
--
-- Les gardes ne sont pas SECURITY DEFINER : elles regardent current_user, comme V24 / V34 / V39 /
-- V41, et laissent passer le code SECURITY DEFINER (recalculs, comptabilisation, annulation).

-- ─── 1. Droits du catalogue ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
SELECT v.code, v.module, v.action, v.label FROM (VALUES
  ('ar.receipt', 'ar', 'receipt', 'Enregistrer un encaissement client'),
  ('ar.reverse_receipt', 'ar', 'reverse_receipt', 'Annuler un encaissement client (contre-passation)'),
  ('ap.pay', 'ap', 'pay', 'Enregistrer un paiement fournisseur'),
  ('ap.reverse_payment', 'ap', 'reverse_payment', 'Annuler un paiement fournisseur (contre-passation)'))
  AS v(code, module, action, label)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT r, p FROM (VALUES
  ('admin', 'ar.receipt'), ('admin', 'ar.reverse_receipt'), ('admin', 'ap.pay'), ('admin', 'ap.reverse_payment'),
  ('accountant', 'ar.receipt'), ('accountant', 'ar.reverse_receipt'), ('accountant', 'ap.pay'), ('accountant', 'ap.reverse_payment'),
  ('treasury_manager', 'ar.receipt'), ('treasury_manager', 'ap.pay'),
  ('treasury_clerk', 'ar.receipt'), ('treasury_clerk', 'ap.pay'),
  ('cash_admin', 'ar.receipt'), ('cash_admin', 'ap.pay')) AS v(r, p)
WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;

SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code IN ('ar.receipt', 'ar.reverse_receipt', 'ap.pay', 'ap.reverse_payment') AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── 2. Règlements : annulation liée, signe du montant ───
ALTER TABLE public.payments
  ADD COLUMN reversal_of uuid REFERENCES public.payments(id),
  ADD COLUMN reversal_reason text;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_sign
  CHECK ((reversal_of IS NULL AND amount > 0) OR (reversal_of IS NOT NULL AND amount < 0));
CREATE UNIQUE INDEX payments_reversal_of_key ON public.payments (reversal_of) WHERE reversal_of IS NOT NULL;

-- Lien règlement → écriture pour l'historique : l'écriture du règlement porte le début de son
-- identifiant dans son numéro (JE-PAY-AP-<date>-<8>, JE-REC-AR-<date>-<8>, et avant V17
-- JE-AP-<date>-<8>, JE-AR-<date>-<8>) et sa source est le type de règlement. Un règlement sans
-- écriture (comptes manquants avant V17) reste sans lien : son annulation est refusée et renvoie au
-- comptable. Déclencheurs coupés le temps de cette seule mise à jour (période close possible).
ALTER TABLE public.payments DISABLE TRIGGER USER;
UPDATE public.payments p
   SET journal_entry_id = (
     SELECT je.id FROM public.journal_entries je
      WHERE je.tenant_id = p.tenant_id
        AND je.source = p.payment_type
        AND je.status = 'posted'
        AND je.entry_number LIKE 'JE-%-' || substr(p.id::text, 1, 8)
      ORDER BY je.created_at, je.id
      LIMIT 1)
 WHERE p.journal_entry_id IS NULL;
ALTER TABLE public.payments ENABLE TRIGGER USER;

-- Comptabilisation : inchangée, sauf l'annulation (comptabilisée par contre-passation) et le lien.
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
BEGIN
  IF NEW.reversal_of IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    _payable := public.posting_account(NEW.tenant_id, 'AP_PAYABLE');
    _bank    := public.posting_account(NEW.tenant_id, 'BANK');

    IF _payable IS NULL THEN _manquants := _manquants || 'AP_PAYABLE'::text; END IF;
    IF _bank    IS NULL THEN _manquants := _manquants || 'BANK'::text; END IF;
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
    VALUES (_entry_id, _bank, 0, NEW.amount, 'CR Banque');
    UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  END IF;

  IF NEW.payment_type = 'ar_receipt' AND NEW.ar_invoice_id IS NOT NULL THEN
    _bank := public.posting_account(NEW.tenant_id, 'BANK');
    _ar   := public.posting_account(NEW.tenant_id, 'AR_RECEIVABLE');

    IF _bank IS NULL THEN _manquants := _manquants || 'BANK'::text; END IF;
    IF _ar   IS NULL THEN _manquants := _manquants || 'AR_RECEIVABLE'::text; END IF;
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
    VALUES (_entry_id, _bank, NEW.amount, 0, 'DR Banque');
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _ar, 0, NEW.amount, 'CR Clients');
    UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  END IF;

  IF _entry_id IS NOT NULL THEN
    UPDATE public.payments SET journal_entry_id = _entry_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END; $function$;

-- Recalcul du réglé : une annulation (montant négatif) fait revenir la facture à « due ».
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
        WHEN status IN ('paid', 'partially_paid', 'overdue') THEN 'sent'
        ELSE status
      END
  WHERE id = _inv_id;
  RETURN COALESCE(NEW, OLD);
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
        WHEN status IN ('paid', 'partially_paid', 'overdue') THEN 'open'
        ELSE status
      END
  WHERE id = _inv_id;

  RETURN COALESCE(NEW, OLD);
END; $function$;

-- Garde des règlements.
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

  IF NEW.payment_type = 'ar_receipt' THEN
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

  -- Vrai pour tous les chemins : la facture réglée appartient à la société du règlement.
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

CREATE TRIGGER trg_guard_payment
  BEFORE INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment();

-- Annulation d'un règlement : ligne négative liée + contre-passation de son écriture.
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

REVOKE ALL ON FUNCTION public.reverse_settlement(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_settlement(uuid, text, date) TO authenticated;

-- ─── 3. Facture client : brouillon modifiable, émise figée ───
CREATE OR REPLACE FUNCTION public.guard_ar_invoice_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT public.tenant_has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Droit insuffisant : seuls l''administrateur et le comptable saisissent les factures clients'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'sent') THEN
      RAISE EXCEPTION 'Une facture client se crée en brouillon ou émise (statut demandé : %)', NEW.status
        USING ERRCODE = 'QG009';
    END IF;
    IF COALESCE(NEW.amount_paid, 0) <> 0 OR NEW.journal_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'Le réglé et l''écriture d''une facture sont calculés par la base' USING ERRCODE = 'QG009';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'La facture % est émise : elle ne se modifie plus et ne se supprime pas ; la corriger par un avoir',
      OLD.invoice_number USING ERRCODE = 'QG009';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status NOT IN ('draft', 'sent') THEN
    RAISE EXCEPTION 'Une facture en brouillon ne peut qu''être émise (statut demandé : %)', NEW.status
      USING ERRCODE = 'QG009';
  END IF;
  IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Le réglé, l''écriture et la société d''une facture ne se saisissent pas' USING ERRCODE = 'QG009';
  END IF;
  RETURN NEW;
END; $function$;

CREATE TRIGGER trg_guard_ar_invoice_lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON public.ar_invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_ar_invoice_lifecycle();

CREATE OR REPLACE FUNCTION public.guard_ar_invoice_lines()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _status text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO _status FROM public.ar_invoices WHERE id = OLD.invoice_id;
    IF _status IS NOT NULL AND _status <> 'draft' THEN
      RAISE EXCEPTION 'Les lignes d''une facture émise sont figées ; la corriger par un avoir' USING ERRCODE = 'QG009';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO _status FROM public.ar_invoices WHERE id = NEW.invoice_id;
    IF _status IS NOT NULL AND _status <> 'draft' THEN
      RAISE EXCEPTION 'Les lignes d''une facture émise sont figées ; la corriger par un avoir' USING ERRCODE = 'QG009';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $function$;

CREATE TRIGGER trg_guard_ar_invoice_lines
  BEFORE INSERT OR UPDATE OR DELETE ON public.ar_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_ar_invoice_lines();

-- ─── 4. Livraison : un seul mouvement, au coût moyen ───
CREATE OR REPLACE FUNCTION public.post_delivery(_so_id uuid, _lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.sales_orders%ROWTYPE;
  _dn_id uuid;
  _dn_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _line jsonb;
  _so_line public.so_lines%ROWTYPE;
  _quantity numeric;
  _cost numeric;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'deliver') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _s FROM public.sales_orders
   WHERE id = _so_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable dans la société active'; END IF;
  IF _s.status NOT IN ('confirmed', 'partially_delivered') THEN
    RAISE EXCEPTION 'La commande doit être confirmée avant livraison';
  END IF;
  IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Les lignes de livraison doivent être un tableau JSON';
  END IF;
  IF jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'Au moins une ligne de livraison est requise';
  END IF;

  INSERT INTO public.delivery_notes
    (tenant_id, dn_number, so_id, customer_id, delivery_date, status, created_by, delivered_by)
  VALUES (_tenant, '', _so_id, _s.customer_id, CURRENT_DATE, 'draft', auth.uid(), auth.uid())
  RETURNING id INTO _dn_id;
  SELECT dn_number INTO _dn_number FROM public.delivery_notes WHERE id = _dn_id;

  FOR _line IN SELECT value FROM jsonb_array_elements(_lines) AS lines(value) LOOP
    IF NULLIF(_line->>'so_line_id', '') IS NULL THEN
      RAISE EXCEPTION 'Identifiant de ligne de commande manquant';
    END IF;
    _quantity := NULLIF(_line->>'quantity', '')::numeric;
    IF _quantity IS NULL OR _quantity <= 0 THEN
      RAISE EXCEPTION 'La quantité livrée doit être positive';
    END IF;
    SELECT * INTO _so_line FROM public.so_lines
     WHERE id = (_line->>'so_line_id')::uuid AND so_id = _so_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La ligne ne fait pas partie de cette commande'; END IF;
    IF _so_line.quantity_delivered + _quantity > _so_line.quantity THEN
      RAISE EXCEPTION 'La quantité livrée dépasse le reliquat de la ligne';
    END IF;
    IF _so_line.item_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.items WHERE id = _so_line.item_id AND tenant_id = _tenant
    ) THEN
      RAISE EXCEPTION 'Article de la ligne hors de la société active';
    END IF;

    INSERT INTO public.dn_lines(dn_id, so_line_id, item_id, description, quantity, unit_price)
    VALUES (_dn_id, _so_line.id, _so_line.item_id, _so_line.description, _quantity, _so_line.unit_price);
    UPDATE public.so_lines SET quantity_delivered = quantity_delivered + _quantity WHERE id = _so_line.id;

    -- Le stock ne bouge que par le mouvement (apply_stock_movement contrôle la disponibilité,
    -- consomme les couches et met la quantité à jour) ; valorisé au coût moyen de l'article.
    IF _so_line.item_id IS NOT NULL THEN
      SELECT COALESCE(average_cost, 0) INTO _cost FROM public.items WHERE id = _so_line.item_id;
      INSERT INTO public.stock_movements
        (tenant_id, item_id, movement_type, quantity, unit_cost, movement_date, reference_type, reference_id, created_by)
      VALUES (_tenant, _so_line.item_id, 'delivery', -_quantity, _cost, CURRENT_DATE, 'delivery_note', _dn_id, auth.uid());
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.so_lines WHERE so_id = _so_id AND quantity_delivered < quantity
  ) THEN
    UPDATE public.sales_orders SET status = 'delivered' WHERE id = _so_id;
  ELSE
    UPDATE public.sales_orders SET status = 'partially_delivered' WHERE id = _so_id;
  END IF;

  -- Le déclencheur de statut voit les lignes et peut préparer la facture (brouillon).
  UPDATE public.delivery_notes SET status = 'completed' WHERE id = _dn_id;
  PERFORM public.notify_sales(_tenant, 'info', 'Livraison enregistrée', _dn_number || ' pour ' || _s.so_number, _dn_id::text);
  RETURN _dn_id;
END;
$function$;

-- ─── 5. Facture issue d'une livraison : brouillon avec les lignes livrées ───
CREATE OR REPLACE FUNCTION public.draft_invoice_from_delivery(_dn public.delivery_notes, _created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid := gen_random_uuid();
  _date date := COALESCE(_dn.delivery_date, CURRENT_DATE);
  _terms integer;
BEGIN
  SELECT payment_terms INTO _terms FROM public.customers WHERE id = _dn.customer_id AND tenant_id = _dn.tenant_id;
  INSERT INTO public.ar_invoices (id, tenant_id, invoice_number, customer_id, invoice_date, due_date,
                                  subtotal, tax_amount, amount_paid, status, so_id, dn_id, created_by)
  VALUES (_id, _dn.tenant_id, 'BROUILLON-' || upper(substr(_id::text, 1, 8)), _dn.customer_id, _date,
          _date + COALESCE(_terms, 30), 0, 0, 0, 'draft', _dn.so_id, _dn.id, _created_by);
  -- Codes TVA laissés vides : le comptable les choisit avant d'émettre (taux validés localement).
  INSERT INTO public.ar_invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price)
  SELECT _dn.tenant_id, _id, row_number() OVER (ORDER BY l.created_at, l.id),
         COALESCE(NULLIF(btrim(l.description), ''), 'Article livré'), l.quantity, l.unit_price
    FROM public.dn_lines l
   WHERE l.dn_id = _dn.id AND l.quantity > 0;
  RETURN _id;
END; $function$;

REVOKE ALL ON FUNCTION public.draft_invoice_from_delivery(public.delivery_notes, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.auto_invoice_on_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _auto boolean;
  _inv_id uuid;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN RETURN NEW; END IF;
  IF NEW.ar_invoice_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT auto_invoice_on_delivery INTO _auto FROM public.sales_settings WHERE tenant_id = NEW.tenant_id;
  IF NOT COALESCE(_auto, false) THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dn_lines WHERE dn_id = NEW.id AND quantity > 0) THEN RETURN NEW; END IF;
  _inv_id := public.draft_invoice_from_delivery(NEW, NEW.created_by);
  NEW.ar_invoice_id := _inv_id;
  PERFORM public.notify_sales(NEW.tenant_id, 'info', 'Facture à émettre',
    'Brouillon préparé depuis ' || NEW.dn_number || ' : choisir les codes TVA puis émettre', _inv_id::text);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.invoice_from_delivery(_dn_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _dn public.delivery_notes%ROWTYPE;
  _inv_id uuid;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'invoice') THEN
    RAISE EXCEPTION 'Droit insuffisant : facturer les livraisons' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _dn FROM public.delivery_notes WHERE id = _dn_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Livraison introuvable dans la société active'; END IF;
  IF _dn.ar_invoice_id IS NOT NULL THEN RAISE EXCEPTION 'Cette livraison est déjà facturée'; END IF;
  IF _dn.status <> 'completed' THEN RAISE EXCEPTION 'La livraison doit être validée avant facturation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dn_lines WHERE dn_id = _dn_id AND quantity > 0) THEN
    RAISE EXCEPTION 'Livraison sans ligne à facturer';
  END IF;
  _inv_id := public.draft_invoice_from_delivery(_dn, auth.uid());
  UPDATE public.delivery_notes SET ar_invoice_id = _inv_id WHERE id = _dn_id;
  PERFORM public.notify_sales(_tenant, 'info', 'Facture à émettre',
    'Brouillon préparé depuis ' || _dn.dn_number || ' : choisir les codes TVA puis émettre', _inv_id::text);
  RETURN _inv_id;
END $function$;
