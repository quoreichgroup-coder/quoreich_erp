-- V41 — Cycle de vie des factures fournisseurs, paramètres appliqués, séparation des tâches
-- (Lot 3, étapes 2 et 4 pour l'AP). Écrit à la main.
--
-- Constaté le 14 nov. 2026 (audit des paramètres) : aucun droit « ap.* » au catalogue ; une
-- facture s'approuvait par simple mise à jour, par n'importe quel membre, y compris son auteur ;
-- les seuils (ap_approval_thresholds L1 à L4), « bon de commande requis » (po_required),
-- « rapprochement à 3 voies » (three_way_match), « réception avant facture »
-- (procurement_settings.require_gr_before_ap) et ses tolérances n'étaient lus par personne ; rien
-- n'empêchait d'enregistrer deux fois la même facture d'un fournisseur.
--
-- Cycle (SAP MIRO + libération ; Sage X3 bon à payer) :
--   brouillon (« draft ») → soumise (« submitted », niveaux selon les seuils de la société)
--     → approuvée niveau par niveau, dans l'ordre, par des tiers habilités → « approved » (la
--       facture passe « open » et se comptabilise, V37)
--     → ou rejetée (motif) → « rejected », de nouveau modifiable, puis resoumise.
-- Contrôles à la soumission (SQLSTATE QG008), lus dans les paramètres de la société :
--   - po_required = 'mandatory' : la facture cite une commande (de son fournisseur, V36) ;
--   - require_gr_before_ap : cette commande a au moins une réception validée ;
--   - three_way_match : le montant HT ne dépasse pas la valeur reçue non encore facturée de la
--     commande (quantités reçues × prix de commande, moins les autres factures de la commande),
--     au-delà de la tolérance la plus large entre three_way_tolerance_pct et
--     three_way_tolerance_amount.
-- Droits : ap.approve_l1 … ap.approve_l4 (niveau n plafonné à 4) ; l'auteur n'approuve jamais sa
-- facture, même administrateur ; une même personne ne valide pas deux niveaux.
-- En base, côté utilisateur, statut d'approbation, statut et écriture ne changent que par ces
-- fonctions ; une facture ne se modifie ou ne se supprime qu'en brouillon ou rejetée.
-- Unicité : une société n'enregistre pas deux fois le même numéro de facture d'un fournisseur.
--
-- Jumelle : supabase/migrations/20261114140000_7c1e4a9d-2b6f-4e8a-9d3c-5f0b1a7e2c84.sql

-- ─── Droits du catalogue ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
SELECT v.code, 'ap', v.action, v.label FROM (VALUES
  ('ap.approve_l1', 'approve_l1', 'Approuver les factures fournisseurs — niveau 1'),
  ('ap.approve_l2', 'approve_l2', 'Approuver les factures fournisseurs — niveau 2'),
  ('ap.approve_l3', 'approve_l3', 'Approuver les factures fournisseurs — niveau 3'),
  ('ap.approve_l4', 'approve_l4', 'Approuver les factures fournisseurs — niveau 4')) AS v(code, action, label)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT r, p FROM (VALUES
  ('admin', 'ap.approve_l1'), ('admin', 'ap.approve_l2'), ('admin', 'ap.approve_l3'), ('admin', 'ap.approve_l4'),
  ('accountant', 'ap.approve_l1'),
  ('manager', 'ap.approve_l1'), ('manager', 'ap.approve_l2')) AS v(r, p)
WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;

-- Sociétés existantes : leurs rôles système reçoivent les mêmes droits. guard_system_roles (V23)
-- ne laisse passer que l'alimentation explicite depuis le référentiel (drapeau de session, local à
-- la transaction, retiré aussitôt).
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code LIKE 'ap.approve_l%' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── Statut d'approbation : brouillon par défaut ───
ALTER TABLE public.ap_invoices ALTER COLUMN approval_status SET DEFAULT 'draft';
UPDATE public.ap_invoices SET approval_status = 'draft'
 WHERE approval_status = 'pending' AND journal_entry_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.ap_invoice_id = ap_invoices.id);

-- ─── Unicité fournisseur + numéro de facture ───
CREATE UNIQUE INDEX ap_invoices_supplier_number_key ON public.ap_invoices (tenant_id, supplier_id, lower(btrim(invoice_number)));

-- ─── File d'approbation des factures ───
CREATE TABLE public.ap_invoice_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.ap_invoices(id) ON DELETE CASCADE,
  level_order integer NOT NULL CHECK (level_order BETWEEN 1 AND 9),
  level_label text NOT NULL,
  approver_label text,
  amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  decided_by uuid,
  decided_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, level_order)
);
CREATE INDEX ap_invoice_approvals_tenant_idx ON public.ap_invoice_approvals (tenant_id, status);
ALTER TABLE public.ap_invoice_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.ap_invoice_approvals FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.ap_invoice_approvals TO authenticated;

-- ─── Lecture contrôlée d'une facture de la société de l'appelant ───
CREATE FUNCTION public.ap_invoice_for_caller(_id uuid) RETURNS public.ap_invoices
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _inv public.ap_invoices%ROWTYPE;
BEGIN
  SELECT * INTO _inv FROM public.ap_invoices WHERE id = _id;
  IF NOT FOUND OR _inv.tenant_id IS DISTINCT FROM public.get_user_tenant_id(auth.uid()) THEN
    RAISE EXCEPTION 'Facture fournisseur introuvable dans la société' USING ERRCODE = '22023';
  END IF;
  RETURN _inv;
