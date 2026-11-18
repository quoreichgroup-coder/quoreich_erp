-- V80 — G-28 : règles de paie par pays, progressives et confirmées par la société.
-- Aucun barème légal n'est prérempli : chaque société renseigne et source ses règles.

ALTER TABLE public.hr_payroll_settings
  ALTER COLUMN employer_contribution_pct DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS country_code char(2),
  ADD COLUMN IF NOT EXISTS currency_code char(3),
  ADD COLUMN IF NOT EXISTS employee_contribution_pct numeric(6,3),
  ADD COLUMN IF NOT EXISTS employee_contribution_cap numeric(18,2),
  ADD COLUMN IF NOT EXISTS employer_contribution_cap numeric(18,2),
  ADD COLUMN IF NOT EXISTS income_tax_bands jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rules_effective_from date,
  ADD COLUMN IF NOT EXISTS rules_reference text,
  ADD COLUMN IF NOT EXISTS rules_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS rules_validated_by uuid REFERENCES auth.users(id);

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS payroll_country_code char(2),
  ADD COLUMN IF NOT EXISTS payroll_currency_code char(3),
  ADD COLUMN IF NOT EXISTS payroll_rules_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS deductions_total numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxes_total numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_charges_total numeric(18,2) NOT NULL DEFAULT 0;

ALTER TABLE public.payroll_lines
  ADD COLUMN IF NOT EXISTS employer_charges numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS department_snapshot text;

CREATE TABLE public.payroll_run_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created', 'lines_generated', 'approved', 'posted', 'status_changed', 'deleted')),
  from_status text,
  to_status text,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX payroll_run_audit_run_created_idx ON public.payroll_run_audit (tenant_id, run_id, created_at DESC, id DESC);
ALTER TABLE public.payroll_run_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_run_audit_read ON public.payroll_run_audit
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_hr_perm(auth.uid(), 'audit_payroll'));
REVOKE ALL ON public.payroll_run_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payroll_run_audit TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_payroll_run_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _event text;
  _from text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.payroll_run_audit (tenant_id, run_id, event_type, from_status, to_status, performed_by, details)
    VALUES (OLD.tenant_id, OLD.id, 'deleted', OLD.status, NULL, auth.uid(),
            jsonb_build_object('period', OLD.period, 'employee_count', OLD.employee_count,
                               'currency', OLD.payroll_currency_code));
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    _event := 'created';
    _from := NULL;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    _from := OLD.status;
    _event := CASE NEW.status WHEN 'approved' THEN 'approved' WHEN 'posted' THEN 'posted' ELSE 'status_changed' END;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.payroll_run_audit (tenant_id, run_id, event_type, from_status, to_status, performed_by, details)
  VALUES (NEW.tenant_id, NEW.id, _event, _from, NEW.status, auth.uid(),
          jsonb_build_object('period', NEW.period, 'employee_count', NEW.employee_count,
                             'currency', NEW.payroll_currency_code));
  RETURN NEW;
END
$function$;

CREATE TRIGGER trg_audit_payroll_run_change
AFTER INSERT OR UPDATE OR DELETE ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.audit_payroll_run_change();

CREATE OR REPLACE FUNCTION public.payroll_rules_valid(_settings public.hr_payroll_settings)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _band jsonb;
  _rate numeric;
  _up_to numeric;
  _previous numeric := 0;
  _index integer := 0;
  _count integer;
