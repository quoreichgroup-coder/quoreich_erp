ALTER TABLE public.inventory_role_audit DROP CONSTRAINT IF EXISTS inventory_role_audit_action_check;
ALTER TABLE public.inventory_role_audit ADD CONSTRAINT inventory_role_audit_action_check
  CHECK (action IN (
    'assign','revoke',
    'period_close','period_close_idempotent','period_close_attempt','period_close_failed',
    'export_csv','export_pdf','export_aborted','export_failed'
  ));