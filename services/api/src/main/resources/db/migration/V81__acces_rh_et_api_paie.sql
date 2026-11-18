-- V81 — annuaire RH à accès fin et contrat commun des opérations paie.
-- Les règles de paie restent pilotées par les paramètres confirmés de chaque société.

INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('hr.view_employees', 'hr', 'view_employees', 'Consulter les dossiers salariés'),
  ('hr.manage_compensation', 'hr', 'manage_compensation', 'Gérer les rémunérations'),
  ('hr.manage_bank_details', 'hr', 'manage_bank_details', 'Gérer les coordonnées bancaires RH')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.role_code, v.permission_code
FROM (VALUES
  ('admin', 'hr.view_employees'), ('admin', 'hr.manage_compensation'), ('admin', 'hr.manage_bank_details'),
  ('hr_admin', 'hr.view_employees'), ('hr_admin', 'hr.manage_compensation'), ('hr_admin', 'hr.manage_bank_details'),
  ('hr_clerk', 'hr.view_employees'), ('hr_clerk', 'hr.manage_employees'), ('hr_clerk', 'hr.view_payroll'),
  ('hr_approver', 'hr.view_employees'), ('hr_approver', 'hr.view_payroll'),
  ('payroll_officer', 'hr.view_employees'), ('payroll_officer', 'hr.view_payroll'),
  ('payroll_officer', 'hr.manage_compensation'), ('payroll_officer', 'hr.manage_bank_details'),
  ('hr_auditor', 'hr.view_employees'), ('hr_auditor', 'hr.view_payroll')
) AS v(role_code, permission_code)
ON CONFLICT DO NOTHING;

-- La saisie RH doit pouvoir consulter les données de base, sans salaire ni IBAN.
DELETE FROM public.erp_system_role_permissions
 WHERE role_code = 'hr_clerk' AND permission_code = 'hr.view_sensitive';

-- Synchroniser les rôles système déjà matérialisés pour chaque société.
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
DELETE FROM public.erp_role_permissions ep
 USING public.erp_roles r
 WHERE ep.role_id = r.id AND r.is_system AND r.code = 'hr_clerk'
   AND ep.permission_code = 'hr.view_sensitive';
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND r.code IN ('admin', 'hr_admin', 'hr_clerk', 'hr_approver', 'payroll_officer', 'hr_auditor')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

DROP POLICY employees_hr_select ON public.employees;
CREATE POLICY employees_hr_select ON public.employees FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
         AND (public.has_hr_perm(auth.uid(), 'view_employees')
              OR public.has_hr_perm(auth.uid(), 'view_sensitive')));

-- Aucun accès direct aux colonnes financières depuis PostgREST. Les fonctions ci-dessous
-- n'exposent salaire/IBAN qu'après vérification explicite des permissions.
REVOKE SELECT, INSERT, UPDATE ON public.employees FROM authenticated;
GRANT SELECT (id, tenant_id, matricule, first_name, last_name, email, phone, job_title, department,
              contract_type, hire_date, end_date, currency, status, created_at, updated_at)
  ON public.employees TO authenticated;

CREATE OR REPLACE FUNCTION public.list_hr_employees()
RETURNS TABLE (
  id uuid, tenant_id uuid, matricule text, first_name text, last_name text, email text, phone text,
  job_title text, department text, contract_type text, hire_date date, end_date date,
  base_salary numeric, currency text, bank_account text, status text,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _sensitive boolean := public.has_hr_perm(auth.uid(), 'view_sensitive');
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'view_employees') THEN
    RAISE EXCEPTION 'Permission refusée : hr.view_employees' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT e.id, e.tenant_id, e.matricule, e.first_name, e.last_name, e.email, e.phone,
           e.job_title, e.department, e.contract_type, e.hire_date, e.end_date,
           CASE WHEN _sensitive THEN e.base_salary ELSE NULL END,
           e.currency,
           CASE WHEN _sensitive THEN e.bank_account ELSE NULL END,
           e.status, e.created_at, e.updated_at
      FROM public.employees e
     WHERE e.tenant_id = _tenant
     ORDER BY e.matricule, e.id;
END
$function$;

