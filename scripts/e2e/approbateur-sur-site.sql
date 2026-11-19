-- Second membre de la société de test SUR SITE (approbations par un tiers). Rejouable.
--
--   docker exec -i qerp-dev-postgres psql -U postgres -d qerp_reel -v user_id=<uuid du compte de test> \
--     -v approver_id=<uuid du compte approbateur> -v ON_ERROR_STOP=1 --single-transaction -f - < scripts/e2e/approbateur-sur-site.sql
--
-- Même identifiant que dans le nuage (l'API valide les jetons du projet Supabase tant que l'identité sur site
-- n'existe pas). Rôles d'approbateur des circuits : achats N3, gestionnaire, comptable (comme dans le nuage : validation des coordonnées bancaires), RH,
-- auditeur de conformité ; attribués comme par l'écran des rôles (user_role_assignments).

SELECT set_config('qerp.e2e_user', :'user_id', true) IS NOT NULL AS auteur_lu,
       set_config('qerp.e2e_approver', :'approver_id', true) IS NOT NULL AS approbateur_lu;

DO $$
DECLARE
  _user uuid := current_setting('qerp.e2e_user')::uuid;
  _approver uuid := current_setting('qerp.e2e_approver')::uuid;
  _tenant uuid := (SELECT tenant_id FROM public.profiles WHERE id = current_setting('qerp.e2e_user')::uuid);
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Société sur site absente : jouer d''abord scripts/e2e/societe-sur-site.sql'; END IF;
  INSERT INTO auth.users (id) VALUES (_approver) ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, tenant_id, full_name) VALUES (_approver, _tenant, 'Approbateur E2E')
    ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
  INSERT INTO public.user_role_assignments (user_id, role_id, tenant_id, assigned_by)
  SELECT _approver, r.id, _tenant, _user FROM public.erp_roles r
   WHERE r.tenant_id = _tenant AND r.code IN ('procurement_l3', 'manager', 'accountant', 'compliance_auditor', 'hr_approver')
  ON CONFLICT DO NOTHING;
  RAISE NOTICE 'Approbateur % ajouté à la société sur site %', _approver, _tenant;
END $$;
