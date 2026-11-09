
-- Create a security definer function for onboarding
CREATE OR REPLACE FUNCTION public.create_tenant_for_user(_tenant_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _user_id uuid := auth.uid();
BEGIN
  -- Create tenant
  INSERT INTO public.tenants (name)
  VALUES (_tenant_name)
  RETURNING id INTO _tenant_id;

  -- Link profile to tenant
  UPDATE public.profiles
  SET tenant_id = _tenant_id
  WHERE id = _user_id;

  -- Assign admin role
  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (_user_id, 'admin', _tenant_id);

  RETURN _tenant_id;
END;
$$;

-- Create a function for joining a tenant
CREATE OR REPLACE FUNCTION public.join_tenant(_tenant_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _user_id uuid := auth.uid();
BEGIN
  -- Find tenant by name (case insensitive)
  SELECT id INTO _tenant_id
  FROM public.tenants
  WHERE lower(name) = lower(_tenant_name)
  LIMIT 1;

  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  -- Link profile to tenant
  UPDATE public.profiles
  SET tenant_id = _tenant_id
  WHERE id = _user_id;

  -- Assign viewer role
  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (_user_id, 'viewer', _tenant_id);

  RETURN _tenant_id;
END;
$$;
