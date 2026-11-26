-- V148 — Paie : prorata de présence dans la période, net négatif bloquant, rubriques non écrasées.
--
-- Audit RH & Paie du 25 nov. 2026 (docs/audit-erp/32-audit-rh-paie.md), anomalies P0 démontrées :
--   * generate_payroll_lines ne lisait l'état du salarié qu'au dernier jour de la période : un salarié embauché
--     le 20 recevait le mois complet, un salarié sorti ou suspendu le 10 ne recevait rien pour ses jours
--     travaillés, une augmentation au 15 s'appliquait au mois entier, et hire_date n'était jamais lue
--     (un salarié « actif » embauché le mois suivant était payé).
--   * le précontrôle n'arrêtait pas un net à payer négatif (retenues > brut).
--   * save_hr_payroll_component faisait un upsert sur le code : « Ajouter » une rubrique avec un code existant
--     remplaçait silencieusement la rubrique en place.
-- Règles :
--   * le salaire de base est calculé segment par segment entre les dates de la période où l'état du dossier
--     change (mouvements approuvés, embauche, fin de contrat) ; seuls les jours « active » entre l'embauche et
--     la fin de contrat sont payés ; un salarié sans aucun jour de présence n'a pas de ligne ;
--   * la méthode de décompte est un paramètre de la société (hr_payroll_settings.proration_method) :
--     jours calendaires du mois, ou mois de 30 jours ; la changer retire la confirmation des barèmes ;
--   * une rubrique fixe n'est proratisée que si elle le déclare (hr_payroll_components.prorated) ; une rubrique
--     en % suit la base déjà proratisée ; une variable approuvée garde son montant ;
--   * le détail (jours présents, jours de référence, taux, segments) est photographié sur la ligne
--     « Salaire de base » et la méthode dans la photographie des règles du cycle.

ALTER TABLE public.hr_payroll_settings
  ADD COLUMN IF NOT EXISTS proration_method text NOT NULL DEFAULT 'calendar_days';
ALTER TABLE public.hr_payroll_settings
  ADD CONSTRAINT hr_payroll_settings_proration_method_check
  CHECK (proration_method IN ('calendar_days', 'thirty_days'));

ALTER TABLE public.hr_payroll_components
  ADD COLUMN IF NOT EXISTS prorated boolean NOT NULL DEFAULT false;

-- Toute modification d'une règle de calcul retire la confirmation (la méthode de prorata en fait partie).
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
      NEW.income_tax_bands, NEW.rules_effective_from, NEW.rules_reference, NEW.proration_method)
     IS DISTINCT FROM
     (OLD.country_code, OLD.currency_code, OLD.employee_contribution_pct, OLD.employee_contribution_cap,
      OLD.employer_contribution_pct, OLD.employer_contribution_cap,
      OLD.income_tax_bands, OLD.rules_effective_from, OLD.rules_reference, OLD.proration_method) THEN
    NEW.rules_validated_at := NULL;
    NEW.rules_validated_by := NULL;
  END IF;
  RETURN NEW;
END
$function$;

