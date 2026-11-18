-- V82 - mouvements RH effectifs-dates, approbation separee et piste immuable.
-- Aucun bareme ni motif legal n'est presuppose : les motifs sont fournis par la societe.

INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('hr.create_employee_movement', 'hr', 'create_employee_movement', 'Soumettre un mouvement RH'),
  ('hr.approve_employee_movement', 'hr', 'approve_employee_movement', 'Approuver un mouvement RH'),
  ('hr.view_employee_history', 'hr', 'view_employee_history', 'Consulter l''historique RH')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.role_code, v.permission_code
FROM (VALUES
  ('admin', 'hr.create_employee_movement'), ('admin', 'hr.approve_employee_movement'), ('admin', 'hr.view_employee_history'),
  ('hr_admin', 'hr.create_employee_movement'), ('hr_admin', 'hr.approve_employee_movement'), ('hr_admin', 'hr.view_employee_history'),
  ('hr_clerk', 'hr.create_employee_movement'), ('hr_clerk', 'hr.view_employee_history'),
  ('hr_approver', 'hr.approve_employee_movement'), ('hr_approver', 'hr.view_employee_history'),
  ('payroll_officer', 'hr.view_employee_history'), ('hr_auditor', 'hr.view_employee_history')
) AS v(role_code, permission_code)
ON CONFLICT DO NOTHING;

SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND r.code IN ('admin', 'hr_admin', 'hr_clerk', 'hr_approver', 'payroll_officer', 'hr_auditor')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- Un dossier identitaire peut etre corrige ici; les champs d'emploi/salaire ne sont modifiables que par mouvement.
CREATE OR REPLACE FUNCTION public.save_hr_employee(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := NULLIF(_payload ->> 'id', '')::uuid;
  _employee public.employees%ROWTYPE;
  _state jsonb;
  _manage_compensation boolean := public.has_hr_perm(auth.uid(), 'manage_compensation');
  _manage_bank boolean := public.has_hr_perm(auth.uid(), 'manage_bank_details');
  _salary numeric := NULLIF(_payload ->> 'base_salary', '')::numeric;
  _bank text := NULLIF(btrim(_payload ->> 'bank_account'), '');
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_employees') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_employees' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(_payload ->> 'matricule'), '') IS NULL OR NULLIF(btrim(_payload ->> 'first_name'), '') IS NULL
     OR NULLIF(btrim(_payload ->> 'last_name'), '') IS NULL OR NULLIF(btrim(_payload ->> 'contract_type'), '') IS NULL THEN
    RAISE EXCEPTION 'Matricule, prenom, nom et contrat sont obligatoires' USING ERRCODE = 'QG028';
  END IF;
  IF _salary IS NOT NULL AND _salary < 0 THEN RAISE EXCEPTION 'Remuneration invalide' USING ERRCODE = 'QG028'; END IF;
  IF NOT _manage_bank AND _bank IS NOT NULL THEN RAISE EXCEPTION 'Permission refusee : hr.manage_bank_details' USING ERRCODE = '42501'; END IF;
  IF _id IS NULL THEN
    IF _salary IS NOT NULL AND _salary <> 0 AND NOT _manage_compensation THEN
      RAISE EXCEPTION 'Permission refusee : hr.manage_compensation' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.employees (tenant_id, matricule, first_name, last_name, email, phone, job_title, department,
      contract_type, hire_date, end_date, base_salary, currency, bank_account, status)
    VALUES (_tenant, btrim(_payload ->> 'matricule'), btrim(_payload ->> 'first_name'), btrim(_payload ->> 'last_name'),
      NULLIF(lower(btrim(_payload ->> 'email')), ''), NULLIF(btrim(_payload ->> 'phone'), ''),
      NULLIF(btrim(_payload ->> 'job_title'), ''), NULLIF(btrim(_payload ->> 'department'), ''),
      btrim(_payload ->> 'contract_type'), COALESCE(NULLIF(_payload ->> 'hire_date', '')::date, CURRENT_DATE),
      NULLIF(_payload ->> 'end_date', '')::date, COALESCE(_salary, 0),
      CASE WHEN _manage_compensation THEN upper(COALESCE(NULLIF(_payload ->> 'currency', ''), 'XOF'))
        ELSE COALESCE((SELECT s.currency_code::text FROM public.hr_payroll_settings s WHERE s.tenant_id = _tenant), 'XOF') END,
      CASE WHEN _manage_bank THEN _bank ELSE NULL END, COALESCE(NULLIF(_payload ->> 'status', ''), 'active'))
    RETURNING id INTO _id;
    RETURN _id;
  END IF;
  SELECT * INTO _employee FROM public.employees e WHERE e.id = _id AND e.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employe introuvable dans la societe courante' USING ERRCODE = '42501'; END IF;
  _state := public.hr_employee_state_at(_id, CURRENT_DATE);
  IF (_payload ? 'base_salary' AND _salary IS DISTINCT FROM NULLIF(_state->>'base_salary', '')::numeric)
     OR (_payload ? 'currency' AND upper(_payload->>'currency') IS DISTINCT FROM upper(_state->>'currency'))
     OR (_payload ? 'job_title' AND NULLIF(btrim(_payload->>'job_title'), '') IS DISTINCT FROM _state->>'job_title')
     OR (_payload ? 'department' AND NULLIF(btrim(_payload->>'department'), '') IS DISTINCT FROM _state->>'department')
     OR (_payload ? 'contract_type' AND btrim(_payload->>'contract_type') IS DISTINCT FROM _state->>'contract_type')
     OR (_payload ? 'hire_date' AND NULLIF(_payload->>'hire_date', '')::date IS DISTINCT FROM NULLIF(_state->>'hire_date', '')::date)
     OR (_payload ? 'end_date' AND NULLIF(_payload->>'end_date', '')::date IS DISTINCT FROM NULLIF(_state->>'end_date', '')::date)
     OR (_payload ? 'status' AND _payload->>'status' IS DISTINCT FROM _state->>'status') THEN
    RAISE EXCEPTION 'Les changements de salaire, poste, departement, contrat, dates ou statut doivent passer par un mouvement RH' USING ERRCODE = 'QG028';
  END IF;
  UPDATE public.employees SET matricule = btrim(_payload->>'matricule'), first_name = btrim(_payload->>'first_name'),
    last_name = btrim(_payload->>'last_name'), email = NULLIF(lower(btrim(_payload->>'email')), ''),
    phone = NULLIF(btrim(_payload->>'phone'), ''), bank_account = CASE WHEN _manage_bank THEN _bank ELSE _employee.bank_account END,
    updated_at = now() WHERE id = _id AND tenant_id = _tenant;
  RETURN _id;
