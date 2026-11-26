-- V147 : les accès des rôles standard sont personnalisables par société, sauf Administrateur.
-- Jumelle : supabase/migrations/20261121200000_3d4e5f6a-7b8c-49de-a0f1-2b3c4d5e6f7a.sql

CREATE OR REPLACE FUNCTION public.guard_system_roles() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
BEGIN
  IF current_setting('qerp.system_roles_seed', true) = 'on' THEN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
               WHERE c.oid = 'public.erp_roles'::regclass
                 AND pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE')) THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    -- Le marqueur seul est falsifiable. Refuser aussi les écritures ordinaires afin qu'il
    -- ne puisse pas servir à désactiver leur journalisation.
    RAISE EXCEPTION 'Initialisation des rôles réservée au propriétaire de la base' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'erp_roles' THEN
    IF OLD.is_system AND (TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD) THEN
      IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'L''identité d''un rôle système est protégée' USING ERRCODE = '23514';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- UPDATE peut déplacer une permission : protéger la source ET la destination.
  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM public.erp_roles r WHERE r.id = OLD.role_id AND r.code = 'admin'
  ) THEN
    IF TG_OP <> 'DELETE' OR EXISTS (
      SELECT 1 FROM public.tenants t JOIN public.erp_roles r ON r.tenant_id = t.id WHERE r.id = OLD.role_id
    ) THEN
      RAISE EXCEPTION 'Le rôle Administrateur est protégé : ses accès ne peuvent pas être modifiés' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') AND EXISTS (
    SELECT 1 FROM public.erp_roles r WHERE r.id = NEW.role_id AND r.code = 'admin'
  ) THEN
    RAISE EXCEPTION 'Le rôle Administrateur est protégé : ses accès ne peuvent pas être modifiés' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW IS DISTINCT FROM OLD THEN
    -- Le journal existant enregistre les INSERT/DELETE : passer par le remplacement
    -- atomique garantit un retrait et un ajout tracés pour chaque changement effectif.
    RAISE EXCEPTION 'Utilisez le remplacement des droits pour journaliser chaque changement' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

-- Initialiser seulement les nouveaux rôles. Un nouvel arrivant ou un appel répété ne doit
-- jamais rétablir les permissions que l'administrateur a retirées aux rôles existants.
CREATE OR REPLACE FUNCTION public.seed_tenant_system_roles(_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _previous_seed text := current_setting('qerp.system_roles_seed', true);
BEGIN
  PERFORM set_config('qerp.system_roles_seed', 'on', true);
  WITH created AS (
    INSERT INTO public.erp_roles (tenant_id, name, description, is_system, code)
    SELECT _tenant,
           CASE WHEN EXISTS (SELECT 1 FROM public.erp_roles x WHERE x.tenant_id = _tenant AND x.name = s.label AND x.code IS DISTINCT FROM s.code)
                THEN s.label || ' (système)' ELSE s.label END,
           'Rôle système', true, s.code
    FROM public.erp_system_roles s
    WHERE NOT EXISTS (SELECT 1 FROM public.erp_roles r WHERE r.tenant_id = _tenant AND r.code = s.code)
    ON CONFLICT DO NOTHING
    RETURNING id, code
  )
  INSERT INTO public.erp_role_permissions (role_id, permission_code)
  SELECT r.id, p.permission_code FROM created r
  JOIN public.erp_system_role_permissions p ON p.role_code = r.code;
  PERFORM set_config('qerp.system_roles_seed', coalesce(_previous_seed, 'off'), true);
END; $$;

-- Même opération atomique pour l'API et Supabase. SECURITY INVOKER conserve la RLS,
-- en plus des contrôles explicites de société et d'administrateur.
CREATE FUNCTION public.set_erp_role_permissions(_role uuid, _permissions text[]) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE _code text; _unknown text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_tenant_admin() THEN
    RAISE EXCEPTION 'Rôle administrateur requis dans la société courante' USING ERRCODE = '42501';
  END IF;
  SELECT r.code INTO _code FROM public.erp_roles r
  WHERE r.id = _role AND r.tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rôle introuvable dans la société courante' USING ERRCODE = 'P0002';
  END IF;
  IF _code = 'admin' THEN
    RAISE EXCEPTION 'Le rôle Administrateur est protégé : ses accès ne peuvent pas être modifiés' USING ERRCODE = '23514';
  END IF;
  IF _permissions IS NULL THEN
    RAISE EXCEPTION 'La liste des droits est requise' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(coalesce(p.code, 'NULL'), ', ' ORDER BY p.code) INTO _unknown
  FROM (SELECT DISTINCT unnest(_permissions) AS code) p
  WHERE p.code IS NULL OR NOT EXISTS (SELECT 1 FROM public.erp_permission_catalog c WHERE c.code = p.code);
  IF _unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Droits inconnus du catalogue : %', _unknown USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.erp_role_permissions p WHERE p.role_id = _role AND NOT (p.permission_code = ANY (_permissions));
  INSERT INTO public.erp_role_permissions (role_id, permission_code)
  SELECT _role, p.code FROM (SELECT DISTINCT unnest(_permissions) AS code) p
  ON CONFLICT DO NOTHING;
END; $$;

REVOKE ALL ON FUNCTION public.set_erp_role_permissions(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_erp_role_permissions(uuid, text[]) TO authenticated, service_role;
