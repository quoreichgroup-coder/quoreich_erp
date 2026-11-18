-- V83 - types et motifs de mouvements RH parametres par societe.
-- Aucun motif juridique n'est preconfigure : l'administrateur de la societe gere ses valeurs.
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('hr.manage_movement_settings', 'hr', 'manage_movement_settings', 'Configurer les types et motifs de mouvements RH')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
VALUES ('admin', 'hr.manage_movement_settings'), ('hr_admin', 'hr.manage_movement_settings')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND r.code IN ('admin', 'hr_admin')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

CREATE TABLE public.hr_movement_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('movement_type', 'reason_code')),
  code text NOT NULL CHECK (code ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, code),
  UNIQUE (id, tenant_id, kind, code)
);
CREATE INDEX hr_movement_references_active_idx
  ON public.hr_movement_references (tenant_id, kind, active, sort_order, label);
ALTER TABLE public.hr_movement_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_movement_references FROM authenticated;
GRANT SELECT (id, tenant_id, kind, code, label, active, sort_order, created_at, updated_at)
  ON public.hr_movement_references TO authenticated;
CREATE POLICY hr_movement_references_select ON public.hr_movement_references FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_hr_perm(auth.uid(), 'view_employee_history')
      OR public.has_hr_perm(auth.uid(), 'create_employee_movement')
      OR public.has_hr_perm(auth.uid(), 'approve_employee_movement')
      OR public.has_hr_perm(auth.uid(), 'manage_movement_settings')));
CREATE POLICY hr_movement_references_no_direct_write ON public.hr_movement_references FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE FUNCTION public.list_hr_movement_references(_include_inactive boolean DEFAULT false)
RETURNS TABLE (id uuid, tenant_id uuid, kind text, code text, label text, active boolean, sort_order integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT (
      public.has_hr_perm(auth.uid(), 'view_employee_history')
      OR public.has_hr_perm(auth.uid(), 'create_employee_movement')
      OR public.has_hr_perm(auth.uid(), 'approve_employee_movement')
      OR public.has_hr_perm(auth.uid(), 'manage_movement_settings')) THEN
    RAISE EXCEPTION 'Droit insuffisant pour consulter les referentiels RH' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT r.id, r.tenant_id, r.kind, r.code, r.label, r.active, r.sort_order
    FROM public.hr_movement_references r
   WHERE r.tenant_id = _tenant AND (_include_inactive OR r.active)
   ORDER BY r.kind, r.sort_order, r.label, r.code;
END
$function$;

CREATE FUNCTION public.save_hr_movement_reference(
  _kind text, _code text, _label text, _active boolean DEFAULT true, _sort_order integer DEFAULT 0)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid;
  _normalized_code text := lower(btrim(_code));
  _normalized_label text := btrim(_label);
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_movement_settings') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_movement_settings' USING ERRCODE = '42501';
  END IF;
  IF _kind NOT IN ('movement_type', 'reason_code') OR _normalized_code !~ '^[a-z0-9][a-z0-9._-]{0,79}$'
     OR length(_normalized_label) NOT BETWEEN 1 AND 120 OR _sort_order IS NULL THEN
    RAISE EXCEPTION 'Type, code, libelle ou ordre invalide' USING ERRCODE = 'QG028';
  END IF;
  INSERT INTO public.hr_movement_references (tenant_id, kind, code, label, active, sort_order)
  VALUES (_tenant, _kind, _normalized_code, _normalized_label, COALESCE(_active, true), _sort_order)
  ON CONFLICT (tenant_id, kind, code) DO UPDATE
    SET label = EXCLUDED.label, active = EXCLUDED.active, sort_order = EXCLUDED.sort_order, updated_at = now()
  RETURNING id INTO _id;
  RETURN _id;
END
$function$;

CREATE FUNCTION public.guard_employee_movement_references() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.hr_movement_references r
      WHERE r.tenant_id = NEW.tenant_id AND r.kind = 'movement_type' AND r.code = lower(btrim(NEW.movement_type)) AND r.active)
     OR NOT EXISTS (SELECT 1 FROM public.hr_movement_references r
      WHERE r.tenant_id = NEW.tenant_id AND r.kind = 'reason_code' AND r.code = lower(btrim(NEW.reason_code)) AND r.active) THEN
    RAISE EXCEPTION 'Le type et le motif doivent etre actifs dans Parametres RH' USING ERRCODE = 'QG028';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER employee_movement_configured_references
BEFORE INSERT ON public.employee_movements
FOR EACH ROW EXECUTE FUNCTION public.guard_employee_movement_references();

-- Un approbateur peut charger la liste nécessaire à sa décision sans recevoir le droit d'édition.
CREATE OR REPLACE FUNCTION public.list_employee_movements(_employee_id uuid)
RETURNS TABLE (
  id uuid, tenant_id uuid, employee_id uuid, movement_type text, effective_date date,
  reason_code text, reason text, before_values jsonb, after_values jsonb, status text,
  created_by uuid, created_at timestamptz, decided_by uuid, decided_at timestamptz, decision_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _sensitive boolean := public.has_hr_perm(auth.uid(), 'view_sensitive');
BEGIN
  IF _tenant IS NULL OR (NOT public.has_hr_perm(auth.uid(), 'view_employee_history')
      AND NOT public.has_hr_perm(auth.uid(), 'approve_employee_movement')) THEN
    RAISE EXCEPTION 'Droit insuffisant pour consulter les mouvements RH' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT m.id, m.tenant_id, m.employee_id, m.movement_type, m.effective_date,
       m.reason_code, m.reason,
       CASE WHEN _sensitive THEN m.before_values ELSE m.before_values - 'base_salary' END,
       CASE WHEN _sensitive THEN m.after_values ELSE m.after_values - 'base_salary' END,
       m.status, m.created_by, m.created_at, m.decided_by, m.decided_at, m.decision_reason
    FROM public.employee_movements m
   WHERE m.tenant_id = _tenant AND m.employee_id = _employee_id
   ORDER BY m.effective_date DESC, m.created_at DESC;
END
$function$;

REVOKE ALL ON FUNCTION public.list_hr_movement_references(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_hr_movement_reference(text, text, text, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_hr_movement_references(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_hr_movement_reference(text, text, text, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_employee_movements(uuid) TO authenticated;
