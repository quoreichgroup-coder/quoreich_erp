-- Persisted prechecks are the gate between draft calculation and payroll approval.
ALTER TABLE public.payroll_run_audit DROP CONSTRAINT payroll_run_audit_event_type_check;
ALTER TABLE public.payroll_run_audit ADD CONSTRAINT payroll_run_audit_event_type_check
  CHECK (event_type IN ('created', 'lines_generated', 'prechecked', 'approved', 'posted', 'status_changed', 'deleted'));

CREATE TABLE public.payroll_run_prechecks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Keep the immutable review attached to its run: a prechecked run cannot be physically deleted.
  run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE RESTRICT,
  passed boolean NOT NULL,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(findings) = 'array'),
  checked_by uuid NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_run_prechecks_latest_idx
  ON public.payroll_run_prechecks (tenant_id, run_id, checked_at DESC, id DESC);
ALTER TABLE public.payroll_run_prechecks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_run_prechecks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payroll_run_prechecks TO authenticated;
CREATE POLICY payroll_run_prechecks_read ON public.payroll_run_prechecks
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_hr_perm(auth.uid(), 'view_payroll') OR public.has_hr_perm(auth.uid(), 'audit_payroll')));
CREATE POLICY payroll_run_prechecks_no_direct_write ON public.payroll_run_prechecks
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE FUNCTION public.prevent_payroll_precheck_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  RAISE EXCEPTION 'Les précontrôles de paie sont immuables' USING ERRCODE = '42501';
END
$function$;
CREATE TRIGGER payroll_run_prechecks_immutable
  BEFORE UPDATE OR DELETE ON public.payroll_run_prechecks
  FOR EACH ROW EXECUTE FUNCTION public.prevent_payroll_precheck_mutation();

CREATE FUNCTION public.precheck_payroll_run(_run_id uuid)
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
  _count integer;
  _id uuid;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'approve_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusée : approbation paie requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle introuvable' USING ERRCODE = '42501'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Le précontrôle exige un cycle brouillon' USING ERRCODE = 'QG028'; END IF;

  SELECT count(*), COALESCE(sum(gross), 0), COALESCE(sum(deductions), 0), COALESCE(sum(taxes), 0),
         COALESCE(sum(net), 0), COALESCE(sum(employer_charges), 0)
    INTO _count, _gross, _deductions, _taxes, _net, _charges
    FROM public.payroll_lines WHERE tenant_id = _tenant AND run_id = _run_id;
  IF _count = 0 THEN _findings := _findings || jsonb_build_array('Aucune ligne de paie calculée.'); END IF;
  IF _gross <= 0 THEN _findings := _findings || jsonb_build_array('Le total brut doit être supérieur à zéro.'); END IF;
  IF _run.payroll_rules_snapshot IS NULL OR _run.payroll_country_code IS NULL OR _run.payroll_currency_code IS NULL THEN
    _findings := _findings || jsonb_build_array('La photographie des règles, du pays ou de la devise est absente.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_run_variables v WHERE v.tenant_id = _tenant
      AND v.run_id = _run_id AND v.status = 'pending') THEN
    _findings := _findings || jsonb_build_array('Des variables restent en attente de décision.');
  END IF;
  IF abs(_gross - COALESCE(_run.gross_total, 0)) > 0.01
     OR abs(_deductions - COALESCE(_run.deductions_total, 0)) > 0.01
     OR abs(_taxes - COALESCE(_run.taxes_total, 0)) > 0.01
     OR abs(_net - COALESCE(_run.net_total, 0)) > 0.01
     OR abs(_charges - COALESCE(_run.employer_charges_total, 0)) > 0.01 THEN
    _findings := _findings || jsonb_build_array('Les totaux du cycle ne correspondent pas aux lignes calculées.');
  END IF;
  IF abs((_gross + _charges) - (_net + _deductions + _taxes + _charges)) > 0.01 THEN
    _findings := _findings || jsonb_build_array('L’écriture estimée est déséquilibrée.');
  END IF;
  IF public.posting_account(_tenant, 'PAYROLL_SALARIES') IS NULL THEN
    _findings := _findings || jsonb_build_array('Compte de charges de salaires non paramétré.');
  END IF;
  IF public.posting_account(_tenant, 'PAYROLL_NET_PAYABLE') IS NULL THEN
    _findings := _findings || jsonb_build_array('Compte de rémunérations dues non paramétré.');
  END IF;
  IF (_deductions + _charges) > 0 AND public.posting_account(_tenant, 'PAYROLL_SOCIAL') IS NULL THEN
    _findings := _findings || jsonb_build_array('Compte des organismes sociaux non paramétré.');
  END IF;
  IF _taxes > 0 AND public.posting_account(_tenant, 'PAYROLL_TAX') IS NULL THEN
    _findings := _findings || jsonb_build_array('Compte d’impôt sur salaires non paramétré.');
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

CREATE OR REPLACE FUNCTION public.approve_payroll_run(_run_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _run public.payroll_runs%ROWTYPE;
  _precheck public.payroll_run_prechecks%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'approve_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusée : rôle Approbateur Paie requis' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle introuvable' USING ERRCODE = '42501'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Seuls les cycles brouillons peuvent être approuvés' USING ERRCODE = 'QG028'; END IF;
  IF _run.created_by = auth.uid() THEN
    RAISE EXCEPTION 'Le préparateur ne peut pas approuver son propre cycle' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _precheck FROM public.payroll_run_prechecks
    WHERE tenant_id = _tenant AND run_id = _run_id
      AND checked_at >= COALESCE((SELECT max(a.created_at) FROM public.payroll_run_audit a
        WHERE a.tenant_id = _tenant AND a.run_id = _run_id AND a.event_type = 'lines_generated'), '-infinity'::timestamptz)
    ORDER BY checked_at DESC, id DESC LIMIT 1;
  IF NOT FOUND OR NOT _precheck.passed THEN
    RAISE EXCEPTION 'Un précontrôle sans anomalie est requis avant approbation' USING ERRCODE = 'QG028';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payroll_lines WHERE tenant_id = _tenant AND run_id = _run_id) THEN
    RAISE EXCEPTION 'Aucune ligne de paie calculée' USING ERRCODE = 'QG028';
  END IF;
  UPDATE public.payroll_runs SET status = 'approved', approved_by = auth.uid(), approved_at = now()
    WHERE id = _run_id;
END
$function$;

REVOKE ALL ON FUNCTION public.precheck_payroll_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.precheck_payroll_run(uuid) TO authenticated;
