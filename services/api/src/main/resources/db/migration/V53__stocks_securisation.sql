-- V53 — Stocks : plus d'écriture directe (audit S-xx « tables FOR ALL », suite de V42 pour les
-- ventes ; références SAP : un mouvement de stock naît d'une transaction métier (MIGO, VL02N,
-- MI07), jamais d'une saisie de table ; Sage X3 : mouvements via les fonctions de stock).
--
-- Avant : la politique « FOR ALL » de stock_movements, items, stock_valuation_layers,
-- inventory_settings, warehouses, item_locations, inventory_counts / _lines laissait tout membre —
-- un « Lecteur » compris — insérer, modifier ou supprimer un mouvement (et depuis V51 l'écriture
-- comptable qui le suit), réécrire la quantité ou le coût moyen d'un article, basculer la société
-- en inventaire intermittent, ou fixer le coût unitaire d'un comptage. transfer_stock ne vérifiait
-- pas que l'article et les dépôts appartiennent à la société de l'appelant.
--
-- Après :
--   · stock_movements, stock_valuation_layers : lecture seule ; les mouvements naissent des
--     fonctions (réception, livraison, retours, transfert, ajustement, inventaire) ;
--   · items : création / modification avec le droit inventory.move, suppression par
--     l'administrateur ; quantité en stock et coût moyen jamais saisis (calculés par les mouvements) ;
--   · warehouses, item_locations : écriture avec inventory.move ;
--   · inventory_settings : écriture par l'administrateur de la société ;
--   · inventory_counts / _lines : écriture avec inventory.count, tant que le comptage est en
--     brouillon ; la validation passe par post_inventory_count, qui recalcule l'attendu (stock à
--     la validation) et valorise au coût moyen — jamais au coût saisi ;
--   · create_stock_adjustment(article, dépôt, quantité ±, coût, date, motif) : droit inventory.adjust,
--     motif obligatoire, coût moyen pour une sortie ;
--   · transfer_stock : article et dépôts de la société, messages en français.
-- Erreurs métier : QG015.

-- ─── Mouvements et couches de valorisation : lecture seule ───
ALTER TABLE public.stock_movements ADD COLUMN reason text;

DROP POLICY "Tenant isolation" ON public.stock_movements;
CREATE POLICY "Lecture société" ON public.stock_movements FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.stock_movements FROM authenticated, anon;

DROP POLICY "valuation layers tenant access" ON public.stock_valuation_layers;
CREATE POLICY "Lecture société" ON public.stock_valuation_layers FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.stock_valuation_layers FROM authenticated, anon;

-- ─── Paramètres de stock : administrateur ───
DROP POLICY "inv settings tenant access" ON public.inventory_settings;
CREATE POLICY "Lecture société" ON public.inventory_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Administrateur de la société" ON public.inventory_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin());

-- ─── Articles ───
DROP POLICY "Tenant isolation" ON public.items;
CREATE POLICY "Lecture société" ON public.items FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Création habilitée" ON public.items FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'inventory.move'));
CREATE POLICY "Modification habilitée" ON public.items FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'inventory.move'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'inventory.move'));
CREATE POLICY "Suppression administrateur" ON public.items FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin());

-- Quantité et coût moyen : résultat des mouvements, jamais une saisie (garde non SECURITY DEFINER :
-- elle voit le rôle de l'appelant ; apply_stock_movement, propriétaire, passe).
CREATE OR REPLACE FUNCTION public.guard_item_stock_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.quantity_on_hand, 0) <> 0 OR COALESCE(NEW.average_cost, 0) <> 0 THEN
      RAISE EXCEPTION 'Un article se crée sans stock : le stock entre par une réception, un ajustement ou un inventaire'
        USING ERRCODE = 'QG015';
    END IF;
  ELSIF NEW.quantity_on_hand IS DISTINCT FROM OLD.quantity_on_hand OR NEW.average_cost IS DISTINCT FROM OLD.average_cost
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'La quantité en stock et le coût moyen résultent des mouvements : passer un ajustement ou un inventaire'
      USING ERRCODE = 'QG015';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_item_stock_fields BEFORE INSERT OR UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.guard_item_stock_fields();

-- ─── Dépôts et emplacements ───
DROP POLICY "warehouses tenant access" ON public.warehouses;
CREATE POLICY "Lecture société" ON public.warehouses FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture habilitée" ON public.warehouses FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'inventory.move'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'inventory.move'));

