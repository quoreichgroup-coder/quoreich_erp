REVOKE EXECUTE ON FUNCTION public.seed_ap_defaults(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_ap_defaults(uuid) TO authenticated, service_role;