END
$function$;

CREATE TABLE public.employee_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (length(btrim(movement_type)) BETWEEN 1 AND 80),
  effective_date date NOT NULL,
  reason_code text NOT NULL CHECK (length(btrim(reason_code)) BETWEEN 1 AND 80),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 2000),
  before_values jsonb NOT NULL CHECK (jsonb_typeof(before_values) = 'object'),
  after_values jsonb NOT NULL CHECK (jsonb_typeof(after_values) = 'object' AND after_values <> '{}'::jsonb),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  CONSTRAINT employee_movements_approval_fields CHECK
    ((status IN ('approved', 'rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
      OR (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)),
  CONSTRAINT employee_movements_id_tenant UNIQUE (id, tenant_id)
);
CREATE INDEX employee_movements_tenant_employee_date_idx
  ON public.employee_movements (tenant_id, employee_id, effective_date, created_at);
CREATE UNIQUE INDEX employee_movements_one_decision_per_date_idx
  ON public.employee_movements (tenant_id, employee_id, effective_date)
  WHERE status IN ('pending', 'approved');

CREATE TABLE public.employee_movement_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  movement_id uuid NOT NULL REFERENCES public.employee_movements(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('submitted', 'approved', 'rejected')),
  performed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object')
);
CREATE INDEX employee_movement_audit_tenant_movement_idx
  ON public.employee_movement_audit (tenant_id, movement_id, created_at DESC, id DESC);

ALTER TABLE public.employee_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_movement_audit ENABLE ROW LEVEL SECURITY;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.employee_movements FROM authenticated;
GRANT SELECT (id, tenant_id, employee_id, movement_type, effective_date, reason_code, reason, status,
              created_by, created_at, decided_by, decided_at, decision_reason)
  ON public.employee_movements TO authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.employee_movement_audit FROM authenticated;
GRANT SELECT (id, tenant_id, movement_id, event_type, performed_by, created_at)
  ON public.employee_movement_audit TO authenticated;
CREATE POLICY employee_movements_select ON public.employee_movements FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_hr_perm(auth.uid(), 'view_employee_history'));
CREATE POLICY employee_movements_insert ON public.employee_movements FOR INSERT TO authenticated
  WITH CHECK (false);
CREATE POLICY employee_movements_update ON public.employee_movements FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY employee_movements_delete ON public.employee_movements FOR DELETE TO authenticated
  USING (false);