-- Poids d'un intervalle de jours [_from, _to] inclus dans la période, selon la méthode de la société.
--   calendar_days : nombre de jours calendaires ;
--   thirty_days   : mois de 30 jours (le 31 ne compte pas, le dernier jour d'un mois court vaut le 30).
CREATE OR REPLACE FUNCTION public.payroll_day_weight(_from date, _to date, _period_end date, _method text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _from IS NULL OR _to IS NULL OR _to < _from THEN 0::numeric
    WHEN _method = 'thirty_days' THEN GREATEST(
      (CASE WHEN _to = _period_end THEN 30 ELSE LEAST(extract(day FROM _to)::int, 30) END)
      - LEAST(extract(day FROM _from)::int, 30) + 1, 0)::numeric
    ELSE (_to - _from + 1)::numeric
  END
$function$;

-- Segments de la période sur lesquels l'état effectif du salarié est constant, avec l'indicateur de présence
-- (statut « active », embauché, contrat non terminé). Interne au calcul de paie.
CREATE OR REPLACE FUNCTION public.payroll_presence_segments(_employee_id uuid, _period_start date, _period_end date)
RETURNS TABLE (segment_start date, segment_end date, present boolean, state jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _employee public.employees%ROWTYPE;
  _bounds date[];
  _i integer;
  _hire date;
  _end date;
BEGIN
  SELECT * INTO _employee FROM public.employees e WHERE e.id = _employee_id AND e.tenant_id = _tenant;
  IF _employee.id IS NULL THEN RAISE EXCEPTION 'Employe introuvable' USING ERRCODE = '42501'; END IF;

  SELECT array_agg(DISTINCT d ORDER BY d) INTO _bounds FROM (
    SELECT _period_start AS d
    UNION SELECT _employee.hire_date
    UNION SELECT _employee.end_date + 1
    UNION SELECT m.effective_date FROM public.employee_movements m
     WHERE m.tenant_id = _tenant AND m.employee_id = _employee_id AND m.status = 'approved'
    UNION SELECT NULLIF(m.after_values->>'end_date', '')::date + 1 FROM public.employee_movements m
     WHERE m.tenant_id = _tenant AND m.employee_id = _employee_id AND m.status = 'approved'
  ) b WHERE d IS NOT NULL AND d BETWEEN _period_start AND _period_end;

  FOR _i IN 1 .. array_length(_bounds, 1) LOOP
    segment_start := _bounds[_i];
    segment_end := CASE WHEN _i < array_length(_bounds, 1) THEN _bounds[_i + 1] - 1 ELSE _period_end END;
    state := public.hr_employee_state_at(_employee_id, segment_start);
    _hire := NULLIF(state->>'hire_date', '')::date;
    _end := NULLIF(state->>'end_date', '')::date;
    present := COALESCE(state->>'status', '') = 'active'
      AND (_hire IS NULL OR _hire <= segment_start)
      AND (_end IS NULL OR _end >= segment_start);
    RETURN NEXT;
  END LOOP;
END
$function$;
REVOKE ALL ON FUNCTION public.payroll_presence_segments(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_day_weight(date, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_day_weight(date, date, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_payroll_lines(_run_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _run public.payroll_runs%ROWTYPE;
  _settings public.hr_payroll_settings%ROWTYPE;
  _employee public.employees%ROWTYPE;
  _state jsonb;
  _segment record;
  _segments jsonb;
  _item record;
  _period_start date;
  _period_end date;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _days_total numeric;
  _days_present numeric;
  _weight numeric;
  _weighted_base numeric;
  _ratio numeric;
  _base numeric(18,2);
  _rate numeric(18,4);
  _amount numeric(18,2);
  _gross numeric(18,2);
  _earned numeric(18,2);
  _component_deductions numeric(18,2);
  _component_charges numeric(18,2);
  _employee_base numeric(18,2);
  _employer_base numeric(18,2);
  _taxable_base numeric(18,2);
  _employee_social numeric(18,2);
  _employer_social numeric(18,2);
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
  SELECT * INTO _settings FROM public.hr_payroll_settings WHERE tenant_id = _tenant FOR SHARE;
  IF NOT FOUND OR _settings.rules_validated_at IS NULL OR NOT public.payroll_rules_valid(_settings) THEN
    RAISE EXCEPTION 'Les baremes de paie doivent etre configures et confirmes avant le calcul' USING ERRCODE = 'QG028';
  END IF;
  IF _settings.rules_effective_from > _period_start THEN
    RAISE EXCEPTION 'Les baremes du pays ne sont pas applicables a la periode de paie' USING ERRCODE = 'QG028';
  END IF;
  _days_total := public.payroll_day_weight(_period_start, _period_end, _period_end, _settings.proration_method);

  DELETE FROM public.payroll_component_lines WHERE run_id = _run_id;
  DELETE FROM public.payroll_lines WHERE run_id = _run_id;
  FOR _employee IN SELECT e.* FROM public.employees e WHERE e.tenant_id = _tenant ORDER BY e.id LOOP
    _days_present := 0; _weighted_base := 0; _state := NULL; _segments := '[]'::jsonb;
    FOR _segment IN SELECT * FROM public.payroll_presence_segments(_employee.id, _period_start, _period_end) LOOP
      IF _segment.present THEN
        _weight := public.payroll_day_weight(_segment.segment_start, _segment.segment_end, _period_end, _settings.proration_method);
        IF COALESCE(upper(btrim(_segment.state->>'currency')), '') <> _settings.currency_code::text THEN
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

    IF _days_present > 0 THEN
      _ratio := LEAST(_days_present / _days_total, 1);
      _base := ROUND(_weighted_base / _days_total, 2);
      _earned := 0; _component_deductions := 0; _component_charges := 0;
      _employee_base := _base; _employer_base := _base; _taxable_base := _base;
      INSERT INTO public.payroll_component_lines
        (tenant_id, run_id, employee_id, code_snapshot, label_snapshot, kind, calculation_method,
         calculation_base, amount, source_type, definition_snapshot)
      VALUES (_tenant, _run_id, _employee.id, 'BASE_SALARY', 'Salaire de base', 'earning', 'fixed',
        _base, _base, 'base_salary', jsonb_build_object('employee_state', _state, 'as_of', _period_end,
          'presence', jsonb_build_object('method', _settings.proration_method, 'days_present', _days_present,
            'days_total', _days_total, 'ratio', ROUND(_ratio, 6), 'segments', _segments)));

      FOR _item IN
        SELECT c.id component_id, c.code, c.label, c.kind, c.calculation_method,
          c.taxable, c.subject_employee_social, c.subject_employer_social, c.cap, c.prorated,
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
        IF _item.kind = 'earning' THEN
          _earned := _earned + _amount;
          IF _item.taxable THEN _taxable_base := _taxable_base + _amount; END IF;
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
            'taxable', _item.taxable, 'subject_employee_social', _item.subject_employee_social,
            'subject_employer_social', _item.subject_employer_social, 'printable', _item.printable,
            'gl_account_code', _item.gl_account_code, 'period_start', _period_start, 'period_end', _period_end));
      END LOOP;

      _gross := ROUND(_base + _earned, 2);
      _employee_social := ROUND(LEAST(_employee_base, COALESCE(_settings.employee_contribution_cap, _employee_base))
        * _settings.employee_contribution_pct / 100, 2);
      _employer_social := ROUND(LEAST(_employer_base, COALESCE(_settings.employer_contribution_cap, _employer_base))
        * _settings.employer_contribution_pct / 100, 2);
      _taxes := public.compute_progressive_payroll_tax(GREATEST(_taxable_base - _employee_social, 0), _settings.income_tax_bands);
      _net := ROUND(_gross - _employee_social - _component_deductions - _taxes, 2);
      INSERT INTO public.payroll_lines
        (tenant_id, run_id, employee_id, gross, deductions, taxes, net, employer_charges, department_snapshot)
      VALUES (_tenant, _run_id, _employee.id, _gross, ROUND(_employee_social + _component_deductions, 2), _taxes,
          _net, ROUND(_employer_social + _component_charges, 2), COALESCE(_state->>'department', ''));
      _count := _count + 1;
    END IF;
  END LOOP;
  UPDATE public.payroll_runs
     SET gross_total = COALESCE((SELECT SUM(gross) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         net_total = COALESCE((SELECT SUM(net) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         deductions_total = COALESCE((SELECT SUM(deductions) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         taxes_total = COALESCE((SELECT SUM(taxes) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         employer_charges_total = COALESCE((SELECT SUM(employer_charges) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         employee_count = _count, payroll_country_code = _settings.country_code,
         payroll_currency_code = _settings.currency_code,
         payroll_rules_snapshot = jsonb_build_object('country_code', _settings.country_code,
           'currency_code', _settings.currency_code, 'employee_contribution_pct', _settings.employee_contribution_pct,
           'employee_contribution_cap', _settings.employee_contribution_cap,
           'employer_contribution_pct', _settings.employer_contribution_pct,
           'employer_contribution_cap', _settings.employer_contribution_cap,
           'income_tax_bands', _settings.income_tax_bands, 'rules_effective_from', _settings.rules_effective_from,
           'rules_reference', _settings.rules_reference, 'rules_validated_at', _settings.rules_validated_at,
           'rules_validated_by', _settings.rules_validated_by, 'proration_method', _settings.proration_method,
           'components_snapshot', true)
   WHERE id = _run_id;
  INSERT INTO public.payroll_run_audit (tenant_id, run_id, event_type, from_status, to_status, performed_by, details)
  VALUES (_tenant, _run_id, 'lines_generated', _run.status, _run.status, auth.uid(),
    jsonb_build_object('line_count', _count, 'country', _settings.country_code,
      'currency', _settings.currency_code, 'employment_state_as_of', _period_end,
      'proration_method', _settings.proration_method,
      'component_line_count', (SELECT count(*) FROM public.payroll_component_lines WHERE run_id = _run_id)));
  RETURN _count;
END
$function$;

-- Précontrôle : V98 + net à payer négatif bloquant.
CREATE OR REPLACE FUNCTION public.precheck_payroll_run(_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _run public.payroll_runs%ROWTYPE;
  _findings jsonb := '[]'::jsonb;
  _gross numeric;
  _deductions numeric;
  _taxes numeric;
  _net numeric;
  _charges numeric;
  _component_gross numeric;
  _component_deductions numeric;
  _component_charges numeric;
  _count integer;
  _negative integer;
  _id uuid;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'approve_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusee : approbation paie requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle introuvable' USING ERRCODE = '42501'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Le precontrole exige un cycle brouillon' USING ERRCODE = 'QG028'; END IF;

  SELECT count(*), COALESCE(sum(gross), 0), COALESCE(sum(deductions), 0), COALESCE(sum(taxes), 0),
         COALESCE(sum(net), 0), COALESCE(sum(employer_charges), 0), count(*) FILTER (WHERE net < 0)
    INTO _count, _gross, _deductions, _taxes, _net, _charges, _negative
    FROM public.payroll_lines WHERE tenant_id = _tenant AND run_id = _run_id;
  SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'earning'), 0),
         COALESCE(sum(amount) FILTER (WHERE kind = 'deduction'), 0),
         COALESCE(sum(amount) FILTER (WHERE kind = 'employer_charge'), 0)
    INTO _component_gross, _component_deductions, _component_charges
    FROM public.payroll_component_lines WHERE tenant_id = _tenant AND run_id = _run_id;

  IF _count = 0 THEN _findings := _findings || jsonb_build_array('Aucune ligne de paie calculee.'); END IF;
  IF _gross <= 0 THEN _findings := _findings || jsonb_build_array('Le total brut doit etre superieur a zero.'); END IF;
  IF _negative > 0 THEN
    _findings := _findings || jsonb_build_array(format(
      'Net a payer negatif pour %s salarie(s) : les retenues depassent le brut.', _negative));
  END IF;
  IF _run.payroll_rules_snapshot IS NULL OR _run.payroll_country_code IS NULL OR _run.payroll_currency_code IS NULL THEN
    _findings := _findings || jsonb_build_array('La photographie des regles, du pays ou de la devise est absente.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_run_variables v WHERE v.tenant_id = _tenant
      AND v.run_id = _run_id AND v.status = 'pending') THEN
    _findings := _findings || jsonb_build_array('Des variables restent en attente de decision.');
  END IF;
  IF abs(_gross - COALESCE(_run.gross_total, 0)) > 0.01
     OR abs(_deductions - COALESCE(_run.deductions_total, 0)) > 0.01
     OR abs(_taxes - COALESCE(_run.taxes_total, 0)) > 0.01
     OR abs(_net - COALESCE(_run.net_total, 0)) > 0.01
     OR abs(_charges - COALESCE(_run.employer_charges_total, 0)) > 0.01 THEN
    _findings := _findings || jsonb_build_array('Les totaux du cycle ne correspondent pas aux lignes calculees.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_component_lines WHERE tenant_id = _tenant AND run_id = _run_id)
     AND (abs(_gross - _component_gross) > 0.01 OR _component_deductions > _deductions + 0.01
       OR _component_charges > _charges + 0.01) THEN
    _findings := _findings || jsonb_build_array('Le detail des rubriques ne correspond pas aux totaux du cycle.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payroll_component_lines l
     WHERE l.tenant_id = _tenant AND l.run_id = _run_id
       AND NULLIF(btrim(l.definition_snapshot->>'gl_account_code'), '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.gl_accounts g
          WHERE g.tenant_id = _tenant AND g.code = btrim(l.definition_snapshot->>'gl_account_code')
            AND g.is_active AND NOT g.is_header)) THEN
    _findings := _findings || jsonb_build_array('Un compte configure sur une rubrique est absent, inactif ou non imputable.');
  END IF;
  IF abs((_gross + _charges) - (_net + _deductions + _taxes + _charges)) > 0.01 THEN
    _findings := _findings || jsonb_build_array('L''ecriture estimee est desequilibree.');
  END IF;
  IF public.posting_account(_tenant, 'PAYROLL_SALARIES') IS NULL THEN
    _findings := _findings || jsonb_build_array('Compte de charges de salaires non parametre.');
  END IF;
  IF public.posting_account(_tenant, 'PAYROLL_NET_PAYABLE') IS NULL THEN
    _findings := _findings || jsonb_build_array('Compte de remunerations dues non parametre.');
  END IF;
  IF (_deductions + _charges) > 0 AND public.posting_account(_tenant, 'PAYROLL_SOCIAL') IS NULL THEN
    _findings := _findings || jsonb_build_array('Compte des organismes sociaux non parametre.');
  END IF;
  IF _charges > _component_charges + 0.01 OR EXISTS (
      SELECT 1 FROM public.payroll_component_lines l
       WHERE l.tenant_id = _tenant AND l.run_id = _run_id AND l.kind = 'employer_charge'
         AND NULLIF(btrim(l.definition_snapshot->>'gl_account_code'), '') IS NULL) THEN
    IF public.posting_account(_tenant, 'PAYROLL_EMPLOYER_CHARGES') IS NULL THEN
      _findings := _findings || jsonb_build_array('Compte de charges patronales non parametre.');
    END IF;
  END IF;
  IF _taxes > 0 AND public.posting_account(_tenant, 'PAYROLL_TAX') IS NULL THEN
    _findings := _findings || jsonb_build_array('Compte d''impot sur salaires non parametre.');
  END IF;

  INSERT INTO public.payroll_run_prechecks (tenant_id, run_id, passed, findings, checked_by)
  VALUES (_tenant, _run_id, jsonb_array_length(_findings) = 0, _findings, auth.uid())
  RETURNING id INTO _id;
  INSERT INTO public.payroll_run_audit (tenant_id, run_id, event_type, from_status, to_status, performed_by, details)
  VALUES (_tenant, _run_id, 'prechecked', _run.status, _run.status, auth.uid(),
    jsonb_build_object('precheck_id', _id, 'passed', jsonb_array_length(_findings) = 0, 'finding_count', jsonb_array_length(_findings)));
  RETURN jsonb_build_object('id', _id, 'run_id', _run_id, 'passed', jsonb_array_length(_findings) = 0,
    'findings', _findings, 'checked_by', auth.uid(), 'checked_at', now());
END
$function$;

-- Rubriques : la liste expose « prorated » ; l'enregistrement ne remplace plus une rubrique existante sans son id.
DROP FUNCTION public.list_hr_payroll_components(boolean);
CREATE FUNCTION public.list_hr_payroll_components(_include_inactive boolean DEFAULT false)
RETURNS TABLE (id uuid, tenant_id uuid, code text, label text, kind text, calculation_method text,
  amount numeric, cap numeric, effective_from date, effective_to date, gl_account_code text,
  printable boolean, active boolean, sort_order integer, taxable boolean,
  subject_employee_social boolean, subject_employer_social boolean, prorated boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR (NOT public.has_hr_perm(auth.uid(), 'view_payroll')
      AND NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components')) THEN
    RAISE EXCEPTION 'Droit insuffisant pour consulter les rubriques de paie' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT c.id, c.tenant_id, c.code, c.label, c.kind, c.calculation_method, c.amount, c.cap,
      c.effective_from, c.effective_to, c.gl_account_code, c.printable, c.active, c.sort_order,
      c.taxable, c.subject_employee_social, c.subject_employer_social, c.prorated
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
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_payroll_components' USING ERRCODE = '42501';
  END IF;
  IF _code IS NULL OR _code !~ '^[a-z0-9][a-z0-9._-]{0,39}$' OR _label IS NULL OR length(_label) NOT BETWEEN 1 AND 120
     OR _kind IS NULL OR _kind NOT IN ('earning', 'deduction', 'employer_charge')
     OR _method IS NULL OR _method NOT IN ('fixed', 'percent_base') OR _amount IS NULL OR _amount <= 0
     OR (_method = 'percent_base' AND _amount > 100) OR _from IS NULL
     OR (_to IS NOT NULL AND _to < _from) OR (_cap IS NOT NULL AND _cap <= 0) THEN
    RAISE EXCEPTION 'Definition de rubrique de paie invalide' USING ERRCODE = 'QG028';
  END IF;
  IF _id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.hr_payroll_components c WHERE c.tenant_id = _tenant AND c.code = _code) THEN
      RAISE EXCEPTION 'Le code de rubrique « % » existe deja : modifiez la rubrique existante', _code USING ERRCODE = 'QG028';
    END IF;
    INSERT INTO public.hr_payroll_components
      (tenant_id, code, label, kind, calculation_method, amount, cap, effective_from, effective_to,
       gl_account_code, printable, active, sort_order, taxable, subject_employee_social, subject_employer_social, prorated)
    VALUES (_tenant, _code, _label, _kind, _method, _amount, _cap, _from, _to,
      nullif(btrim(_input->>'gl_account_code'), ''), COALESCE((_input->>'printable')::boolean, true),
      COALESCE((_input->>'active')::boolean, true), COALESCE((_input->>'sort_order')::integer, 0),
      COALESCE((_input->>'taxable')::boolean, false),
      COALESCE((_input->>'subject_employee_social')::boolean, false),
      COALESCE((_input->>'subject_employer_social')::boolean, false),
      COALESCE((_input->>'prorated')::boolean, false))
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
    updated_at = now()
  WHERE id = _id AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rubrique introuvable dans la societe courante' USING ERRCODE = '42501'; END IF;
  RETURN _id;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Definition de rubrique de paie invalide' USING ERRCODE = 'QG028';
END
$function$;
