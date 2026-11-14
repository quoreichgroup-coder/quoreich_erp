-- V52 — Retour fournisseur et avoir fournisseur (audit G-13, Lot 3 ; références : SAP retour de
-- livraison (mvt 122) sur l'entrée de marchandises puis avoir fournisseur MIRO ; Sage 300 / X3
-- « retour fournisseur » lié à la réception, puis « avoir fournisseur » lié à la facture).
--
-- Retour fournisseur : create_supplier_return(réception, motif, date, [{gr_line_id, quantity}],
--   remplacement attendu, facture à créditer, référence de l'avoir du fournisseur)
--   · réception validée de la société ; quantité ≤ reçu − déjà retourné, par ligne ; motif obligatoire ;
--     date dans une période ouverte des achats ; droit procurement.return ;
--   · article stocké : mouvement « supplier_return » (sortie) au coût de la ligne de commande, donc
--     DR Variation des stocks / CR Stocks en inventaire permanent (V51) — jamais le compte fournisseur ;
--   · remplacement attendu : la quantité redevient à recevoir sur la commande (statut repassé à
--     « partiellement reçue ») ; sinon la ligne reste soldée ;
--   · rapprochement à 3 voies : le reçu facturable est net de tous les retours ;
--   · facture fournisseur citée (même commande, approuvée) : avoir fournisseur créé aussitôt pour
--     quantité × coût de commande, TVA au taux moyen de la facture ; sinon avoir « à recevoir »,
--     établi plus tard par credit_supplier_return.
--
-- Avoir fournisseur : create_ap_credit_note(facture, motif, date, HT, TVA, référence fournisseur)
--   · facture approuvée de la société ; Σ avoirs ≤ facture (HT et TVA séparément) ; droit ap.credit_note ;
--   · numéro légal AVF-YYYY-#### (série « ap_credit_note ») ; écriture miroir de la facture (V37) au
--     journal des achats AC : DR Fournisseurs (TTC) / CR Achats (HT) / CR TVA récupérable (TVA) ;
--   · imputé sur le reste dû de la facture par une ligne de règlement « ap_credit » (le reste dû,
--     la balance âgée et les règlements la voient) ; le surplus (facture déjà payée) reste un crédit
--     fournisseur non imputé (amount_allocated < total) ;
--   · une imputation d'avoir ne se saisit pas directement et ne s'annule pas comme un paiement.
-- Erreurs métier : QG014.

-- ─── Droits ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('procurement.return', 'procurement', 'return', 'Retourner des marchandises au fournisseur'),
  ('ap.credit_note', 'ap', 'credit_note', 'Enregistrer un avoir fournisseur')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES ('admin', 'procurement.return'), ('procurement_controller', 'procurement.return'),
                             ('procurement_l2', 'procurement.return'), ('procurement_l3', 'procurement.return'),
                             ('inventory_manager', 'procurement.return'),
                             ('admin', 'ap.credit_note'), ('accountant', 'ap.credit_note')) AS v(r, p)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code IN ('procurement.return', 'ap.credit_note') AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── Tables ───
CREATE TABLE public.ap_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  credit_note_number text NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.ap_invoices(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  supplier_reference text,
  credit_date date NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  subtotal numeric(18,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total numeric(18,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  amount_allocated numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount_allocated >= 0),
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap_credit_notes_tenant_number_key UNIQUE (tenant_id, credit_note_number),
  CONSTRAINT ap_credit_notes_allocated_check CHECK (amount_allocated <= total)
);
CREATE INDEX ap_credit_notes_invoice_idx ON public.ap_credit_notes (invoice_id);
CREATE INDEX ap_credit_notes_supplier_idx ON public.ap_credit_notes (tenant_id, supplier_id);

CREATE TABLE public.supplier_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  return_number text NOT NULL,
  gr_id uuid NOT NULL REFERENCES public.goods_receipts(id),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  return_date date NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  replacement_expected boolean NOT NULL DEFAULT false,
  total_value numeric(18,2) NOT NULL DEFAULT 0,
  credit_note_id uuid UNIQUE REFERENCES public.ap_credit_notes(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_returns_tenant_number_key UNIQUE (tenant_id, return_number)
);
CREATE INDEX supplier_returns_gr_idx ON public.supplier_returns (gr_id);
CREATE INDEX supplier_returns_po_idx ON public.supplier_returns (po_id);

CREATE TABLE public.supplier_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  return_id uuid NOT NULL REFERENCES public.supplier_returns(id) ON DELETE CASCADE,
  gr_line_id uuid NOT NULL REFERENCES public.gr_lines(id),
  po_line_id uuid NOT NULL REFERENCES public.po_lines(id),
  item_id uuid REFERENCES public.items(id),
  description text,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL DEFAULT 0,
  replacement_expected boolean NOT NULL DEFAULT false
);
CREATE INDEX supplier_return_lines_gr_line_idx ON public.supplier_return_lines (gr_line_id);
CREATE INDEX supplier_return_lines_po_line_idx ON public.supplier_return_lines (po_line_id);
CREATE INDEX supplier_return_lines_return_idx ON public.supplier_return_lines (return_id);