CREATE POLICY employee_movement_audit_select ON public.employee_movement_audit FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_hr_perm(auth.uid(), 'view_employee_history'));
CREATE POLICY employee_movement_audit_insert ON public.employee_movement_audit FOR INSERT TO authenticated
  WITH CHECK (false);
CREATE POLICY employee_movement_audit_update ON public.employee_movement_audit FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY employee_movement_audit_delete ON public.employee_movement_audit FOR DELETE TO authenticated
  USING (false);

CREATE FUNCTION public.reject_employee_movement_audit_change() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  RAISE EXCEPTION 'La piste d''audit RH est immuable' USING ERRCODE = '42501';
END
$function$;
CREATE TRIGGER employee_movement_audit_immutable
BEFORE UPDATE OR DELETE ON public.employee_movement_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_employee_movement_audit_change();

CREATE FUNCTION public.hr_employee_state_at(_employee_id uuid, _as_of date)
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
    'end_date', _employee.end_date, 'status', _employee.status);
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

CREATE FUNCTION public.create_employee_movement(
  _employee_id uuid, _movement_type text, _effective_date date,
  _reason_code text, _reason text, _after_values jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _employee public.employees%ROWTYPE;
  _before jsonb;
  _id uuid;
  _key text;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'create_employee_movement') THEN
    RAISE EXCEPTION 'Permission refusee : hr.create_employee_movement' USING ERRCODE = '42501';
  END IF;
  IF _effective_date IS NULL OR NULLIF(btrim(_movement_type), '') IS NULL OR length(btrim(_movement_type)) > 80
     OR NULLIF(btrim(_reason_code), '') IS NULL OR length(btrim(COALESCE(_reason, ''))) < 3
     OR jsonb_typeof(_after_values) <> 'object' OR _after_values = '{}'::jsonb THEN
    RAISE EXCEPTION 'Type, date, motif et valeurs du mouvement sont obligatoires' USING ERRCODE = 'QG028';
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
  IF _after_values ? 'status' AND _after_values->>'status' NOT IN ('active', 'inactive', 'suspended', 'terminated') THEN
    RAISE EXCEPTION 'Statut RH invalide' USING ERRCODE = 'QG028';
  END IF;
  _before := public.hr_employee_state_at(_employee_id, _effective_date - 1);
  INSERT INTO public.employee_movements
    (tenant_id, employee_id, movement_type, effective_date, reason_code, reason, before_values, after_values, created_by)
  VALUES (_tenant, _employee_id, _movement_type, _effective_date, btrim(_reason_code), btrim(_reason), _before, _after_values, auth.uid())
  RETURNING id INTO _id;
  INSERT INTO public.employee_movement_audit (tenant_id, movement_id, event_type, performed_by, details)
  VALUES (_tenant, _id, 'submitted', auth.uid(), jsonb_build_object('effective_date', _effective_date, 'reason_code', _reason_code));
  RETURN _id;
END
$function$;

CREATE FUNCTION public.approve_employee_movement(_movement_id uuid, _decision_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _movement public.employee_movements%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'approve_employee_movement') THEN
    RAISE EXCEPTION 'Permission refusee : hr.approve_employee_movement' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _movement FROM public.employee_movements m
   WHERE m.id = _movement_id AND m.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mouvement introuvable dans la societe courante' USING ERRCODE = '42501'; END IF;
  IF _movement.status <> 'pending' THEN RAISE EXCEPTION 'Seul un mouvement en attente peut etre approuve' USING ERRCODE = 'QG028'; END IF;
  IF _movement.created_by = auth.uid() THEN RAISE EXCEPTION 'Separation des taches : le createur ne peut approuver son mouvement' USING ERRCODE = '42501'; END IF;
  IF _movement.effective_date <= CURRENT_DATE AND EXISTS (
      SELECT 1 FROM public.payroll_runs r WHERE r.tenant_id = _tenant AND r.status = 'posted'
        AND r.period >= to_char(_movement.effective_date, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'Un cycle de paie est deja comptabilise pour cette date ; utiliser une correction de paie' USING ERRCODE = 'QG028';
  END IF;
  UPDATE public.employee_movements
     SET status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_reason = NULLIF(btrim(_decision_reason), '')
   WHERE id = _movement_id;
  INSERT INTO public.employee_movement_audit (tenant_id, movement_id, event_type, performed_by, details)
  VALUES (_tenant, _movement_id, 'approved', auth.uid(), jsonb_build_object('effective_date', _movement.effective_date));
  RETURN _movement_id;
END
$function$;

CREATE FUNCTION public.reject_employee_movement(_movement_id uuid, _decision_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _movement public.employee_movements%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'approve_employee_movement') THEN
    RAISE EXCEPTION 'Permission refusee : hr.approve_employee_movement' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_decision_reason, ''))) < 3 THEN RAISE EXCEPTION 'Un motif de rejet est obligatoire' USING ERRCODE = 'QG028'; END IF;
  SELECT * INTO _movement FROM public.employee_movements m
   WHERE m.id = _movement_id AND m.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mouvement introuvable dans la societe courante' USING ERRCODE = '42501'; END IF;
  IF _movement.status <> 'pending' THEN RAISE EXCEPTION 'Seul un mouvement en attente peut etre rejete' USING ERRCODE = 'QG028'; END IF;
  IF _movement.created_by = auth.uid() THEN RAISE EXCEPTION 'Separation des taches : le createur ne peut decider son mouvement' USING ERRCODE = '42501'; END IF;
  UPDATE public.employee_movements SET status = 'rejected', decision_reason = btrim(_decision_reason), decided_by = auth.uid(), decided_at = now()
   WHERE id = _movement_id;
  INSERT INTO public.employee_movement_audit (tenant_id, movement_id, event_type, performed_by, details)
  VALUES (_tenant, _movement_id, 'rejected', auth.uid(), jsonb_build_object('reason', btrim(_decision_reason)));
  RETURN _movement_id;
