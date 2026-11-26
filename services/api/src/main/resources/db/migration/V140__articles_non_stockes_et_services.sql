-- V140 — Articles non stockés et réception de services (écart G-30 ; SAP type d'article / fiche de service, Sage X3
-- articles non gérés en stock, « service fait »).
-- Avant : un article servait toujours de stock. Un contrat de maintenance ou une prestation saisi comme article créait des
-- mouvements de stock à la réception, apparaissait dans les inventaires et pouvait déclencher le réapprovisionnement.
--   items.item_type                stock (défaut) / non_stock (consommable acheté en charge) / service ;
--   garde-fou sur stock_movements (aa_non_stock_item) : pour les pièces (réception, livraison, retours), le
--                                  mouvement d'un article non stocké est ignoré — la pièce suit son cours (rapprochement,
--                                  facturation, réception non facturée, coût) sans toucher au stock ; pour les gestes de
--                                  stock (ajustement, transfert, inventaire, campagne) il est refusé (QG037) ;
--   guard_item_type                pas de seuil, stock de sécurité ni règle de réapprovisionnement sur un article non
--                                  stocké ; un article ne change pas de type tant qu'il a du stock ;
--   réception de service           quantité décimale = avancement (0,3 sur 1 = 30 %) ; procurement_settings.
--                                  service_acceptance_second_person (défaut non) : la réception d'une ligne de service
--                                  (« service fait ») est validée par une autre personne que l'auteur de la commande.

ALTER TABLE public.items ADD COLUMN item_type text NOT NULL DEFAULT 'stock' CHECK (item_type IN ('stock', 'non_stock', 'service'));
ALTER TABLE public.procurement_settings ADD COLUMN service_acceptance_second_person boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.guard_item_type()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.item_type <> 'stock' THEN
    IF COALESCE(NEW.reorder_level, 0) <> 0 OR COALESCE(NEW.safety_stock, 0) <> 0 OR COALESCE(NEW.max_stock, 0) <> 0 THEN
      RAISE EXCEPTION 'Article « % » non stocké : pas de seuil de réapprovisionnement, de stock de sécurité ni de stock maximal', NEW.name USING ERRCODE = 'QG037';
    END IF;
    IF EXISTS (SELECT 1 FROM public.item_replenishment_rules r WHERE r.item_id = NEW.id) THEN
      RAISE EXCEPTION 'Article « % » : supprimer les règles de réapprovisionnement avant de le rendre non stocké', NEW.name USING ERRCODE = 'QG037';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.item_type IS DISTINCT FROM OLD.item_type AND (
    COALESCE(OLD.quantity_on_hand, 0) <> 0 OR EXISTS (
      SELECT 1 FROM public.item_locations l WHERE l.item_id = OLD.id AND COALESCE(l.quantity_on_hand, 0) <> 0
    )
  ) THEN
    RAISE EXCEPTION 'Article « % » : le type ne change pas tant que le stock (%) n''est pas soldé', NEW.name, OLD.quantity_on_hand USING ERRCODE = 'QG037';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_item_type BEFORE INSERT OR UPDATE OF item_type, reorder_level, safety_stock, max_stock ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.guard_item_type();

CREATE FUNCTION public.guard_replenishment_item_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM i.id FROM public.items i WHERE i.id = NEW.item_id AND i.item_type = 'stock' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Article non stocké : pas de règle de réapprovisionnement' USING ERRCODE = 'QG037';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_replenishment_item_type() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_replenishment_item_type BEFORE INSERT OR UPDATE OF item_id ON public.item_replenishment_rules
  FOR EACH ROW EXECUTE FUNCTION public.guard_replenishment_item_type();

-- Avant guard_campaign_stock_movement : un service ne touche pas le dépôt gelé pour inventaire.
CREATE FUNCTION public.non_stock_item_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _type text; _name text;
BEGIN
  IF NEW.warehouse_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory-campaign:' || NEW.warehouse_id::text, 0));
  END IF;
  SELECT i.item_type, i.name INTO _type, _name FROM public.items i WHERE i.id = NEW.item_id FOR UPDATE;
  IF _type IS NULL OR _type = 'stock' THEN RETURN NEW; END IF;
  IF NEW.movement_type IN ('receipt', 'delivery', 'customer_return', 'supplier_return') THEN
    RETURN NULL;   -- pièce d'achat ou de vente d'un article non stocké : pas de mouvement, la pièce continue.
  END IF;
  RAISE EXCEPTION 'Article « % » non stocké (%) : pas de mouvement de stock', _name,
    CASE _type WHEN 'service' THEN 'service' ELSE 'acheté en charge' END USING ERRCODE = 'QG037';
