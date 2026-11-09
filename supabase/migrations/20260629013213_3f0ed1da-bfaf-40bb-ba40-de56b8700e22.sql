-- 1) read_at on erp_alerts
ALTER TABLE public.erp_alerts
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE INDEX IF NOT EXISTS erp_alerts_tenant_created_idx
  ON public.erp_alerts (tenant_id, created_at DESC);

-- 2) notification_preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  modules text[] NOT NULL DEFAULT ARRAY[]::text[],
  severities text[] NOT NULL DEFAULT ARRAY['critical','error','warning','info']::text[],
  include_resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage their own notification prefs"
  ON public.notification_preferences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_notification_preferences()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_touch_notification_prefs ON public.notification_preferences;
CREATE TRIGGER trg_touch_notification_prefs
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_notification_preferences();

-- 3) Bulk RPCs
CREATE OR REPLACE FUNCTION public.mark_all_erp_alerts_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_count integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;

  UPDATE public.erp_alerts
     SET read_at = now()
   WHERE tenant_id = v_tenant
     AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION public.mark_all_erp_alerts_read() FROM public;
GRANT EXECUTE ON FUNCTION public.mark_all_erp_alerts_read() TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_all_erp_alerts(
  _module text DEFAULT NULL,
  _severity text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_count integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;

  -- Restrict bulk resolve to admins
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  UPDATE public.erp_alerts
     SET is_resolved = true,
         resolved_at = now(),
         resolved_by = auth.uid()
   WHERE tenant_id = v_tenant
     AND is_resolved = false
     AND (_module IS NULL OR module = _module)
     AND (_severity IS NULL OR severity = _severity);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION public.resolve_all_erp_alerts(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_all_erp_alerts(text, text) TO authenticated;