
-- Allow authenticated users to INSERT tenants (for onboarding)
CREATE POLICY "Authenticated users can create tenants"
ON public.tenants
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow profiles INSERT (the trigger does it as SECURITY DEFINER, but let's also allow explicit)
CREATE POLICY "Users can insert own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());