BEGIN
  IF _settings.country_code IS NULL OR _settings.country_code !~ '^[A-Z]{2}$'
     OR _settings.currency_code IS NULL OR _settings.currency_code !~ '^[A-Z]{3}$'
     OR _settings.employee_contribution_pct IS NULL
     OR _settings.employee_contribution_pct NOT BETWEEN 0 AND 100
     OR _settings.employer_contribution_pct NOT BETWEEN 0 AND 100
     OR (_settings.employee_contribution_cap IS NOT NULL AND _settings.employee_contribution_cap <= 0)
     OR (_settings.employer_contribution_cap IS NOT NULL AND _settings.employer_contribution_cap <= 0)
     OR _settings.rules_effective_from IS NULL
     OR NULLIF(btrim(_settings.rules_reference), '') IS NULL
     OR jsonb_typeof(_settings.income_tax_bands) <> 'array' THEN
    RETURN false;
  END IF;
  _count := jsonb_array_length(_settings.income_tax_bands);
  IF _count = 0 THEN RETURN false; END IF;

  FOR _band IN SELECT value FROM jsonb_array_elements(_settings.income_tax_bands) LOOP
    _index := _index + 1;
    IF jsonb_typeof(_band) <> 'object' OR NOT (_band ? 'rate_pct') THEN RETURN false; END IF;
    BEGIN
      _rate := (_band ->> 'rate_pct')::numeric;
    EXCEPTION WHEN OTHERS THEN RETURN false;
    END;
    IF _rate NOT BETWEEN 0 AND 100 THEN RETURN false; END IF;
    IF NOT (_band ? 'up_to') THEN RETURN false; END IF;
    IF _band -> 'up_to' = 'null'::jsonb THEN
      IF _index <> _count THEN RETURN false; END IF;
    ELSE
      BEGIN
        _up_to := (_band ->> 'up_to')::numeric;
      EXCEPTION WHEN OTHERS THEN RETURN false;
      END;
      IF _up_to <= _previous OR _index = _count THEN RETURN false; END IF;
      _previous := _up_to;
    END IF;
  END LOOP;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.compute_progressive_payroll_tax(_taxable numeric, _bands jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _band jsonb;
  _previous numeric := 0;
  _up_to numeric;
  _amount numeric;
  _tax numeric := 0;
BEGIN
  IF COALESCE(_taxable, 0) <= 0 THEN RETURN 0; END IF;
  FOR _band IN SELECT value FROM jsonb_array_elements(_bands) LOOP
    _up_to := CASE WHEN _band -> 'up_to' = 'null'::jsonb THEN _taxable ELSE (_band ->> 'up_to')::numeric END;
    _amount := GREATEST(0, LEAST(_taxable, _up_to) - _previous);
    _tax := _tax + _amount * ((_band ->> 'rate_pct')::numeric / 100);
    IF _band -> 'up_to' = 'null'::jsonb OR _taxable <= _up_to THEN EXIT; END IF;
    _previous := _up_to;
  END LOOP;
  RETURN ROUND(_tax, 2);
END
$function$;

CREATE OR REPLACE FUNCTION public.guard_hr_payroll_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND
     (NEW.country_code, NEW.currency_code, NEW.employee_contribution_pct, NEW.employee_contribution_cap,
      NEW.employer_contribution_pct, NEW.employer_contribution_cap,
      NEW.income_tax_bands, NEW.rules_effective_from, NEW.rules_reference)
     IS DISTINCT FROM
     (OLD.country_code, OLD.currency_code, OLD.employee_contribution_pct, OLD.employee_contribution_cap,
      OLD.employer_contribution_pct, OLD.employer_contribution_cap,
      OLD.income_tax_bands, OLD.rules_effective_from, OLD.rules_reference) THEN
    NEW.rules_validated_at := NULL;
    NEW.rules_validated_by := NULL;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER trg_guard_hr_payroll_settings
BEFORE INSERT OR UPDATE ON public.hr_payroll_settings
FOR EACH ROW EXECUTE FUNCTION public.guard_hr_payroll_settings();

CREATE OR REPLACE FUNCTION public.confirm_payroll_rules()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _settings public.hr_payroll_settings%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'hr.payroll_settings') THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_settings' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _settings FROM public.hr_payroll_settings WHERE tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND OR NOT public.payroll_rules_valid(_settings) THEN
    RAISE EXCEPTION 'Barèmes incomplets ou invalides : pays, taux, tranches, date d''effet et référence officielle requis' USING ERRCODE = 'QG028';
  END IF;
  UPDATE public.hr_payroll_settings
     SET rules_validated_at = now(), rules_validated_by = auth.uid(), updated_at = now()
   WHERE tenant_id = _tenant;
  RETURN (SELECT rules_validated_at FROM public.hr_payroll_settings WHERE tenant_id = _tenant);
END
$function$;

DROP FUNCTION public.generate_payroll_lines(uuid);
DROP FUNCTION public.compute_payroll_line(uuid);

