-- Enable cron + http extensions for scheduler
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =========================
-- AI Analysis History
-- =========================
CREATE TABLE public.ai_analysis_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  analysis_type text NOT NULL CHECK (analysis_type IN ('cashflow_forecast', 'gl_anomaly_detection')),
  trigger_source text NOT NULL DEFAULT 'manual' CHECK (trigger_source IN ('manual', 'scheduled')),
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'partial')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  duration_ms integer,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_history_tenant_created ON public.ai_analysis_history (tenant_id, created_at DESC);
CREATE INDEX idx_ai_history_tenant_type ON public.ai_analysis_history (tenant_id, analysis_type, created_at DESC);

ALTER TABLE public.ai_analysis_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation"
ON public.ai_analysis_history
FOR ALL
TO authenticated
USING (tenant_id = public.get_user_tenant_id(auth.uid()))
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- =========================
-- AI Analysis Schedules
-- =========================
CREATE TABLE public.ai_analysis_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  analysis_type text NOT NULL CHECK (analysis_type IN ('cashflow_forecast', 'gl_anomaly_detection')),
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  enabled boolean NOT NULL DEFAULT true,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, analysis_type)
);

CREATE INDEX idx_ai_schedules_next_run ON public.ai_analysis_schedules (enabled, next_run_at) WHERE enabled = true;

ALTER TABLE public.ai_analysis_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view schedules"
ON public.ai_analysis_schedules
FOR SELECT
TO authenticated
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Admins can manage schedules"
ON public.ai_analysis_schedules
FOR ALL
TO authenticated
USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- Trigger to auto update updated_at
CREATE OR REPLACE FUNCTION public.touch_ai_schedules_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_ai_schedules
BEFORE UPDATE ON public.ai_analysis_schedules
FOR EACH ROW EXECUTE FUNCTION public.touch_ai_schedules_updated_at();

-- Realtime support for history
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_analysis_history;