-- V149 — Paie : règles légales versionnées et datées, cotisations multiples, abattement et charges de famille,
-- arrondis, exonération partielle des rubriques (audit docs/audit-erp/32-audit-rh-paie.md, P1).
--
-- Constat : hr_payroll_settings ne contenait qu'UNE ligne par société (un taux salarial, un taux patronal, des
-- tranches) écrasée à chaque modification : pas d'historique, pas de CNSS par branche (pension, prestations
-- familiales, risques professionnels, chacune avec son taux et son plafond), pas d'abattement forfaitaire (qui
-- dépend de la catégorie du salarié), pas de réduction pour charges de famille, arrondi fixe au centime.
-- Références de structure (aucun taux n'est repris) : Odoo — règles calculées dans l'ordre de séquence et
-- registres de cotisations ; Sage Paie — cotisations par organisme, taux salarial / patronal, tranches entre un
-- plancher et un plafond ; Burkina Faso — IUTS (CGI) : abattement forfaitaire selon la catégorie, avec minimum et
-- maximum, indemnités exonérées dans une limite, réduction d'impôt selon le nombre de charges (nombre plafonné) ;
-- CNSS (loi 004-2021/AN) : branches à taux distincts, plafond fixé par arrêté.
--
-- Règles :
--   * payroll_rule_versions : une version par date d'effet, brouillon → validée (droit hr.payroll_rules_validate,
--     contrôle complet) → archivée ; une version validée est figée : une nouvelle loi = une nouvelle version ;
--   * un cycle applique la version validée dont la date d'effet est la plus récente au 1er jour de la période,
--     photographiée en entier sur le cycle : les anciens bulletins restent reproductibles ;
--   * une société sans aucune version validée continue sur ses règles actuelles (hr_payroll_settings), converties
--     à la volée en une version équivalente (cotisation unique « SOCIAL ») : mêmes montants qu'avant V149 ;
--   * chaque cotisation produit ses lignes de bulletin (part salariale = retenue, part patronale = charge) et sa
--     comptabilisation (compte de charge patronale et compte de l'organisme, sinon rôles de paie) ;
--   * aucune valeur légale n'est préremplie.

-- 1. Droit de validation des règles.
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('hr.payroll_rules_validate', 'hr', 'payroll_rules_validate', 'Valider les règles légales de paie')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
VALUES ('admin', 'hr.payroll_rules_validate'), ('hr_admin', 'hr.payroll_rules_validate')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r
JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
WHERE r.is_system AND r.code IN ('admin', 'hr_admin') AND sp.permission_code = 'hr.payroll_rules_validate'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- 2. Versions de règles et cotisations.
CREATE TABLE public.payroll_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  effective_from date NOT NULL,
  reference text NOT NULL DEFAULT '',
  notes text,
  proration_method text NOT NULL DEFAULT 'calendar_days' CHECK (proration_method IN ('calendar_days', 'thirty_days')),
  rounding_unit numeric(12,4) NOT NULL DEFAULT 0.01 CHECK (rounding_unit > 0),
  rounding_mode text NOT NULL DEFAULT 'nearest' CHECK (rounding_mode IN ('nearest', 'down', 'up')),
  taxable_rounding_unit numeric(12,2) CHECK (taxable_rounding_unit IS NULL OR taxable_rounding_unit > 0),
  income_tax_bands jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(income_tax_bands) = 'array'),
  tax_abatements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tax_abatements) = 'array'),
  family_reductions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(family_reductions) = 'array'),
  family_max_dependents integer CHECK (family_max_dependents IS NULL OR family_max_dependents BETWEEN 1 AND 30),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'archived')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'legacy_settings')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  validated_by uuid,
  validated_at timestamptz,
  archived_by uuid,
  archived_at timestamptz,
  archive_reason text,
  CONSTRAINT payroll_rule_versions_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT payroll_rule_versions_validation CHECK (status = 'draft' OR validated_at IS NOT NULL OR status = 'archived')
);
CREATE UNIQUE INDEX payroll_rule_versions_one_validated_per_date
  ON public.payroll_rule_versions (tenant_id, effective_from) WHERE status = 'validated';
CREATE INDEX payroll_rule_versions_tenant_idx ON public.payroll_rule_versions (tenant_id, status, effective_from DESC);

CREATE TABLE public.payroll_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  organism text,
  employee_rate_pct numeric(8,4) NOT NULL DEFAULT 0 CHECK (employee_rate_pct BETWEEN 0 AND 100),
  employer_rate_pct numeric(8,4) NOT NULL DEFAULT 0 CHECK (employer_rate_pct BETWEEN 0 AND 100),
  base_floor numeric(18,2) CHECK (base_floor IS NULL OR base_floor >= 0),
  employee_ceiling numeric(18,2) CHECK (employee_ceiling IS NULL OR employee_ceiling > 0),
  employer_ceiling numeric(18,2) CHECK (employer_ceiling IS NULL OR employer_ceiling > 0),
  deductible_from_tax boolean NOT NULL DEFAULT true,
  payable_account_code text,
  employer_account_code text,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (version_id, code),
  FOREIGN KEY (version_id, tenant_id) REFERENCES public.payroll_rule_versions (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX payroll_contributions_version_idx ON public.payroll_contributions (tenant_id, version_id, sort_order);

ALTER TABLE public.payroll_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_contributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_rule_versions, public.payroll_contributions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payroll_rule_versions, public.payroll_contributions TO authenticated;
CREATE POLICY payroll_rule_versions_read ON public.payroll_rule_versions FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_hr_perm(auth.uid(), 'view_payroll') OR public.has_permission(auth.uid(), 'hr.payroll_settings')));
CREATE POLICY payroll_contributions_read ON public.payroll_contributions FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_hr_perm(auth.uid(), 'view_payroll') OR public.has_permission(auth.uid(), 'hr.payroll_settings')));

-- Une version validée ou archivée est figée, pour les rôles applicatifs comme pour le code SECURITY DEFINER :
-- seule la transition validée → archivée est admise. Seule la suppression d'une société (rôle propriétaire,
-- cascade) peut emporter une version validée.
CREATE OR REPLACE FUNCTION public.guard_payroll_rule_version()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' AND current_user IN ('authenticated', 'anon', 'qerp_api') THEN
      RAISE EXCEPTION 'Une version de règles validée ou archivée ne se supprime pas' USING ERRCODE = 'QG028';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
    IF OLD.status = 'validated' AND NEW.status = 'archived'
       AND (to_jsonb(NEW) - ARRAY['status', 'archived_by', 'archived_at', 'archive_reason', 'updated_at'])
         = (to_jsonb(OLD) - ARRAY['status', 'archived_by', 'archived_at', 'archive_reason', 'updated_at']) THEN
      NEW.updated_at := now();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Version de règles % : seule une version brouillon se modifie (créer une nouvelle version)', OLD.status
      USING ERRCODE = 'QG028';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_payroll_rule_version BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_rule_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_rule_version();

CREATE OR REPLACE FUNCTION public.guard_payroll_contribution()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE _status text;
BEGIN
  IF TG_OP = 'DELETE' AND current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN OLD; END IF;
  SELECT v.status INTO _status FROM public.payroll_rule_versions v
   WHERE v.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  IF _status IS NOT NULL AND _status <> 'draft' THEN
    RAISE EXCEPTION 'Les cotisations d''une version % sont figées', _status USING ERRCODE = 'QG028';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;
CREATE TRIGGER trg_guard_payroll_contribution BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_contributions
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_contribution();

-- 3. Salarié : catégorie de paie (référentiel de la société) et nombre de charges de famille, datés par mouvement.
ALTER TABLE public.hr_movement_references DROP CONSTRAINT hr_movement_references_kind_check;
ALTER TABLE public.hr_movement_references ADD CONSTRAINT hr_movement_references_kind_check
  CHECK (kind IN ('movement_type', 'reason_code', 'contract_type', 'department', 'job_title', 'payroll_category'));
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS payroll_category text,
  ADD COLUMN IF NOT EXISTS tax_dependents integer NOT NULL DEFAULT 0;
ALTER TABLE public.employees ADD CONSTRAINT employees_tax_dependents_check CHECK (tax_dependents BETWEEN 0 AND 30);

