CREATE TABLE public.erp_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  module text NOT NULL,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  message text NOT NULL,
  action_required boolean NOT NULL DEFAULT false,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.erp_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.erp_alerts
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));