ALTER TABLE public.ap_credit_notes ADD COLUMN supplier_return_id uuid REFERENCES public.supplier_returns(id);
ALTER TABLE public.payments ADD COLUMN source_ap_credit_note_id uuid REFERENCES public.ap_credit_notes(id);

-- Lecture pour la société ; aucune écriture directe : tout passe par les fonctions.
ALTER TABLE public.ap_credit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ap_credit_notes FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.ap_credit_notes TO authenticated;
ALTER TABLE public.supplier_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.supplier_returns FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.supplier_returns TO authenticated;
ALTER TABLE public.supplier_return_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.supplier_return_lines FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.supplier_return_lines TO authenticated;

-- ─── Quantités retournées d'une ligne de commande ───
CREATE OR REPLACE FUNCTION public.po_line_returned(_po_line uuid, _replacement_only boolean)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(quantity), 0) FROM public.supplier_return_lines
   WHERE po_line_id = _po_line AND (NOT _replacement_only OR replacement_expected)
$function$;

-- ─── Journal : l'avoir fournisseur va au journal des achats ───
CREATE OR REPLACE FUNCTION public.journal_for_source(_source text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _source
    WHEN 'ar_invoice' THEN 'VT'
    WHEN 'ar_credit_note' THEN 'VT'
    WHEN 'ap_invoice' THEN 'AC'
    WHEN 'ap_credit_note' THEN 'AC'
    WHEN 'ar_receipt' THEN 'BQ'
    WHEN 'ar_advance' THEN 'BQ'
    WHEN 'ar_refund' THEN 'BQ'
    WHEN 'ap_payment' THEN 'BQ'
    WHEN 'treasury' THEN 'BQ'
    WHEN 'payroll' THEN 'PA'
    ELSE 'OD'
  END
$function$;

-- ─── Réception : un retour avec remplacement redevient à recevoir ───
CREATE OR REPLACE FUNCTION public.on_gr_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _po public.purchase_orders%ROWTYPE;
  _ligne record;
  _lignes integer;
  _restant numeric;
BEGIN
  -- En-tête figé et création « en attente » : garde_goods_receipt (BEFORE). Ici, la validation.
  IF TG_OP <> 'UPDATE' OR NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _po FROM public.purchase_orders WHERE id = NEW.po_id FOR UPDATE;
  IF NOT FOUND OR _po.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Réception % : commande introuvable', NEW.gr_number USING ERRCODE = 'QG004';
  END IF;
  IF _po.status NOT IN ('approved', 'ordered', 'partially_received') THEN
    RAISE EXCEPTION 'Réception refusée : la commande % est « % » (approuvée, commandée ou partiellement reçue requise)',
      _po.po_number, _po.status USING ERRCODE = 'QG004';
  END IF;

  -- La réception est datée : elle tombe dans une période ouverte des achats (calendrier V33).
  PERFORM public.assert_fiscal_period_open(NEW.tenant_id, NEW.receipt_date, 'PURCHASING');

  SELECT count(*) INTO _lignes FROM public.gr_lines WHERE gr_id = NEW.id;
  IF _lignes = 0 THEN
    RAISE EXCEPTION 'Réception % sans ligne', NEW.gr_number USING ERRCODE = 'QG004';
  END IF;

  -- Chaque ligne reçue se rapporte à une ligne de CETTE commande, sans dépasser le restant dû.
  FOR _ligne IN
    SELECT gl.id, gl.po_line_id, gl.item_id AS gr_item, gl.quantity_received, gl.quantity_rejected, pl.po_id, pl.quantity AS commande,
           pl.item_id, pl.unit_cost, pl.description,
           COALESCE((SELECT sum(g2.quantity_received) FROM public.gr_lines g2
                       JOIN public.goods_receipts r2 ON r2.id = g2.gr_id
                      WHERE g2.po_line_id = gl.po_line_id AND r2.status = 'completed' AND r2.id <> NEW.id), 0)
             - public.po_line_returned(gl.po_line_id, true) AS deja_recu
    FROM public.gr_lines gl
    LEFT JOIN public.po_lines pl ON pl.id = gl.po_line_id
    WHERE gl.gr_id = NEW.id
  LOOP
    IF _ligne.po_line_id IS NULL OR _ligne.po_id IS DISTINCT FROM NEW.po_id THEN
      RAISE EXCEPTION 'Réception % : chaque ligne doit se rapporter à une ligne de la commande %', NEW.gr_number, _po.po_number
        USING ERRCODE = 'QG004';
    END IF;
    IF _ligne.gr_item IS NOT NULL AND _ligne.item_id IS NOT NULL AND _ligne.gr_item <> _ligne.item_id THEN
      RAISE EXCEPTION 'Réception % : l''article reçu diffère de celui de la ligne de commande « % »', NEW.gr_number,
        COALESCE(_ligne.description, 'ligne') USING ERRCODE = 'QG004';
    END IF;
    IF COALESCE(_ligne.quantity_received, 0) < 0 OR COALESCE(_ligne.quantity_rejected, 0) < 0 THEN
      RAISE EXCEPTION 'Réception % : quantités négatives refusées', NEW.gr_number USING ERRCODE = 'QG004';
    END IF;
    _restant := _ligne.commande - _ligne.deja_recu;
    IF _ligne.quantity_received > _restant THEN
      RAISE EXCEPTION 'Sur-réception refusée (« % ») : commandé %, déjà reçu %, reçu maintenant %',
        COALESCE(_ligne.description, 'ligne'), _ligne.commande, _ligne.deja_recu, _ligne.quantity_received
        USING ERRCODE = 'QG004';
    END IF;
  END LOOP;

  -- Stock : un seul mouvement par ligne, valorisé au coût de la commande ; apply_stock_movement met
  -- à jour la quantité et le coût moyen (plus de mise à jour directe de items).
  INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, unit_cost, movement_date,
                                      reference_type, reference_id, created_by)
  SELECT NEW.tenant_id, COALESCE(gl.item_id, pl.item_id), 'receipt', gl.quantity_received, COALESCE(pl.unit_cost, 0),
         COALESCE(NEW.receipt_date, CURRENT_DATE), 'goods_receipt', NEW.id, NEW.received_by
  FROM public.gr_lines gl
  JOIN public.po_lines pl ON pl.id = gl.po_line_id
  WHERE gl.gr_id = NEW.id AND COALESCE(gl.item_id, pl.item_id) IS NOT NULL AND gl.quantity_received > 0;

  -- Statut de la commande : entièrement reçue ou partiellement reçue.
  UPDATE public.purchase_orders p
     SET status = CASE WHEN NOT EXISTS (
           SELECT 1 FROM public.po_lines pl
            WHERE pl.po_id = p.id
              AND pl.quantity > COALESCE((SELECT sum(g.quantity_received) FROM public.gr_lines g
                                            JOIN public.goods_receipts r ON r.id = g.gr_id
                                           WHERE g.po_line_id = pl.id AND r.status = 'completed'), 0)
                                - public.po_line_returned(pl.id, true)
         ) THEN 'received' ELSE 'partially_received' END
   WHERE p.id = NEW.po_id;
  RETURN NEW;
