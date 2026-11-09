
-- 1) Security fixes: drop unscoped admin SELECT policies on cross-tenant role audit tables
DROP POLICY IF EXISTS "budget_audit_admin_select" ON public.budget_role_audit;
DROP POLICY IF EXISTS "compliance_audit_admin_select" ON public.compliance_role_audit;
DROP POLICY IF EXISTS "Project admins read tenant audit" ON public.project_role_audit;

-- 2) Realtime notifications: enable replica identity + add to publication
ALTER TABLE public.erp_alerts REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.erp_alerts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- 3) Resolve alert RPC (SECURITY DEFINER, tenant-scoped)
CREATE OR REPLACE FUNCTION public.resolve_erp_alert(_alert_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.erp_alerts WHERE id = _alert_id;
  IF v_tenant IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_role_assignments
    WHERE user_id = auth.uid() AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.erp_alerts
     SET is_resolved = true,
         resolved_at = now(),
         resolved_by = auth.uid()::text
   WHERE id = _alert_id;
  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.resolve_erp_alert(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_erp_alert(uuid) TO authenticated;
