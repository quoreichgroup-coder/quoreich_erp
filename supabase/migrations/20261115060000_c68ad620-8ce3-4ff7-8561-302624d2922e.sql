-- V57 — Achats et fournisseurs paramétrables (demande du propriétaire : « rends plus flexible et
-- configurable »). Aucune règle de V54–V56 ne reste figée dans le code ; le comportement par défaut
-- est exactement celui livré, chaque société l'ajuste ensuite.
--
-- 1. Droits du catalogue au lieu de listes de rôles codées en dur — attribuables à tout rôle, y
--    compris les rôles personnalisés (Paramètres → Rôles et autorisations) :
--      suppliers.manage (créer / modifier une fiche), suppliers.delete, suppliers.verify_bank
--      (valider des coordonnées bancaires), procurement.followup (accusé de réception,
--      replanification), procurement.settings (paramètres des achats).
--    Accordés par défaut aux mêmes rôles qu'avant (aucun changement de comportement).
-- 2. Paramètres par société (procurement_settings), modifiables avec procurement.settings — avant,
--    tout membre pouvait modifier les paramètres des achats :
--      bank_dual_control (double contrôle des coordonnées bancaires, oui par défaut),
--      bank_control_methods (modes de paiement soumis au contrôle, virement par défaut),
--      followup_grace_days (tolérance avant « en retard », 0 par défaut),
--      default_lead_time_days (délai de livraison quand la fiche fournisseur n'en a pas),
--      replenishment_include_requisitions / replenishment_include_reservations (ce que compte le
--      stock prévisionnel : demandes d'achat ouvertes, commandes clients non livrées ; oui par défaut).

-- ─── 1. Droits ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('suppliers.manage', 'suppliers', 'manage', 'Créer et modifier les fiches fournisseurs'),
  ('suppliers.delete', 'suppliers', 'delete', 'Supprimer une fiche fournisseur'),
  ('suppliers.verify_bank', 'suppliers', 'verify_bank', 'Valider les coordonnées bancaires d''un fournisseur'),
  ('procurement.followup', 'procurement', 'followup', 'Suivre les livraisons fournisseurs (accusé de réception, replanification)'),
  ('procurement.settings', 'procurement', 'settings', 'Modifier les paramètres des achats')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES
  ('admin', 'suppliers.manage'), ('accountant', 'suppliers.manage'), ('procurement_controller', 'suppliers.manage'),
  ('procurement_l1', 'suppliers.manage'), ('procurement_l2', 'suppliers.manage'), ('procurement_l3', 'suppliers.manage'),
  ('admin', 'suppliers.delete'), ('accountant', 'suppliers.delete'),
  ('admin', 'suppliers.verify_bank'), ('accountant', 'suppliers.verify_bank'),
  ('admin', 'procurement.followup'), ('procurement_controller', 'procurement.followup'), ('procurement_l1', 'procurement.followup'),
  ('procurement_l2', 'procurement.followup'), ('procurement_l3', 'procurement.followup'),
  ('admin', 'procurement.settings')) AS v(r, p)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code IN ('suppliers.manage', 'suppliers.delete', 'suppliers.verify_bank', 'procurement.followup', 'procurement.settings')
   AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

DROP POLICY "Création habilitée" ON public.suppliers;
DROP POLICY "Modification habilitée" ON public.suppliers;
DROP POLICY "Suppression comptable" ON public.suppliers;
CREATE POLICY "Création habilitée" ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'suppliers.manage'));
CREATE POLICY "Modification habilitée" ON public.suppliers FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'suppliers.manage'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Suppression habilitée" ON public.suppliers FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'suppliers.delete'));

DROP POLICY "Lecture comptable" ON public.supplier_change_log;
CREATE POLICY "Lecture habilitée" ON public.supplier_change_log FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
         AND (public.has_permission(auth.uid(), 'suppliers.verify_bank') OR public.has_permission(auth.uid(), 'suppliers.delete')));

