-- V102 — RH : contrat, service et poste issus de référentiels par société ; statut du salarié borné ;
-- devise du salarié issue des règles de paie (plus de « XOF » implicite).
--
-- Revue du 17 nov. 2026 : la fiche salarié acceptait un contrat, un service, un poste et un statut en texte
-- libre (« CDI », « cdi », « C.D.I. » devenaient trois contrats différents dans les rapports), et
-- save_hr_employee retombait sur la devise « XOF » quand la société n'avait pas de règles de paie.
--   * hr_movement_references accueille trois référentiels de plus : contract_type, department, job_title,
--     gérés dans Paramètres RH comme les types et motifs de mouvement (droit hr.manage_movement_settings) ;
--   * la base accepte le code ou le libellé d'une valeur active et enregistre le code, sur la fiche comme dans
--     les mouvements (formulaire, import, actions groupées, API : un seul contrôle) ;
--   * le statut est un état du cycle de vie (actif, inactif, suspendu, sorti) : la paie ne calcule que les actifs ;
--   * les valeurs déjà saisies deviennent des entrées des référentiels (aucune perte).

-- 1. Référentiels
ALTER TABLE public.hr_movement_references DROP CONSTRAINT hr_movement_references_kind_check;
ALTER TABLE public.hr_movement_references ADD CONSTRAINT hr_movement_references_kind_check
  CHECK (kind IN ('movement_type', 'reason_code', 'contract_type', 'department', 'job_title'));

