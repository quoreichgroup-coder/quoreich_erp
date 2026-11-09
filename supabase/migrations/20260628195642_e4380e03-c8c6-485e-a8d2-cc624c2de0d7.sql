CREATE OR REPLACE FUNCTION public.close_inventory_period(_period text)
 RETURNS inventory_period_closes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant UUID := public.get_user_tenant_id(auth.uid());
  _user UUID := auth.uid();
  _existing public.inventory_period_closes;
  _row public.inventory_period_closes;
  _snapshot JSONB;
  _total_value NUMERIC;
  _total_qty NUMERIC;
  _items_count INTEGER;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;
  IF NOT public.has_inventory_perm(_user, 'close') THEN
    RAISE EXCEPTION 'forbidden: requires inventory close permission';
  END IF;
  IF _period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid period format, expected YYYY-MM';
  END IF;

  SELECT * INTO _existing FROM public.inventory_period_closes
   WHERE tenant_id = _tenant AND period = _period;
  IF FOUND THEN
    INSERT INTO public.inventory_role_audit
      (tenant_id, target_user_id, role, action, performed_by, comment)
    VALUES (_tenant, _user, 'inventory_controller', 'period_close_idempotent', _user, _period);
    RETURN _existing;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'item_id', item_id, 'code', code, 'name', name, 'category', category,
            'qty', quantity_on_hand, 'unit_cost', unit_cost, 'value', stock_value)), '[]'::jsonb),
         COALESCE(SUM(stock_value), 0),
         COALESCE(SUM(quantity_on_hand), 0),
         COUNT(*)
    INTO _snapshot, _total_value, _total_qty, _items_count
    FROM public.inventory_slow_moving_view
   WHERE tenant_id = _tenant;

  INSERT INTO public.inventory_period_closes
    (tenant_id, period, closed_by, total_value, total_qty, items_count, snapshot)
  VALUES (_tenant, _period, _user, _total_value, _total_qty, _items_count, _snapshot)
  RETURNING * INTO _row;

  INSERT INTO public.period_locks (tenant_id, period, module, locked_by, locked_at)
  VALUES (_tenant, _period, 'inventory', _user, now())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.inventory_role_audit
    (tenant_id, target_user_id, role, action, performed_by, comment)
  VALUES (_tenant, _user, 'inventory_controller', 'period_close', _user, _period);

  RETURN _row;
END;
$function$;