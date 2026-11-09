
-- 1. has_treasury_perm
CREATE OR REPLACE FUNCTION public.has_treasury_perm(_user_id uuid, _action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR public.has_role(_user_id, 'cash_admin'::public.app_role)
    OR CASE _action
      WHEN 'create_txn'       THEN public.has_role(_user_id,'treasury_clerk'::public.app_role)
                                OR public.has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'import_statement' THEN public.has_role(_user_id,'treasury_clerk'::public.app_role)
                                OR public.has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'match'            THEN public.has_role(_user_id,'treasury_clerk'::public.app_role)
                                OR public.has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'validate_recon'   THEN public.has_role(_user_id,'treasury_manager'::public.app_role)
                                OR public.has_role(_user_id,'treasury_controller'::public.app_role)
      WHEN 'edit_forecast'    THEN public.has_role(_user_id,'treasury_manager'::public.app_role)
                                OR public.has_role(_user_id,'treasury_controller'::public.app_role)
      WHEN 'manage_accounts'  THEN public.has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'export'           THEN public.has_role(_user_id,'treasury_manager'::public.app_role)
                                OR public.has_role(_user_id,'treasury_controller'::public.app_role)
      WHEN 'view_sensitive'   THEN public.has_role(_user_id,'treasury_clerk'::public.app_role)
                                OR public.has_role(_user_id,'treasury_manager'::public.app_role)
                                OR public.has_role(_user_id,'treasury_controller'::public.app_role)
      WHEN 'close_period'     THEN public.has_role(_user_id,'treasury_controller'::public.app_role)
                                OR public.has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'audit'            THEN public.has_role(_user_id,'treasury_controller'::public.app_role)
                                OR public.has_role(_user_id,'treasury_manager'::public.app_role)
      ELSE false
    END
$$;
REVOKE EXECUTE ON FUNCTION public.has_treasury_perm(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_treasury_perm(uuid, text) TO authenticated, service_role;

-- 2. Extend treasury_role_audit action check
ALTER TABLE public.treasury_role_audit DROP CONSTRAINT IF EXISTS treasury_role_audit_action_check;
ALTER TABLE public.treasury_role_audit ADD CONSTRAINT treasury_role_audit_action_check
  CHECK (action IN (
    'assign','revoke',
    'period_close_started','period_close_completed','period_close_failed','period_close_idempotent',
    'export_csv','export_pdf','export_aborted','export_failed'
  ));

-- 3. treasury_period_closes
CREATE TABLE IF NOT EXISTS public.treasury_period_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  period text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  attempt int NOT NULL DEFAULT 1,
  total_balance numeric(18,2) NOT NULL DEFAULT 0,
  accounts_count int NOT NULL DEFAULT 0,
  reconciliations_count int NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  closed_by uuid NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period)
);
GRANT SELECT, INSERT ON public.treasury_period_closes TO authenticated;
GRANT ALL ON public.treasury_period_closes TO service_role;
ALTER TABLE public.treasury_period_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_treasury_closes_select" ON public.treasury_period_closes;
CREATE POLICY "tenant_treasury_closes_select" ON public.treasury_period_closes FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "tenant_treasury_closes_insert" ON public.treasury_period_closes;
CREATE POLICY "tenant_treasury_closes_insert" ON public.treasury_period_closes FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid())
              AND closed_by = auth.uid()
              AND public.has_treasury_perm(auth.uid(), 'close_period'));