END $$;
REVOKE EXECUTE ON FUNCTION public.non_stock_item_movement() FROM PUBLIC, anon;
CREATE TRIGGER aa_non_stock_item BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.non_stock_item_movement();

-- Les écritures directes dans les quantités par dépôt doivent respecter le même invariant.
CREATE FUNCTION public.guard_non_stock_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _warehouse uuid;
BEGIN
  FOR _warehouse IN SELECT DISTINCT d.id FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.warehouse_id END, NEW.warehouse_id
  ]) AS d(id) WHERE d.id IS NOT NULL ORDER BY d.id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory-campaign:' || _warehouse::text, 0));
  END LOOP;
  PERFORM i.id FROM public.items i WHERE i.id = NEW.item_id AND i.item_type = 'stock' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Article non stocké : pas de quantité en dépôt' USING ERRCODE = 'QG037';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_non_stock_location() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER aa_non_stock_location BEFORE INSERT OR UPDATE ON public.item_locations
  FOR EACH ROW EXECUTE FUNCTION public.guard_non_stock_location();

-- « Service fait » : validation par une autre personne que l'auteur de la commande, si la société l'exige.
CREATE FUNCTION public.service_acceptance_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _buyer uuid;
BEGIN
  IF NOT (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed') THEN RETURN NEW; END IF;
  IF NOT COALESCE((SELECT s.service_acceptance_second_person FROM public.procurement_settings s WHERE s.tenant_id = NEW.tenant_id), false) THEN RETURN NEW; END IF;
  SELECT po.created_by INTO _buyer FROM public.purchase_orders po WHERE po.id = NEW.po_id FOR UPDATE;
  IF NEW.warehouse_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory-campaign:' || NEW.warehouse_id::text, 0));
  END IF;
  -- Sérialiser le contrôle avec les changements de type et les mouvements, dans un ordre stable.
  PERFORM i.id FROM public.items i WHERE i.id IN (
    SELECT COALESCE(gl.item_id, pl.item_id) FROM public.gr_lines gl
      JOIN public.po_lines pl ON pl.id = gl.po_line_id
     WHERE gl.gr_id = NEW.id AND gl.quantity_received > 0
  ) ORDER BY i.id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.gr_lines gl JOIN public.po_lines pl ON pl.id = gl.po_line_id
                   JOIN public.items i ON i.id = COALESCE(gl.item_id, pl.item_id)
                  WHERE gl.gr_id = NEW.id AND i.item_type = 'service' AND gl.quantity_received > 0) THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR auth.uid() = _buyer THEN
    RAISE EXCEPTION 'Réception % : le service fait est attesté par une autre personne que l''auteur de la commande', NEW.gr_number USING ERRCODE = 'QG037';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.service_acceptance_check() FROM PUBLIC, anon;
CREATE TRIGGER trg_service_acceptance BEFORE UPDATE OF status ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.service_acceptance_check();

CREATE OR REPLACE VIEW public.inventory_kpis_view WITH (security_invoker = on) AS
 SELECT tenant_id,
    count(*) FILTER (WHERE status = 'active'::text) AS active_items,
    count(*) FILTER (WHERE COALESCE(reorder_level, 0::numeric) > 0 AND quantity_on_hand <= COALESCE(reorder_level, 0::numeric)) AS low_stock_items,
    count(*) FILTER (WHERE quantity_on_hand <= 0::numeric) AS out_of_stock_items,
    round(COALESCE(sum(quantity_on_hand * average_cost), 0::numeric), 2) AS total_stock_value
   FROM public.items i
  WHERE i.item_type = 'stock'
  GROUP BY tenant_id;


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
  LEFT JOIN public.procurement_settings ps ON ps.tenant_id = i.tenant_id
 WHERE i.item_type = 'stock';

