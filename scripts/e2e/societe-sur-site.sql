-- Société de test des parcours SUR SITE (API Java + PostgreSQL local). Rejouable.
--
--   docker exec -i qerp-dev-postgres psql -U postgres -d qerp_reel -v user_id=<uuid du compte de test> \
--     -v ON_ERROR_STOP=1 --single-transaction -f - < scripts/e2e/societe-sur-site.sql
--
-- Tant que le fournisseur d'identité sur site (Keycloak, plan de bascule) n'existe pas, l'API
-- valide les jetons du projet Supabase : le compte de test doit donc exister dans la base locale
-- avec le MÊME identifiant que dans le nuage (scripts/e2e/compte-de-test.sql). Sa société locale,
-- « E2E QUOREICH (sur site) », est distincte de la société du nuage : chaque base a ses données.
-- Les rôles système viennent du déclencheur de création de société ; le plan SYSCOHADA est
-- appliqué comme par l'écran (apply_accounting_framework_to).

SELECT set_config('qerp.e2e_user', :'user_id', true) IS NOT NULL AS parametre_lu;

DO $$
DECLARE
  _user uuid := current_setting('qerp.e2e_user')::uuid;
  _tenant uuid;
BEGIN
  INSERT INTO auth.users (id) VALUES (_user) ON CONFLICT DO NOTHING;
  SELECT tenant_id INTO _tenant FROM public.profiles WHERE id = _user;
  IF _tenant IS NULL THEN
    INSERT INTO public.tenants (name) VALUES ('E2E QUOREICH (sur site)') RETURNING id INTO _tenant;
    INSERT INTO public.profiles (id, tenant_id, full_name) VALUES (_user, _tenant, 'Testeur E2E')
      ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
  END IF;
  INSERT INTO public.user_role_assignments (user_id, role_id, tenant_id, assigned_by)
  SELECT _user, r.id, _tenant, _user FROM public.erp_roles r WHERE r.tenant_id = _tenant AND r.code = 'admin'
  ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_posting_accounts WHERE tenant_id = _tenant) THEN
    PERFORM public.apply_accounting_framework_to(_tenant, 'SYSCOHADA_REVISE', _user);
  END IF;
  RAISE NOTICE 'Société sur site % prête pour %', _tenant, _user;
END $$;
