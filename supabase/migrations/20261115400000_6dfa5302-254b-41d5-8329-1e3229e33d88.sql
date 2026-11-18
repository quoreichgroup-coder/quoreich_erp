CREATE TABLE public.inventory_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
 reference text,
 item_scope text NOT NULL DEFAULT 'warehouse' CHECK (item_scope IN ('warehouse','assigned','all_active')),
 state text NOT NULL DEFAULT 'counting' CHECK (state IN ('counting','submitted','cancelled')),
 opened_by uuid NOT NULL,
 opened_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid,
 decided_at timestamptz,
 cancel_reason text
);
CREATE UNIQUE INDEX inventory_campaign_active_depot ON public.inventory_campaigns(warehouse_id)
 WHERE state IN ('counting','submitted');
CREATE TABLE public.inventory_campaign_lines (
 tenant_id uuid NOT NULL,
 campaign_id uuid REFERENCES public.inventory_campaigns(id),
 item_id uuid REFERENCES public.items(id),
 expected numeric NOT NULL,
 opening_code text,
 opening_name text,
 opening_unit text,
 counted numeric CHECK (counted >= 0 AND counted < 10000000000000000 AND counted = trunc(counted, 2)),
 counted_by uuid,
 PRIMARY KEY (campaign_id,item_id)
);
ALTER TABLE public.inventory_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_campaign_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_campaigns, public.inventory_campaign_lines FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.guard_campaign_stock_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE depot uuid;
BEGIN
 FOR depot IN SELECT DISTINCT d.id FROM unnest(ARRAY[
   CASE WHEN TG_OP <> 'INSERT' THEN OLD.warehouse_id END,
   CASE WHEN TG_OP <> 'DELETE' THEN NEW.warehouse_id END
 ]) AS d(id) WHERE d.id IS NOT NULL ORDER BY d.id
 LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('inventory-campaign:' || depot::text, 0));
   IF EXISTS (SELECT 1 FROM public.inventory_campaigns c WHERE c.warehouse_id = depot
              AND c.state IN ('counting','submitted')) THEN
     RAISE EXCEPTION 'Dépôt gelé par une campagne d’inventaire' USING ERRCODE = '55000';
   END IF;
 END LOOP;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_campaign_stock_movement() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_campaign_stock_movement BEFORE INSERT OR UPDATE OR DELETE ON public.stock_movements
 FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_stock_movement();
-- The depot quantity is also exposed through item_locations, including manual location edits.
CREATE TRIGGER guard_campaign_stock_location BEFORE INSERT OR UPDATE OR DELETE ON public.item_locations
 FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_stock_movement();