CREATE OR REPLACE FUNCTION public.hr_reference_label(_kind text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT CASE _kind WHEN 'contract_type' THEN 'Contrat' WHEN 'department' THEN 'Service' WHEN 'job_title' THEN 'Poste'
    WHEN 'payroll_category' THEN 'Catégorie de paie' ELSE _kind END
$function$;

CREATE OR REPLACE FUNCTION public.guard_employee_references()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _f text; _old text; _new text; _code text; _row jsonb := to_jsonb(NEW); _patch jsonb := '{}'::jsonb;
BEGIN
  FOREACH _f IN ARRAY ARRAY['contract_type', 'department', 'job_title', 'payroll_category'] LOOP
    _new := NULLIF(btrim(_row ->> _f), '');
    _old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> _f END;
    IF _new IS NULL THEN
      IF _f = 'contract_type' THEN RAISE EXCEPTION 'Contrat obligatoire' USING ERRCODE = 'QG028'; END IF;
      _patch := _patch || jsonb_build_object(_f, NULL);
      CONTINUE;
    END IF;
    IF TG_OP = 'UPDATE' AND _new IS NOT DISTINCT FROM _old THEN CONTINUE; END IF;
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
DROP TRIGGER trg_guard_employee_references ON public.employees;
CREATE TRIGGER trg_guard_employee_references BEFORE INSERT OR UPDATE OF contract_type, department, job_title, payroll_category
  ON public.employees FOR EACH ROW EXECUTE FUNCTION public.guard_employee_references();

CREATE OR REPLACE FUNCTION public.guard_employee_movement_values()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _f text; _v text; _code text; _after jsonb := NEW.after_values;
BEGIN
  FOREACH _f IN ARRAY ARRAY['contract_type', 'department', 'job_title', 'payroll_category'] LOOP
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
  IF _after ? 'tax_dependents' AND (jsonb_typeof(_after -> 'tax_dependents') <> 'number'
      OR (_after ->> 'tax_dependents')::numeric <> trunc((_after ->> 'tax_dependents')::numeric)
      OR (_after ->> 'tax_dependents')::numeric NOT BETWEEN 0 AND 30) THEN
    RAISE EXCEPTION 'Nombre de charges de famille invalide (entier de 0 à 30)' USING ERRCODE = 'QG028';
  END IF;
  NEW.after_values := _after;
  RETURN NEW;
END $function$;

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
  IF _kind NOT IN ('movement_type', 'reason_code', 'contract_type', 'department', 'job_title', 'payroll_category')
     OR _normalized_code !~ '^[a-z0-9][a-z0-9._-]{0,79}$'
     OR length(_normalized_label) NOT BETWEEN 1 AND 120 OR _sort_order IS NULL
     OR jsonb_typeof(_bulk_action_options) <> 'array'
     OR jsonb_array_length(_bulk_action_options) > 200
     OR (_bulk_action_field IS NOT NULL AND _bulk_action_field NOT IN ('status', 'department', 'job_title', 'contract_type', 'end_date', 'payroll_category'))
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

CREATE OR REPLACE FUNCTION public.hr_employee_state_at(_employee_id uuid, _as_of date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _employee public.employees%ROWTYPE;
  _state jsonb;
  _movement record;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  SELECT * INTO _employee FROM public.employees e WHERE e.id = _employee_id AND e.tenant_id = _tenant;
  IF _employee.id IS NULL THEN RAISE EXCEPTION 'Employe introuvable' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_hr_perm(auth.uid(), 'view_employee_history')
     AND NOT public.has_hr_perm(auth.uid(), 'view_payroll')
     AND NOT public.has_hr_perm(auth.uid(), 'view_employees') THEN
    RAISE EXCEPTION 'Droit RH insuffisant pour consulter le dossier effectif' USING ERRCODE = '42501';
  END IF;
  _state := jsonb_build_object(
    'base_salary', _employee.base_salary, 'currency', _employee.currency, 'department', _employee.department,
    'job_title', _employee.job_title, 'contract_type', _employee.contract_type, 'hire_date', _employee.hire_date,
    'end_date', _employee.end_date, 'status', _employee.status,
    'payroll_category', _employee.payroll_category, 'tax_dependents', _employee.tax_dependents);
  FOR _movement IN
    SELECT m.after_values FROM public.employee_movements m
     WHERE m.tenant_id = _tenant AND m.employee_id = _employee_id
       AND m.status = 'approved' AND m.effective_date <= COALESCE(_as_of, CURRENT_DATE)
     ORDER BY m.effective_date, m.decided_at, m.id
  LOOP
    _state := _state || _movement.after_values;
  END LOOP;
  RETURN _state;
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
    IF _key NOT IN ('base_salary', 'currency', 'department', 'job_title', 'contract_type', 'end_date', 'status',
                    'payroll_category', 'tax_dependents') THEN
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

-- Devise de paie d'une société : version validée la plus récente, sinon règles actuelles.
CREATE OR REPLACE FUNCTION public.payroll_tenant_currency(_tenant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(
    (SELECT v.currency_code::text FROM public.payroll_rule_versions v
      WHERE v.tenant_id = _tenant AND v.status = 'validated' ORDER BY v.effective_from DESC LIMIT 1),
    (SELECT s.currency_code::text FROM public.hr_payroll_settings s WHERE s.tenant_id = _tenant))
$function$;
REVOKE ALL ON FUNCTION public.payroll_tenant_currency(uuid) FROM PUBLIC, anon, authenticated;

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
  _pay_currency text := public.payroll_tenant_currency(public.get_user_tenant_id(auth.uid()));
  _dependents integer := COALESCE(NULLIF(_payload ->> 'tax_dependents', '')::integer, 0);
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
      contract_type, hire_date, end_date, base_salary, currency, bank_account, status, payroll_category, tax_dependents
    ) VALUES (
      _tenant, _matricule, btrim(_payload ->> 'first_name'), btrim(_payload ->> 'last_name'),
      NULLIF(lower(btrim(_payload ->> 'email')), ''), NULLIF(btrim(_payload ->> 'phone'), ''),
      NULLIF(btrim(_payload ->> 'job_title'), ''), NULLIF(btrim(_payload ->> 'department'), ''),
      btrim(_payload ->> 'contract_type'), COALESCE(NULLIF(_payload ->> 'hire_date', '')::date, CURRENT_DATE),
      NULLIF(_payload ->> 'end_date', '')::date, COALESCE(_salary, 0),
      CASE WHEN _manage_compensation THEN upper(COALESCE(NULLIF(_payload ->> 'currency', ''), _pay_currency)) ELSE _pay_currency END,
      CASE WHEN _manage_bank THEN _bank ELSE NULL END,
      COALESCE((SELECT s.default_status FROM public.hr_employee_number_settings s WHERE s.tenant_id = _tenant), 'active'),
      NULLIF(btrim(_payload ->> 'payroll_category'), ''), _dependents
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
     OR (_payload ? 'status' AND _payload->>'status' IS DISTINCT FROM _state->>'status')
     OR (_payload ? 'payroll_category' AND NULLIF(btrim(_payload->>'payroll_category'), '') IS DISTINCT FROM _state->>'payroll_category')
     OR (_payload ? 'tax_dependents' AND COALESCE(NULLIF(_payload->>'tax_dependents', '')::integer, 0)
           IS DISTINCT FROM COALESCE(NULLIF(_state->>'tax_dependents', '')::integer, 0)) THEN
    RAISE EXCEPTION 'Les changements de paie, poste, service, contrat, catégorie, charges de famille, dates ou statut doivent passer par un mouvement RH' USING ERRCODE = 'QG028';
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

DROP FUNCTION public.list_hr_employees();
CREATE FUNCTION public.list_hr_employees()
RETURNS TABLE (
  id uuid, tenant_id uuid, matricule text, first_name text, last_name text, email text, phone text,
  job_title text, department text, contract_type text, hire_date date, end_date date,
  base_salary numeric, currency text, bank_account text, status text,
  created_at timestamptz, updated_at timestamptz, payroll_category text, tax_dependents integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _sensitive boolean := public.has_hr_perm(auth.uid(), 'view_sensitive');
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'view_employees') THEN
    RAISE EXCEPTION 'Permission refusee : hr.view_employees' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT e.id, e.tenant_id, e.matricule, e.first_name, e.last_name, e.email, e.phone,
           COALESCE(s.state->>'job_title', e.job_title), COALESCE(s.state->>'department', e.department),
           COALESCE(s.state->>'contract_type', e.contract_type),
           COALESCE(NULLIF(s.state->>'hire_date', '')::date, e.hire_date),
           NULLIF(s.state->>'end_date', '')::date,
           CASE WHEN _sensitive THEN NULLIF(s.state->>'base_salary', '')::numeric ELSE NULL END,
           COALESCE(s.state->>'currency', e.currency),
           CASE WHEN _sensitive THEN e.bank_account ELSE NULL END,
           COALESCE(s.state->>'status', e.status), e.created_at, e.updated_at,
           NULLIF(s.state->>'payroll_category', ''),
           CASE WHEN _sensitive THEN COALESCE(NULLIF(s.state->>'tax_dependents', '')::integer, 0) ELSE NULL END
      FROM public.employees e
      CROSS JOIN LATERAL (SELECT public.hr_employee_state_at(e.id, CURRENT_DATE) AS state) s
     WHERE e.tenant_id = _tenant ORDER BY e.matricule, e.id;
END
$function$;
REVOKE ALL ON FUNCTION public.list_hr_employees() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_employees() TO authenticated;

-- 4. Rubriques : exonération fiscale partielle (part exonérée = min(montant, % du salaire de base, plafond)).
ALTER TABLE public.hr_payroll_components
  ADD COLUMN IF NOT EXISTS tax_exempt_pct numeric(7,3) CHECK (tax_exempt_pct IS NULL OR tax_exempt_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS tax_exempt_cap numeric(18,2) CHECK (tax_exempt_cap IS NULL OR tax_exempt_cap >= 0);

DROP FUNCTION public.list_hr_payroll_components(boolean);
CREATE FUNCTION public.list_hr_payroll_components(_include_inactive boolean DEFAULT false)
RETURNS TABLE (id uuid, tenant_id uuid, code text, label text, kind text, calculation_method text,
  amount numeric, cap numeric, effective_from date, effective_to date, gl_account_code text,
  printable boolean, active boolean, sort_order integer, taxable boolean,
  subject_employee_social boolean, subject_employer_social boolean, prorated boolean,
  tax_exempt_pct numeric, tax_exempt_cap numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR (NOT public.has_hr_perm(auth.uid(), 'view_payroll')
      AND NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components')) THEN
    RAISE EXCEPTION 'Droit insuffisant pour consulter les rubriques de paie' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT c.id, c.tenant_id, c.code, c.label, c.kind, c.calculation_method, c.amount, c.cap,
      c.effective_from, c.effective_to, c.gl_account_code, c.printable, c.active, c.sort_order,
      c.taxable, c.subject_employee_social, c.subject_employer_social, c.prorated, c.tax_exempt_pct, c.tax_exempt_cap
    FROM public.hr_payroll_components c
   WHERE c.tenant_id = _tenant AND (_include_inactive OR c.active)
   ORDER BY c.sort_order, c.label, c.code;
END
$function$;
REVOKE ALL ON FUNCTION public.list_hr_payroll_components(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_payroll_components(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_hr_payroll_component(_input jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := NULLIF(_input->>'id', '')::uuid;
  _code text := lower(btrim(_input->>'code'));
  _label text := btrim(_input->>'label');
  _kind text := _input->>'kind';
  _method text := _input->>'calculation_method';
  _amount numeric := (_input->>'amount')::numeric;
  _cap numeric := nullif(_input->>'cap', '')::numeric;
  _from date := (_input->>'effective_from')::date;
  _to date := nullif(_input->>'effective_to', '')::date;
  _exempt_pct numeric := nullif(_input->>'tax_exempt_pct', '')::numeric;
  _exempt_cap numeric := nullif(_input->>'tax_exempt_cap', '')::numeric;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_payroll_components' USING ERRCODE = '42501';
  END IF;
  IF _code IS NULL OR _code !~ '^[a-z0-9][a-z0-9._-]{0,39}$' OR _label IS NULL OR length(_label) NOT BETWEEN 1 AND 120
     OR _kind IS NULL OR _kind NOT IN ('earning', 'deduction', 'employer_charge')
     OR _method IS NULL OR _method NOT IN ('fixed', 'percent_base') OR _amount IS NULL OR _amount <= 0
     OR (_method = 'percent_base' AND _amount > 100) OR _from IS NULL
     OR (_to IS NOT NULL AND _to < _from) OR (_cap IS NOT NULL AND _cap <= 0)
     OR (_exempt_pct IS NOT NULL AND _exempt_pct NOT BETWEEN 0 AND 100) OR (_exempt_cap IS NOT NULL AND _exempt_cap < 0) THEN
    RAISE EXCEPTION 'Definition de rubrique de paie invalide' USING ERRCODE = 'QG028';
  END IF;
  IF (_exempt_pct IS NOT NULL OR _exempt_cap IS NOT NULL)
     AND (_kind <> 'earning' OR NOT COALESCE((_input->>'taxable')::boolean, false)) THEN
    RAISE EXCEPTION 'Une exonération partielle ne s''applique qu''à un gain imposable' USING ERRCODE = 'QG028';
  END IF;
  IF _id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.hr_payroll_components c WHERE c.tenant_id = _tenant AND c.code = _code) THEN
      RAISE EXCEPTION 'Le code de rubrique « % » existe deja : modifiez la rubrique existante', _code USING ERRCODE = 'QG028';
    END IF;
    INSERT INTO public.hr_payroll_components
      (tenant_id, code, label, kind, calculation_method, amount, cap, effective_from, effective_to,
       gl_account_code, printable, active, sort_order, taxable, subject_employee_social, subject_employer_social, prorated,
       tax_exempt_pct, tax_exempt_cap)
    VALUES (_tenant, _code, _label, _kind, _method, _amount, _cap, _from, _to,
      nullif(btrim(_input->>'gl_account_code'), ''), COALESCE((_input->>'printable')::boolean, true),
      COALESCE((_input->>'active')::boolean, true), COALESCE((_input->>'sort_order')::integer, 0),
      COALESCE((_input->>'taxable')::boolean, false),
      COALESCE((_input->>'subject_employee_social')::boolean, false),
      COALESCE((_input->>'subject_employer_social')::boolean, false),
      COALESCE((_input->>'prorated')::boolean, false), _exempt_pct, _exempt_cap)
    RETURNING id INTO _id;
    RETURN _id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.hr_payroll_components c WHERE c.tenant_id = _tenant AND c.code = _code AND c.id <> _id) THEN
    RAISE EXCEPTION 'Le code de rubrique « % » est deja utilise par une autre rubrique', _code USING ERRCODE = 'QG028';
  END IF;
  UPDATE public.hr_payroll_components SET
    code = _code, label = _label, kind = _kind, calculation_method = _method, amount = _amount, cap = _cap,
    effective_from = _from, effective_to = _to, gl_account_code = nullif(btrim(_input->>'gl_account_code'), ''),
    printable = COALESCE((_input->>'printable')::boolean, printable),
    active = COALESCE((_input->>'active')::boolean, active),
    sort_order = COALESCE((_input->>'sort_order')::integer, sort_order),
    taxable = COALESCE((_input->>'taxable')::boolean, taxable),
    subject_employee_social = COALESCE((_input->>'subject_employee_social')::boolean, subject_employee_social),
    subject_employer_social = COALESCE((_input->>'subject_employer_social')::boolean, subject_employer_social),
    prorated = COALESCE((_input->>'prorated')::boolean, prorated),
    tax_exempt_pct = _exempt_pct, tax_exempt_cap = _exempt_cap,
    updated_at = now()
  WHERE id = _id AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rubrique introuvable dans la societe courante' USING ERRCODE = '42501'; END IF;
  RETURN _id;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Definition de rubrique de paie invalide' USING ERRCODE = 'QG028';
END
$function$;

-- 5. Lignes de bulletin : les cotisations deviennent des lignes détaillées.
ALTER TABLE public.payroll_component_lines DROP CONSTRAINT payroll_component_lines_calculation_method_check;
ALTER TABLE public.payroll_component_lines ADD CONSTRAINT payroll_component_lines_calculation_method_check
  CHECK (calculation_method IN ('fixed', 'percent_base', 'contribution'));
ALTER TABLE public.payroll_component_lines DROP CONSTRAINT payroll_component_lines_source_type_check;
ALTER TABLE public.payroll_component_lines ADD CONSTRAINT payroll_component_lines_source_type_check
  CHECK (source_type IN ('base_salary', 'employee_assignment', 'payroll_variable', 'contribution'));

-- 6. Outils de calcul.
CREATE OR REPLACE FUNCTION public.payroll_round(_amount numeric, _unit numeric, _mode text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT ROUND(CASE COALESCE(_mode, 'nearest')
    WHEN 'down' THEN floor(_amount / _unit) * _unit
    WHEN 'up' THEN ceil(_amount / _unit) * _unit
    ELSE round(_amount / _unit) * _unit END, 2)
$function$;
GRANT EXECUTE ON FUNCTION public.payroll_round(numeric, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_tax_bands_valid(_bands jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $function$
DECLARE _band jsonb; _rate numeric; _up_to numeric; _previous numeric := 0; _index integer := 0; _count integer;
BEGIN
  IF _bands IS NULL OR jsonb_typeof(_bands) <> 'array' THEN RETURN false; END IF;
  _count := jsonb_array_length(_bands);
  IF _count = 0 THEN RETURN false; END IF;
  FOR _band IN SELECT value FROM jsonb_array_elements(_bands) LOOP
    _index := _index + 1;
    IF jsonb_typeof(_band) <> 'object' OR NOT (_band ? 'rate_pct') OR NOT (_band ? 'up_to') THEN RETURN false; END IF;
    BEGIN _rate := (_band ->> 'rate_pct')::numeric; EXCEPTION WHEN OTHERS THEN RETURN false; END;
    IF _rate IS NULL OR _rate NOT BETWEEN 0 AND 100 THEN RETURN false; END IF;
    IF _band -> 'up_to' = 'null'::jsonb THEN
      IF _index <> _count THEN RETURN false; END IF;
    ELSE
      BEGIN _up_to := (_band ->> 'up_to')::numeric; EXCEPTION WHEN OTHERS THEN RETURN false; END;
      IF _up_to IS NULL OR _up_to <= _previous OR _index = _count THEN RETURN false; END IF;
      _previous := _up_to;
    END IF;
  END LOOP;
  RETURN true;
END $function$;

-- Anomalies d'une version (vide = valide).
CREATE OR REPLACE FUNCTION public.payroll_rule_version_issues(_version_id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _v public.payroll_rule_versions%ROWTYPE;
  _issues text[] := ARRAY[]::text[];
  _e jsonb;
  _seen text[] := ARRAY[]::text[];
  _key text;
  _c public.payroll_contributions%ROWTYPE;
  _n numeric;
BEGIN
  SELECT * INTO _v FROM public.payroll_rule_versions WHERE id = _version_id;
  IF NOT FOUND THEN RETURN ARRAY['Version introuvable']; END IF;
  IF length(btrim(_v.reference)) < 3 THEN _issues := _issues || 'Référence officielle (texte, article, URL) obligatoire'::text; END IF;
  IF NOT public.payroll_tax_bands_valid(_v.income_tax_bands) THEN
    _issues := _issues || 'Barème d''impôt invalide : tranches croissantes, taux de 0 à 100 %, dernière tranche sans limite'::text;
  END IF;
  FOR _e IN SELECT value FROM jsonb_array_elements(_v.tax_abatements) LOOP
    _key := COALESCE(NULLIF(btrim(_e ->> 'category'), ''), '*');
    BEGIN
      _n := (_e ->> 'rate_pct')::numeric;
      IF jsonb_typeof(_e) <> 'object' OR _n IS NULL OR _n NOT BETWEEN 0 AND 100
         OR COALESCE(_e ->> 'basis', '') NOT IN ('base_salary', 'taxable_gross')
         OR (NULLIF(_e ->> 'min_amount', '') IS NOT NULL AND (_e ->> 'min_amount')::numeric < 0)
         OR (NULLIF(_e ->> 'max_amount', '') IS NOT NULL AND (_e ->> 'max_amount')::numeric
               < COALESCE(NULLIF(_e ->> 'min_amount', '')::numeric, 0)) THEN
        _issues := _issues || format('Abattement « %s » invalide (base, taux, minimum, maximum)', _key);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _issues := _issues || format('Abattement « %s » invalide (valeurs numériques attendues)', _key);
    END;
    IF _key = ANY(_seen) THEN _issues := _issues || format('Abattement « %s » en double', _key); END IF;
    _seen := _seen || _key;
    IF _key <> '*' AND NOT EXISTS (SELECT 1 FROM public.hr_movement_references r
        WHERE r.tenant_id = _v.tenant_id AND r.kind = 'payroll_category' AND r.code = _key) THEN
      _issues := _issues || format('Catégorie « %s » absente du référentiel des catégories de paie', _key);
    END IF;
  END LOOP;
  _seen := ARRAY[]::text[];
  FOR _e IN SELECT value FROM jsonb_array_elements(_v.family_reductions) LOOP
    BEGIN
      IF jsonb_typeof(_e) <> 'object' OR (_e ->> 'dependents')::integer < 1
         OR (_e ->> 'reduction_pct')::numeric NOT BETWEEN 0 AND 100 THEN
        _issues := _issues || 'Réduction pour charges de famille invalide (nombre ≥ 1, taux de 0 à 100 %)'::text;
      END IF;
      IF (_e ->> 'dependents') = ANY(_seen) THEN _issues := _issues || 'Réduction pour charges de famille en double'::text; END IF;
      _seen := _seen || (_e ->> 'dependents');
    EXCEPTION WHEN OTHERS THEN
      _issues := _issues || 'Réduction pour charges de famille invalide (valeurs numériques attendues)'::text;
    END;
  END LOOP;
  FOR _c IN SELECT * FROM public.payroll_contributions WHERE version_id = _version_id LOOP
    IF _c.base_floor IS NOT NULL AND (_c.employee_ceiling <= _c.base_floor OR _c.employer_ceiling <= _c.base_floor) THEN
      _issues := _issues || format('Cotisation %s : le plafond doit dépasser le plancher', _c.code);
    END IF;
    FOREACH _key IN ARRAY ARRAY[_c.payable_account_code, _c.employer_account_code] LOOP
      IF NULLIF(btrim(_key), '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.gl_accounts g
          WHERE g.tenant_id = _v.tenant_id AND g.code = btrim(_key) AND g.is_active AND NOT g.is_header) THEN
        _issues := _issues || format('Cotisation %s : compte %s absent, inactif ou non imputable', _c.code, _key);
      END IF;
    END LOOP;
  END LOOP;
  RETURN _issues;
END $function$;
REVOKE ALL ON FUNCTION public.payroll_rule_version_issues(uuid) FROM PUBLIC, anon, authenticated;

-- Règles applicables à une période (jsonb), version validée sinon règles actuelles converties. Interne.
CREATE OR REPLACE FUNCTION public.payroll_effective_rules(_tenant uuid, _period_start date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _v public.payroll_rule_versions%ROWTYPE;
  _s public.hr_payroll_settings%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.payroll_rule_versions v WHERE v.tenant_id = _tenant AND v.status = 'validated') THEN
    SELECT * INTO _v FROM public.payroll_rule_versions v
     WHERE v.tenant_id = _tenant AND v.status = 'validated' AND v.effective_from <= _period_start
     ORDER BY v.effective_from DESC LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Les baremes du pays ne sont pas applicables a la periode de paie (aucune version validee en vigueur)' USING ERRCODE = 'QG028';
    END IF;
    RETURN jsonb_build_object('engine', 'v149', 'source', 'version', 'version_id', _v.id,
      'country_code', _v.country_code, 'currency_code', _v.currency_code, 'effective_from', _v.effective_from,
      'reference', _v.reference, 'validated_at', _v.validated_at, 'validated_by', _v.validated_by,
      'proration_method', _v.proration_method, 'rounding_unit', _v.rounding_unit, 'rounding_mode', _v.rounding_mode,
      'taxable_rounding_unit', _v.taxable_rounding_unit, 'income_tax_bands', _v.income_tax_bands,
      'tax_abatements', _v.tax_abatements, 'family_reductions', _v.family_reductions,
      'family_max_dependents', _v.family_max_dependents,
      'contributions', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', c.code, 'label', c.label, 'organism', c.organism,
          'employee_rate_pct', c.employee_rate_pct, 'employer_rate_pct', c.employer_rate_pct, 'base_floor', c.base_floor,
          'employee_ceiling', c.employee_ceiling, 'employer_ceiling', c.employer_ceiling,
          'deductible_from_tax', c.deductible_from_tax, 'payable_account_code', c.payable_account_code,
          'employer_account_code', c.employer_account_code, 'sort_order', c.sort_order) ORDER BY c.sort_order, c.code)
        FROM public.payroll_contributions c WHERE c.version_id = _v.id), '[]'::jsonb));
  END IF;

  SELECT * INTO _s FROM public.hr_payroll_settings WHERE tenant_id = _tenant;
  IF NOT FOUND OR _s.rules_validated_at IS NULL OR NOT public.payroll_rules_valid(_s) THEN
    RAISE EXCEPTION 'Les baremes de paie doivent etre configures et confirmes avant le calcul' USING ERRCODE = 'QG028';
  END IF;
  IF _s.rules_effective_from > _period_start THEN
    RAISE EXCEPTION 'Les baremes du pays ne sont pas applicables a la periode de paie' USING ERRCODE = 'QG028';
  END IF;
  RETURN jsonb_build_object('engine', 'v149', 'source', 'legacy_settings', 'version_id', NULL,
    'country_code', _s.country_code, 'currency_code', _s.currency_code, 'effective_from', _s.rules_effective_from,
    'reference', _s.rules_reference, 'validated_at', _s.rules_validated_at, 'validated_by', _s.rules_validated_by,
    'proration_method', _s.proration_method, 'rounding_unit', 0.01, 'rounding_mode', 'nearest',
    'taxable_rounding_unit', NULL, 'income_tax_bands', _s.income_tax_bands,
    'tax_abatements', '[]'::jsonb, 'family_reductions', '[]'::jsonb, 'family_max_dependents', NULL,
    'employee_contribution_pct', _s.employee_contribution_pct, 'employee_contribution_cap', _s.employee_contribution_cap,
    'employer_contribution_pct', _s.employer_contribution_pct, 'employer_contribution_cap', _s.employer_contribution_cap,
    'contributions', jsonb_build_array(jsonb_build_object('code', 'SOCIAL', 'label', 'Cotisations sociales',
      'organism', NULL, 'employee_rate_pct', _s.employee_contribution_pct, 'employer_rate_pct', _s.employer_contribution_pct,
      'base_floor', NULL, 'employee_ceiling', _s.employee_contribution_cap, 'employer_ceiling', _s.employer_contribution_cap,
      'deductible_from_tax', true, 'payable_account_code', NULL, 'employer_account_code', NULL, 'sort_order', 0)));
END $function$;
REVOKE ALL ON FUNCTION public.payroll_effective_rules(uuid, date) FROM PUBLIC, anon, authenticated;

-- 7. Gestion des versions (écrans et API).
CREATE OR REPLACE FUNCTION public.list_payroll_rule_versions()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR (NOT public.has_hr_perm(auth.uid(), 'view_payroll')
      AND NOT public.has_permission(auth.uid(), 'hr.payroll_settings')) THEN
    RAISE EXCEPTION 'Droit insuffisant pour consulter les règles de paie' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(v) || jsonb_build_object(
      'contributions', COALESCE((SELECT jsonb_agg(to_jsonb(c) - 'tenant_id' ORDER BY c.sort_order, c.code)
        FROM public.payroll_contributions c WHERE c.version_id = v.id), '[]'::jsonb),
      'issues', to_jsonb(CASE WHEN v.status = 'draft' THEN public.payroll_rule_version_issues(v.id) ELSE ARRAY[]::text[] END))
      ORDER BY v.effective_from DESC, v.created_at DESC)
    FROM public.payroll_rule_versions v WHERE v.tenant_id = _tenant), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.list_payroll_rule_versions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_payroll_rule_versions() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_payroll_rule_version(_input jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := NULLIF(_input ->> 'id', '')::uuid;
  _c jsonb;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'hr.payroll_settings') THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_settings' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_input) <> 'object' OR NULLIF(_input ->> 'effective_from', '') IS NULL
     OR upper(COALESCE(_input ->> 'country_code', '')) !~ '^[A-Z]{2}$'
     OR upper(COALESCE(_input ->> 'currency_code', '')) !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Pays (ISO 2), devise (ISO 3) et date d''effet sont obligatoires' USING ERRCODE = 'QG028';
  END IF;
  IF _input ? 'contributions' AND jsonb_typeof(_input -> 'contributions') <> 'array' THEN
    RAISE EXCEPTION 'Liste de cotisations invalide' USING ERRCODE = 'QG028';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.payroll_rule_versions (tenant_id, country_code, currency_code, effective_from, reference, notes,
      proration_method, rounding_unit, rounding_mode, taxable_rounding_unit, income_tax_bands, tax_abatements,
      family_reductions, family_max_dependents, created_by)
    VALUES (_tenant, upper(_input ->> 'country_code'), upper(_input ->> 'currency_code'), (_input ->> 'effective_from')::date,
      COALESCE(btrim(_input ->> 'reference'), ''), NULLIF(btrim(_input ->> 'notes'), ''),
      COALESCE(NULLIF(_input ->> 'proration_method', ''), 'calendar_days'),
      COALESCE(NULLIF(_input ->> 'rounding_unit', '')::numeric, 0.01),
      COALESCE(NULLIF(_input ->> 'rounding_mode', ''), 'nearest'),
      NULLIF(_input ->> 'taxable_rounding_unit', '')::numeric,
      COALESCE(_input -> 'income_tax_bands', '[]'::jsonb), COALESCE(_input -> 'tax_abatements', '[]'::jsonb),
      COALESCE(_input -> 'family_reductions', '[]'::jsonb), NULLIF(_input ->> 'family_max_dependents', '')::integer,
      auth.uid())
    RETURNING id INTO _id;
  ELSE
    UPDATE public.payroll_rule_versions SET
      country_code = upper(_input ->> 'country_code'), currency_code = upper(_input ->> 'currency_code'),
      effective_from = (_input ->> 'effective_from')::date, reference = COALESCE(btrim(_input ->> 'reference'), ''),
      notes = NULLIF(btrim(_input ->> 'notes'), ''),
      proration_method = COALESCE(NULLIF(_input ->> 'proration_method', ''), 'calendar_days'),
      rounding_unit = COALESCE(NULLIF(_input ->> 'rounding_unit', '')::numeric, 0.01),
      rounding_mode = COALESCE(NULLIF(_input ->> 'rounding_mode', ''), 'nearest'),
      taxable_rounding_unit = NULLIF(_input ->> 'taxable_rounding_unit', '')::numeric,
      income_tax_bands = COALESCE(_input -> 'income_tax_bands', '[]'::jsonb),
      tax_abatements = COALESCE(_input -> 'tax_abatements', '[]'::jsonb),
      family_reductions = COALESCE(_input -> 'family_reductions', '[]'::jsonb),
      family_max_dependents = NULLIF(_input ->> 'family_max_dependents', '')::integer
    WHERE id = _id AND tenant_id = _tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Version introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
    DELETE FROM public.payroll_contributions WHERE version_id = _id;
  END IF;
  FOR _c IN SELECT value FROM jsonb_array_elements(COALESCE(_input -> 'contributions', '[]'::jsonb)) LOOP
    INSERT INTO public.payroll_contributions (tenant_id, version_id, code, label, organism, employee_rate_pct,
      employer_rate_pct, base_floor, employee_ceiling, employer_ceiling, deductible_from_tax,
      payable_account_code, employer_account_code, sort_order)
    VALUES (_tenant, _id, upper(btrim(_c ->> 'code')), btrim(_c ->> 'label'), NULLIF(btrim(_c ->> 'organism'), ''),
      COALESCE(NULLIF(_c ->> 'employee_rate_pct', '')::numeric, 0), COALESCE(NULLIF(_c ->> 'employer_rate_pct', '')::numeric, 0),
      NULLIF(_c ->> 'base_floor', '')::numeric, NULLIF(_c ->> 'employee_ceiling', '')::numeric,
      NULLIF(_c ->> 'employer_ceiling', '')::numeric, COALESCE((_c ->> 'deductible_from_tax')::boolean, true),
      NULLIF(btrim(_c ->> 'payable_account_code'), ''), NULLIF(btrim(_c ->> 'employer_account_code'), ''),
      COALESCE(NULLIF(_c ->> 'sort_order', '')::integer, 0));
  END LOOP;
  RETURN _id;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'Code de cotisation en double dans la version' USING ERRCODE = 'QG028';
  WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow
    OR invalid_datetime_format THEN
    RAISE EXCEPTION 'Valeur invalide dans la version de règles : %', SQLERRM USING ERRCODE = 'QG028';
END $function$;
REVOKE ALL ON FUNCTION public.save_payroll_rule_version(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_payroll_rule_version(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_payroll_rule_version(_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _v public.payroll_rule_versions%ROWTYPE;
  _issues text[];
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'hr.payroll_rules_validate') THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_rules_validate' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _v FROM public.payroll_rule_versions WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  IF _v.status <> 'draft' THEN RAISE EXCEPTION 'Seule une version brouillon se valide' USING ERRCODE = 'QG028'; END IF;
  _issues := public.payroll_rule_version_issues(_id);
  IF cardinality(_issues) > 0 THEN
    RAISE EXCEPTION 'Version non valide : %', array_to_string(_issues, ' ; ') USING ERRCODE = 'QG028';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_rule_versions v WHERE v.tenant_id = _tenant AND v.status = 'validated'
      AND v.effective_from = _v.effective_from) THEN
    RAISE EXCEPTION 'Une version validée existe déjà au %, archivez-la d''abord', _v.effective_from USING ERRCODE = 'QG028';
  END IF;
  UPDATE public.payroll_rule_versions SET status = 'validated', validated_by = auth.uid(), validated_at = now()
   WHERE id = _id;
  RETURN now();
END $function$;
REVOKE ALL ON FUNCTION public.validate_payroll_rule_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_payroll_rule_version(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_payroll_rule_version(_id uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _v public.payroll_rule_versions%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'hr.payroll_rules_validate') THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_rules_validate' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'Motif d''archivage obligatoire' USING ERRCODE = 'QG028'; END IF;
  SELECT * INTO _v FROM public.payroll_rule_versions WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  IF _v.status <> 'validated' THEN RAISE EXCEPTION 'Seule une version validée s''archive (un brouillon se supprime)' USING ERRCODE = 'QG028'; END IF;
  UPDATE public.payroll_rule_versions SET status = 'archived', archived_by = auth.uid(), archived_at = now(),
         archive_reason = btrim(_reason) WHERE id = _id;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.archive_payroll_rule_version(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_payroll_rule_version(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_payroll_rule_version(_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'hr.payroll_settings') THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_settings' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.payroll_rule_versions WHERE id = _id AND tenant_id = _tenant AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Seul un brouillon de la société courante se supprime' USING ERRCODE = 'QG028'; END IF;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.delete_payroll_rule_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_payroll_rule_version(uuid) TO authenticated;

-- 8. Calcul du cycle (V148 + règles versionnées, cotisations, abattement, charges de famille, arrondis).
CREATE OR REPLACE FUNCTION public.generate_payroll_lines(_run_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _run public.payroll_runs%ROWTYPE;
  _rules jsonb;
  _employee public.employees%ROWTYPE;
  _state jsonb;
  _segment record;
  _segments jsonb;
  _item record;
  _c jsonb;
  _e jsonb;
  _period_start date;
  _period_end date;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _unit numeric;
  _mode text;
  _days_total numeric;
  _days_present numeric;
  _weight numeric;
  _weighted_base numeric;
  _ratio numeric;
  _base numeric(18,2);
  _rate numeric(18,4);
  _amount numeric(18,2);
  _exempt numeric(18,2);
  _gross numeric(18,2);
  _earned numeric(18,2);
  _component_deductions numeric(18,2);
  _component_charges numeric(18,2);
  _employee_base numeric(18,2);
  _employer_base numeric(18,2);
  _taxable_gross numeric(18,2);
  _floor numeric;
  _e_base numeric(18,2);
  _r_base numeric(18,2);
  _e_amount numeric(18,2);
  _r_amount numeric(18,2);
  _employee_contrib numeric(18,2);
  _employer_contrib numeric(18,2);
  _tax_deductible numeric(18,2);
  _taxable numeric(18,2);
  _abatement numeric(18,2);
  _net_taxable numeric(18,2);
  _tax_before numeric(18,2);
  _dependents integer;
  _reduction numeric;
  _taxes numeric(18,2);
  _net numeric(18,2);
  _count integer := 0;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'create_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusee : role Saisie RH requis' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id FOR UPDATE;
  IF _run.tenant_id IS NULL OR _run.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Cycle non modifiable (statut %)', _run.status; END IF;
  IF _run.period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Periode de paie invalide (format attendu AAAA-MM)' USING ERRCODE = 'QG028';
  END IF;
  _period_start := to_date(_run.period || '-01', 'YYYY-MM-DD');
  _period_end := (_period_start + interval '1 month - 1 day')::date;
  IF EXISTS (SELECT 1 FROM public.payroll_run_variables v WHERE v.tenant_id = _tenant
       AND v.run_id = _run_id AND v.status = 'pending') THEN
    RAISE EXCEPTION 'Toutes les variables doivent etre approuvees ou rejetees avant calcul' USING ERRCODE = 'QG028';
  END IF;
  _rules := public.payroll_effective_rules(_tenant, _period_start);
  _unit := (_rules ->> 'rounding_unit')::numeric;
  _mode := _rules ->> 'rounding_mode';
  _days_total := public.payroll_day_weight(_period_start, _period_end, _period_end, _rules ->> 'proration_method');

  DELETE FROM public.payroll_component_lines WHERE run_id = _run_id;
  DELETE FROM public.payroll_lines WHERE run_id = _run_id;
  FOR _employee IN SELECT e.* FROM public.employees e WHERE e.tenant_id = _tenant ORDER BY e.id LOOP
    _days_present := 0; _weighted_base := 0; _state := NULL; _segments := '[]'::jsonb;
    FOR _segment IN SELECT * FROM public.payroll_presence_segments(_employee.id, _period_start, _period_end) LOOP
      IF _segment.present THEN
        _weight := public.payroll_day_weight(_segment.segment_start, _segment.segment_end, _period_end, _rules ->> 'proration_method');
        IF COALESCE(upper(btrim(_segment.state->>'currency')), '') <> (_rules ->> 'currency_code') THEN
          RAISE EXCEPTION 'Devise des salaries differente de la devise du bareme de paie' USING ERRCODE = 'QG028';
        END IF;
        _days_present := _days_present + _weight;
        _weighted_base := _weighted_base
          + GREATEST(COALESCE(NULLIF(_segment.state->>'base_salary', '')::numeric, 0), 0) * _weight;
        _state := _segment.state;
        _segments := _segments || jsonb_build_array(jsonb_build_object('from', _segment.segment_start,
          'to', _segment.segment_end, 'days', _weight, 'base_salary', _segment.state->'base_salary'));
      END IF;
    END LOOP;
    CONTINUE WHEN _days_present <= 0;

    _ratio := LEAST(_days_present / _days_total, 1);
    _base := ROUND(_weighted_base / _days_total, 2);
    _earned := 0; _component_deductions := 0; _component_charges := 0;
    _employee_base := _base; _employer_base := _base; _taxable_gross := _base;

    FOR _item IN
      SELECT c.id component_id, c.code, c.label, c.kind, c.calculation_method,
        c.taxable, c.subject_employee_social, c.subject_employer_social, c.cap, c.prorated,
        c.tax_exempt_pct, c.tax_exempt_cap,
        c.printable, c.sort_order, c.gl_account_code, c.amount definition_amount,
        COALESCE(a.amount_override, c.amount) rate_amount, NULL::numeric variable_amount,
        'employee_assignment'::text source_type, a.id source_id
      FROM public.hr_employee_payroll_components a
      JOIN public.hr_payroll_components c ON c.id = a.component_id AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = _tenant AND a.employee_id = _employee.id AND a.active
        AND a.effective_from <= _period_end AND (a.effective_to IS NULL OR a.effective_to >= _period_start)
        AND c.active AND c.effective_from <= _period_end AND (c.effective_to IS NULL OR c.effective_to >= _period_start)
      UNION ALL
      SELECT c.id, c.code, c.label, c.kind, c.calculation_method,
        c.taxable, c.subject_employee_social, c.subject_employer_social, c.cap, c.prorated,
        c.tax_exempt_pct, c.tax_exempt_cap,
        c.printable, c.sort_order, c.gl_account_code, c.amount, NULL::numeric, v.amount,
        'payroll_variable'::text, v.id
      FROM public.payroll_run_variables v
      JOIN public.hr_payroll_components c ON c.id = v.component_id AND c.tenant_id = v.tenant_id
      WHERE v.tenant_id = _tenant AND v.run_id = _run_id AND v.employee_id = _employee.id
        AND v.status = 'approved' AND c.active
      ORDER BY code, source_type, source_id
    LOOP
      _rate := _item.rate_amount;
      _amount := CASE WHEN _item.source_type = 'payroll_variable' THEN _item.variable_amount
        WHEN _item.calculation_method = 'fixed' AND _item.prorated THEN _rate * _ratio
        WHEN _item.calculation_method = 'fixed' THEN _rate
        ELSE _base * _rate / 100 END;
      IF _item.cap IS NOT NULL THEN _amount := LEAST(_amount, _item.cap); END IF;
      _amount := ROUND(GREATEST(_amount, 0), 2);
      _exempt := 0;
      IF _item.kind = 'earning' THEN
        _earned := _earned + _amount;
        IF _item.taxable THEN
          IF _item.tax_exempt_pct IS NOT NULL OR _item.tax_exempt_cap IS NOT NULL THEN
            _exempt := LEAST(_amount, COALESCE(_base * _item.tax_exempt_pct / 100, _amount), COALESCE(_item.tax_exempt_cap, _amount));
          END IF;
          _taxable_gross := _taxable_gross + _amount - _exempt;
        END IF;
        IF _item.subject_employee_social THEN _employee_base := _employee_base + _amount; END IF;
        IF _item.subject_employer_social THEN _employer_base := _employer_base + _amount; END IF;
      ELSIF _item.kind = 'deduction' THEN
        _component_deductions := _component_deductions + _amount;
      ELSE
        _component_charges := _component_charges + _amount;
      END IF;
      INSERT INTO public.payroll_component_lines
        (tenant_id, run_id, employee_id, component_id, code_snapshot, label_snapshot, kind,
         calculation_method, calculation_base, rate_snapshot, amount, source_type, source_id, definition_snapshot)
      VALUES (_tenant, _run_id, _employee.id, _item.component_id, _item.code, _item.label, _item.kind,
        _item.calculation_method, _base, CASE WHEN _item.source_type = 'payroll_variable' THEN NULL ELSE _rate END,
        _amount, _item.source_type, _item.source_id,
        jsonb_build_object('definition_amount', _item.definition_amount, 'rate_amount', _rate, 'cap', _item.cap,
          'sort_order', _item.sort_order, 'prorated', _item.prorated, 'presence_ratio', ROUND(_ratio, 6),
          'tax_exempt_amount', _exempt,
          'taxable', _item.taxable, 'subject_employee_social', _item.subject_employee_social,
          'subject_employer_social', _item.subject_employer_social, 'printable', _item.printable,
          'gl_account_code', _item.gl_account_code, 'period_start', _period_start, 'period_end', _period_end));
    END LOOP;

    -- Cotisations : une ligne de retenue (part salariale) et une ligne de charge (part patronale) par cotisation.
    _employee_contrib := 0; _employer_contrib := 0; _tax_deductible := 0;
    FOR _c IN SELECT value FROM jsonb_array_elements(_rules -> 'contributions') LOOP
      _floor := COALESCE(NULLIF(_c ->> 'base_floor', '')::numeric, 0);
      _e_base := GREATEST(LEAST(_employee_base, COALESCE(NULLIF(_c ->> 'employee_ceiling', '')::numeric, _employee_base)) - _floor, 0);
      _r_base := GREATEST(LEAST(_employer_base, COALESCE(NULLIF(_c ->> 'employer_ceiling', '')::numeric, _employer_base)) - _floor, 0);
      _e_amount := public.payroll_round(_e_base * COALESCE((_c ->> 'employee_rate_pct')::numeric, 0) / 100, _unit, _mode);
      _r_amount := public.payroll_round(_r_base * COALESCE((_c ->> 'employer_rate_pct')::numeric, 0) / 100, _unit, _mode);
      IF _e_amount > 0 THEN
        INSERT INTO public.payroll_component_lines (tenant_id, run_id, employee_id, code_snapshot, label_snapshot, kind,
          calculation_method, calculation_base, rate_snapshot, amount, source_type, definition_snapshot)
        VALUES (_tenant, _run_id, _employee.id, _c ->> 'code', (_c ->> 'label') || ' (part salariale)', 'deduction',
          'contribution', _e_base, (_c ->> 'employee_rate_pct')::numeric, _e_amount, 'contribution',
          jsonb_build_object('contribution', _c, 'side', 'employee', 'sort_order', 100000 + COALESCE((_c ->> 'sort_order')::integer, 0),
            'printable', true, 'gl_account_code', _c ->> 'payable_account_code', 'payable_account_code', _c ->> 'payable_account_code',
            'period_start', _period_start, 'period_end', _period_end));
        _employee_contrib := _employee_contrib + _e_amount;
        IF COALESCE((_c ->> 'deductible_from_tax')::boolean, true) THEN _tax_deductible := _tax_deductible + _e_amount; END IF;
      END IF;
      IF _r_amount > 0 THEN
        INSERT INTO public.payroll_component_lines (tenant_id, run_id, employee_id, code_snapshot, label_snapshot, kind,
          calculation_method, calculation_base, rate_snapshot, amount, source_type, definition_snapshot)
        VALUES (_tenant, _run_id, _employee.id, _c ->> 'code', (_c ->> 'label') || ' (part patronale)', 'employer_charge',
          'contribution', _r_base, (_c ->> 'employer_rate_pct')::numeric, _r_amount, 'contribution',
          jsonb_build_object('contribution', _c, 'side', 'employer', 'sort_order', 200000 + COALESCE((_c ->> 'sort_order')::integer, 0),
            'printable', true, 'gl_account_code', _c ->> 'employer_account_code', 'payable_account_code', _c ->> 'payable_account_code',
            'period_start', _period_start, 'period_end', _period_end));
        _employer_contrib := _employer_contrib + _r_amount;
      END IF;
    END LOOP;

    -- Impôt : imposable − cotisations déductibles − abattement (catégorie du salarié), arrondi de la base,
    -- barème progressif, réduction pour charges de famille.
    _taxable := GREATEST(_taxable_gross - _tax_deductible, 0);
    SELECT value INTO _e FROM jsonb_array_elements(_rules -> 'tax_abatements') value
     WHERE NULLIF(btrim(value ->> 'category'), '') IS NOT DISTINCT FROM NULLIF(_state ->> 'payroll_category', '')
        OR NULLIF(btrim(value ->> 'category'), '') IS NULL
     ORDER BY (NULLIF(btrim(value ->> 'category'), '') IS NULL) LIMIT 1;
    _abatement := 0;
    IF _e IS NOT NULL THEN
      _abatement := (CASE WHEN _e ->> 'basis' = 'taxable_gross' THEN _taxable_gross ELSE _base END)
        * (_e ->> 'rate_pct')::numeric / 100;
      IF NULLIF(_e ->> 'min_amount', '') IS NOT NULL THEN _abatement := GREATEST(_abatement, (_e ->> 'min_amount')::numeric); END IF;
      IF NULLIF(_e ->> 'max_amount', '') IS NOT NULL THEN _abatement := LEAST(_abatement, (_e ->> 'max_amount')::numeric); END IF;
      _abatement := ROUND(LEAST(_abatement, _taxable), 2);
    END IF;
    _net_taxable := _taxable - _abatement;
    IF NULLIF(_rules ->> 'taxable_rounding_unit', '') IS NOT NULL THEN
      _net_taxable := public.payroll_round(_net_taxable, (_rules ->> 'taxable_rounding_unit')::numeric, 'down');
    END IF;
    _tax_before := public.compute_progressive_payroll_tax(_net_taxable, _rules -> 'income_tax_bands');
    _dependents := LEAST(COALESCE(NULLIF(_state ->> 'tax_dependents', '')::integer, 0),
      COALESCE(NULLIF(_rules ->> 'family_max_dependents', '')::integer, 30));
    SELECT (value ->> 'reduction_pct')::numeric INTO _reduction FROM jsonb_array_elements(_rules -> 'family_reductions') value
     WHERE (value ->> 'dependents')::integer <= _dependents ORDER BY (value ->> 'dependents')::integer DESC LIMIT 1;
    _taxes := public.payroll_round(_tax_before * (1 - COALESCE(_reduction, 0) / 100), _unit, _mode);

    INSERT INTO public.payroll_component_lines
      (tenant_id, run_id, employee_id, code_snapshot, label_snapshot, kind, calculation_method,
       calculation_base, amount, source_type, definition_snapshot)
    VALUES (_tenant, _run_id, _employee.id, 'BASE_SALARY', 'Salaire de base', 'earning', 'fixed',
      _base, _base, 'base_salary', jsonb_build_object('employee_state', _state, 'as_of', _period_end,
        'presence', jsonb_build_object('method', _rules ->> 'proration_method', 'days_present', _days_present,
          'days_total', _days_total, 'ratio', ROUND(_ratio, 6), 'segments', _segments),
        'tax', jsonb_build_object('taxable_gross', _taxable_gross, 'deductible_contributions', _tax_deductible,
          'abatement', _abatement, 'abatement_rule', _e, 'net_taxable', _net_taxable, 'tax_before_reduction', _tax_before,
          'dependents', _dependents, 'reduction_pct', COALESCE(_reduction, 0), 'tax', _taxes),
        'rule_version_id', _rules -> 'version_id'));

    _gross := ROUND(_base + _earned, 2);
    _net := ROUND(_gross - _employee_contrib - _component_deductions - _taxes, 2);
    INSERT INTO public.payroll_lines
      (tenant_id, run_id, employee_id, gross, deductions, taxes, net, employer_charges, department_snapshot)
    VALUES (_tenant, _run_id, _employee.id, _gross, ROUND(_employee_contrib + _component_deductions, 2), _taxes,
        _net, ROUND(_employer_contrib + _component_charges, 2), COALESCE(_state->>'department', ''));
    _count := _count + 1;
  END LOOP;
  UPDATE public.payroll_runs
     SET gross_total = COALESCE((SELECT SUM(gross) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         net_total = COALESCE((SELECT SUM(net) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         deductions_total = COALESCE((SELECT SUM(deductions) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         taxes_total = COALESCE((SELECT SUM(taxes) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         employer_charges_total = COALESCE((SELECT SUM(employer_charges) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         employee_count = _count, payroll_country_code = _rules ->> 'country_code',
         payroll_currency_code = _rules ->> 'currency_code',
         payroll_rules_snapshot = _rules || jsonb_build_object(
           'rules_effective_from', _rules -> 'effective_from', 'rules_reference', _rules -> 'reference',
           'rules_validated_at', _rules -> 'validated_at', 'rules_validated_by', _rules -> 'validated_by',
           'components_snapshot', true)
   WHERE id = _run_id;
  INSERT INTO public.payroll_run_audit (tenant_id, run_id, event_type, from_status, to_status, performed_by, details)
  VALUES (_tenant, _run_id, 'lines_generated', _run.status, _run.status, auth.uid(),
    jsonb_build_object('line_count', _count, 'country', _rules ->> 'country_code',
      'currency', _rules ->> 'currency_code', 'employment_state_as_of', _period_end,
      'rules_source', _rules ->> 'source', 'rule_version_id', _rules -> 'version_id',
      'proration_method', _rules ->> 'proration_method',
      'component_line_count', (SELECT count(*) FROM public.payroll_component_lines WHERE run_id = _run_id)));
  RETURN _count;
END
$function$;

-- 9. Comptabilisation : cycles calculés par V149 = écriture par compte (cotisations comprises) ; cycles
--    antérieurs = logique V98 inchangée.
CREATE OR REPLACE FUNCTION public.post_payroll_run(_run_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _r public.payroll_runs%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _entry_id uuid;
  _entry_number text;
  _gross numeric;
  _ded numeric;
  _tax numeric;
  _net numeric;
  _patronal numeric;
  _component_deductions numeric := 0;
  _component_charges numeric := 0;
  _social_credit numeric;
  _account_id uuid;
  _line record;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'execute_payroll') THEN
    RAISE EXCEPTION 'Permission refusee : role Officier de Paie requis' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _r FROM public.payroll_runs WHERE id = _run_id FOR UPDATE;
  IF _r.tenant_id IS NULL OR _r.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _r.status = 'posted' THEN RAISE EXCEPTION 'Cycle deja comptabilise'; END IF;
  IF _r.status <> 'approved' THEN RAISE EXCEPTION 'Le cycle doit etre approuve avant comptabilisation'; END IF;
  IF _r.payroll_rules_snapshot IS NULL OR _r.payroll_country_code IS NULL THEN
    RAISE EXCEPTION 'Le cycle ne contient pas de photographie des baremes valides' USING ERRCODE = 'QG028';
  END IF;

  SELECT COALESCE(SUM(gross), 0), COALESCE(SUM(deductions), 0), COALESCE(SUM(taxes), 0),
         COALESCE(SUM(net), 0), COALESCE(SUM(employer_charges), 0)
    INTO _gross, _ded, _tax, _net, _patronal FROM public.payroll_lines
   WHERE tenant_id = _tenant AND run_id = _run_id;
  IF _gross <= 0 THEN RAISE EXCEPTION 'Cycle vide - aucune ligne a comptabiliser'; END IF;

  _entry_number := 'JE-PAY-' || _r.period || '-' || substr(_run_id::text, 1, 8);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, _entry_number, _r.pay_date, 'Paie ' || _r.period || ' (' || _r.payroll_country_code || ')', 'payroll', 'draft', auth.uid())
  RETURNING id INTO _entry_id;

  IF _r.payroll_rules_snapshot ->> 'engine' = 'v149' THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    SELECT _entry_id, x.account_id, sum(x.debit), sum(x.credit),
           CASE WHEN count(DISTINCT x.label) = 1 THEN min(x.label) ELSE min(x.grp) END
      FROM (
        SELECT public.hr_component_posting_account(_tenant, COALESCE(l.definition_snapshot ->> 'gl_account_code', ''),
                 CASE WHEN l.kind = 'earning' THEN 'PAYROLL_SALARIES' ELSE 'PAYROLL_EMPLOYER_CHARGES' END) account_id,
               l.amount debit, 0::numeric credit, l.label_snapshot label,
               CASE WHEN l.kind = 'earning' THEN 'Rémunérations' ELSE 'Charges patronales' END grp, 'D' side
          FROM public.payroll_component_lines l
         WHERE l.tenant_id = _tenant AND l.run_id = _run_id AND l.kind IN ('earning', 'employer_charge') AND l.amount > 0
        UNION ALL
        SELECT public.hr_component_posting_account(_tenant, COALESCE(l.definition_snapshot ->> 'gl_account_code', ''), 'PAYROLL_SOCIAL'),
               0, l.amount, l.label_snapshot, 'Retenues et cotisations', 'C'
          FROM public.payroll_component_lines l
         WHERE l.tenant_id = _tenant AND l.run_id = _run_id AND l.kind = 'deduction' AND l.amount > 0
        UNION ALL
        SELECT public.hr_component_posting_account(_tenant,
                 CASE WHEN l.source_type = 'contribution' THEN COALESCE(l.definition_snapshot ->> 'payable_account_code', '') ELSE '' END,
                 'PAYROLL_SOCIAL'),
               0, l.amount, l.label_snapshot, 'Organismes sociaux', 'C'
          FROM public.payroll_component_lines l
         WHERE l.tenant_id = _tenant AND l.run_id = _run_id AND l.kind = 'employer_charge' AND l.amount > 0
      ) x
     GROUP BY x.account_id, x.side;
  ELSIF EXISTS (SELECT 1 FROM public.payroll_component_lines WHERE tenant_id = _tenant AND run_id = _run_id) THEN
    SELECT COALESCE(sum(amount), 0) INTO _component_charges
      FROM public.payroll_component_lines
     WHERE tenant_id = _tenant AND run_id = _run_id AND kind = 'employer_charge';
    FOR _line IN
      SELECT kind, COALESCE(NULLIF(btrim(definition_snapshot->>'gl_account_code'), ''), '') AS account_code,
             sum(amount) AS amount, min(label_snapshot) AS label
        FROM public.payroll_component_lines
       WHERE tenant_id = _tenant AND run_id = _run_id AND kind IN ('earning', 'employer_charge') AND amount > 0
       GROUP BY kind, COALESCE(NULLIF(btrim(definition_snapshot->>'gl_account_code'), ''), '')
       ORDER BY kind, account_code
    LOOP
      _account_id := public.hr_component_posting_account(_tenant, _line.account_code,
        CASE WHEN _line.kind = 'earning' THEN 'PAYROLL_SALARIES' ELSE 'PAYROLL_EMPLOYER_CHARGES' END);
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _account_id, _line.amount, 0, _line.label);
    END LOOP;
    IF _patronal > _component_charges THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_EMPLOYER_CHARGES'),
        _patronal - _component_charges, 0, 'Cotisations patronales legales');
    END IF;
    FOR _line IN
      SELECT COALESCE(NULLIF(btrim(definition_snapshot->>'gl_account_code'), ''), '') AS account_code,
             sum(amount) AS amount, min(label_snapshot) AS label
        FROM public.payroll_component_lines
       WHERE tenant_id = _tenant AND run_id = _run_id AND kind = 'deduction' AND amount > 0
       GROUP BY COALESCE(NULLIF(btrim(definition_snapshot->>'gl_account_code'), ''), '')
       ORDER BY account_code
    LOOP
      _component_deductions := _component_deductions + _line.amount;
      _account_id := public.hr_component_posting_account(_tenant, _line.account_code, 'PAYROLL_SOCIAL');
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _account_id, 0, _line.amount, _line.label);
    END LOOP;
  ELSE
    -- Compatibility with cycles calculated before component snapshots existed.
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_SALARIES'), _gross, 0, 'Salaires bruts');
    IF _patronal > 0 THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_EMPLOYER_CHARGES'), _patronal, 0, 'Charges patronales');
    END IF;
  END IF;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_NET_PAYABLE'), 0, _net, 'Personnel - remunerations dues');
  IF _r.payroll_rules_snapshot ->> 'engine' IS DISTINCT FROM 'v149' THEN
    _social_credit := _ded + _patronal - _component_deductions;
    IF _social_credit > 0 THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_SOCIAL'), 0, _social_credit, 'Organismes sociaux');
    END IF;
  END IF;
  IF _tax > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_TAX'), 0, _tax, 'Etat - impot sur salaires');
  END IF;
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry_id;
  UPDATE public.payroll_runs
     SET status = 'posted', executed_by = auth.uid(), executed_at = now(), notes = COALESCE(notes, '') || ' | JE=' || _entry_number
   WHERE id = _run_id;
  RETURN _entry_id;
END
$function$;
GRANT EXECUTE ON FUNCTION public.post_payroll_run(uuid) TO authenticated;

-- 10. Isolation : les nouvelles tables liées entre elles sont couvertes par le contrôle de même société.
SELECT public.install_tenant_isolation_triggers();