DROP POLICY "item_locations tenant access" ON public.item_locations;
CREATE POLICY "Lecture société" ON public.item_locations FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture habilitée" ON public.item_locations FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'inventory.move'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'inventory.move'));

-- ─── Inventaires (comptages) ───
DROP POLICY "inv counts tenant access" ON public.inventory_counts;
CREATE POLICY "Lecture société" ON public.inventory_counts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Comptage habilité" ON public.inventory_counts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'inventory.count'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'inventory.count'));

DROP POLICY "inv count lines tenant access" ON public.inventory_count_lines;
CREATE POLICY "Lecture société" ON public.inventory_count_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.inventory_counts c
                  WHERE c.id = inventory_count_lines.count_id AND c.tenant_id = public.get_user_tenant_id(auth.uid())));
CREATE POLICY "Comptage habilité" ON public.inventory_count_lines FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'inventory.count')
         AND EXISTS (SELECT 1 FROM public.inventory_counts c
                      WHERE c.id = inventory_count_lines.count_id AND c.tenant_id = public.get_user_tenant_id(auth.uid())))
  WITH CHECK (public.has_permission(auth.uid(), 'inventory.count')
              AND EXISTS (SELECT 1 FROM public.inventory_counts c
                           WHERE c.id = inventory_count_lines.count_id AND c.tenant_id = public.get_user_tenant_id(auth.uid())));

-- Un comptage validé est figé ; la validation ne se fait que par post_inventory_count.
CREATE OR REPLACE FUNCTION public.guard_inventory_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _status text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_TABLE_NAME = 'inventory_counts' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'draft' THEN
        RAISE EXCEPTION 'Un inventaire se crée en brouillon' USING ERRCODE = 'QG015';
      END IF;
    ELSIF OLD.status <> 'draft' OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status) THEN
      RAISE EXCEPTION 'Un inventaire validé ne se modifie plus ; la validation passe par « Valider l''inventaire »'
        USING ERRCODE = 'QG015';
    END IF;
  ELSE
    SELECT status INTO _status FROM public.inventory_counts WHERE id = COALESCE(NEW.count_id, OLD.count_id);
    IF COALESCE(_status, 'draft') <> 'draft' THEN
      RAISE EXCEPTION 'Les lignes d''un inventaire validé ne se modifient plus' USING ERRCODE = 'QG015';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;
CREATE TRIGGER trg_guard_inventory_count BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_counts
  FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_count();
CREATE TRIGGER trg_guard_inventory_count_lines BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_count_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_count();

-- ─── Article et dépôt de la société ───
CREATE OR REPLACE FUNCTION public.stock_item_of_tenant(_tenant uuid, _item uuid, _warehouse uuid)
 RETURNS public.items
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _i public.items%ROWTYPE;
BEGIN
  SELECT * INTO _i FROM public.items WHERE id = _item AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article introuvable dans la société active' USING ERRCODE = 'QG015'; END IF;
  IF _warehouse IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = _warehouse AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Dépôt introuvable dans la société active' USING ERRCODE = 'QG015';
  END IF;
  RETURN _i;