-- ─── 2. Paramètres ───
ALTER TABLE public.procurement_settings
  ADD COLUMN bank_dual_control boolean NOT NULL DEFAULT true,
  ADD COLUMN bank_control_methods text[] NOT NULL DEFAULT ARRAY['bank_transfer']::text[]
    CHECK (bank_control_methods <@ ARRAY['bank_transfer', 'check', 'cash', 'mobile_money']::text[]),
  ADD COLUMN followup_grace_days integer NOT NULL DEFAULT 0 CHECK (followup_grace_days BETWEEN 0 AND 365),
  ADD COLUMN default_lead_time_days integer NOT NULL DEFAULT 0 CHECK (default_lead_time_days BETWEEN 0 AND 3650),
  ADD COLUMN replenishment_include_requisitions boolean NOT NULL DEFAULT true,
  ADD COLUMN replenishment_include_reservations boolean NOT NULL DEFAULT true;

INSERT INTO public.procurement_settings (tenant_id)
SELECT t.id FROM public.tenants t
 WHERE NOT EXISTS (SELECT 1 FROM public.procurement_settings s WHERE s.tenant_id = t.id);

DROP POLICY tenant_isolation_procurement_settings ON public.procurement_settings;
CREATE POLICY "Lecture société" ON public.procurement_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Modification habilitée" ON public.procurement_settings FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Création habilitée" ON public.procurement_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.settings'));

-- Paramètres d'une société, valeurs par défaut si la ligne manque.
CREATE OR REPLACE FUNCTION public.procurement_setting(_tenant uuid)
 RETURNS public.procurement_settings
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.procurement_settings%ROWTYPE;
BEGIN
  SELECT * INTO _s FROM public.procurement_settings WHERE tenant_id = _tenant;
  IF NOT FOUND THEN
    _s.tenant_id := _tenant; _s.bank_dual_control := true; _s.bank_control_methods := ARRAY['bank_transfer'];
    _s.followup_grace_days := 0; _s.default_lead_time_days := 0;
    _s.replenishment_include_requisitions := true; _s.replenishment_include_reservations := true;
  END IF;
  RETURN _s;
END $function$;
REVOKE ALL ON FUNCTION public.procurement_setting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.procurement_setting(uuid) TO authenticated;

-- Double contrôle bancaire : selon le paramètre, droit du catalogue.
CREATE OR REPLACE FUNCTION public.verify_supplier_bank_details(_supplier_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _s public.suppliers%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'suppliers.verify_bank') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'suppliers.verify_bank')
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _s FROM public.suppliers WHERE id = _supplier_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fournisseur introuvable dans la société active' USING ERRCODE = 'QG018'; END IF;
  IF _s.bank_account IS NULL THEN RAISE EXCEPTION 'Aucune coordonnée bancaire à valider' USING ERRCODE = 'QG018'; END IF;
  IF _s.bank_verified THEN RAISE EXCEPTION 'Coordonnées bancaires déjà validées' USING ERRCODE = 'QG018'; END IF;
  IF (public.procurement_setting(_tenant)).bank_dual_control AND _s.bank_changed_by IS NOT DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Double contrôle : les coordonnées bancaires doivent être validées par une autre personne que celle qui les a saisies'
      USING ERRCODE = 'QG018';
  END IF;
  UPDATE public.suppliers SET bank_verified = true, bank_verified_by = auth.uid(), bank_verified_at = now() WHERE id = _supplier_id;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_supplier_bank_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s record;
  _p public.procurement_settings%ROWTYPE;