END $$;
REVOKE ALL ON FUNCTION public.ap_invoice_for_caller(uuid) FROM PUBLIC, anon, authenticated;

-- ─── Soumission : contrôles des paramètres, puis file selon les seuils ───
CREATE FUNCTION public.ap_invoice_submit(_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    SELECT COALESCE(sum(gl.quantity_received * pl.unit_cost), 0) INTO _recu
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
END $$;
REVOKE ALL ON FUNCTION public.ap_invoice_submit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ap_invoice_submit(uuid) TO authenticated;

-- ─── Décision d'un niveau ───
CREATE FUNCTION public.ap_invoice_decide(_approval_id uuid, _approve boolean, _comment text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _a public.ap_invoice_approvals%ROWTYPE;
  _inv public.ap_invoices%ROWTYPE;
  _perm text;
BEGIN
  SELECT * INTO _a FROM public.ap_invoice_approvals WHERE id = _approval_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Étape d''approbation introuvable' USING ERRCODE = '22023'; END IF;
  _inv := public.ap_invoice_for_caller(_a.invoice_id);
  IF _a.status <> 'pending' OR _inv.approval_status <> 'submitted' THEN
    RAISE EXCEPTION 'Étape % déjà décidée ou facture % non soumise', _a.level_label, _inv.invoice_number USING ERRCODE = 'QG008';
  END IF;
  IF NOT _approve AND (_comment IS NULL OR btrim(_comment) = '') THEN
    RAISE EXCEPTION 'Motif de rejet obligatoire' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ap_invoice_approvals x WHERE x.invoice_id = _a.invoice_id AND x.status = 'pending'
               AND x.level_order < _a.level_order) THEN
    RAISE EXCEPTION 'Les niveaux précédents de la facture % ne sont pas encore approuvés', _inv.invoice_number USING ERRCODE = 'QG008';
  END IF;
  IF auth.uid() = _inv.created_by THEN
    RAISE EXCEPTION 'Séparation des tâches : vous ne pouvez pas décider de la facture % que vous avez saisie', _inv.invoice_number
      USING ERRCODE = 'QG008';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ap_invoice_approvals x WHERE x.invoice_id = _a.invoice_id AND x.status = 'approved'
               AND x.decided_by = auth.uid()) THEN
    RAISE EXCEPTION 'Séparation des tâches : vous avez déjà approuvé un niveau de la facture %', _inv.invoice_number USING ERRCODE = 'QG008';
  END IF;
  _perm := 'ap.approve_l' || least(_a.level_order, 4)::text;
  IF NOT public.has_permission(auth.uid(), _perm) THEN
    RAISE EXCEPTION 'Droit insuffisant : le niveau % (%) demande le droit %', _a.level_label, _a.approver_label, _perm
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.ap_invoice_approvals
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now(),
         comment = NULLIF(btrim(_comment), '')
   WHERE id = _approval_id;

  IF NOT _approve THEN
    UPDATE public.ap_invoice_approvals SET status = 'skipped', decided_at = now()
     WHERE invoice_id = _a.invoice_id AND status = 'pending';
    UPDATE public.ap_invoices SET approval_status = 'rejected' WHERE id = _a.invoice_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.ap_invoice_approvals x WHERE x.invoice_id = _a.invoice_id AND x.status = 'pending') THEN
    -- Dernier niveau : la facture est approuvée et comptabilisée (on_ap_invoice_posted, V37).
    UPDATE public.ap_invoices SET approval_status = 'approved', status = 'open' WHERE id = _a.invoice_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.ap_invoice_decide(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ap_invoice_decide(uuid, boolean, text) TO authenticated;

-- ─── Garde : côté utilisateur, cycle par les fonctions ; modification en brouillon ou rejetée ───
CREATE FUNCTION public.guard_ap_invoice_lifecycle() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.approval_status NOT IN ('draft', 'pending') OR NEW.journal_entry_id IS NOT NULL OR NEW.status NOT IN ('draft') THEN
      RAISE EXCEPTION 'Une facture fournisseur se crée en brouillon, puis se soumet à approbation' USING ERRCODE = 'QG008';
    END IF;
    NEW.approval_status := 'draft';
    RETURN NEW;
  END IF;
  IF OLD.approval_status NOT IN ('draft', 'rejected', 'pending') THEN
    RAISE EXCEPTION 'Facture « % » : seule une facture en brouillon ou rejetée se modifie ou se supprime', OLD.approval_status
      USING ERRCODE = 'QG008';
  END IF;
  IF TG_OP = 'UPDATE' AND ((NEW.approval_status, NEW.status, NEW.journal_entry_id, NEW.amount_paid)
                            IS DISTINCT FROM (OLD.approval_status, OLD.status, OLD.journal_entry_id, OLD.amount_paid)) THEN
    RAISE EXCEPTION 'Le statut d''une facture fournisseur change par soumission, approbation ou rejet' USING ERRCODE = 'QG008';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard_ap_invoice_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON public.ap_invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_ap_invoice_lifecycle();

-- ─── Réception en attente : supprimable (ses lignes partent avec elle) ───
-- guard_goods_receipt (V34) refuse déjà la suppression d'une réception validée ; une réception en
-- attente se supprime, ses lignes suivent par cascade (gr_lines_gr_id_fkey ON DELETE CASCADE).