CREATE FUNCTION public.compute_payroll_line(_employee_id uuid)
RETURNS TABLE(gross numeric, deductions numeric, taxes numeric, net numeric, employer_charges numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _employee public.employees%ROWTYPE;
  _settings public.hr_payroll_settings%ROWTYPE;
  _taxable numeric;
BEGIN
  SELECT * INTO _employee FROM public.employees WHERE id = _employee_id;
  IF _employee.id IS NULL OR _employee.tenant_id <> public.get_user_tenant_id(auth.uid()) THEN
    RAISE EXCEPTION 'Employé introuvable' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_hr_perm(auth.uid(), 'view_payroll')
     AND NOT public.has_hr_perm(auth.uid(), 'create_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusée : consultation ou création de paie requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _settings FROM public.hr_payroll_settings WHERE tenant_id = _employee.tenant_id;
  IF NOT FOUND OR _settings.rules_validated_at IS NULL OR NOT public.payroll_rules_valid(_settings) THEN
    RAISE EXCEPTION 'Les barèmes de paie du pays doivent être configurés et confirmés avant le calcul' USING ERRCODE = 'QG028';
  END IF;

  gross := ROUND(GREATEST(COALESCE(_employee.base_salary, 0), 0), 2);
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _run public.payroll_runs%ROWTYPE;
  _settings public.hr_payroll_settings%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _count integer := 0;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'create_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusée : rôle Saisie RH requis';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id FOR UPDATE;
  IF _run.tenant_id IS NULL OR _run.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Cycle non modifiable (statut %)', _run.status; END IF;
  IF _run.period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Période de paie invalide (format attendu AAAA-MM)' USING ERRCODE = 'QG028';
  END IF;
  SELECT * INTO _settings FROM public.hr_payroll_settings WHERE tenant_id = _tenant FOR SHARE;
  IF NOT FOUND OR _settings.rules_validated_at IS NULL OR NOT public.payroll_rules_valid(_settings) THEN
    RAISE EXCEPTION 'Les barèmes de paie du pays doivent être configurés et confirmés avant le calcul' USING ERRCODE = 'QG028';
  END IF;
  IF _settings.rules_effective_from > to_date(_run.period || '-01', 'YYYY-MM-DD') THEN
    RAISE EXCEPTION 'Les barèmes du pays ne sont pas applicables à la période de paie' USING ERRCODE = 'QG028';
  END IF;
  IF EXISTS (SELECT 1 FROM public.employees e WHERE e.tenant_id = _tenant AND e.status = 'active'
             AND COALESCE(upper(btrim(e.currency)), '') <> _settings.currency_code::text) THEN
    RAISE EXCEPTION 'Devise des salariés différente de la devise du barème de paie' USING ERRCODE = 'QG028';
  END IF;

  DELETE FROM public.payroll_lines WHERE run_id = _run_id;
  INSERT INTO public.payroll_lines (tenant_id, run_id, employee_id, gross, deductions, taxes, net, employer_charges, department_snapshot)
  SELECT _run.tenant_id, _run_id, e.id, c.gross, c.deductions, c.taxes, c.net, c.employer_charges, COALESCE(e.department, '')
    FROM public.employees e
    CROSS JOIN LATERAL public.compute_payroll_line(e.id) c
   WHERE e.tenant_id = _run.tenant_id AND e.status = 'active';
  GET DIAGNOSTICS _count = ROW_COUNT;

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
           'country_code', _settings.country_code,
           'currency_code', _settings.currency_code,
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
  VALUES (_run.tenant_id, _run_id, 'lines_generated', _run.status, _run.status, auth.uid(),
          jsonb_build_object('line_count', _count, 'country', _settings.country_code,
                             'currency', _settings.currency_code));
  RETURN _count;
END
$function$;

CREATE OR REPLACE VIEW public.payroll_register_view WITH (security_invoker = true) AS
SELECT pl.tenant_id, pr.period, pr.pay_date, pr.status,
       e.matricule, e.first_name, e.last_name, pl.department_snapshot AS department, e.job_title,
       pl.gross, pl.deductions, pl.taxes, pl.net
FROM public.payroll_lines pl
JOIN public.payroll_runs pr ON pr.id = pl.run_id
JOIN public.employees e ON e.id = pl.employee_id;

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
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'execute_payroll') THEN
    RAISE EXCEPTION 'Permission refusée : rôle Officier de Paie requis';
  END IF;
  SELECT * INTO _r FROM public.payroll_runs WHERE id = _run_id FOR UPDATE;
  IF _r.tenant_id IS NULL OR _r.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _r.status = 'posted' THEN RAISE EXCEPTION 'Cycle déjà comptabilisé'; END IF;
  IF _r.status <> 'approved' THEN RAISE EXCEPTION 'Le cycle doit être approuvé avant comptabilisation'; END IF;
  IF _r.payroll_rules_snapshot IS NULL OR _r.payroll_country_code IS NULL THEN
    RAISE EXCEPTION 'Le cycle ne contient pas de photographie des barèmes validés' USING ERRCODE = 'QG028';
  END IF;

  SELECT COALESCE(SUM(gross), 0), COALESCE(SUM(deductions), 0), COALESCE(SUM(taxes), 0),
         COALESCE(SUM(net), 0), COALESCE(SUM(employer_charges), 0)
    INTO _gross, _ded, _tax, _net, _patronal FROM public.payroll_lines WHERE run_id = _run_id;
  IF _gross <= 0 THEN RAISE EXCEPTION 'Cycle vide — aucune ligne à comptabiliser'; END IF;

  _entry_number := 'JE-PAY-' || _r.period || '-' || substr(_run_id::text, 1, 8);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, _entry_number, _r.pay_date, 'Paie ' || _r.period || ' (' || _r.payroll_country_code || ')', 'payroll', 'draft', auth.uid())
  RETURNING id INTO _entry_id;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_SALARIES'), _gross, 0, 'Salaires bruts');
  IF _patronal > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_EMPLOYER_CHARGES'), _patronal, 0, 'Charges patronales');
  END IF;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_NET_PAYABLE'), 0, _net, 'Personnel — rémunérations dues');
  IF (_ded + _patronal) > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_SOCIAL'), 0, _ded + _patronal, 'Organismes sociaux');
  END IF;
  IF _tax > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_TAX'), 0, _tax, 'État — impôt sur salaires');
  END IF;
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry_id;
  UPDATE public.payroll_runs
     SET status = 'posted', executed_by = auth.uid(), executed_at = now(), notes = COALESCE(notes, '') || ' | JE=' || _entry_number
   WHERE id = _run_id;
  RETURN _entry_id;
END
$function$;

REVOKE ALL ON FUNCTION public.confirm_payroll_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_payroll_rules() TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_progressive_payroll_tax(numeric, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_payroll_line(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_payroll_lines(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_payroll_run(uuid) TO authenticated;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