END;
$function$;

-- ─── Rapprochement à 3 voies : reçu net des retours ───
CREATE OR REPLACE FUNCTION public.ap_invoice_submit(_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _inv public.ap_invoices%ROWTYPE := public.ap_invoice_for_caller(_id);
  _po_required text;
  _three_way boolean;
  _gr_required boolean;
  _tol_pct numeric;
  _tol_amount numeric;
  _recu numeric;
  _deja numeric;
  _reste numeric;
  _tol numeric;
  _t record;
  _n integer := 0;
BEGIN
  IF _inv.approval_status NOT IN ('draft', 'rejected', 'pending') THEN
    RAISE EXCEPTION 'La facture % est « % » : seule une facture en brouillon ou rejetée se soumet',
      _inv.invoice_number, _inv.approval_status USING ERRCODE = 'QG008';
  END IF;
  IF COALESCE(_inv.subtotal, 0) <= 0 THEN
    RAISE EXCEPTION 'La facture % n''a pas de montant HT', _inv.invoice_number USING ERRCODE = 'QG008';
  END IF;

  SELECT g.po_required, g.three_way_match INTO _po_required, _three_way
    FROM public.ap_general_settings g WHERE g.tenant_id = _inv.tenant_id;
  SELECT s.require_gr_before_ap, s.three_way_tolerance_pct, s.three_way_tolerance_amount
    INTO _gr_required, _tol_pct, _tol_amount
    FROM public.procurement_settings s WHERE s.tenant_id = _inv.tenant_id;

  IF COALESCE(_po_required, 'optional') = 'mandatory' AND _inv.po_id IS NULL THEN
    RAISE EXCEPTION 'La société exige un bon de commande : la facture % doit citer la commande du fournisseur', _inv.invoice_number
      USING ERRCODE = 'QG008', HINT = 'Paramètres fournisseurs : « bon de commande requis ».';
  END IF;

  IF _inv.po_id IS NOT NULL THEN
    -- Reçu facturable : net de tous les retours fournisseurs (V52).
    SELECT COALESCE(sum(gl.quantity_received * pl.unit_cost), 0)
           - COALESCE((SELECT sum(rl.quantity * rl.unit_cost) FROM public.supplier_return_lines rl
                         JOIN public.supplier_returns sr ON sr.id = rl.return_id WHERE sr.po_id = _inv.po_id), 0) INTO _recu
      FROM public.gr_lines gl
      JOIN public.goods_receipts g ON g.id = gl.gr_id AND g.status = 'completed'
      JOIN public.po_lines pl ON pl.id = gl.po_line_id
     WHERE g.po_id = _inv.po_id;
    IF COALESCE(_gr_required, false) AND _recu = 0 THEN
      RAISE EXCEPTION 'La société exige une réception avant la facture : la commande citée par % n''a aucune réception validée',
        _inv.invoice_number USING ERRCODE = 'QG008', HINT = 'Paramètres des achats : « réception avant facture ».';
    END IF;
    IF COALESCE(_three_way, false) THEN
      SELECT COALESCE(sum(a.subtotal), 0) INTO _deja FROM public.ap_invoices a
       WHERE a.po_id = _inv.po_id AND a.id <> _inv.id AND a.approval_status IN ('submitted', 'approved');
      _reste := _recu - _deja;
      _tol := greatest(COALESCE(_tol_amount, 0), _reste * COALESCE(_tol_pct, 0) / 100);
      IF _inv.subtotal > _reste + _tol THEN
        RAISE EXCEPTION 'Rapprochement à 3 voies : % HT facturé pour % reçu non encore facturé (tolérance %) sur la commande',
          _inv.subtotal, _reste, round(_tol, 2) USING ERRCODE = 'QG008',
          HINT = 'Facturer au plus la valeur reçue, ou réceptionner le reste de la commande.';
      END IF;
    END IF;
  END IF;

  DELETE FROM public.ap_invoice_approvals WHERE invoice_id = _id;
  FOR _t IN
    SELECT * FROM public.ap_approval_thresholds
     WHERE tenant_id = _inv.tenant_id AND (doc_types ILIKE '%facture%' OR doc_types ILIKE '%tous%')
     ORDER BY max_amount NULLS LAST, level
  LOOP
    _n := _n + 1;
    INSERT INTO public.ap_invoice_approvals (tenant_id, invoice_id, level_order, level_label, approver_label, amount)
    VALUES (_inv.tenant_id, _id, _n, _t.level, _t.approver, _inv.total);
    EXIT WHEN _t.max_amount IS NULL OR _inv.total <= _t.max_amount OR _n = 9;
  END LOOP;
  IF _n = 0 THEN
    INSERT INTO public.ap_invoice_approvals (tenant_id, invoice_id, level_order, level_label, approver_label, amount)
    VALUES (_inv.tenant_id, _id, 1, 'L1', 'Approbateur niveau 1', _inv.total);
    _n := 1;
  END IF;

  UPDATE public.ap_invoices SET approval_status = 'submitted' WHERE id = _id;
  RETURN _n;
END $function$;

-- ─── Règlements : imputation d'un avoir fournisseur ───
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
    IF OLD.payment_type NOT IN ('ap_payment', 'ap_credit') OR OLD.ap_invoice_id IS NULL THEN RETURN OLD; END IF;
    _inv_id := OLD.ap_invoice_id;
  ELSE
    IF NEW.payment_type NOT IN ('ap_payment', 'ap_credit') OR NEW.ap_invoice_id IS NULL THEN RETURN NEW; END IF;
    _inv_id := NEW.ap_invoice_id;
  END IF;

  SELECT total, due_date INTO _total, _due FROM public.ap_invoices WHERE id = _inv_id;
  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments
   WHERE ap_invoice_id = _inv_id AND payment_type IN ('ap_payment', 'ap_credit');

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
  ELSIF NEW.payment_type = 'ap_credit' THEN
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
  IF _p.payment_type IN ('ar_credit', 'ar_advance', 'ap_credit') THEN
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

-- ─── Avoir fournisseur ───
CREATE OR REPLACE FUNCTION public.create_ap_credit_note(_invoice_id uuid, _reason text, _credit_date date,
                                                       _subtotal numeric, _tax_amount numeric,
                                                       _supplier_reference text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _inv public.ap_invoices%ROWTYPE;
  _date date := COALESCE(_credit_date, CURRENT_DATE);
  _sub numeric := ROUND(COALESCE(_subtotal, 0), 2);
  _tax numeric := ROUND(COALESCE(_tax_amount, 0), 2);
  _total numeric;
  _done_sub numeric; _done_tax numeric;
  _payable uuid; _purchases uuid; _vat uuid;
  _id uuid := gen_random_uuid();
  _number text; _entry uuid; _alloc numeric;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Aucune société active' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_permission(auth.uid(), 'ap.credit_note') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'ap.credit_note')
      USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Motif de l''avoir obligatoire' USING ERRCODE = 'QG014';
  END IF;
  SELECT * INTO _inv FROM public.ap_invoices WHERE id = _invoice_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facture fournisseur introuvable dans la société active' USING ERRCODE = 'QG014'; END IF;
  IF _inv.approval_status <> 'approved' OR _inv.status NOT IN ('open', 'partially_paid', 'overdue', 'paid') THEN
    RAISE EXCEPTION 'Seule une facture fournisseur approuvée se crédite (facture %)', _inv.invoice_number
      USING ERRCODE = 'QG014';
  END IF;
  IF _sub < 0 OR _tax < 0 OR _sub + _tax <= 0 THEN
    RAISE EXCEPTION 'Montants de l''avoir invalides (HT %, TVA %)', _sub, _tax USING ERRCODE = 'QG014';
  END IF;
  SELECT COALESCE(sum(subtotal), 0), COALESCE(sum(tax_amount), 0) INTO _done_sub, _done_tax
    FROM public.ap_credit_notes WHERE invoice_id = _invoice_id;
  IF _done_sub + _sub > _inv.subtotal THEN
    RAISE EXCEPTION 'HT des avoirs (%) supérieur au HT de la facture % (%)', _done_sub + _sub, _inv.invoice_number, _inv.subtotal
      USING ERRCODE = 'QG014';
  END IF;
  IF _done_tax + _tax > _inv.tax_amount THEN
    RAISE EXCEPTION 'TVA des avoirs (%) supérieure à la TVA de la facture % (%)', _done_tax + _tax, _inv.invoice_number, _inv.tax_amount
      USING ERRCODE = 'QG014';
  END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AP');
  _total := _sub + _tax;

  _payable := public.require_posting_account(_tenant, 'AP_PAYABLE');
  IF _sub > 0 THEN _purchases := public.require_posting_account(_tenant, 'PURCHASES'); END IF;
  IF _tax > 0 THEN _vat := public.require_posting_account(_tenant, 'VAT_INPUT'); END IF;

  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _tenant, 'ap_credit_note', 'AVF-', 'AVF-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _tenant AND doc_type = 'ap_credit_note');
  _number := public.next_document_number(_tenant, 'ap_credit_note', _date);

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-AVF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(_id::text, 1, 8), _date,
          'Avoir fournisseur ' || _number || ' sur facture ' || _inv.invoice_number || ' — ' || btrim(_reason),
          'ap_credit_note', 'draft', auth.uid())
  RETURNING id INTO _entry;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry, _payable, _total, 0, 'DR Fournisseurs (avoir)');
  IF _sub > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry, _purchases, 0, _sub, 'CR Achats (avoir)');
  END IF;
  IF _tax > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry, _vat, 0, _tax, 'CR TVA récupérable (avoir)');
  END IF;
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;

  _alloc := LEAST(_total, GREATEST(_inv.total - _inv.amount_paid, 0));
  INSERT INTO public.ap_credit_notes (id, tenant_id, credit_note_number, invoice_id, supplier_id, supplier_reference, credit_date,
                                      reason, subtotal, tax_amount, total, amount_allocated, journal_entry_id, created_by)
  VALUES (_id, _tenant, _number, _invoice_id, _inv.supplier_id, NULLIF(btrim(COALESCE(_supplier_reference, '')), ''), _date,
          btrim(_reason), _sub, _tax, _total, _alloc, _entry, auth.uid());
  IF _alloc > 0 THEN
    INSERT INTO public.payments (tenant_id, payment_type, ap_invoice_id, amount, payment_date, payment_method,
                                 reference, journal_entry_id, created_by, source_ap_credit_note_id)
    VALUES (_tenant, 'ap_credit', _invoice_id, _alloc, _date, 'credit_note', _number, _entry, auth.uid(), _id);
  END IF;
  RETURN _id;
