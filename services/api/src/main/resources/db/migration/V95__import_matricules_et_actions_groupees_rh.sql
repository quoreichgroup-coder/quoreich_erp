-- V95: employee numbering, mass import, and configurable bulk movement actions.
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('hr.manage_employee_number_settings', 'hr', 'manage_employee_number_settings', 'Configurer la numérotation des salariés')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
VALUES ('admin', 'hr.manage_employee_number_settings'), ('hr_admin', 'hr.manage_employee_number_settings')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND r.code IN ('admin', 'hr_admin')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

ALTER TABLE public.hr_movement_references
  ADD COLUMN bulk_action_field text,
  ADD COLUMN bulk_action_options jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.hr_movement_references
  ADD CONSTRAINT hr_movement_references_bulk_field_check
    CHECK (bulk_action_field IS NULL OR bulk_action_field IN ('status', 'department', 'job_title', 'contract_type', 'end_date')),
  ADD CONSTRAINT hr_movement_references_bulk_options_check
    CHECK (jsonb_typeof(bulk_action_options) = 'array' AND jsonb_array_length(bulk_action_options) <= 200);
GRANT SELECT (bulk_action_field, bulk_action_options) ON public.hr_movement_references TO authenticated;

CREATE TABLE public.hr_employee_number_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  prefix text NOT NULL DEFAULT 'EMP' CHECK (length(btrim(prefix)) BETWEEN 1 AND 24),
  include_year boolean NOT NULL DEFAULT false,
  separator text NOT NULL DEFAULT '-' CHECK (length(separator) <= 5 AND separator !~ '[[:cntrl:]]'),
  number_width integer NOT NULL DEFAULT 5 CHECK (number_width BETWEEN 1 AND 12),
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number > 0),
  default_status text NOT NULL DEFAULT 'active' CHECK (length(btrim(default_status)) BETWEEN 1 AND 80),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_employee_number_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_employee_number_settings FROM PUBLIC, anon, authenticated;
CREATE POLICY hr_employee_number_settings_read ON public.hr_employee_number_settings
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_hr_perm(auth.uid(), 'view_employees')
      OR public.has_hr_perm(auth.uid(), 'manage_employees')
      OR public.has_hr_perm(auth.uid(), 'manage_employee_number_settings')));
CREATE POLICY hr_employee_number_settings_no_direct_write ON public.hr_employee_number_settings
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP FUNCTION public.list_hr_movement_references(boolean);
CREATE FUNCTION public.list_hr_movement_references(_include_inactive boolean DEFAULT false)
RETURNS TABLE (
  id uuid, tenant_id uuid, kind text, code text, label text, active boolean, sort_order integer,
  bulk_action_field text, bulk_action_options jsonb
)
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
  RETURN QUERY SELECT r.id, r.tenant_id, r.kind, r.code, r.label, r.active, r.sort_order,
                      r.bulk_action_field, r.bulk_action_options
    FROM public.hr_movement_references r
   WHERE r.tenant_id = _tenant AND (_include_inactive OR r.active)
   ORDER BY r.kind, r.sort_order, r.label, r.code;
