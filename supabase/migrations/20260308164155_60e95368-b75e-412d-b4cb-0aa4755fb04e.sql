
-- Remove the overly permissive tenants INSERT policy since we now use SECURITY DEFINER functions
DROP POLICY IF EXISTS "Authenticated users can create tenants" ON public.tenants;
