-- V146 — Les alertes suivent les modules autorisés, y compris en lecture directe et dans les RPC.
CREATE FUNCTION public.can_access_alert_module(_module text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND (public.is_tenant_admin() OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(public.my_access()->'permissions') AS permission(code)
    WHERE split_part(permission.code, '.', 1) = CASE regexp_replace(lower(_module), '[^a-z]', '', 'g')
      WHEN 'gl' THEN 'accounting' WHEN 'generalledger' THEN 'accounting'
      WHEN 'accountsreceivable' THEN 'ar' WHEN 'accountspayable' THEN 'ap'
      WHEN 'payroll' THEN 'hr' WHEN 'fixedassets' THEN 'assets'
      WHEN 'projectaccounting' THEN 'projects' WHEN 'expensemanagement' THEN 'expenses'
      WHEN 'risk' THEN 'risks' WHEN 'riskmanagement' THEN 'risks' WHEN 'budgetforecast' THEN 'budget'
      ELSE regexp_replace(lower(_module), '[^a-z]', '', 'g') END))
$$;
REVOKE ALL ON FUNCTION public.can_access_alert_module(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_alert_module(text) TO authenticated, service_role;

CREATE POLICY alert_module_select ON public.erp_alerts AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.can_access_alert_module(module));

CREATE OR REPLACE FUNCTION public.mark_all_erp_alerts_read() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _count integer;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Connexion et société requises' USING ERRCODE = '42501'; END IF;
  UPDATE public.erp_alerts a SET read_at = now()
   WHERE a.tenant_id = _tenant AND a.read_at IS NULL AND public.can_access_alert_module(a.module);
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_erp_alert(_alert_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _tenant uuid; _module text;
BEGIN
  SELECT a.tenant_id, a.module INTO _tenant, _module FROM public.erp_alerts a WHERE a.id = _alert_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF _tenant IS DISTINCT FROM public.get_user_tenant_id(auth.uid())
     OR NOT public.can_access_alert_module(_module) THEN
    RAISE EXCEPTION 'Accès refusé à cette alerte' USING ERRCODE = '42501';
  END IF;
  UPDATE public.erp_alerts a SET is_resolved = true, resolved_at = now(), resolved_by = auth.uid()::text
   WHERE a.id = _alert_id AND a.tenant_id = _tenant;
  RETURN true;
END $$;