CREATE OR REPLACE FUNCTION public.save_hr_employee(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := NULLIF(_payload ->> 'id', '')::uuid;
  _employee public.employees%ROWTYPE;
  _manage_compensation boolean := public.has_hr_perm(auth.uid(), 'manage_compensation');
  _manage_bank boolean := public.has_hr_perm(auth.uid(), 'manage_bank_details');
  _salary numeric := NULLIF(_payload ->> 'base_salary', '')::numeric;
  _bank text := NULLIF(btrim(_payload ->> 'bank_account'), '');
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_employees') THEN
    RAISE EXCEPTION 'Permission refusée : hr.manage_employees' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(_payload ->> 'matricule'), '') IS NULL
     OR NULLIF(btrim(_payload ->> 'first_name'), '') IS NULL
     OR NULLIF(btrim(_payload ->> 'last_name'), '') IS NULL
     OR NULLIF(btrim(_payload ->> 'contract_type'), '') IS NULL THEN
    RAISE EXCEPTION 'Matricule, prénom, nom et contrat sont obligatoires' USING ERRCODE = 'QG028';
  END IF;
  IF _salary IS NOT NULL AND _salary < 0 THEN
    RAISE EXCEPTION 'La rémunération ne peut pas être négative' USING ERRCODE = 'QG028';
  END IF;
  IF NOT _manage_bank AND _bank IS NOT NULL THEN
    RAISE EXCEPTION 'Permission refusée : hr.manage_bank_details' USING ERRCODE = '42501';
  END IF;

  IF _id IS NULL THEN
    IF _salary IS NOT NULL AND _salary <> 0 AND NOT _manage_compensation THEN
      RAISE EXCEPTION 'Permission refusée : hr.manage_compensation' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.employees (
      tenant_id, matricule, first_name, last_name, email, phone, job_title, department,
      contract_type, hire_date, end_date, base_salary, currency, bank_account, status
    ) VALUES (
      _tenant, btrim(_payload ->> 'matricule'), btrim(_payload ->> 'first_name'), btrim(_payload ->> 'last_name'),
      NULLIF(lower(btrim(_payload ->> 'email')), ''), NULLIF(btrim(_payload ->> 'phone'), ''),
      NULLIF(btrim(_payload ->> 'job_title'), ''), NULLIF(btrim(_payload ->> 'department'), ''),
      btrim(_payload ->> 'contract_type'), COALESCE(NULLIF(_payload ->> 'hire_date', '')::date, CURRENT_DATE),
      NULLIF(_payload ->> 'end_date', '')::date, COALESCE(_salary, 0),
      CASE WHEN _manage_compensation THEN upper(COALESCE(NULLIF(_payload ->> 'currency', ''), 'XOF'))
           ELSE COALESCE((SELECT s.currency_code::text FROM public.hr_payroll_settings s WHERE s.tenant_id = _tenant), 'XOF') END,
      CASE WHEN _manage_bank THEN _bank ELSE NULL END,
      COALESCE(NULLIF(_payload ->> 'status', ''), 'active')
    ) RETURNING id INTO _id;
    RETURN _id;
  END IF;

  SELECT * INTO _employee FROM public.employees e
   WHERE e.id = _id AND e.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employé introuvable dans la société courante' USING ERRCODE = '42501';
  END IF;
  IF NOT _manage_compensation AND _salary IS NOT NULL AND _salary IS DISTINCT FROM _employee.base_salary THEN
    RAISE EXCEPTION 'Permission refusée : hr.manage_compensation' USING ERRCODE = '42501';
  END IF;
  IF _manage_compensation AND _salary IS NOT NULL AND _salary IS DISTINCT FROM _employee.base_salary THEN
    RAISE EXCEPTION 'Une modification de rémunération doit être enregistrée comme mouvement RH effectif-daté' USING ERRCODE = 'QG028';
  END IF;
  UPDATE public.employees SET
    matricule = btrim(_payload ->> 'matricule'), first_name = btrim(_payload ->> 'first_name'),
    last_name = btrim(_payload ->> 'last_name'), email = NULLIF(lower(btrim(_payload ->> 'email')), ''),
    phone = NULLIF(btrim(_payload ->> 'phone'), ''), job_title = NULLIF(btrim(_payload ->> 'job_title'), ''),
    department = NULLIF(btrim(_payload ->> 'department'), ''), contract_type = btrim(_payload ->> 'contract_type'),
    hire_date = COALESCE(NULLIF(_payload ->> 'hire_date', '')::date, _employee.hire_date),
    end_date = CASE WHEN _payload ? 'end_date' THEN NULLIF(_payload ->> 'end_date', '')::date ELSE _employee.end_date END,
    base_salary = _employee.base_salary,
    currency = _employee.currency,
    bank_account = CASE WHEN _manage_bank THEN _bank ELSE _employee.bank_account END,
    status = COALESCE(NULLIF(_payload ->> 'status', ''), _employee.status), updated_at = now()
   WHERE id = _id AND tenant_id = _tenant;
  RETURN _id;
END
$function$;

CREATE OR REPLACE FUNCTION public.create_payroll_run(_period text, _pay_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'create_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusée : hr.create_payroll_run' USING ERRCODE = '42501';
  END IF;
  IF _period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR _pay_date IS NULL THEN
    RAISE EXCEPTION 'Période ou date de paie invalide' USING ERRCODE = 'QG028';
  END IF;
  INSERT INTO public.payroll_runs (tenant_id, period, pay_date, status, created_by)
  VALUES (_tenant, _period, _pay_date, 'draft', auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END
$function$;

REVOKE ALL ON FUNCTION public.list_hr_employees() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_hr_employee(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_payroll_run(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_employees() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_hr_employee(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_payroll_run(text, date) TO authenticated;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