END; $function$;
REVOKE ALL ON FUNCTION public.create_ap_credit_note(uuid, text, date, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ap_credit_note(uuid, text, date, numeric, numeric, text) TO authenticated;

-- Avoir d'un retour : quantités retournées × coût de commande, TVA au taux moyen de la facture.
CREATE OR REPLACE FUNCTION public.credit_supplier_return(_return_id uuid, _invoice_id uuid, _supplier_reference text DEFAULT NULL,
                                                        _credit_date date DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _r public.supplier_returns%ROWTYPE;
  _inv public.ap_invoices%ROWTYPE;
  _tax numeric; _cn uuid;
BEGIN
  SELECT * INTO _r FROM public.supplier_returns WHERE id = _return_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retour fournisseur introuvable dans la société active' USING ERRCODE = 'QG014'; END IF;
  IF _r.credit_note_id IS NOT NULL THEN
    RAISE EXCEPTION 'Le retour % a déjà son avoir', _r.return_number USING ERRCODE = 'QG014';
  END IF;
  IF _r.total_value <= 0 THEN
    RAISE EXCEPTION 'Le retour % n''a pas de valeur à créditer', _r.return_number USING ERRCODE = 'QG014';
  END IF;
  SELECT * INTO _inv FROM public.ap_invoices WHERE id = _invoice_id AND tenant_id = _tenant;
  IF NOT FOUND OR _inv.po_id IS DISTINCT FROM _r.po_id THEN
    RAISE EXCEPTION 'La facture à créditer doit être une facture de la commande du retour' USING ERRCODE = 'QG014';
  END IF;
  _tax := CASE WHEN _inv.subtotal > 0 THEN ROUND(_r.total_value * _inv.tax_amount / _inv.subtotal, 2) ELSE 0 END;
  _cn := public.create_ap_credit_note(_invoice_id, 'Retour ' || _r.return_number || ' — ' || _r.reason,
                                      COALESCE(_credit_date, _r.return_date), _r.total_value, _tax, _supplier_reference);
  UPDATE public.ap_credit_notes SET supplier_return_id = _r.id WHERE id = _cn;
  UPDATE public.supplier_returns SET credit_note_id = _cn WHERE id = _r.id;
  RETURN _cn;
END; $function$;
REVOKE ALL ON FUNCTION public.credit_supplier_return(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_supplier_return(uuid, uuid, text, date) TO authenticated;

-- ─── Retour fournisseur ───
CREATE OR REPLACE FUNCTION public.create_supplier_return(_gr_id uuid, _reason text, _return_date date, _lines jsonb,
                                                        _replacement_expected boolean DEFAULT false,
                                                        _ap_invoice_id uuid DEFAULT NULL,
                                                        _supplier_reference text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _gr public.goods_receipts%ROWTYPE;
  _po public.purchase_orders%ROWTYPE;
  _date date := COALESCE(_return_date, CURRENT_DATE);
  _id uuid := gen_random_uuid();
  _l jsonb; _gl record; _qty numeric; _done numeric; _n integer := 0;
  _number text; _value numeric := 0; _item uuid;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Aucune société active' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_permission(auth.uid(), 'procurement.return') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'procurement.return')
      USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Motif du retour obligatoire' USING ERRCODE = 'QG014';
  END IF;
  SELECT * INTO _gr FROM public.goods_receipts WHERE id = _gr_id AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Réception introuvable dans la société active' USING ERRCODE = 'QG014'; END IF;
  IF _gr.status <> 'completed' THEN
    RAISE EXCEPTION 'Seule une réception validée se retourne (réception %)', _gr.gr_number USING ERRCODE = 'QG014';
  END IF;
  IF _date < _gr.receipt_date THEN
    RAISE EXCEPTION 'Le retour ne peut pas précéder la réception (%)', _gr.receipt_date USING ERRCODE = 'QG014';
  END IF;
  SELECT * INTO _po FROM public.purchase_orders WHERE id = _gr.po_id FOR UPDATE;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'PURCHASING');
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'Indiquer au moins une ligne à retourner' USING ERRCODE = 'QG014';
  END IF;

  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _tenant, 'supplier_return', 'RTF-', 'RTF-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _tenant AND doc_type = 'supplier_return');
  _number := public.next_document_number(_tenant, 'supplier_return', _date);
  INSERT INTO public.supplier_returns (id, tenant_id, return_number, gr_id, po_id, supplier_id, return_date, reason,
                                       replacement_expected, created_by)
  VALUES (_id, _tenant, _number, _gr.id, _gr.po_id, _po.supplier_id, _date, btrim(_reason),
          COALESCE(_replacement_expected, false), auth.uid());

  FOR _l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    SELECT gl.id, gl.quantity_received, gl.item_id, pl.id AS po_line_id, pl.item_id AS po_item, pl.unit_cost, pl.description
      INTO _gl
      FROM public.gr_lines gl JOIN public.po_lines pl ON pl.id = gl.po_line_id
     WHERE gl.id = (_l->>'gr_line_id')::uuid AND gl.gr_id = _gr.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ligne de retour étrangère à la réception %', _gr.gr_number USING ERRCODE = 'QG014';
    END IF;
    _qty := COALESCE((_l->>'quantity')::numeric, 0);
    IF _qty = 0 THEN CONTINUE; END IF;
    IF _qty < 0 THEN
      RAISE EXCEPTION 'Quantité retournée négative (« % »)', COALESCE(_gl.description, 'ligne') USING ERRCODE = 'QG014';
    END IF;
    SELECT COALESCE(sum(quantity), 0) INTO _done FROM public.supplier_return_lines WHERE gr_line_id = _gl.id;
    IF _done + _qty > _gl.quantity_received THEN
      RAISE EXCEPTION 'Retour supérieur au reçu non encore retourné pour « % » (reste %)', COALESCE(_gl.description, 'ligne'),
        _gl.quantity_received - _done USING ERRCODE = 'QG014';
    END IF;
    _item := COALESCE(_gl.item_id, _gl.po_item);
    _n := _n + 1;
    INSERT INTO public.supplier_return_lines (tenant_id, return_id, gr_line_id, po_line_id, item_id, description, quantity,
                                              unit_cost, replacement_expected)
    VALUES (_tenant, _id, _gl.id, _gl.po_line_id, _item, _gl.description, _qty, COALESCE(_gl.unit_cost, 0),
            COALESCE(_replacement_expected, false));
    _value := _value + ROUND(_qty * COALESCE(_gl.unit_cost, 0), 2);
    IF _item IS NOT NULL THEN
      INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, unit_cost, movement_date,
                                          reference_type, reference_id, created_by)
      VALUES (_tenant, _item, 'supplier_return', -_qty, COALESCE(_gl.unit_cost, 0), _date, 'supplier_return', _id, auth.uid());
    END IF;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Indiquer au moins une quantité à retourner' USING ERRCODE = 'QG014'; END IF;
  UPDATE public.supplier_returns SET total_value = _value WHERE id = _id;

  -- Remplacement attendu : la commande a de nouveau du reste à recevoir.
  IF COALESCE(_replacement_expected, false) AND _po.status = 'received' THEN
    UPDATE public.purchase_orders SET status = 'partially_received' WHERE id = _po.id;
  END IF;

  IF _ap_invoice_id IS NOT NULL THEN
    PERFORM public.credit_supplier_return(_id, _ap_invoice_id, _supplier_reference, _date);
  END IF;
  RETURN _id;
END; $function$;
REVOKE ALL ON FUNCTION public.create_supplier_return(uuid, text, date, jsonb, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_return(uuid, text, date, jsonb, boolean, uuid, text) TO authenticated;
