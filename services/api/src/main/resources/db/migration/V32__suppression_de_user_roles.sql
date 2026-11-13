-- V32 — Fin de la transition : user_roles est supprimée. Écrit à la main.
--
-- Depuis V23, les droits se lisent dans la matrice (user_role_assignments → erp_roles →
-- erp_role_permissions). user_roles n'était plus qu'une table de transition, tenue cohérente par
-- deux recopies (V23 user_roles → matrice, V25 matrice → user_roles). Depuis V31 plus rien ne
-- l'écrit en dehors de ces recopies, et plus rien ne la lit (écrans : V27 et listes de membres ;
-- fonctions : V29 pour la dernière lecture).
--
-- 1. Reprise : toute ligne de user_roles absente de la matrice y est ajoutée — sans perte de droit
--    en vigueur. Une ligne SANS société (écrite par les RPC cassées que V31 remplace) prend la
--    société du profil de l'utilisateur, seule interprétation possible ; sans profil rattaché,
--    elle ne donnait aucun droit et n'est pas reprise.
-- 2. Suppression des deux recopies, des témoins legacy_* (corps V8 conservés pour
--    AutorisationsEquivalenceIT, qui a prouvé l'équivalence des droits avant la bascule et
--    disparaît avec eux) et de la table. L'énumération app_role reste : elle type les rôles
--    système (erp_roles.code) et les paramètres des RPC.
--
-- Jumelle : supabase/migrations/20261113200000_7a1c5e9b-3f8d-4b2a-8e6c-9d4f1b0a3e57.sql

-- ─── 1. Reprise ───
DO $$
DECLARE
  _repris integer;
BEGIN
  WITH sources AS (
    SELECT ur.user_id, ur.role::text AS code, COALESCE(ur.tenant_id, p.tenant_id) AS tenant_id
    FROM public.user_roles ur
    LEFT JOIN public.profiles p ON p.id = ur.user_id
  ), ajouts AS (
    INSERT INTO public.user_role_assignments (user_id, role_id, tenant_id)
    SELECT DISTINCT s.user_id, r.id, s.tenant_id
    FROM sources s
    JOIN public.erp_roles r ON r.tenant_id = s.tenant_id AND r.code = s.code
    WHERE s.tenant_id IS NOT NULL
    ON CONFLICT (user_id, role_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _repris FROM ajouts;
  RAISE NOTICE 'V32 : % affectation(s) reprise(s) de user_roles dans la matrice', _repris;
END $$;

-- ─── 2. Suppressions ───
DROP TRIGGER trg_mirror_role_assignments ON public.user_role_assignments;
DROP TRIGGER trg_mirror_user_roles ON public.user_roles;
DROP FUNCTION public.mirror_role_assignments();
DROP FUNCTION public.mirror_user_roles();

DROP FUNCTION public.legacy_has_crm_perm(uuid, text);
DROP FUNCTION public.legacy_has_hr_perm(uuid, text);
DROP FUNCTION public.legacy_has_inventory_perm(uuid, text);
DROP FUNCTION public.legacy_has_procurement_perm(uuid, text, integer);
DROP FUNCTION public.legacy_has_sales_perm(uuid, text);
DROP FUNCTION public.legacy_has_treasury_perm(uuid, text);
DROP FUNCTION public.legacy_has_role(uuid, public.app_role);

DROP TABLE public.user_roles;