BEGIN
  IF NEW.payment_type <> 'ap_payment' OR NEW.ap_invoice_id IS NULL OR NEW.reversal_of IS NOT NULL THEN RETURN NEW; END IF;
  _p := public.procurement_setting(NEW.tenant_id);
  IF NOT _p.bank_dual_control OR NOT (COALESCE(NEW.payment_method, '') = ANY (_p.bank_control_methods)) THEN RETURN NEW; END IF;
  SELECT s.name, s.bank_account, s.bank_verified INTO _s
    FROM public.ap_invoices i JOIN public.suppliers s ON s.id = i.supplier_id WHERE i.id = NEW.ap_invoice_id;
  IF _s.bank_account IS NOT NULL AND NOT _s.bank_verified THEN
    RAISE EXCEPTION 'Paiement refusé : les coordonnées bancaires de « % » ont été modifiées et ne sont pas encore validées par une autre personne', _s.name
      USING ERRCODE = 'QG018', HINT = 'Fiche fournisseur → « Valider les coordonnées bancaires » (droit dédié, autre personne que l''auteur du changement).';
  END IF;
  RETURN NEW;
END $function$;

-- Suivi des commandes : droit du catalogue ; délai par défaut de la société.
CREATE OR REPLACE FUNCTION public.po_followup_target(_po_id uuid)
 RETURNS public.purchase_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _po public.purchase_orders%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'procurement.followup') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'procurement.followup')
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _po FROM public.purchase_orders WHERE id = _po_id AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable dans la société active' USING ERRCODE = 'QG018'; END IF;
  IF _po.status NOT IN ('approved', 'ordered', 'partially_received') THEN
    RAISE EXCEPTION 'Seule une commande approuvée et non soldée se suit (commande %, %)', _po.po_number, _po.status USING ERRCODE = 'QG018';
  END IF;
  RETURN _po;
END $function$;

CREATE OR REPLACE FUNCTION public.default_po_dates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _lead integer; _inco text;
BEGIN
  SELECT NULLIF(lead_time_days, 0), default_incoterm INTO _lead, _inco FROM public.suppliers WHERE id = NEW.supplier_id;
  _lead := COALESCE(_lead, (public.procurement_setting(NEW.tenant_id)).default_lead_time_days, 0);
  IF NEW.expected_date IS NULL THEN NEW.expected_date := COALESCE(NEW.order_date, CURRENT_DATE) + _lead; END IF;
  IF NEW.incoterm IS NULL THEN NEW.incoterm := _inco; END IF;
  RETURN NEW;
END $function$;

-- Suivi : « en retard » après la tolérance de la société.
CREATE OR REPLACE VIEW public.purchase_order_followup_view WITH (security_invoker = on) AS
WITH restes AS (
  SELECT pl.po_id,
         sum(GREATEST(pl.quantity
           - COALESCE((SELECT sum(g.quantity_received) FROM public.gr_lines g JOIN public.goods_receipts r ON r.id = g.gr_id
                        WHERE g.po_line_id = pl.id AND r.status = 'completed'), 0)
           + public.po_line_returned(pl.id, true), 0)) AS qty_remaining,
         sum(GREATEST(pl.quantity
           - COALESCE((SELECT sum(g.quantity_received) FROM public.gr_lines g JOIN public.goods_receipts r ON r.id = g.gr_id
                        WHERE g.po_line_id = pl.id AND r.status = 'completed'), 0)
           + public.po_line_returned(pl.id, true), 0) * pl.unit_cost) AS value_remaining,
         min(pl.expected_date) AS first_line_date
    FROM public.po_lines pl GROUP BY pl.po_id
)
SELECT po.tenant_id, po.id AS po_id, po.po_number, po.supplier_id, s.name AS supplier_name, po.order_date, po.status,
       po.incoterm, po.expected_date, po.supplier_confirmed_date, po.supplier_reference, po.acknowledged_at,
       COALESCE(po.supplier_confirmed_date, LEAST(po.expected_date, r.first_line_date), po.expected_date) AS promised_date,
       COALESCE(r.qty_remaining, 0) AS qty_remaining,
       round(COALESCE(r.value_remaining, 0), 2) AS value_remaining,
       GREATEST(CURRENT_DATE - COALESCE(po.supplier_confirmed_date, po.expected_date), 0) AS days_late,
       CASE WHEN COALESCE(r.qty_remaining, 0) = 0 THEN 'complete'
            WHEN COALESCE(po.supplier_confirmed_date, po.expected_date) + COALESCE(ps.followup_grace_days, 0) < CURRENT_DATE THEN 'late'
            WHEN po.acknowledged_at IS NULL THEN 'unconfirmed'
            ELSE 'on_time' END AS followup_state,
       COALESCE(ps.followup_grace_days, 0) AS grace_days
  FROM public.purchase_orders po
  LEFT JOIN public.suppliers s ON s.id = po.supplier_id
  LEFT JOIN restes r ON r.po_id = po.id
  LEFT JOIN public.procurement_settings ps ON ps.tenant_id = po.tenant_id
 WHERE po.status IN ('approved', 'ordered', 'partially_received');

