-- Utiliser le compte photographie par rubrique, avec les roles de paie comme repli.
CREATE FUNCTION public.hr_component_posting_account(_tenant uuid, _account_code text, _fallback_role text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _account_id uuid;
  _code text := NULLIF(btrim(_account_code), '');
BEGIN
  IF _code IS NULL THEN
    RETURN public.require_posting_account(_tenant, _fallback_role);
  END IF;

  SELECT id INTO _account_id
    FROM public.gl_accounts
   WHERE tenant_id = _tenant AND code = _code AND is_active AND NOT is_header;
  IF _account_id IS NULL THEN
    RAISE EXCEPTION 'Compte de rubrique % absent, inactif ou non imputable', _code
      USING ERRCODE = 'QG001', HINT = 'Choisir un compte actif et imputable de la societe courante.';
  END IF;
  RETURN _account_id;
END
$function$;
REVOKE ALL ON FUNCTION public.hr_component_posting_account(uuid, text, text) FROM PUBLIC, anon, authenticated;

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
  _id uuid;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'approve_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusee : approbation paie requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle introuvable' USING ERRCODE = '42501'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Le precontrole exige un cycle brouillon' USING ERRCODE = 'QG028'; END IF;

  SELECT count(*), COALESCE(sum(gross), 0), COALESCE(sum(deductions), 0), COALESCE(sum(taxes), 0),
         COALESCE(sum(net), 0), COALESCE(sum(employer_charges), 0)
    INTO _count, _gross, _deductions, _taxes, _net, _charges
    FROM public.payroll_lines WHERE tenant_id = _tenant AND run_id = _run_id;
  SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'earning'), 0),
         COALESCE(sum(amount) FILTER (WHERE kind = 'deduction'), 0),
         COALESCE(sum(amount) FILTER (WHERE kind = 'employer_charge'), 0)
    INTO _component_gross, _component_deductions, _component_charges
    FROM public.payroll_component_lines WHERE tenant_id = _tenant AND run_id = _run_id;

  IF _count = 0 THEN _findings := _findings || jsonb_build_array('Aucune ligne de paie calculee.'); END IF;
  IF _gross <= 0 THEN _findings := _findings || jsonb_build_array('Le total brut doit etre superieur a zero.'); END IF;
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

  IF EXISTS (SELECT 1 FROM public.payroll_component_lines WHERE tenant_id = _tenant AND run_id = _run_id) THEN
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
  _social_credit := _ded + _patronal - _component_deductions;
  IF _social_credit > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_SOCIAL'), 0, _social_credit, 'Organismes sociaux');
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
