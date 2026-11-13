-- V27 — Ce que l'utilisateur peut faire, dit par la base. Écrit à la main.
--
-- Les écrans calculaient eux-mêmes quels boutons activer, à partir de user_roles lu SANS
-- filtre de société, et d'une correspondance rôle → action recopiée dans onze fichiers
-- *-roles.ts. Elle dérivait de la base (la trésorerie ignorait admin, à qui la base donne
-- tout) et ne pouvait pas connaître les rôles sur mesure de la matrice.
--
-- my_access() renvoie, pour l'utilisateur connecté et dans SA société :
--   roles        codes des rôles système détenus (pour les modules que la base contrôle
--                encore par has_role : budget, projets, notes de frais, risques, conformité,
--                immobilisations) ;
--   permissions  droits du catalogue accordés par tous ses rôles, sur mesure compris, hors
--                rôles « à revoir » — exactement ce que vérifie has_permission().
--
-- Corrige aussi trois politiques qui ne vérifiaient pas la société : « Admins view all roles »
-- (user_roles), risk_audit_admin_select et budget_audit_admin_insert.
--
-- Jumelle : supabase/migrations/20261113150000_6b3d8f1a-2e7c-4a9d-b4f6-0c5e9a1d7b28.sql

CREATE FUNCTION public.my_access() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'roles', COALESCE((
      SELECT jsonb_agg(DISTINCT r.code ORDER BY r.code)
      FROM public.user_role_assignments a
      JOIN public.erp_roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
      WHERE a.user_id = auth.uid()
        AND a.tenant_id = public.get_user_tenant_id(auth.uid())
        AND r.code IS NOT NULL), '[]'::jsonb),
    'permissions', COALESCE((
      SELECT jsonb_agg(DISTINCT p.permission_code ORDER BY p.permission_code)
      FROM public.user_role_assignments a
      JOIN public.erp_roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
      JOIN public.erp_role_permissions p ON p.role_id = r.id
      WHERE a.user_id = auth.uid()
        AND a.tenant_id = public.get_user_tenant_id(auth.uid())
        AND NOT r.needs_review), '[]'::jsonb))
$$;

REVOKE ALL ON FUNCTION public.my_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_access() TO authenticated, service_role;

-- ─── Fuite corrigée : « Admins view all roles » ───
-- La politique du schéma de production laissait tout administrateur lire les user_roles de
-- TOUTES les sociétés (identifiants d'utilisateurs, rôles, société) : USING has_role(admin),
-- sans condition de société. Les listes de membres des écrans de rôles ne filtrent pas
-- elles-mêmes. Même nom, condition de société ajoutée.
DROP POLICY "Admins view all roles" ON public.user_roles;
CREATE POLICY "Admins view all roles" ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
         AND tenant_id = public.get_user_tenant_id(auth.uid()));

-- Même défaut sur deux journaux de rôles (politiques permissives : elles s'ajoutent aux
-- versions limitées à la société qui existent à côté, et les annulent en pratique) :
--   risk_audit_admin_select   tout administrateur lisait le journal des rôles risques de toutes
--                             les sociétés ;
--   budget_audit_admin_insert un administrateur pouvait écrire une ligne au nom de n'importe
--                             quelle société.
DROP POLICY risk_audit_admin_select ON public.risk_role_audit;
CREATE POLICY risk_audit_admin_select ON public.risk_role_audit FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
         AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'risk_admin'::public.app_role)));
DROP POLICY budget_audit_admin_insert ON public.budget_role_audit;
CREATE POLICY budget_audit_admin_insert ON public.budget_role_audit FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid()
              AND tenant_id = public.get_user_tenant_id(auth.uid())
              AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'budget_admin'::public.app_role)));
