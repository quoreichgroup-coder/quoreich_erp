-- V54 — Réapprovisionnement (audit 11 §2, lots S2 et R1 ; écarts G-42, G-43 ; références : SAP
-- planification sur point de commande « VM » et fiches d'achat (info records), Sage X3 plan de
-- réapprovisionnement, Odoo règles min / max, Dynamics planification des approvisionnements).
--
-- S2 — l'alerte prenait le stock de sécurité à la place du point de commande quand il était
--      renseigné : l'alerte arrivait trop tard. Seuil = point de commande (reorder_level) ; le stock
--      de sécurité reste affiché à part. Même correction dans inventory_kpis_view.
-- R1 — · supplier_items : catalogue fournisseur (référence, prix, devise, délai, minimum et multiple
--        de commande, fournisseur préféré unique par article) ;
--      · item_replenishment_rules : règle par article et (optionnellement) par dépôt — « point de
--        commande » (quantité fixe) ou « min / max » (remonter au maximum) ;
--      · stock_projection_view : stock disponible prévisionnel = en stock (du dépôt si la règle en
--        cite un) + commandé non reçu (demandes ouvertes et commandes ouvertes, net des réceptions et
--        des retours avec remplacement) − commandé client non livré ;
--      · generate_replenishment_proposals() : propositions datées, arrondies au minimum et au multiple
--        du fournisseur préféré ; les anciennes propositions non traitées sont remplacées ;
--      · convert_replenishment_proposals(ids) : une demande d'achat brouillon par fournisseur préféré
--        (le circuit d'approbation V39 s'applique tel quel) ; dismiss_replenishment_proposal(id, motif).
--      Droit procurement.replenish (admin, procurement_controller, procurement_l2 / l3, inventory_manager).
-- Erreurs métier : QG016.

-- ─── Droit ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('procurement.replenish', 'procurement', 'replenish', 'Paramétrer et lancer le réapprovisionnement')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, 'procurement.replenish'
  FROM (VALUES ('admin'), ('procurement_controller'), ('procurement_l2'), ('procurement_l3'), ('inventory_manager')) AS v(r)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code = 'procurement.replenish' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── S2 : alerte au point de commande ───
CREATE OR REPLACE VIEW public.low_stock_alerts_view WITH (security_invoker = on) AS
 SELECT tenant_id,
    id AS item_id,
    code,
    name,
    unit,
    quantity_on_hand,
    COALESCE(reorder_level, 0::numeric) AS threshold,
    COALESCE(reorder_level, 0::numeric) - quantity_on_hand AS gap,
    COALESCE(safety_stock, 0::numeric) AS safety_stock,
    quantity_on_hand <= COALESCE(safety_stock, 0::numeric) AND COALESCE(safety_stock, 0::numeric) > 0 AS below_safety
   FROM public.items i
  WHERE COALESCE(reorder_level, 0::numeric) > 0 AND quantity_on_hand <= COALESCE(reorder_level, 0::numeric);

CREATE OR REPLACE VIEW public.inventory_kpis_view WITH (security_invoker = on) AS
 SELECT tenant_id,
    count(*) FILTER (WHERE status = 'active'::text) AS active_items,
    count(*) FILTER (WHERE COALESCE(reorder_level, 0::numeric) > 0 AND quantity_on_hand <= COALESCE(reorder_level, 0::numeric)) AS low_stock_items,
    count(*) FILTER (WHERE quantity_on_hand <= 0::numeric) AS out_of_stock_items,
    round(COALESCE(sum(quantity_on_hand * average_cost), 0::numeric), 2) AS total_stock_value
   FROM public.items i
  GROUP BY tenant_id;

-- ─── Catalogue fournisseur ───
CREATE TABLE public.supplier_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  supplier_ref text,
  unit_price numeric(18,4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  currency text NOT NULL DEFAULT 'XOF' CHECK (currency ~ '^[A-Z]{3}$'),
  lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  min_order_qty numeric NOT NULL DEFAULT 0 CHECK (min_order_qty >= 0),
  order_multiple numeric NOT NULL DEFAULT 0 CHECK (order_multiple >= 0),
  is_preferred boolean NOT NULL DEFAULT false,
  valid_from date,
  valid_to date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_items_unique UNIQUE (tenant_id, supplier_id, item_id),
  CONSTRAINT supplier_items_validity CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX supplier_items_one_preferred ON public.supplier_items (tenant_id, item_id) WHERE is_preferred AND active;
CREATE INDEX supplier_items_item_idx ON public.supplier_items (item_id);
CREATE INDEX supplier_items_supplier_idx ON public.supplier_items (supplier_id);

-- ─── Règles de réapprovisionnement ───
CREATE TABLE public.item_replenishment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('reorder_point', 'min_max')),
  reorder_point numeric NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  safety_stock numeric NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  order_qty numeric NOT NULL DEFAULT 0 CHECK (order_qty >= 0),
  max_qty numeric NOT NULL DEFAULT 0 CHECK (max_qty >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT replenishment_rule_quantities CHECK (
    (method = 'reorder_point' AND order_qty > 0) OR (method = 'min_max' AND max_qty > reorder_point)),
  CONSTRAINT replenishment_rule_safety CHECK (safety_stock <= reorder_point)
);
CREATE UNIQUE INDEX item_replenishment_rules_unique
  ON public.item_replenishment_rules (tenant_id, item_id, COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ─── Propositions ───
CREATE TABLE public.replenishment_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.item_replenishment_rules(id) ON DELETE SET NULL,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  on_hand numeric NOT NULL,
  on_order numeric NOT NULL,
  reserved numeric NOT NULL,
  projected numeric NOT NULL,
  reorder_point numeric NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric(18,4) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'XOF',
  needed_by date,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'converted', 'dismissed')),
  requisition_id uuid REFERENCES public.purchase_requisitions(id) ON DELETE SET NULL,
  dismiss_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz
);
CREATE INDEX replenishment_proposals_tenant_idx ON public.replenishment_proposals (tenant_id, status);