END $function$;
REVOKE ALL ON FUNCTION public.stock_item_of_tenant(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ─── Ajustement de stock ───
CREATE OR REPLACE FUNCTION public.create_stock_adjustment(_item_id uuid, _warehouse_id uuid, _quantity numeric,
                                                         _unit_cost numeric, _movement_date date, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _i public.items%ROWTYPE;
  _cost numeric;
  _id uuid := gen_random_uuid();
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Aucune société active' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_permission(auth.uid(), 'inventory.adjust') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'inventory.adjust')
      USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Motif de l''ajustement obligatoire' USING ERRCODE = 'QG015';
  END IF;
  IF COALESCE(_quantity, 0) = 0 THEN
    RAISE EXCEPTION 'Quantité d''ajustement nulle' USING ERRCODE = 'QG015';
  END IF;
  _i := public.stock_item_of_tenant(_tenant, _item_id, _warehouse_id);
  -- Une sortie se valorise au coût moyen ; une entrée au coût indiqué, sinon au coût moyen.
  _cost := CASE WHEN _quantity < 0 OR COALESCE(_unit_cost, 0) <= 0 THEN COALESCE(_i.average_cost, 0) ELSE _unit_cost END;
  INSERT INTO public.stock_movements (id, tenant_id, item_id, movement_type, quantity, unit_cost, warehouse_id, movement_date,
                                      reference_type, created_by, status, reason)
  VALUES (_id, _tenant, _item_id, 'adjustment', _quantity, _cost, _warehouse_id, COALESCE(_movement_date, CURRENT_DATE),
          'adjustment', auth.uid(), 'posted', btrim(_reason));
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.create_stock_adjustment(uuid, uuid, numeric, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_stock_adjustment(uuid, uuid, numeric, numeric, date, text) TO authenticated;

-- ─── Transfert entre dépôts ───
CREATE OR REPLACE FUNCTION public.transfer_stock(_item_id uuid, _from_wh uuid, _to_wh uuid, _qty numeric, _notes text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _i public.items%ROWTYPE;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Aucune société active' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_inventory_perm(auth.uid(), 'transfer') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'inventory.transfer')
      USING ERRCODE = '42501';
  END IF;
  IF COALESCE(_qty, 0) <= 0 THEN RAISE EXCEPTION 'La quantité transférée doit être positive' USING ERRCODE = 'QG015'; END IF;
  IF _from_wh IS NULL OR _to_wh IS NULL OR _from_wh = _to_wh THEN
    RAISE EXCEPTION 'Choisir deux dépôts différents' USING ERRCODE = 'QG015';
  END IF;
  _i := public.stock_item_of_tenant(_tenant, _item_id, _from_wh);
  PERFORM public.stock_item_of_tenant(_tenant, _item_id, _to_wh);

  INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, unit_cost, warehouse_id, reference_type,
                                      created_by, status, reason)
  VALUES (_tenant, _item_id, 'transfer_out', -_qty, COALESCE(_i.average_cost, 0), _from_wh, 'transfer', auth.uid(), 'posted',
          NULLIF(btrim(COALESCE(_notes, '')), '')),
         (_tenant, _item_id, 'transfer_in', _qty, COALESCE(_i.average_cost, 0), _to_wh, 'transfer', auth.uid(), 'posted',
          NULLIF(btrim(COALESCE(_notes, '')), ''));

  PERFORM public.notify_inventory(_tenant, 'info', 'Transfert stock', _qty || ' unités déplacées', _item_id::text);
END $function$;

-- ─── Validation d'un inventaire : attendu = stock à la validation, valorisé au coût moyen ───
CREATE OR REPLACE FUNCTION public.post_inventory_count(_count_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c public.inventory_counts%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _line record;
  _ecart numeric;
BEGIN
  IF NOT public.has_inventory_perm(auth.uid(), 'post_count') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'inventory.post_count')
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _c FROM public.inventory_counts WHERE id = _count_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventaire introuvable dans la société active' USING ERRCODE = 'QG015'; END IF;
  IF _c.status = 'posted' THEN RAISE EXCEPTION 'Inventaire déjà validé' USING ERRCODE = 'QG015'; END IF;

  FOR _line IN
    SELECT l.id, l.item_id, l.counted_qty, i.quantity_on_hand, i.average_cost
      FROM public.inventory_count_lines l
      JOIN public.items i ON i.id = l.item_id AND i.tenant_id = _tenant
     WHERE l.count_id = _count_id
       FOR UPDATE OF i
  LOOP
    _ecart := COALESCE(_line.counted_qty, 0) - COALESCE(_line.quantity_on_hand, 0);
    UPDATE public.inventory_count_lines
       SET expected_qty = COALESCE(_line.quantity_on_hand, 0), unit_cost = COALESCE(_line.average_cost, 0)
     WHERE id = _line.id;
    IF _ecart <> 0 THEN
      INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, unit_cost, warehouse_id, reference_type,
                                          reference_id, created_by, status, reason)
      VALUES (_tenant, _line.item_id, 'adjustment', _ecart, COALESCE(_line.average_cost, 0), _c.warehouse_id, 'inventory_count',
              _count_id, auth.uid(), 'posted', 'Inventaire ' || _c.count_number);
    END IF;
  END LOOP;

  UPDATE public.inventory_counts SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _count_id;
  PERFORM public.notify_inventory(_tenant, 'success', 'Inventaire validé', _c.count_number, _count_id::text);
END $function$;
