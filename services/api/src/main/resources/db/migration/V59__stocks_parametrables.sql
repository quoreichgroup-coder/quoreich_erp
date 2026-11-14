-- V59 — Stocks paramétrables (écart G-51, même méthode que V57 / V58).
--
-- 1. Droits du catalogue au lieu de l'administrateur codé en dur ou de rôles écrits dans l'écran,
--    accordés par défaut aux mêmes rôles qu'avant :
--      inventory.settings (paramètres de stock : avant, administrateur seulement),
--      inventory.delete_item (supprimer un article : avant, administrateur seulement),
--      inventory.export (exports CSV des stocks : avant, rôles écrits dans l'écran).
-- 2. Règle paramétrable : inventory_settings.adjustment_reason_required (motif obligatoire sur un
--    ajustement de stock ; oui par défaut).

INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('inventory.settings', 'inventory', 'settings', 'Modifier les paramètres de stock'),
  ('inventory.delete_item', 'inventory', 'delete_item', 'Supprimer un article'),
  ('inventory.export', 'inventory', 'export', 'Exporter les données de stock')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES
  ('admin', 'inventory.settings'), ('admin', 'inventory.delete_item'),
  ('admin', 'inventory.export'), ('inventory_manager', 'inventory.export'), ('inventory_controller', 'inventory.export')) AS v(r, p)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code IN ('inventory.settings', 'inventory.delete_item', 'inventory.export') AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

DROP POLICY "Administrateur de la société" ON public.inventory_settings;
CREATE POLICY "Paramétrage habilité" ON public.inventory_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'inventory.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'inventory.settings'));
DROP POLICY "Suppression administrateur" ON public.items;
CREATE POLICY "Suppression habilitée" ON public.items FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'inventory.delete_item'));

ALTER TABLE public.inventory_settings ADD COLUMN adjustment_reason_required boolean NOT NULL DEFAULT true;

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
  _reason_required boolean;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Aucune société active' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_permission(auth.uid(), 'inventory.adjust') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'inventory.adjust')
      USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(adjustment_reason_required, true) INTO _reason_required FROM public.inventory_settings WHERE tenant_id = _tenant;
  IF COALESCE(_reason_required, true) AND (_reason IS NULL OR btrim(_reason) = '') THEN
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
          'adjustment', auth.uid(), 'posted', NULLIF(btrim(COALESCE(_reason, '')), ''));
  RETURN _id;
END $function$;