END
$function$;

CREATE FUNCTION public.list_employee_movements(_employee_id uuid)
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
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'view_employee_history') THEN
    RAISE EXCEPTION 'Permission refusee : hr.view_employee_history' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT m.id, m.tenant_id, m.employee_id, m.movement_type, m.effective_date,
       m.reason_code, m.reason,
       CASE WHEN _sensitive THEN m.before_values ELSE m.before_values - 'base_salary' END,
       CASE WHEN _sensitive THEN m.after_values ELSE m.after_values - 'base_salary' END,
       m.status, m.created_by, m.created_at, m.decided_by, m.decided_at, m.decision_reason
    FROM public.employee_movements m
   WHERE m.tenant_id = _tenant AND m.employee_id = _employee_id ORDER BY m.effective_date DESC, m.created_at DESC;
END
$function$;

CREATE OR REPLACE FUNCTION public.list_hr_employees()
RETURNS TABLE (
  id uuid, tenant_id uuid, matricule text, first_name text, last_name text, email text, phone text,
  job_title text, department text, contract_type text, hire_date date, end_date date,
  base_salary numeric, currency text, bank_account text, status text,
  created_at timestamptz, updated_at timestamptz
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
           COALESCE(s.state->>'status', e.status), e.created_at, e.updated_at
      FROM public.employees e
      CROSS JOIN LATERAL (SELECT public.hr_employee_state_at(e.id, CURRENT_DATE) AS state) s
     WHERE e.tenant_id = _tenant ORDER BY e.matricule, e.id;
END
$function$;

CREATE FUNCTION public.compute_payroll_line_at(_employee_id uuid, _gross_input numeric)
RETURNS TABLE(gross numeric, deductions numeric, taxes numeric, net numeric, employer_charges numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _employee public.employees%ROWTYPE;
  _settings public.hr_payroll_settings%ROWTYPE;
  _taxable numeric;
BEGIN
  SELECT * INTO _employee FROM public.employees WHERE id = _employee_id;
  IF _employee.id IS NULL OR _employee.tenant_id <> public.get_user_tenant_id(auth.uid()) THEN
    RAISE EXCEPTION 'Employe introuvable' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_hr_perm(auth.uid(), 'view_payroll') AND NOT public.has_hr_perm(auth.uid(), 'create_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusee : consultation ou creation de paie requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _settings FROM public.hr_payroll_settings WHERE tenant_id = _employee.tenant_id;
  IF NOT FOUND OR _settings.rules_validated_at IS NULL OR NOT public.payroll_rules_valid(_settings) THEN
    RAISE EXCEPTION 'Les baremes de paie du pays doivent etre configures et confirmes avant le calcul' USING ERRCODE = 'QG028';
  END IF;
  gross := ROUND(GREATEST(COALESCE(_gross_input, 0), 0), 2);
  deductions := ROUND(LEAST(gross, COALESCE(_settings.employee_contribution_cap, gross)) * _settings.employee_contribution_pct / 100, 2);
  _taxable := GREATEST(gross - deductions, 0);
  taxes := public.compute_progressive_payroll_tax(_taxable, _settings.income_tax_bands);
  net := ROUND(gross - deductions - taxes, 2);
  employer_charges := ROUND(LEAST(gross, COALESCE(_settings.employer_contribution_cap, gross)) * _settings.employer_contribution_pct / 100, 2);
  RETURN NEXT;
END
$function$;

CREATE OR REPLACE FUNCTION public.generate_payroll_lines(_run_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _run public.payroll_runs%ROWTYPE;
  _settings public.hr_payroll_settings%ROWTYPE;
  _employee public.employees%ROWTYPE;
  _state jsonb;
  _calc record;
  _period_end date;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
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
  _period_end := (to_date(_run.period || '-01', 'YYYY-MM-DD') + INTERVAL '1 month - 1 day')::date;
  SELECT * INTO _settings FROM public.hr_payroll_settings WHERE tenant_id = _tenant FOR SHARE;
  IF NOT FOUND OR _settings.rules_validated_at IS NULL OR NOT public.payroll_rules_valid(_settings) THEN
    RAISE EXCEPTION 'Les baremes de paie du pays doivent etre configures et confirmes avant le calcul' USING ERRCODE = 'QG028';
  END IF;
  IF _settings.rules_effective_from > to_date(_run.period || '-01', 'YYYY-MM-DD') THEN
    RAISE EXCEPTION 'Les baremes du pays ne sont pas applicables a la periode de paie' USING ERRCODE = 'QG028';
  END IF;

  DELETE FROM public.payroll_lines WHERE run_id = _run_id;
  FOR _employee IN SELECT e.* FROM public.employees e WHERE e.tenant_id = _tenant ORDER BY e.id LOOP
    _state := public.hr_employee_state_at(_employee.id, _period_end);
    IF COALESCE(_state->>'status', _employee.status) = 'active' THEN
      IF COALESCE(upper(btrim(_state->>'currency')), '') <> _settings.currency_code::text THEN
        RAISE EXCEPTION 'Devise des salaries differente de la devise du bareme de paie' USING ERRCODE = 'QG028';
      END IF;
      SELECT * INTO _calc FROM public.compute_payroll_line_at(_employee.id, NULLIF(_state->>'base_salary', '')::numeric);
      INSERT INTO public.payroll_lines
        (tenant_id, run_id, employee_id, gross, deductions, taxes, net, employer_charges, department_snapshot)
      VALUES (_tenant, _run_id, _employee.id, _calc.gross, _calc.deductions, _calc.taxes, _calc.net,
              _calc.employer_charges, COALESCE(_state->>'department', ''));
      _count := _count + 1;
    END IF;
  END LOOP;
  UPDATE public.payroll_runs
     SET gross_total = COALESCE((SELECT SUM(gross) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         net_total = COALESCE((SELECT SUM(net) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         deductions_total = COALESCE((SELECT SUM(deductions) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         taxes_total = COALESCE((SELECT SUM(taxes) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         employer_charges_total = COALESCE((SELECT SUM(employer_charges) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         employee_count = _count,
         payroll_country_code = _settings.country_code,
         payroll_currency_code = _settings.currency_code,
         payroll_rules_snapshot = jsonb_build_object(
           'country_code', _settings.country_code, 'currency_code', _settings.currency_code,
           'employee_contribution_pct', _settings.employee_contribution_pct,
           'employee_contribution_cap', _settings.employee_contribution_cap,
           'employer_contribution_pct', _settings.employer_contribution_pct,
           'employer_contribution_cap', _settings.employer_contribution_cap,
           'income_tax_bands', _settings.income_tax_bands,
           'rules_effective_from', _settings.rules_effective_from,
           'rules_reference', _settings.rules_reference,
           'rules_validated_at', _settings.rules_validated_at,
           'rules_validated_by', _settings.rules_validated_by)
   WHERE id = _run_id;
  INSERT INTO public.payroll_run_audit (tenant_id, run_id, event_type, from_status, to_status, performed_by, details)
  VALUES (_tenant, _run_id, 'lines_generated', _run.status, _run.status, auth.uid(),
          jsonb_build_object('line_count', _count, 'country', _settings.country_code,
            'currency', _settings.currency_code, 'employment_state_as_of', _period_end));
  RETURN _count;
END
$function$;

REVOKE ALL ON FUNCTION public.hr_employee_state_at(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_employee_movement(uuid, text, date, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_employee_movement(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_employee_movement(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_employee_movements(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.compute_payroll_line_at(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_employee_movement(uuid, text, date, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_employee_movement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_employee_movement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_employee_movements(uuid) TO authenticated;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