CREATE OR REPLACE FUNCTION public.inventory_campaign_open_items(_tenant uuid,_warehouse uuid,_scope text)
RETURNS TABLE(item_id uuid,expected numeric) LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH depot AS (
    SELECT l.item_id,sum(l.quantity_on_hand) AS amount
    FROM public.item_locations l WHERE l.tenant_id = _tenant AND l.warehouse_id = _warehouse GROUP BY l.item_id
  )
  SELECT i.id,coalesce(d.amount,0)
  FROM public.items i LEFT JOIN depot d ON d.item_id = i.id
  WHERE i.tenant_id = _tenant AND i.item_type = 'stock' AND (
    d.item_id IS NOT NULL OR (i.status = 'active' AND (_scope = 'all_active'
      OR (_scope = 'assigned' AND i.default_warehouse_id = _warehouse)))
  )
$$;

CREATE OR REPLACE VIEW public.inventory_valuation_by_category_view WITH (security_invoker='on') AS
 WITH fifo AS (
         SELECT i.tenant_id,
            COALESCE(NULLIF(i.category, ''::text), 'Sans catégorie'::text) AS category,
            sum((l.qty_remaining * l.cost_in)) AS fifo_value
           FROM (public.items i
             LEFT JOIN public.stock_valuation_layers l ON ((l.item_id = i.id)))
          GROUP BY i.tenant_id, COALESCE(NULLIF(i.category, ''::text), 'Sans catégorie'::text)
        ), avgc AS (
         SELECT i.tenant_id,
            COALESCE(NULLIF(i.category, ''::text), 'Sans catégorie'::text) AS category,
            count(*) AS items_count,
            sum(i.quantity_on_hand) AS total_qty,
            sum((i.quantity_on_hand * COALESCE(i.average_cost, i.unit_cost, (0)::numeric))) AS avg_cost_value
           FROM public.items i
          WHERE (i.status = 'active'::text) AND i.item_type = 'stock'
          GROUP BY i.tenant_id, COALESCE(NULLIF(i.category, ''::text), 'Sans catégorie'::text)
        )
 SELECT a.tenant_id,
    a.category,
    a.items_count,
    a.total_qty,
    COALESCE(f.fifo_value, (0)::numeric) AS fifo_value,
    a.avg_cost_value,
    (COALESCE(f.fifo_value, (0)::numeric) - a.avg_cost_value) AS variance
   FROM (avgc a
     LEFT JOIN fifo f ON (((f.tenant_id = a.tenant_id) AND (f.category = a.category))));

CREATE OR REPLACE VIEW public.inventory_slow_moving_view WITH (security_invoker='on') AS
 SELECT tenant_id,
    id AS item_id,
    code,
    name,
    category,
    quantity_on_hand,
    COALESCE(average_cost, unit_cost, (0)::numeric) AS unit_cost,
    (quantity_on_hand * COALESCE(average_cost, unit_cost, (0)::numeric)) AS stock_value,
    ( SELECT max(sm.movement_date) AS max
           FROM public.stock_movements sm
          WHERE ((sm.item_id = i.id) AND (sm.quantity < (0)::numeric) AND (sm.movement_type <> ALL (ARRAY['transfer_in'::text, 'transfer_out'::text, 'transfer'::text, 'adjust_in'::text, 'adjust_out'::text])))) AS last_outbound_date,
        CASE
            WHEN (( SELECT max(sm.movement_date) AS max
               FROM public.stock_movements sm
              WHERE ((sm.item_id = i.id) AND (sm.quantity < (0)::numeric))) IS NULL) THEN 'Dormant'::text
            WHEN (( SELECT max(sm.movement_date) AS max
               FROM public.stock_movements sm
              WHERE ((sm.item_id = i.id) AND (sm.quantity < (0)::numeric))) < (CURRENT_DATE - '180 days'::interval)) THEN 'Mort'::text
            WHEN (( SELECT max(sm.movement_date) AS max
               FROM public.stock_movements sm
              WHERE ((sm.item_id = i.id) AND (sm.quantity < (0)::numeric))) < (CURRENT_DATE - '90 days'::interval)) THEN 'Lent'::text
            ELSE 'Actif'::text
        END AS movement_class
   FROM public.items i
  WHERE i.item_type = 'stock' AND ((quantity_on_hand > (0)::numeric) AND (status = 'active'::text));

SELECT public.install_tenant_isolation_triggers();