END
$function$;
REVOKE ALL ON FUNCTION public.list_hr_movement_references(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_movement_references(boolean) TO authenticated;

CREATE FUNCTION public.save_hr_movement_reference(
  _kind text, _code text, _label text, _active boolean, _sort_order integer,
  _bulk_action_field text, _bulk_action_options jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid;
  _normalized_code text := lower(btrim(_code));
  _normalized_label text := btrim(_label);
  _option jsonb;
  _seen text[] := ARRAY[]::text[];
  _value text;
  _option_label text;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_movement_settings') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_movement_settings' USING ERRCODE = '42501';
  END IF;
  IF _kind NOT IN ('movement_type', 'reason_code') OR _normalized_code !~ '^[a-z0-9][a-z0-9._-]{0,79}$'
     OR length(_normalized_label) NOT BETWEEN 1 AND 120 OR _sort_order IS NULL
     OR jsonb_typeof(_bulk_action_options) <> 'array'
     OR jsonb_array_length(_bulk_action_options) > 200
     OR (_bulk_action_field IS NOT NULL AND _bulk_action_field NOT IN ('status', 'department', 'job_title', 'contract_type', 'end_date'))
     OR (_kind <> 'movement_type' AND (_bulk_action_field IS NOT NULL OR _bulk_action_options <> '[]'::jsonb))
     OR ((_bulk_action_field IS NULL) <> (_bulk_action_options = '[]'::jsonb)) THEN
    RAISE EXCEPTION 'Type, code, libelle ou action groupee invalide' USING ERRCODE = 'QG028';
  END IF;
  FOR _option IN SELECT value FROM jsonb_array_elements(_bulk_action_options) LOOP
    _value := NULLIF(btrim(_option ->> 'value'), '');
    _option_label := NULLIF(btrim(_option ->> 'label'), '');
    IF jsonb_typeof(_option) <> 'object' OR _value IS NULL OR _option_label IS NULL
       OR length(_value) > 120 OR length(_option_label) > 120
       OR lower(_value) = ANY(_seen) THEN
      RAISE EXCEPTION 'Valeurs ou libelles de l''action groupee invalides ou dupliques' USING ERRCODE = 'QG028';
    END IF;
    _seen := array_append(_seen, lower(_value));
    IF _bulk_action_field = 'end_date' THEN
      BEGIN
        PERFORM _value::date;
      EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
        RAISE EXCEPTION 'Les valeurs de date de fin doivent suivre une date valide' USING ERRCODE = 'QG028';
      END;
    END IF;
  END LOOP;
  INSERT INTO public.hr_movement_references
    (tenant_id, kind, code, label, active, sort_order, bulk_action_field, bulk_action_options)
  VALUES (_tenant, _kind, _normalized_code, _normalized_label, COALESCE(_active, true), _sort_order,
          _bulk_action_field, _bulk_action_options)
  ON CONFLICT (tenant_id, kind, code) DO UPDATE
    SET label = EXCLUDED.label, active = EXCLUDED.active, sort_order = EXCLUDED.sort_order,
        bulk_action_field = EXCLUDED.bulk_action_field, bulk_action_options = EXCLUDED.bulk_action_options,
        updated_at = now()
  RETURNING id INTO _id;
  RETURN _id;
END
$function$;

CREATE OR REPLACE FUNCTION public.save_hr_movement_reference(
  _kind text, _code text, _label text, _active boolean DEFAULT true, _sort_order integer DEFAULT 0)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT public.save_hr_movement_reference(_kind, _code, _label, _active, _sort_order, NULL, '[]'::jsonb)
$function$;
REVOKE ALL ON FUNCTION public.save_hr_movement_reference(text, text, text, boolean, integer, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_hr_movement_reference(text, text, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_hr_movement_reference(text, text, text, boolean, integer, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_hr_movement_reference(text, text, text, boolean, integer) TO authenticated;

CREATE FUNCTION public.list_hr_employee_number_settings()
RETURNS TABLE (tenant_id uuid, prefix text, include_year boolean, separator text, number_width integer,
               next_number bigint, default_status text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT (public.has_hr_perm(auth.uid(), 'view_employees')
      OR public.has_hr_perm(auth.uid(), 'manage_employees')
      OR public.has_hr_perm(auth.uid(), 'manage_employee_number_settings')) THEN
    RAISE EXCEPTION 'Permission refusee : hr.view_employees' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.hr_employee_number_settings (tenant_id) VALUES (_tenant)
  ON CONFLICT ON CONSTRAINT hr_employee_number_settings_pkey DO NOTHING;
  RETURN QUERY SELECT s.tenant_id, s.prefix, s.include_year, s.separator, s.number_width,
                      s.next_number, s.default_status, s.updated_at
    FROM public.hr_employee_number_settings s WHERE s.tenant_id = _tenant;
END
$function$;

CREATE FUNCTION public.save_hr_employee_number_settings(
  _prefix text, _include_year boolean, _separator text, _number_width integer,
  _next_number bigint, _default_status text)
RETURNS TABLE (tenant_id uuid, prefix text, include_year boolean, separator text, number_width integer,
               next_number bigint, default_status text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_employee_number_settings') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_employee_number_settings' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(_prefix)) NOT BETWEEN 1 AND 24 OR length(_separator) > 5
     OR _separator ~ '[[:cntrl:]]' OR _number_width NOT BETWEEN 1 AND 12
     OR _next_number < 1 OR length(btrim(_default_status)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Parametres de matricule invalides' USING ERRCODE = 'QG028';
  END IF;
  INSERT INTO public.hr_employee_number_settings
    (tenant_id, prefix, include_year, separator, number_width, next_number, default_status)
  VALUES (_tenant, btrim(_prefix), COALESCE(_include_year, false), _separator,
          _number_width, _next_number, btrim(_default_status))
  ON CONFLICT ON CONSTRAINT hr_employee_number_settings_pkey DO UPDATE SET prefix = EXCLUDED.prefix, include_year = EXCLUDED.include_year,
    separator = EXCLUDED.separator, number_width = EXCLUDED.number_width, next_number = EXCLUDED.next_number,
    default_status = EXCLUDED.default_status, updated_at = now();
  RETURN QUERY SELECT * FROM public.list_hr_employee_number_settings();
END
$function$;

CREATE FUNCTION public.next_hr_employee_number(_tenant uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _settings public.hr_employee_number_settings%ROWTYPE;
  _candidate text;
BEGIN
  INSERT INTO public.hr_employee_number_settings (tenant_id) VALUES (_tenant) ON CONFLICT (tenant_id) DO NOTHING;
  SELECT * INTO _settings FROM public.hr_employee_number_settings s WHERE s.tenant_id = _tenant FOR UPDATE;
  LOOP
    _candidate := _settings.prefix || CASE WHEN _settings.include_year THEN _settings.separator || to_char(CURRENT_DATE, 'YYYY') ELSE '' END
      || _settings.separator || lpad(_settings.next_number::text, _settings.number_width, '0');
    _settings.next_number := _settings.next_number + 1;
    UPDATE public.hr_employee_number_settings SET next_number = _settings.next_number, updated_at = now()
      WHERE tenant_id = _tenant;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.tenant_id = _tenant AND e.matricule = _candidate);
  END LOOP;
  RETURN _candidate;
END
$function$;
REVOKE ALL ON FUNCTION public.next_hr_employee_number(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_hr_employee(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := NULLIF(_payload ->> 'id', '')::uuid;
  _employee public.employees%ROWTYPE;
  _state jsonb;
  _manage_compensation boolean := public.has_hr_perm(auth.uid(), 'manage_compensation');
  _manage_bank boolean := public.has_hr_perm(auth.uid(), 'manage_bank_details');
  _salary numeric := NULLIF(_payload ->> 'base_salary', '')::numeric;
  _bank text := NULLIF(btrim(_payload ->> 'bank_account'), '');
  _matricule text := NULLIF(btrim(_payload ->> 'matricule'), '');
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_employees') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_employees' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(_payload ->> 'first_name'), '') IS NULL
     OR NULLIF(btrim(_payload ->> 'last_name'), '') IS NULL
     OR NULLIF(btrim(_payload ->> 'contract_type'), '') IS NULL THEN
    RAISE EXCEPTION 'Prenom, nom et contrat sont obligatoires' USING ERRCODE = 'QG028';
  END IF;
  IF _salary IS NOT NULL AND _salary < 0 THEN
    RAISE EXCEPTION 'La remuneration ne peut pas etre negative' USING ERRCODE = 'QG028';
  END IF;
  IF NOT _manage_bank AND _bank IS NOT NULL THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_bank_details' USING ERRCODE = '42501';
  END IF;
  IF _id IS NULL THEN
    IF _salary IS NOT NULL AND _salary <> 0 AND NOT _manage_compensation THEN
      RAISE EXCEPTION 'Permission refusee : hr.manage_compensation' USING ERRCODE = '42501';
    END IF;
    IF _matricule IS NULL THEN _matricule := public.next_hr_employee_number(_tenant); END IF;
    INSERT INTO public.employees (
      tenant_id, matricule, first_name, last_name, email, phone, job_title, department,
      contract_type, hire_date, end_date, base_salary, currency, bank_account, status
    ) VALUES (
      _tenant, _matricule, btrim(_payload ->> 'first_name'), btrim(_payload ->> 'last_name'),
      NULLIF(lower(btrim(_payload ->> 'email')), ''), NULLIF(btrim(_payload ->> 'phone'), ''),
      NULLIF(btrim(_payload ->> 'job_title'), ''), NULLIF(btrim(_payload ->> 'department'), ''),
      btrim(_payload ->> 'contract_type'), COALESCE(NULLIF(_payload ->> 'hire_date', '')::date, CURRENT_DATE),
      NULLIF(_payload ->> 'end_date', '')::date, COALESCE(_salary, 0),
      CASE WHEN _manage_compensation THEN upper(COALESCE(NULLIF(_payload ->> 'currency', ''), 'XOF'))
           ELSE COALESCE((SELECT s.currency_code::text FROM public.hr_payroll_settings s WHERE s.tenant_id = _tenant), 'XOF') END,
      CASE WHEN _manage_bank THEN _bank ELSE NULL END,
      COALESCE(NULLIF(_payload ->> 'status', ''),
        (SELECT s.default_status FROM public.hr_employee_number_settings s WHERE s.tenant_id = _tenant), 'active')
    ) RETURNING id INTO _id;
    RETURN _id;
  END IF;

  SELECT * INTO _employee FROM public.employees e WHERE e.id = _id AND e.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employe introuvable dans la societe courante' USING ERRCODE = '42501'; END IF;
  IF NOT _manage_compensation AND _salary IS NOT NULL AND _salary IS DISTINCT FROM _employee.base_salary THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_compensation' USING ERRCODE = '42501';
  END IF;
  IF _manage_compensation AND _salary IS NOT NULL AND _salary IS DISTINCT FROM _employee.base_salary THEN
    RAISE EXCEPTION 'Une modification de remuneration doit etre enregistree comme mouvement RH effectif-date' USING ERRCODE = 'QG028';
  END IF;
  _state := public.hr_employee_state_at(_id, CURRENT_DATE);
  IF (_payload ? 'currency' AND upper(_payload->>'currency') IS DISTINCT FROM upper(_state->>'currency'))
     OR (_payload ? 'job_title' AND NULLIF(btrim(_payload->>'job_title'), '') IS DISTINCT FROM _state->>'job_title')
     OR (_payload ? 'department' AND NULLIF(btrim(_payload->>'department'), '') IS DISTINCT FROM _state->>'department')
     OR (_payload ? 'contract_type' AND btrim(_payload->>'contract_type') IS DISTINCT FROM _state->>'contract_type')
     OR (_payload ? 'hire_date' AND NULLIF(_payload->>'hire_date', '')::date IS DISTINCT FROM NULLIF(_state->>'hire_date', '')::date)
     OR (_payload ? 'end_date' AND NULLIF(_payload->>'end_date', '')::date IS DISTINCT FROM NULLIF(_state->>'end_date', '')::date)
     OR (_payload ? 'status' AND _payload->>'status' IS DISTINCT FROM _state->>'status') THEN
    RAISE EXCEPTION 'Les changements de paie, poste, service, contrat, dates ou statut doivent passer par un mouvement RH' USING ERRCODE = 'QG028';
  END IF;
  UPDATE public.employees SET
    matricule = COALESCE(_matricule, _employee.matricule), first_name = btrim(_payload ->> 'first_name'),
    last_name = btrim(_payload ->> 'last_name'), email = NULLIF(lower(btrim(_payload ->> 'email')), ''),
    phone = NULLIF(btrim(_payload ->> 'phone'), ''), base_salary = _employee.base_salary, currency = _employee.currency,
    bank_account = CASE WHEN _manage_bank THEN _bank ELSE _employee.bank_account END,
    updated_at = now()
   WHERE id = _id AND tenant_id = _tenant;
  RETURN _id;
END
$function$;

CREATE FUNCTION public.import_hr_employees(_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _row jsonb;
  _id uuid;
  _matricule text;
  _result jsonb := '[]'::jsonb;
  _count integer;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_employees') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_employees' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'L''import doit contenir entre 1 et 1000 lignes' USING ERRCODE = 'QG028';
  END IF;
  FOR _row IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    IF jsonb_typeof(_row) <> 'object' THEN RAISE EXCEPTION 'Ligne d''import invalide' USING ERRCODE = 'QG028'; END IF;
    _id := public.save_hr_employee(jsonb_build_object(
      'matricule', _row ->> 'matricule', 'first_name', _row ->> 'first_name', 'last_name', _row ->> 'last_name',
      'email', _row ->> 'email', 'phone', _row ->> 'phone', 'job_title', _row ->> 'job_title',
      'department', _row ->> 'department', 'contract_type', _row ->> 'contract_type', 'hire_date', _row ->> 'hire_date'));
    SELECT e.matricule INTO _matricule FROM public.employees e WHERE e.id = _id AND e.tenant_id = _tenant;
    _result := _result || jsonb_build_array(jsonb_build_object('id', _id, 'matricule', _matricule));
  END LOOP;
  SELECT jsonb_array_length(_result) INTO _count;
  RETURN jsonb_build_object('created_count', _count, 'employees', _result);
END
$function$;

CREATE OR REPLACE FUNCTION public.create_employee_movement(
  _employee_id uuid, _movement_type text, _effective_date date,
  _reason_code text, _reason text, _after_values jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _employee public.employees%ROWTYPE;
  _before jsonb;
  _id uuid;
  _key text;
  _reference public.hr_movement_references%ROWTYPE;
  _status_option jsonb;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'create_employee_movement') THEN
    RAISE EXCEPTION 'Permission refusee : hr.create_employee_movement' USING ERRCODE = '42501';
  END IF;
  IF _effective_date IS NULL OR NULLIF(btrim(_movement_type), '') IS NULL OR length(btrim(_movement_type)) > 80
     OR NULLIF(btrim(_reason_code), '') IS NULL OR length(btrim(COALESCE(_reason, ''))) < 3
     OR jsonb_typeof(_after_values) <> 'object' OR _after_values = '{}'::jsonb THEN
    RAISE EXCEPTION 'Type, date, motif et valeurs du mouvement sont obligatoires' USING ERRCODE = 'QG028';
  END IF;
  SELECT * INTO _reference FROM public.hr_movement_references r
   WHERE r.tenant_id = _tenant AND r.kind = 'movement_type' AND r.code = lower(btrim(_movement_type)) AND r.active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Le type de mouvement doit etre actif dans Parametres RH' USING ERRCODE = 'QG028'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hr_movement_references r WHERE r.tenant_id = _tenant
      AND r.kind = 'reason_code' AND r.code = lower(btrim(_reason_code)) AND r.active) THEN
    RAISE EXCEPTION 'Le motif doit etre actif dans Parametres RH' USING ERRCODE = 'QG028';
  END IF;
  SELECT * INTO _employee FROM public.employees e WHERE e.id = _employee_id AND e.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employe introuvable dans la societe courante' USING ERRCODE = '42501'; END IF;
  FOR _key IN SELECT jsonb_object_keys(_after_values) LOOP
    IF _key NOT IN ('base_salary', 'currency', 'department', 'job_title', 'contract_type', 'end_date', 'status') THEN
      RAISE EXCEPTION 'Champ RH non modifiable par mouvement: %', _key USING ERRCODE = 'QG028';
    END IF;
  END LOOP;
  IF _after_values ? 'base_salary' AND (jsonb_typeof(_after_values->'base_salary') <> 'number' OR (_after_values->>'base_salary')::numeric < 0) THEN
    RAISE EXCEPTION 'Salaire de base invalide' USING ERRCODE = 'QG028';
  END IF;
  IF _after_values ? 'status' THEN
    SELECT option INTO _status_option FROM jsonb_array_elements(_reference.bulk_action_options) option
     WHERE _reference.bulk_action_field = 'status' AND option->>'value' = _after_values->>'status' LIMIT 1;
    IF _status_option IS NULL THEN RAISE EXCEPTION 'Le statut doit etre configure dans Parametres RH pour ce type de mouvement' USING ERRCODE = 'QG028'; END IF;
  END IF;
  _before := public.hr_employee_state_at(_employee_id, _effective_date - 1);
  INSERT INTO public.employee_movements
    (tenant_id, employee_id, movement_type, effective_date, reason_code, reason, before_values, after_values, created_by)
  VALUES (_tenant, _employee_id, lower(btrim(_movement_type)), _effective_date, lower(btrim(_reason_code)), btrim(_reason), _before, _after_values, auth.uid())
  RETURNING id INTO _id;
  INSERT INTO public.employee_movement_audit (tenant_id, movement_id, event_type, performed_by, details)
  VALUES (_tenant, _id, 'submitted', auth.uid(), jsonb_build_object('effective_date', _effective_date, 'reason_code', _reason_code));
  RETURN _id;
END
$function$;

CREATE FUNCTION public.create_employee_movements_bulk(
  _employee_ids uuid[], _movement_type text, _effective_date date, _reason_code text, _reason text, _action_value text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _reference public.hr_movement_references%ROWTYPE;
  _employee_id uuid;
  _movement_id uuid;
  _result jsonb := '[]'::jsonb;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'create_employee_movement') THEN
    RAISE EXCEPTION 'Permission refusee : hr.create_employee_movement' USING ERRCODE = '42501';
  END IF;
  IF _employee_ids IS NULL OR cardinality(_employee_ids) NOT BETWEEN 1 AND 500
     OR (SELECT count(DISTINCT id) FROM unnest(_employee_ids) id) <> cardinality(_employee_ids) THEN
    RAISE EXCEPTION 'La selection doit contenir entre 1 et 500 salaries sans doublon' USING ERRCODE = 'QG028';
  END IF;
  SELECT * INTO _reference FROM public.hr_movement_references r
   WHERE r.tenant_id = _tenant AND r.kind = 'movement_type' AND r.code = lower(btrim(_movement_type)) AND r.active;
  IF NOT FOUND OR _reference.bulk_action_field IS NULL OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(_reference.bulk_action_options) option WHERE option->>'value' = _action_value) THEN
    RAISE EXCEPTION 'Cette action ou valeur n''est plus configuree dans les parametres RH' USING ERRCODE = 'QG028';
  END IF;
  IF (SELECT count(*) FROM public.employees e WHERE e.tenant_id = _tenant AND e.id = ANY(_employee_ids)) <> cardinality(_employee_ids) THEN
    RAISE EXCEPTION 'Un ou plusieurs salaries ne sont pas dans la societe courante' USING ERRCODE = '42501';
  END IF;
  FOREACH _employee_id IN ARRAY _employee_ids LOOP
    _movement_id := public.create_employee_movement(
      _employee_id, _reference.code, _effective_date, _reason_code, _reason,
      jsonb_build_object(_reference.bulk_action_field, _action_value));
    _result := _result || jsonb_build_array(jsonb_build_object('employee_id', _employee_id, 'movement_id', _movement_id));
  END LOOP;
  RETURN jsonb_build_object('created_count', cardinality(_employee_ids), 'movements', _result);
END
$function$;

REVOKE ALL ON FUNCTION public.list_hr_employee_number_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_hr_employee_number_settings(text, boolean, text, integer, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_hr_employees(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_employee_movements_bulk(uuid[], text, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_employee_number_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_hr_employee_number_settings(text, boolean, text, integer, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_hr_employees(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_employee_movements_bulk(uuid[], text, date, text, text, text) TO authenticated;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
