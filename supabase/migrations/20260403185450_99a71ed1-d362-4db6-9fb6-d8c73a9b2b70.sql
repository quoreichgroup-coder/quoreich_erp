
-- GL Audit Logs table
CREATE TABLE public.gl_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  batch_id text NOT NULL,
  entry_id uuid REFERENCES public.journal_entries(id),
  action text NOT NULL,
  user_name text NOT NULL DEFAULT 'System',
  details text,
  hash text NOT NULL DEFAULT '',
  prev_hash text NOT NULL DEFAULT '00000000',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.gl_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.gl_audit_logs
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

-- Index for fast batch lookups
CREATE INDEX idx_gl_audit_logs_batch ON public.gl_audit_logs(batch_id);
CREATE INDEX idx_gl_audit_logs_tenant ON public.gl_audit_logs(tenant_id);

-- Trigger: auto-log journal entry status changes
CREATE OR REPLACE FUNCTION public.log_journal_entry_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _action text;
  _details text;
  _batch_id text;
  _prev_hash text;
  _new_hash text;
BEGIN
  -- Determine action
  IF TG_OP = 'INSERT' THEN
    _action := 'Created';
    _details := 'Journal entry created: ' || NEW.entry_number || COALESCE(' — ' || NEW.description, '');
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> NEW.status THEN
      CASE NEW.status
        WHEN 'posted' THEN _action := 'Posted'; _details := 'Posted to GL by ' || COALESCE(NEW.posted_by::text, 'System');
        WHEN 'validated' THEN _action := 'Approved'; _details := 'Approved for posting';
        WHEN 'rejected' THEN _action := 'Rejected'; _details := 'Entry rejected';
        WHEN 'cancelled' THEN _action := 'Cancelled'; _details := 'Entry cancelled';
        WHEN 'reversed' THEN _action := 'Reversed'; _details := 'Entry reversed — compensating entry created';
        ELSE _action := 'Updated'; _details := 'Status changed from ' || OLD.status || ' to ' || NEW.status;
      END CASE;
    ELSE
      _action := 'Updated';
      _details := 'Entry modified: ' || NEW.entry_number;
    END IF;
  END IF;

  -- Build batch ID from source + date
  _batch_id := 'GLB-' || UPPER(COALESCE(
    CASE NEW.source
      WHEN 'ar_receipt' THEN 'AR'
      WHEN 'ar_invoice' THEN 'AR'
      WHEN 'ap_payment' THEN 'AP'
      WHEN 'ap_invoice' THEN 'AP'
      WHEN 'manual' THEN 'GL'
      ELSE UPPER(LEFT(NEW.source, 4))
    END, 'GL')) || '-' || to_char(NEW.entry_date, 'YYYYMMDD');

  -- Get previous hash for chain integrity
  SELECT COALESCE(hash, '00000000') INTO _prev_hash
  FROM public.gl_audit_logs
  WHERE tenant_id = NEW.tenant_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF _prev_hash IS NULL THEN _prev_hash := '00000000'; END IF;

  -- Simple hash (MD5 truncated)
  _new_hash := UPPER(LEFT(md5(_prev_hash || _action || NEW.id::text || now()::text), 8));

  INSERT INTO public.gl_audit_logs (tenant_id, batch_id, entry_id, action, user_name, details, hash, prev_hash)
  VALUES (NEW.tenant_id, _batch_id, NEW.id, _action, COALESCE(NEW.created_by::text, 'System'), _details, _new_hash, _prev_hash);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_journal_entry_audit
  AFTER INSERT OR UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_journal_entry_audit();
