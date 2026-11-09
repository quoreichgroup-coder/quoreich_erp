
-- Licenses table: stores module licenses per tenant
CREATE TABLE public.licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  module_name text NOT NULL,
  plan text NOT NULL DEFAULT 'Enterprise',
  license_type text NOT NULL DEFAULT 'per-module',
  start_date date NOT NULL,
  end_date date NOT NULL,
  max_users integer,
  active_users integer DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.licenses
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE INDEX idx_licenses_tenant ON public.licenses(tenant_id);

-- Tenant modules table: tracks module activation state per tenant
CREATE TABLE public.tenant_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  module_name text NOT NULL,
  status text NOT NULL DEFAULT 'inactive',
  activated_at timestamptz,
  deactivated_at timestamptz,
  activated_by text,
  license_id uuid REFERENCES public.licenses(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, module_name)
);

ALTER TABLE public.tenant_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.tenant_modules
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE INDEX idx_tenant_modules_tenant ON public.tenant_modules(tenant_id);
