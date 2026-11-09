
-- ERP Roles table
CREATE TABLE public.erp_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.erp_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.erp_roles
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE UNIQUE INDEX erp_roles_tenant_name ON public.erp_roles (tenant_id, name);

-- ERP Permissions table
CREATE TABLE public.erp_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  role_id uuid NOT NULL REFERENCES public.erp_roles(id) ON DELETE CASCADE,
  module text NOT NULL,
  permission text NOT NULL,
  UNIQUE (role_id, module, permission)
);

ALTER TABLE public.erp_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access via role" ON public.erp_permissions
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.erp_roles r
    WHERE r.id = erp_permissions.role_id
    AND r.tenant_id = get_user_tenant_id(auth.uid())
  ));

-- User Role Assignments table
CREATE TABLE public.user_role_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.erp_roles(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid,
  UNIQUE (user_id, role_id)
);

ALTER TABLE public.user_role_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.user_role_assignments
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

-- Allow profiles to be read by same-tenant users (needed for user management)
CREATE POLICY "Same tenant can view profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));