-- ─── Droits ───
CREATE OR REPLACE FUNCTION public.replenishment_target_ok(_tenant uuid, _item uuid, _supplier uuid, _warehouse uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.items WHERE id = _item AND tenant_id = _tenant)
     AND (_supplier IS NULL OR EXISTS (SELECT 1 FROM public.suppliers WHERE id = _supplier AND tenant_id = _tenant))
     AND (_warehouse IS NULL OR EXISTS (SELECT 1 FROM public.warehouses WHERE id = _warehouse AND tenant_id = _tenant))
$function$;
REVOKE ALL ON FUNCTION public.replenishment_target_ok(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replenishment_target_ok(uuid, uuid, uuid, uuid) TO authenticated;

ALTER TABLE public.supplier_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.supplier_items FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture habilitée" ON public.supplier_items FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.replenish'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.replenish')
              AND public.replenishment_target_ok(tenant_id, item_id, supplier_id, NULL));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_items TO authenticated;

ALTER TABLE public.item_replenishment_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.item_replenishment_rules FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture habilitée" ON public.item_replenishment_rules FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.replenish'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.replenish')
              AND public.replenishment_target_ok(tenant_id, item_id, NULL, warehouse_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_replenishment_rules TO authenticated;

-- Propositions : lecture seule, tout passe par les fonctions.
ALTER TABLE public.replenishment_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.replenishment_proposals FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.replenishment_proposals TO authenticated;

-- ─── Stock disponible prévisionnel ───
-- Commandé : lignes des demandes ouvertes (non converties) et des commandes ouvertes, net du reçu
-- (réceptions validées) et des retours fournisseurs avec remplacement (V52) ; réservé : commandes
-- clients confirmées non livrées. Les commandes n'ont pas de dépôt : commandé et réservé sont
-- comptés au niveau de l'article.
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
       COALESCE(c.qty, 0) + COALESCE(d.qty, 0) AS on_order,
       COALESCE(s.qty, 0) AS reserved,
       i.quantity_on_hand + COALESCE(c.qty, 0) + COALESCE(d.qty, 0) - COALESCE(s.qty, 0) AS projected
  FROM public.items i
  LEFT JOIN commandes c ON c.item_id = i.id
  LEFT JOIN demandes d ON d.item_id = i.id
  LEFT JOIN reserves s ON s.item_id = i.id;
GRANT SELECT ON public.stock_projection_view TO authenticated;

-- Quantité à commander d'après la règle et le fournisseur : brut, puis minimum, puis multiple.
CREATE OR REPLACE FUNCTION public.replenishment_quantity(_method text, _projected numeric, _reorder_point numeric,
                                                        _order_qty numeric, _max_qty numeric, _min_order numeric, _multiple numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  WITH b AS (
    SELECT GREATEST(CASE WHEN _method = 'min_max' THEN _max_qty - _projected ELSE _order_qty END, COALESCE(_min_order, 0)) AS q
  )
  SELECT CASE WHEN _projected > _reorder_point THEN 0
              WHEN COALESCE(_multiple, 0) > 0 THEN ceil(q / _multiple) * _multiple
              ELSE q END
    FROM b
$function$;

-- ─── Génération ───
CREATE OR REPLACE FUNCTION public.generate_replenishment_proposals()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _r record;
  _n integer := 0;
  _qty numeric;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Aucune société active' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_permission(auth.uid(), 'procurement.replenish') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'procurement.replenish')
      USING ERRCODE = '42501';
  END IF;
  -- Les propositions non traitées sont recalculées (aucun doublon d'un calcul à l'autre).
  DELETE FROM public.replenishment_proposals WHERE tenant_id = _tenant AND status = 'proposed';

  FOR _r IN
    SELECT ru.id AS rule_id, ru.item_id, ru.warehouse_id, ru.method, ru.reorder_point, ru.order_qty, ru.max_qty,
           CASE WHEN ru.warehouse_id IS NULL THEN p.on_hand
                ELSE COALESCE((SELECT l.quantity_on_hand FROM public.item_locations l
                                WHERE l.item_id = ru.item_id AND l.warehouse_id = ru.warehouse_id), 0) END AS on_hand,
           p.on_order, p.reserved,
           si.supplier_id, si.unit_price, si.currency, si.lead_time_days, si.min_order_qty, si.order_multiple
      FROM public.item_replenishment_rules ru
      JOIN public.items it ON it.id = ru.item_id AND it.tenant_id = _tenant AND COALESCE(it.status, 'active') = 'active'
      JOIN public.stock_projection_view p ON p.item_id = ru.item_id
      LEFT JOIN LATERAL (
        SELECT s.* FROM public.supplier_items s
         WHERE s.tenant_id = _tenant AND s.item_id = ru.item_id AND s.active
           AND (s.valid_from IS NULL OR s.valid_from <= CURRENT_DATE) AND (s.valid_to IS NULL OR s.valid_to >= CURRENT_DATE)
         ORDER BY s.is_preferred DESC, s.unit_price ASC
         LIMIT 1
      ) si ON true
     WHERE ru.tenant_id = _tenant AND ru.active
  LOOP
    _qty := public.replenishment_quantity(_r.method, _r.on_hand + _r.on_order - _r.reserved, _r.reorder_point,
                                          _r.order_qty, _r.max_qty, _r.min_order_qty, _r.order_multiple);
    IF _qty > 0 THEN
      INSERT INTO public.replenishment_proposals (tenant_id, rule_id, item_id, warehouse_id, supplier_id, on_hand, on_order,
                                                  reserved, projected, reorder_point, quantity, unit_price, currency,
                                                  needed_by, created_by)
      VALUES (_tenant, _r.rule_id, _r.item_id, _r.warehouse_id, _r.supplier_id, _r.on_hand, _r.on_order, _r.reserved,
              _r.on_hand + _r.on_order - _r.reserved, _r.reorder_point, _qty, COALESCE(_r.unit_price, 0),
              COALESCE(_r.currency, 'XOF'), CURRENT_DATE + COALESCE(_r.lead_time_days, 0), auth.uid());
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END $function$;
REVOKE ALL ON FUNCTION public.generate_replenishment_proposals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_replenishment_proposals() TO authenticated;

-- ─── Conversion en demandes d'achat (une par fournisseur proposé) ───
CREATE OR REPLACE FUNCTION public.convert_replenishment_proposals(_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _groupe record;
  _pr uuid;
  _n integer := 0;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Aucune société active' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_permission(auth.uid(), 'procurement.replenish') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'procurement.replenish')
      USING ERRCODE = '42501';
  END IF;
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN
    RAISE EXCEPTION 'Sélectionner au moins une proposition' USING ERRCODE = 'QG016';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_ids) x(id) LEFT JOIN public.replenishment_proposals p ON p.id = x.id AND p.tenant_id = _tenant
              WHERE p.id IS NULL OR p.status <> 'proposed') THEN
    RAISE EXCEPTION 'Proposition introuvable ou déjà traitée : relancer le calcul' USING ERRCODE = 'QG016';
  END IF;

  FOR _groupe IN
    SELECT p.supplier_id, s.name AS supplier_name
      FROM public.replenishment_proposals p LEFT JOIN public.suppliers s ON s.id = p.supplier_id
     WHERE p.id = ANY(_ids)
     GROUP BY p.supplier_id, s.name
  LOOP
    INSERT INTO public.purchase_requisitions (tenant_id, requested_by, request_date, description, status)
    VALUES (_tenant, auth.uid(), CURRENT_DATE,
            'Réapprovisionnement' || COALESCE(' — ' || _groupe.supplier_name, ' — fournisseur à choisir'), 'draft')
    RETURNING id INTO _pr;
    INSERT INTO public.requisition_lines (requisition_id, item_id, description, quantity, estimated_unit_cost)
    SELECT _pr, p.item_id, i.name || CASE WHEN w.code IS NOT NULL THEN ' (dépôt ' || w.code || ')' ELSE '' END,
           p.quantity, p.unit_price
      FROM public.replenishment_proposals p
      JOIN public.items i ON i.id = p.item_id
      LEFT JOIN public.warehouses w ON w.id = p.warehouse_id
     WHERE p.id = ANY(_ids) AND p.supplier_id IS NOT DISTINCT FROM _groupe.supplier_id;
    UPDATE public.replenishment_proposals
       SET status = 'converted', requisition_id = _pr, decided_by = auth.uid(), decided_at = now()
     WHERE id = ANY(_ids) AND supplier_id IS NOT DISTINCT FROM _groupe.supplier_id;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $function$;
REVOKE ALL ON FUNCTION public.convert_replenishment_proposals(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_replenishment_proposals(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.dismiss_replenishment_proposal(_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_permission(auth.uid(), 'procurement.replenish') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'procurement.replenish')
      USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Motif obligatoire pour écarter une proposition' USING ERRCODE = 'QG016';
  END IF;
  UPDATE public.replenishment_proposals
     SET status = 'dismissed', dismiss_reason = btrim(_reason), decided_by = auth.uid(), decided_at = now()
   WHERE id = _id AND tenant_id = _tenant AND status = 'proposed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposition introuvable ou déjà traitée' USING ERRCODE = 'QG016';
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.dismiss_replenishment_proposal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_replenishment_proposal(uuid, text) TO authenticated;