-- Stock prévisionnel : ce qui compte suit les paramètres de la société (colonnes détaillées ajoutées).
CREATE OR REPLACE VIEW public.stock_projection_view WITH (security_invoker = on) AS
WITH commandes AS (
  SELECT pl.item_id,
         sum(GREATEST(pl.quantity
           - COALESCE((SELECT sum(g.quantity_received) FROM public.gr_lines g JOIN public.goods_receipts r ON r.id = g.gr_id
                        WHERE g.po_line_id = pl.id AND r.status = 'completed'), 0)
           + public.po_line_returned(pl.id, true), 0)) AS qty
    FROM public.po_lines pl JOIN public.purchase_orders po ON po.id = pl.po_id
   WHERE po.status IN ('draft', 'submitted', 'approved', 'ordered', 'partially_received') AND pl.item_id IS NOT NULL
   GROUP BY pl.item_id
), demandes AS (
  SELECT rl.item_id, sum(rl.quantity) AS qty
    FROM public.requisition_lines rl JOIN public.purchase_requisitions pr ON pr.id = rl.requisition_id
   WHERE pr.status IN ('draft', 'submitted', 'approved') AND pr.po_id IS NULL AND rl.item_id IS NOT NULL
   GROUP BY rl.item_id
), reserves AS (
  SELECT sl.item_id, sum(GREATEST(sl.quantity - COALESCE(sl.quantity_delivered, 0), 0)) AS qty
    FROM public.so_lines sl JOIN public.sales_orders so ON so.id = sl.so_id
   WHERE so.status IN ('confirmed', 'partially_delivered') AND sl.item_id IS NOT NULL
   GROUP BY sl.item_id
)
SELECT i.tenant_id, i.id AS item_id, i.code, i.name, i.unit,
       i.quantity_on_hand AS on_hand,
       COALESCE(c.qty, 0) + CASE WHEN COALESCE(ps.replenishment_include_requisitions, true) THEN COALESCE(d.qty, 0) ELSE 0 END AS on_order,
       CASE WHEN COALESCE(ps.replenishment_include_reservations, true) THEN COALESCE(s.qty, 0) ELSE 0 END AS reserved,
       i.quantity_on_hand + COALESCE(c.qty, 0)
         + CASE WHEN COALESCE(ps.replenishment_include_requisitions, true) THEN COALESCE(d.qty, 0) ELSE 0 END
         - CASE WHEN COALESCE(ps.replenishment_include_reservations, true) THEN COALESCE(s.qty, 0) ELSE 0 END AS projected,
       COALESCE(c.qty, 0) AS on_order_purchase_orders,
       COALESCE(d.qty, 0) AS on_order_requisitions,
       COALESCE(s.qty, 0) AS sales_reserved
  FROM public.items i
  LEFT JOIN commandes c ON c.item_id = i.id
  LEFT JOIN demandes d ON d.item_id = i.id
  LEFT JOIN reserves s ON s.item_id = i.id
  LEFT JOIN public.procurement_settings ps ON ps.tenant_id = i.tenant_id;