CREATE FUNCTION public.inventory_campaign_open_items(_tenant uuid,_warehouse uuid,_scope text)
RETURNS TABLE(item_id uuid,expected numeric) LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH depot AS (
    SELECT l.item_id,sum(l.quantity_on_hand) AS amount
    FROM public.item_locations l WHERE l.tenant_id = _tenant AND l.warehouse_id = _warehouse GROUP BY l.item_id
  )
  SELECT i.id,coalesce(d.amount,0)
  FROM public.items i LEFT JOIN depot d ON d.item_id = i.id
  WHERE i.tenant_id = _tenant AND (
    d.item_id IS NOT NULL OR (i.status = 'active' AND (_scope = 'all_active'
      OR (_scope = 'assigned' AND i.default_warehouse_id = _warehouse)))
  )
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_open_items(uuid,uuid,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.inventory_campaign(_action text, _id uuid, _item uuid DEFAULT NULL, _quantity numeric DEFAULT NULL,
 _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 actor uuid := auth.uid();
 tenant uuid := public.get_user_tenant_id(actor);
 can_cancel_any boolean := public.has_permission(actor, 'inventory.post_count') IS TRUE;
 campaign public.inventory_campaigns%ROWTYPE;
BEGIN
 IF actor IS NULL OR tenant IS NULL OR public.has_permission(actor, 'inventory.count') IS NOT TRUE THEN
   RAISE EXCEPTION 'Comptage non autorisé' USING ERRCODE = '42501';
 END IF;
 IF _action = 'open' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('inventory-campaign:' || _id::text, 0));
   INSERT INTO public.inventory_campaigns (tenant_id,warehouse_id,opened_by)
    SELECT w.tenant_id,w.id,actor FROM public.warehouses w WHERE w.id = _id AND w.tenant_id = tenant
    RETURNING * INTO campaign;
   IF NOT FOUND THEN RAISE EXCEPTION 'Dépôt introuvable' USING ERRCODE = 'P0002'; END IF;
   INSERT INTO public.inventory_campaign_lines (tenant_id,campaign_id,item_id,expected)
    SELECT tenant,campaign.id,p.item_id,p.expected
    FROM public.inventory_campaign_open_items(tenant,_id,campaign.item_scope) p;
   IF NOT FOUND THEN RAISE EXCEPTION 'Le périmètre configuré ne contient aucun article pour ce dépôt' USING ERRCODE = '22023'; END IF;
 ELSIF _action = 'active' THEN
   SELECT c.* INTO campaign FROM public.inventory_campaigns c
    WHERE c.warehouse_id = _id AND c.tenant_id = tenant AND c.state IN ('counting','submitted');
   IF NOT FOUND THEN RETURN NULL; END IF;
 ELSE
   SELECT c.* INTO campaign FROM public.inventory_campaigns c WHERE c.id = _id AND c.tenant_id = tenant FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Campagne introuvable' USING ERRCODE = 'P0002'; END IF;
   CASE _action
     WHEN 'read' THEN NULL;
     WHEN 'count' THEN
       IF campaign.state <> 'counting' OR _quantity IS NULL OR _quantity < 0
          OR _quantity >= 10000000000000000 OR _quantity <> trunc(_quantity, 2) THEN
         RAISE EXCEPTION 'Saisissez une quantité positive ou nulle, avec au plus deux décimales, pendant le comptage'
           USING ERRCODE = '22023';
       END IF;
       UPDATE public.inventory_campaign_lines l SET counted = _quantity, counted_by = actor
        WHERE l.tenant_id = tenant AND l.campaign_id = _id AND l.item_id = _item
          AND (l.counted_by IS NULL OR l.counted_by = actor);
       IF NOT FOUND THEN
         IF EXISTS (SELECT 1 FROM public.inventory_campaign_lines l
           WHERE l.tenant_id = tenant AND l.campaign_id = _id AND l.item_id = _item) THEN
           RAISE EXCEPTION 'Cet article a déjà été saisi par un autre compteur' USING ERRCODE = '42501';
         END IF;
         RAISE EXCEPTION 'Article hors campagne' USING ERRCODE = 'P0002';
       END IF;
     WHEN 'submit', 'cancel' THEN
       IF campaign.state NOT IN ('counting','submitted') OR (_action = 'submit' AND (campaign.state <> 'counting' OR EXISTS
         (SELECT 1 FROM public.inventory_campaign_lines l WHERE l.tenant_id = tenant AND l.campaign_id = _id AND l.counted IS NULL))) THEN
         RAISE EXCEPTION 'Transition de campagne impossible' USING ERRCODE = '55000';
       END IF;
       IF _action = 'cancel' THEN
         IF campaign.opened_by <> actor AND NOT can_cancel_any THEN
           RAISE EXCEPTION 'Annulation réservée au responsable de la campagne ou à un valideur habilité' USING ERRCODE = '42501';
         END IF;
         IF coalesce(length(btrim(_reason)), 0) NOT BETWEEN 1 AND 1000 THEN
           RAISE EXCEPTION 'Un motif d’annulation de 1 à 1 000 caractères est obligatoire' USING ERRCODE = '22023';
         END IF;
       END IF;
       UPDATE public.inventory_campaigns c SET state = CASE WHEN _action = 'submit' THEN 'submitted' ELSE 'cancelled' END,
        decided_by = actor, decided_at = now(), cancel_reason = CASE WHEN _action = 'cancel' THEN btrim(_reason) END
        WHERE c.id = _id RETURNING * INTO campaign;
     ELSE RAISE EXCEPTION 'Action inconnue' USING ERRCODE = '22023';
   END CASE;
 END IF;
 RETURN jsonb_build_object('id',campaign.id,'warehouse_id',campaign.warehouse_id,'state',campaign.state,
   'reference',campaign.reference,'item_scope',campaign.item_scope,
   'can_cancel',(campaign.opened_by = actor OR can_cancel_any) AND campaign.state IN ('counting','submitted'),'lines',(
   SELECT jsonb_agg(jsonb_build_object('item_id',l.item_id,'code',coalesce(l.opening_code,i.code),
     'name',coalesce(l.opening_name,i.name),'unit',coalesce(l.opening_unit,i.unit),
     'counted', CASE WHEN l.counted_by = actor THEN l.counted END, 'is_counted',l.counted IS NOT NULL,
     'can_edit',campaign.state = 'counting' AND (l.counted_by IS NULL OR l.counted_by = actor))
     ORDER BY coalesce(l.opening_code,i.code),l.item_id)
   FROM public.inventory_campaign_lines l JOIN public.items i ON i.id = l.item_id AND i.tenant_id = tenant
   WHERE l.tenant_id = tenant AND l.campaign_id = campaign.id));
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign(text,uuid,uuid,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_campaign(text,uuid,uuid,numeric,text) TO authenticated;
