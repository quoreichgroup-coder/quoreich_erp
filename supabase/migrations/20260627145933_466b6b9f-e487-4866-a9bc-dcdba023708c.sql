
-- has_hr_perm — helper RBAC paie
CREATE OR REPLACE FUNCTION public.has_hr_perm(_user_id uuid, _action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR public.has_role(_user_id, 'hr_admin'::public.app_role)
    OR CASE _action
      WHEN 'create_payroll_run'  THEN public.has_role(_user_id, 'hr_clerk'::public.app_role)
      WHEN 'approve_payroll_run' THEN public.has_role(_user_id, 'hr_approver'::public.app_role)
      WHEN 'execute_payroll'     THEN public.has_role(_user_id, 'payroll_officer'::public.app_role)
      WHEN 'audit_payroll'       THEN public.has_role(_user_id, 'hr_auditor'::public.app_role)
      WHEN 'export'              THEN public.has_role(_user_id, 'hr_approver'::public.app_role)
                                   OR public.has_role(_user_id, 'payroll_officer'::public.app_role)
                                   OR public.has_role(_user_id, 'hr_auditor'::public.app_role)
      WHEN 'view_sensitive'      THEN public.has_role(_user_id, 'hr_clerk'::public.app_role)
                                   OR public.has_role(_user_id, 'hr_approver'::public.app_role)
                                   OR public.has_role(_user_id, 'payroll_officer'::public.app_role)
                                   OR public.has_role(_user_id, 'hr_auditor'::public.app_role)
      ELSE false
    END
$$;

REVOKE EXECUTE ON FUNCTION public.has_hr_perm(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_hr_perm(uuid, text) TO authenticated;

-- compute_payroll_line
CREATE OR REPLACE FUNCTION public.compute_payroll_line(_employee_id uuid)
RETURNS TABLE(gross numeric, deductions numeric, taxes numeric, net numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _base numeric;
BEGIN
  SELECT base_salary INTO _base FROM public.employees WHERE id = _employee_id;
  IF _base IS NULL THEN _base := 0; END IF;
  gross      := ROUND(_base, 2);
  deductions := ROUND(_base * 0.063, 2);
  taxes      := ROUND((_base - (_base * 0.063)) * 0.10, 2);
  net        := ROUND(gross - deductions - taxes, 2);
  RETURN NEXT;
END $$;

REVOKE EXECUTE ON FUNCTION public.compute_payroll_line(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compute_payroll_line(uuid) TO authenticated;

-- generate_payroll_lines
CREATE OR REPLACE FUNCTION public.generate_payroll_lines(_run_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _run public.payroll_runs%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _count integer := 0;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'create_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusée: rôle Saisie RH requis';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id;
  IF _run.tenant_id IS NULL OR _run.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Cycle non modifiable (statut %)', _run.status; END IF;

  DELETE FROM public.payroll_lines WHERE run_id = _run_id;
  INSERT INTO public.payroll_lines (tenant_id, run_id, employee_id, gross, deductions, taxes, net)
  SELECT _run.tenant_id, _run_id, e.id, c.gross, c.deductions, c.taxes, c.net
    FROM public.employees e
    CROSS JOIN LATERAL public.compute_payroll_line(e.id) c
   WHERE e.tenant_id = _run.tenant_id AND e.status = 'active';
  GET DIAGNOSTICS _count = ROW_COUNT;

  UPDATE public.payroll_runs
     SET gross_total = COALESCE((SELECT SUM(gross) FROM public.payroll_lines WHERE run_id = _run_id),0),
         net_total   = COALESCE((SELECT SUM(net)   FROM public.payroll_lines WHERE run_id = _run_id),0),
         employee_count = _count
   WHERE id = _run_id;
  RETURN _count;
END $$;

REVOKE EXECUTE ON FUNCTION public.generate_payroll_lines(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generate_payroll_lines(uuid) TO authenticated;

-- approve_payroll_run
CREATE OR REPLACE FUNCTION public.approve_payroll_run(_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _r public.payroll_runs%ROWTYPE;
        _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'approve_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusée: rôle Approbateur Paie requis';
  END IF;
  SELECT * INTO _r FROM public.payroll_runs WHERE id = _run_id;
  IF _r.tenant_id IS NULL OR _r.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _r.status <> 'draft' THEN RAISE EXCEPTION 'Seuls les cycles draft peuvent être approuvés'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payroll_lines WHERE run_id = _run_id) THEN
    RAISE EXCEPTION 'Aucune ligne de paie — générez-les d''abord';
  END IF;
  UPDATE public.payroll_runs SET status='approved', approved_by=auth.uid(), approved_at=now()
    WHERE id=_run_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.approve_payroll_run(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_payroll_run(uuid) TO authenticated;

-- post_payroll_run — JE SYSCOHADA
CREATE OR REPLACE FUNCTION public.post_payroll_run(_run_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _r public.payroll_runs%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _entry_id uuid; _entry_number text;
  _acc_salaires uuid; _acc_charges uuid;
  _acc_personnel uuid; _acc_cnps uuid; _acc_etat uuid;
  _gross numeric; _ded numeric; _tax numeric; _net numeric; _patronal numeric;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'execute_payroll') THEN
    RAISE EXCEPTION 'Permission refusée: rôle Officier de Paie requis';
  END IF;
  SELECT * INTO _r FROM public.payroll_runs WHERE id=_run_id;
  IF _r.tenant_id IS NULL OR _r.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _r.status = 'posted' THEN RAISE EXCEPTION 'Cycle déjà comptabilisé'; END IF;
  IF _r.status <> 'approved' THEN RAISE EXCEPTION 'Le cycle doit être approuvé avant comptabilisation'; END IF;

  SELECT COALESCE(SUM(gross),0), COALESCE(SUM(deductions),0),
         COALESCE(SUM(taxes),0), COALESCE(SUM(net),0)
    INTO _gross, _ded, _tax, _net FROM public.payroll_lines WHERE run_id=_run_id;
  IF _gross <= 0 THEN RAISE EXCEPTION 'Cycle vide — aucune ligne à comptabiliser'; END IF;
  _patronal := ROUND(_gross * 0.164, 2);

  SELECT id INTO _acc_salaires  FROM public.gl_accounts WHERE tenant_id=_tenant AND code='6610' LIMIT 1;
  SELECT id INTO _acc_charges   FROM public.gl_accounts WHERE tenant_id=_tenant AND code='6630' LIMIT 1;
  SELECT id INTO _acc_personnel FROM public.gl_accounts WHERE tenant_id=_tenant AND code='4210' LIMIT 1;
  SELECT id INTO _acc_cnps      FROM public.gl_accounts WHERE tenant_id=_tenant AND code='4310' LIMIT 1;
  SELECT id INTO _acc_etat      FROM public.gl_accounts WHERE tenant_id=_tenant AND code='4470' LIMIT 1;

  IF _acc_salaires IS NULL OR _acc_personnel IS NULL THEN
    RAISE EXCEPTION 'Comptes GL paie manquants (6610 Salaires / 4210 Personnel). Configurez le plan SYSCOHADA.';
  END IF;

  _entry_number := 'JE-PAY-'||_r.period||'-'||substr(_run_id::text,1,8);

  INSERT INTO public.journal_entries(tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, _entry_number, _r.pay_date, 'Paie '||_r.period, 'payroll', 'draft', auth.uid())
  RETURNING id INTO _entry_id;

  -- DR
  INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _acc_salaires, _gross + CASE WHEN _acc_charges IS NULL THEN _patronal ELSE 0 END, 0, 'DR Salaires bruts');

  IF _acc_charges IS NOT NULL AND _patronal > 0 THEN
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _acc_charges, _patronal, 0, 'DR Charges patronales');
  END IF;

  -- CR Personnel
  INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _acc_personnel, 0, _net, 'CR Personnel — rémunérations dues');

  -- CR CNPS — fallback vers Personnel si compte absent
  IF (_ded + _patronal) > 0 THEN
    IF _acc_cnps IS NOT NULL THEN
      INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _acc_cnps, 0, _ded + _patronal, 'CR Organismes sociaux (CNPS)');
    ELSE
      UPDATE public.journal_lines SET credit = credit + (_ded + _patronal)
        WHERE entry_id=_entry_id AND account_id=_acc_personnel;
    END IF;
  END IF;

  -- CR État — fallback vers Personnel si compte absent
  IF _tax > 0 THEN
    IF _acc_etat IS NOT NULL THEN
      INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _acc_etat, 0, _tax, 'CR État — impôt sur salaires');
    ELSE
      UPDATE public.journal_lines SET credit = credit + _tax
        WHERE entry_id=_entry_id AND account_id=_acc_personnel;
    END IF;
  END IF;

  UPDATE public.journal_entries SET status='posted', posted_by=auth.uid(), posted_at=now()
    WHERE id=_entry_id;

  UPDATE public.payroll_runs
     SET status='posted', executed_by=auth.uid(), executed_at=now(),
         notes = COALESCE(notes,'')||' | JE='||_entry_number
   WHERE id=_run_id;

  RETURN _entry_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.post_payroll_run(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.post_payroll_run(uuid) TO authenticated;

-- Lock posted runs
CREATE OR REPLACE FUNCTION public.guard_payroll_run_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status='posted' AND NEW.status <> 'posted' THEN
    RAISE EXCEPTION 'Un cycle comptabilisé ne peut être modifié';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status='posted' THEN
    RAISE EXCEPTION 'Un cycle comptabilisé ne peut être supprimé';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_payroll_runs_lock ON public.payroll_runs;
CREATE TRIGGER trg_payroll_runs_lock
  BEFORE UPDATE OR DELETE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_run_lock();

-- KPI view
CREATE OR REPLACE VIEW public.payroll_kpis_view AS
SELECT
  pr.tenant_id,
  to_char(CURRENT_DATE,'YYYY') AS fiscal_year,
  COALESCE(SUM(pr.gross_total) FILTER (WHERE pr.period LIKE to_char(CURRENT_DATE,'YYYY')||'%' AND pr.status='posted'),0) AS gross_ytd,
  COALESCE(SUM(pr.net_total)   FILTER (WHERE pr.period LIKE to_char(CURRENT_DATE,'YYYY')||'%' AND pr.status='posted'),0) AS net_ytd,
  COUNT(*) FILTER (WHERE pr.status='posted')   AS posted_runs,
  COUNT(*) FILTER (WHERE pr.status='draft')    AS draft_runs,
  COUNT(*) FILTER (WHERE pr.status='approved') AS approved_runs,
  (SELECT COUNT(*) FROM public.employees e WHERE e.tenant_id = pr.tenant_id AND e.status='active') AS active_employees
FROM public.payroll_runs pr
GROUP BY pr.tenant_id;
GRANT SELECT ON public.payroll_kpis_view TO authenticated;

-- Register view (legal)
CREATE OR REPLACE VIEW public.payroll_register_view AS
SELECT pl.tenant_id, pr.period, pr.pay_date, pr.status,
       e.matricule, e.first_name, e.last_name, e.department, e.job_title,
       pl.gross, pl.deductions, pl.taxes, pl.net
FROM public.payroll_lines pl
JOIN public.payroll_runs pr ON pr.id = pl.run_id
JOIN public.employees e ON e.id = pl.employee_id;
GRANT SELECT ON public.payroll_register_view TO authenticated;