CREATE OR REPLACE FUNCTION public.hr_reference_code(_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(left(regexp_replace(regexp_replace(lower(btrim(_value)), '[^a-z0-9._-]+', '-', 'g'), '^[^a-z0-9]+', ''), 80), '')
$function$;

-- Valeurs déjà présentes sur les fiches : reprises comme entrées actives.
INSERT INTO public.hr_movement_references (tenant_id, kind, code, label, active, sort_order)
SELECT DISTINCT e.tenant_id, v.kind, public.hr_reference_code(v.value), btrim(v.value), true, 0
  FROM public.employees e
 CROSS JOIN LATERAL (VALUES ('contract_type', e.contract_type), ('department', e.department), ('job_title', e.job_title)) AS v(kind, value)
 WHERE public.hr_reference_code(v.value) IS NOT NULL
ON CONFLICT (tenant_id, kind, code) DO NOTHING;

-- Résolution : code ou libellé d'une valeur active (insensible à la casse) → code.
CREATE OR REPLACE FUNCTION public.hr_resolve_reference(_tenant uuid, _kind text, _value text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.code FROM public.hr_movement_references r
   WHERE r.tenant_id = _tenant AND r.kind = _kind AND r.active
     AND (r.code = lower(btrim(_value)) OR lower(r.label) = lower(btrim(_value)))
   ORDER BY (r.code = lower(btrim(_value))) DESC LIMIT 1
$function$;
REVOKE EXECUTE ON FUNCTION public.hr_resolve_reference(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hr_reference_label(_kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _kind WHEN 'contract_type' THEN 'Contrat' WHEN 'department' THEN 'Service' WHEN 'job_title' THEN 'Poste' ELSE _kind END
$function$;

UPDATE public.employees e SET
  contract_type = COALESCE(public.hr_reference_code(e.contract_type), e.contract_type),
  department = public.hr_reference_code(e.department),
  job_title = public.hr_reference_code(e.job_title);

-- 2. Statut : états du cycle de vie ; plus de contrat par défaut codé (« CDI ») : il vient du référentiel.
ALTER TABLE public.employees ALTER COLUMN contract_type DROP DEFAULT;
ALTER TABLE public.employees ADD CONSTRAINT employees_status_check CHECK (status IN ('active', 'inactive', 'suspended', 'terminated'));
UPDATE public.hr_employee_number_settings SET default_status = 'active' WHERE default_status NOT IN ('active', 'inactive', 'suspended', 'terminated');
ALTER TABLE public.hr_employee_number_settings DROP CONSTRAINT IF EXISTS hr_employee_number_settings_default_status_check;
ALTER TABLE public.hr_employee_number_settings ADD CONSTRAINT hr_employee_number_settings_default_status_check
  CHECK (default_status IN ('active', 'inactive', 'suspended', 'terminated'));

-- 3. Contrôle sur la fiche (toute voie d'écriture)
CREATE OR REPLACE FUNCTION public.guard_employee_references()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _f text; _old text; _new text; _code text; _row jsonb := to_jsonb(NEW); _patch jsonb := '{}'::jsonb;
BEGIN
  FOREACH _f IN ARRAY ARRAY['contract_type', 'department', 'job_title'] LOOP
    _new := NULLIF(btrim(_row ->> _f), '');
    _old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> _f END;
    IF _new IS NULL THEN
      IF _f = 'contract_type' THEN RAISE EXCEPTION 'Contrat obligatoire' USING ERRCODE = 'QG028'; END IF;
      _patch := _patch || jsonb_build_object(_f, NULL);
      CONTINUE;
    END IF;
    IF TG_OP = 'UPDATE' AND _new IS NOT DISTINCT FROM _old THEN CONTINUE; END IF;   -- valeur inchangée (même désactivée depuis)
    _code := public.hr_resolve_reference(NEW.tenant_id, _f, _new);
    IF _code IS NULL THEN
      RAISE EXCEPTION '% « % » absent du référentiel de la société (Paramètres RH → Référentiels)', public.hr_reference_label(_f), _new
        USING ERRCODE = 'QG028', HINT = 'Ajouter la valeur au référentiel ou choisir une valeur existante.';
    END IF;
    _patch := _patch || jsonb_build_object(_f, _code);
  END LOOP;
  NEW := jsonb_populate_record(NEW, _patch);
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_employee_references BEFORE INSERT OR UPDATE OF contract_type, department, job_title ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_references();

-- Mouvements : les nouvelles valeurs proposées sont contrôlées et normalisées de la même façon.
CREATE OR REPLACE FUNCTION public.guard_employee_movement_values()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _f text; _v text; _code text; _after jsonb := NEW.after_values;
BEGIN
  FOREACH _f IN ARRAY ARRAY['contract_type', 'department', 'job_title'] LOOP
    CONTINUE WHEN NOT (_after ? _f);
    _v := NULLIF(btrim(_after ->> _f), '');
    IF _v IS NULL THEN
      IF _f = 'contract_type' THEN RAISE EXCEPTION 'Contrat obligatoire' USING ERRCODE = 'QG028'; END IF;
      CONTINUE;
    END IF;
    _code := public.hr_resolve_reference(NEW.tenant_id, _f, _v);
    IF _code IS NULL THEN
      RAISE EXCEPTION '% « % » absent du référentiel de la société (Paramètres RH → Référentiels)', public.hr_reference_label(_f), _v USING ERRCODE = 'QG028';
    END IF;
    _after := jsonb_set(_after, ARRAY[_f], to_jsonb(_code));
  END LOOP;
  IF _after ? 'status' AND (_after ->> 'status') NOT IN ('active', 'inactive', 'suspended', 'terminated') THEN
    RAISE EXCEPTION 'Statut « % » inconnu (actif, inactif, suspendu, sorti)', _after ->> 'status' USING ERRCODE = 'QG028';
  END IF;
  NEW.after_values := _after;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_employee_movement_values BEFORE INSERT OR UPDATE OF after_values ON public.employee_movements
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_movement_values();

-- Paie : le service photographié sur la ligne de paie est le libellé en vigueur au calcul (le rapport
-- historique reste lisible même si le référentiel change ensuite).
CREATE OR REPLACE FUNCTION public.payroll_line_department_label()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NULLIF(NEW.department_snapshot, '') IS NOT NULL THEN
    NEW.department_snapshot := COALESCE((SELECT r.label FROM public.hr_movement_references r
      WHERE r.tenant_id = NEW.tenant_id AND r.kind = 'department' AND r.code = NEW.department_snapshot), NEW.department_snapshot);
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_payroll_line_department_label BEFORE INSERT ON public.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION public.payroll_line_department_label();

-- 4. Fonctions reprises de V95 : référentiels supplémentaires ; devise de la fiche = devise des règles de paie
--    (refus explicite si elles ne sont pas configurées) ; statut initial = statut par défaut paramétré (le
--    statut change ensuite par mouvement).
CREATE OR REPLACE FUNCTION public.save_hr_movement_reference(
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
  IF _kind NOT IN ('movement_type', 'reason_code', 'contract_type', 'department', 'job_title') OR _normalized_code !~ '^[a-z0-9][a-z0-9._-]{0,79}$'
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
  _pay_currency text := (SELECT s.currency_code::text FROM public.hr_payroll_settings s WHERE s.tenant_id = public.get_user_tenant_id(auth.uid()));
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
    IF _pay_currency IS NULL THEN
      RAISE EXCEPTION 'Devise de paie non configurée : renseigner d''abord les règles de paie (Paramètres RH → Règles de paie)' USING ERRCODE = 'QG028';
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
      CASE WHEN _manage_compensation THEN upper(COALESCE(NULLIF(_payload ->> 'currency', ''), _pay_currency)) ELSE _pay_currency END,
      CASE WHEN _manage_bank THEN _bank ELSE NULL END,
      COALESCE((SELECT s.default_status FROM public.hr_employee_number_settings s WHERE s.tenant_id = _tenant), 'active')
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
