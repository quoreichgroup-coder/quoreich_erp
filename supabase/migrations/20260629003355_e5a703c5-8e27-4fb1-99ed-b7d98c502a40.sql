-- Defensive: ensure UNIQUE constraints required by close_treasury_period's ON CONFLICT clauses exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.treasury_period_closes'::regclass
      AND contype = 'u'
      AND conkey = (
        SELECT array_agg(attnum ORDER BY attnum)
        FROM pg_attribute
        WHERE attrelid = 'public.treasury_period_closes'::regclass
          AND attname = ANY(ARRAY['tenant_id','period'])
      )
  ) THEN
    ALTER TABLE public.treasury_period_closes
      ADD CONSTRAINT treasury_period_closes_tenant_period_uk UNIQUE (tenant_id, period);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.period_locks'::regclass
      AND contype = 'u'
      AND conkey = (
        SELECT array_agg(attnum ORDER BY attnum)
        FROM pg_attribute
        WHERE attrelid = 'public.period_locks'::regclass
          AND attname = ANY(ARRAY['tenant_id','period','module'])
      )
  ) THEN
    ALTER TABLE public.period_locks
      ADD CONSTRAINT period_locks_tenant_period_module_uk UNIQUE (tenant_id, period, module);
  END IF;
END $$;