CREATE INDEX IF NOT EXISTS idx_tpc_tenant_period ON public.treasury_period_closes(tenant_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_tpc_status ON public.treasury_period_closes(tenant_id, status);

-- 4. close_treasury_period RPC
CREATE OR REPLACE FUNCTION public.close_treasury_period(_period text)
RETURNS public.treasury_period_closes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _user uuid := auth.uid();
  _existing public.treasury_period_closes;
  _row public.treasury_period_closes;
  _snapshot jsonb;
  _total_balance numeric := 0;
  _accounts_count int := 0;
  _recon_count int := 0;
  _open_drafts int := 0;
  _period_start date;
  _period_end date;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;
  IF NOT public.has_treasury_perm(_user, 'close_period') THEN
    RAISE EXCEPTION 'forbidden: requires treasury close permission';
  END IF;
  IF _period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid period format, expected YYYY-MM';
  END IF;

  _period_start := to_date(_period || '-01','YYYY-MM-DD');
  _period_end := (_period_start + interval '1 month - 1 day')::date;

  SELECT * INTO _existing FROM public.treasury_period_closes
   WHERE tenant_id = _tenant AND period = _period;
  IF FOUND THEN
    INSERT INTO public.treasury_role_audit
      (tenant_id, actor_id, target_user_id, role, action, comment)
    VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
            'period_close_idempotent', _period);
    RETURN _existing;
  END IF;

  IF EXISTS (SELECT 1 FROM public.period_locks
              WHERE tenant_id = _tenant AND period = _period AND module = 'treasury'
                AND status = 'closed') THEN
    INSERT INTO public.treasury_role_audit
      (tenant_id, actor_id, target_user_id, role, action, comment)
    VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
            'period_close_failed', _period || ' | already_locked');
    RAISE EXCEPTION 'period already locked';
  END IF;

  SELECT COUNT(*) INTO _open_drafts
    FROM public.bank_reconciliations
   WHERE tenant_id = _tenant
     AND status = 'draft'
     AND period_end <= _period_end
     AND period_end >= _period_start;
  IF _open_drafts > 0 THEN
    INSERT INTO public.treasury_role_audit
      (tenant_id, actor_id, target_user_id, role, action, comment)
    VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
            'period_close_failed',
            _period || ' | unreconciled:' || _open_drafts);
    RAISE EXCEPTION 'unreconciled: % open reconciliation(s) in period', _open_drafts;
  END IF;

  INSERT INTO public.treasury_role_audit
    (tenant_id, actor_id, target_user_id, role, action, comment)
  VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
          'period_close_started', _period);

  SELECT COALESCE(jsonb_build_object(
      'accounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', id, 'name', name, 'bank_name', bank_name, 'currency', currency,
          'balance', balance, 'last_reconciled_at', last_reconciled_at))
        FROM public.bank_accounts WHERE tenant_id = _tenant), '[]'::jsonb),
      'reconciliations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', id, 'bank_account_id', bank_account_id, 'period_start', period_start,
          'period_end', period_end, 'status', status, 'ending_balance', ending_balance))
        FROM public.bank_reconciliations
        WHERE tenant_id = _tenant AND period_end >= _period_start AND period_end <= _period_end),
        '[]'::jsonb),
      'period_start', _period_start, 'period_end', _period_end
    ), '{}'::jsonb)
    INTO _snapshot;

  SELECT COALESCE(SUM(balance), 0), COUNT(*) INTO _total_balance, _accounts_count
    FROM public.bank_accounts WHERE tenant_id = _tenant;
  SELECT COUNT(*) INTO _recon_count
    FROM public.bank_reconciliations
   WHERE tenant_id = _tenant AND period_end >= _period_start AND period_end <= _period_end;

  INSERT INTO public.treasury_period_closes
    (tenant_id, period, status, total_balance, accounts_count, reconciliations_count,
     snapshot, closed_by)
  VALUES (_tenant, _period, 'completed', _total_balance, _accounts_count, _recon_count,
          _snapshot, _user)
  RETURNING * INTO _row;

  INSERT INTO public.period_locks (tenant_id, period, module, status, closed_by, closed_at)
  VALUES (_tenant, _period, 'treasury', 'closed', _user, now())
  ON CONFLICT (tenant_id, period, module) DO UPDATE
    SET status='closed', closed_by = EXCLUDED.closed_by, closed_at = EXCLUDED.closed_at;

  INSERT INTO public.treasury_role_audit
    (tenant_id, actor_id, target_user_id, role, action, comment)
  VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
          'period_close_completed', _period);

  RETURN _row;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.close_treasury_period(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_treasury_period(text) TO authenticated;

-- 5. View (security_invoker so RLS applies)
DROP VIEW IF EXISTS public.treasury_close_history_view;
CREATE VIEW public.treasury_close_history_view
WITH (security_invoker = on) AS
SELECT
  c.id, c.tenant_id, c.period, c.status, c.attempt,
  c.total_balance, c.accounts_count, c.reconciliations_count,
  c.error_message, c.closed_by, c.closed_at, c.created_at,
  p.full_name AS closed_by_name
FROM public.treasury_period_closes c
LEFT JOIN public.profiles p ON p.id = c.closed_by;
GRANT SELECT ON public.treasury_close_history_view TO authenticated;
