-- V151 — Paie : contrepassation d'un cycle comptabilisé et cycles de régularisation (rappels, trop-perçus)
-- (audit docs/audit-erp/32-audit-rh-paie.md, P1).
--
-- Constat : UNIQUE (tenant_id, period) sur payroll_runs ne permettait qu'un cycle par mois ; un cycle comptabilisé
-- était intouchable (guard_payroll_run_lock) et aucune correction n'existait, alors que approve_employee_movement
-- refusait tout mouvement rétroactif en renvoyant vers « une correction de paie » inexistante. Une erreur de paie
-- découverte après comptabilisation ne pouvait donc être corrigée que par une écriture manuelle hors paie.
-- Références : SAP — paie rétroactive (recalcul de la période et différences reportées dans la période en cours) ;
-- Sage Paie — rappels de salaire et bulletins complémentaires ; principe : un bulletin clôturé n'est jamais modifié.
--
-- Règles :
--   * contrepassation (droit hr.reverse_payroll) : un cycle comptabilisé passe à « reversed », son écriture est
--     contrepassée par reverse_journal_entry (motif obligatoire) ; ses lignes restent consultables ; la période peut
--     être recalculée par un nouveau cycle ; refusée tant qu'une régularisation comptabilisée s'appuie sur lui ;
--   * régularisation (droit hr.create_payroll_run) : cycle run_kind = 'regularization' de la même période,
--     daté dans une période ouverte (pay_date) ; le calcul refait la période avec les données et règles actuelles,
--     puis ne garde que la DIFFÉRENCE avec ce qui a été comptabilisé (cycle initial et régularisations antérieures),
--     rubrique par rubrique et salarié par salarié ; montants signés (rappel positif, trop-perçu négatif) ;
--     comptabilisation en conséquence (un montant négatif passe au côté opposé) ;
--   * un seul cycle normal non contrepassé par période, une seule régularisation ouverte à la fois par période ;
--   * un mouvement RH rétroactif sur une période comptabilisée est désormais approuvable ; l'audit du mouvement
--     liste les périodes concernées, à régulariser.

-- 1. Droit de contrepassation.
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('hr.reverse_payroll', 'hr', 'reverse_payroll', 'Contrepasser un cycle de paie comptabilisé')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
VALUES ('admin', 'hr.reverse_payroll'), ('hr_admin', 'hr.reverse_payroll')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r
JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
WHERE r.is_system AND r.code IN ('admin', 'hr_admin') AND sp.permission_code = 'hr.reverse_payroll'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- 2. Cycles : nature, cycle régularisé, écriture, contrepassation.
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS run_kind text NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS regularizes_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT;
ALTER TABLE public.payroll_runs
  ADD CONSTRAINT payroll_runs_run_kind_check CHECK (run_kind IN ('regular', 'regularization')),
  ADD CONSTRAINT payroll_runs_regularization_link CHECK ((run_kind = 'regularization') = (regularizes_run_id IS NOT NULL));

-- Écriture des cycles déjà comptabilisés (numéro JE-PAY-<période>-<8 premiers caractères du cycle>).
UPDATE public.payroll_runs r SET journal_entry_id = j.id
  FROM public.journal_entries j
 WHERE r.status = 'posted' AND r.journal_entry_id IS NULL AND j.tenant_id = r.tenant_id
   AND j.entry_number = 'JE-PAY-' || r.period || '-' || substr(r.id::text, 1, 8);

ALTER TABLE public.payroll_runs DROP CONSTRAINT payroll_runs_tenant_id_period_key;
CREATE UNIQUE INDEX payroll_runs_one_regular_per_period
  ON public.payroll_runs (tenant_id, period) WHERE run_kind = 'regular' AND status <> 'reversed';
CREATE UNIQUE INDEX payroll_runs_one_open_regularization_per_period
  ON public.payroll_runs (tenant_id, period) WHERE run_kind = 'regularization' AND status NOT IN ('posted', 'reversed');

-- Lignes de régularisation : montants signés.
ALTER TABLE public.payroll_component_lines DROP CONSTRAINT payroll_component_lines_amount_check;
ALTER TABLE public.payroll_component_lines ADD CONSTRAINT payroll_component_lines_amount_check
  CHECK (amount >= 0 OR source_type = 'regularization');
ALTER TABLE public.payroll_component_lines DROP CONSTRAINT payroll_component_lines_source_type_check;
ALTER TABLE public.payroll_component_lines ADD CONSTRAINT payroll_component_lines_source_type_check
  CHECK (source_type IN ('base_salary', 'employee_assignment', 'payroll_variable', 'contribution', 'regularization'));
ALTER TABLE public.payroll_component_lines DROP CONSTRAINT payroll_component_lines_calculation_method_check;
ALTER TABLE public.payroll_component_lines ADD CONSTRAINT payroll_component_lines_calculation_method_check
  CHECK (calculation_method IN ('fixed', 'percent_base', 'contribution', 'quantity_rate', 'scale', 'formula', 'regularization'));

ALTER TABLE public.payroll_run_audit DROP CONSTRAINT payroll_run_audit_event_type_check;
ALTER TABLE public.payroll_run_audit ADD CONSTRAINT payroll_run_audit_event_type_check
  CHECK (event_type IN ('created', 'lines_generated', 'prechecked', 'approved', 'posted', 'status_changed', 'deleted', 'reversed'));

CREATE OR REPLACE FUNCTION public.audit_payroll_run_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _event text; _from text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.payroll_run_audit (tenant_id, run_id, event_type, from_status, to_status, performed_by, details)
    VALUES (OLD.tenant_id, OLD.id, 'deleted', OLD.status, NULL, auth.uid(),
            jsonb_build_object('period', OLD.period, 'employee_count', OLD.employee_count,
                               'currency', OLD.payroll_currency_code, 'run_kind', OLD.run_kind));
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    _event := 'created'; _from := NULL;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    _from := OLD.status;
    _event := CASE NEW.status WHEN 'approved' THEN 'approved' WHEN 'posted' THEN 'posted' WHEN 'reversed' THEN 'reversed'
      ELSE 'status_changed' END;
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO public.payroll_run_audit (tenant_id, run_id, event_type, from_status, to_status, performed_by, details)
  VALUES (NEW.tenant_id, NEW.id, _event, _from, NEW.status, auth.uid(),
          jsonb_build_object('period', NEW.period, 'employee_count', NEW.employee_count,
                             'currency', NEW.payroll_currency_code, 'run_kind', NEW.run_kind,
                             'regularizes_run_id', NEW.regularizes_run_id, 'reason', NEW.reversal_reason));
  RETURN NEW;
END $function$;

-- Un cycle comptabilisé ne change plus, sauf sa contrepassation (statut et champs de contrepassation seulement).
CREATE OR REPLACE FUNCTION public.guard_payroll_run_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'posted' AND NEW.status <> 'posted' THEN
    IF NEW.status = 'reversed'
       AND (to_jsonb(NEW) - ARRAY['status', 'reversed_at', 'reversed_by', 'reversal_reason', 'reversal_entry_id', 'updated_at'])
         = (to_jsonb(OLD) - ARRAY['status', 'reversed_at', 'reversed_by', 'reversal_reason', 'reversal_entry_id', 'updated_at']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Un cycle comptabilisé ne peut être modifié (contrepasser le cycle)';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'Un cycle contrepassé ne peut être modifié';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Un cycle comptabilisé ou contrepassé ne peut être supprimé';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;

-- Écran / API : un cycle créé directement est toujours un cycle normal vierge.
CREATE OR REPLACE FUNCTION public.guard_payroll_run_direct_write()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft';
    NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.executed_by := NULL; NEW.executed_at := NULL;
    NEW.gross_total := 0; NEW.net_total := 0; NEW.deductions_total := 0; NEW.taxes_total := 0;
    NEW.employer_charges_total := 0; NEW.employee_count := 0;
    NEW.payroll_country_code := NULL; NEW.payroll_currency_code := NULL; NEW.payroll_rules_snapshot := NULL;
    NEW.run_kind := 'regular'; NEW.regularizes_run_id := NULL; NEW.journal_entry_id := NULL;
    NEW.reversed_at := NULL; NEW.reversed_by := NULL; NEW.reversal_reason := NULL; NEW.reversal_entry_id := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Un cycle de paie ne se modifie que par ses fonctions (génération, précontrôle, approbation, comptabilisation)'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Seul un cycle de paie brouillon se supprime (cycle « % »)', OLD.status USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $function$;

-- 3. Calcul : le calcul V150 devient le cœur ; une régularisation n'en garde que la différence.
ALTER FUNCTION public.generate_payroll_lines(uuid) RENAME TO payroll_generate_core;
REVOKE ALL ON FUNCTION public.payroll_generate_core(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.payroll_apply_regularization(_run_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _run public.payroll_runs%ROWTYPE;
  _lines jsonb;
  _totals jsonb;
  _count integer;
BEGIN
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id;
  -- Ce qui a déjà été comptabilisé pour la période : cycle initial et régularisations antérieures, non contrepassés.
  WITH cur AS (
    SELECT employee_id, code_snapshot code, kind, sum(amount) amt, min(label_snapshot) label,
           (array_agg(definition_snapshot ORDER BY id))[1] snap
      FROM public.payroll_component_lines WHERE run_id = _run_id GROUP BY 1, 2, 3),
  prev AS (
    SELECT l.employee_id, l.code_snapshot code, l.kind, sum(l.amount) amt, min(l.label_snapshot) label,
           (array_agg(l.definition_snapshot ORDER BY l.id))[1] snap
      FROM public.payroll_component_lines l JOIN public.payroll_runs r ON r.id = l.run_id
     WHERE r.tenant_id = _run.tenant_id AND r.period = _run.period AND r.status = 'posted' AND r.id <> _run_id
     GROUP BY 1, 2, 3)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('employee_id', d.employee_id, 'code', d.code, 'kind', d.kind,
      'label', d.label, 'diff', d.diff, 'new', d.new_amt, 'old', d.old_amt, 'snap', d.snap)), '[]'::jsonb)
    INTO _lines
    FROM (SELECT COALESCE(c.employee_id, p.employee_id) employee_id, COALESCE(c.code, p.code) code,
                 COALESCE(c.kind, p.kind) kind, COALESCE(c.label, p.label) label,
                 COALESCE(c.amt, 0) - COALESCE(p.amt, 0) diff, COALESCE(c.amt, 0) new_amt, COALESCE(p.amt, 0) old_amt,
                 COALESCE(c.snap, p.snap) snap
            FROM cur c FULL JOIN prev p ON p.employee_id = c.employee_id AND p.code = c.code AND p.kind = c.kind) d
   WHERE d.diff <> 0;

  WITH cur AS (
    SELECT employee_id, gross, deductions, taxes, net, employer_charges, department_snapshot
      FROM public.payroll_lines WHERE run_id = _run_id),
  prev AS (
    SELECT l.employee_id, sum(l.gross) gross, sum(l.deductions) deductions, sum(l.taxes) taxes, sum(l.net) net,
           sum(l.employer_charges) employer_charges, min(l.department_snapshot) department_snapshot
      FROM public.payroll_lines l JOIN public.payroll_runs r ON r.id = l.run_id
     WHERE r.tenant_id = _run.tenant_id AND r.period = _run.period AND r.status = 'posted' AND r.id <> _run_id
     GROUP BY l.employee_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('employee_id', d.employee_id, 'gross', d.gross, 'deductions', d.deductions,
      'taxes', d.taxes, 'net', d.net, 'employer_charges', d.employer_charges, 'department', d.department)), '[]'::jsonb)
    INTO _totals
    FROM (SELECT COALESCE(c.employee_id, p.employee_id) employee_id,
                 COALESCE(c.gross, 0) - COALESCE(p.gross, 0) gross, COALESCE(c.deductions, 0) - COALESCE(p.deductions, 0) deductions,
                 COALESCE(c.taxes, 0) - COALESCE(p.taxes, 0) taxes, COALESCE(c.net, 0) - COALESCE(p.net, 0) net,
                 COALESCE(c.employer_charges, 0) - COALESCE(p.employer_charges, 0) employer_charges,
                 COALESCE(c.department_snapshot, p.department_snapshot) department
            FROM cur c FULL JOIN prev p ON p.employee_id = c.employee_id) d
   WHERE d.gross <> 0 OR d.deductions <> 0 OR d.taxes <> 0 OR d.net <> 0 OR d.employer_charges <> 0;

  DELETE FROM public.payroll_component_lines WHERE run_id = _run_id;
  DELETE FROM public.payroll_lines WHERE run_id = _run_id;
  INSERT INTO public.payroll_component_lines (tenant_id, run_id, employee_id, code_snapshot, label_snapshot, kind,
    calculation_method, calculation_base, amount, source_type, definition_snapshot)
  SELECT _run.tenant_id, _run_id, (x ->> 'employee_id')::uuid, x ->> 'code', x ->> 'label', x ->> 'kind',
    'regularization', (x ->> 'old')::numeric, (x ->> 'diff')::numeric, 'regularization',
    COALESCE(x -> 'snap', '{}'::jsonb) || jsonb_build_object('regularization',
      jsonb_build_object('already_posted', (x ->> 'old')::numeric, 'recalculated', (x ->> 'new')::numeric))
  FROM jsonb_array_elements(_lines) x;
  INSERT INTO public.payroll_lines (tenant_id, run_id, employee_id, gross, deductions, taxes, net, employer_charges, department_snapshot)
  SELECT _run.tenant_id, _run_id, (x ->> 'employee_id')::uuid, (x ->> 'gross')::numeric, (x ->> 'deductions')::numeric,
    (x ->> 'taxes')::numeric, (x ->> 'net')::numeric, (x ->> 'employer_charges')::numeric, COALESCE(x ->> 'department', '')
  FROM jsonb_array_elements(_totals) x;
  _count := jsonb_array_length(_totals);
  UPDATE public.payroll_runs
     SET gross_total = COALESCE((SELECT SUM(gross) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         net_total = COALESCE((SELECT SUM(net) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         deductions_total = COALESCE((SELECT SUM(deductions) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         taxes_total = COALESCE((SELECT SUM(taxes) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         employer_charges_total = COALESCE((SELECT SUM(employer_charges) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         employee_count = _count,
         payroll_rules_snapshot = payroll_rules_snapshot || jsonb_build_object('regularization', jsonb_build_object(
           'regularizes_run_id', _run.regularizes_run_id,
           'already_posted_runs', (SELECT COALESCE(jsonb_agg(r.id ORDER BY r.created_at), '[]'::jsonb) FROM public.payroll_runs r
              WHERE r.tenant_id = _run.tenant_id AND r.period = _run.period AND r.status = 'posted' AND r.id <> _run_id)))
   WHERE id = _run_id;
  RETURN _count;
END $function$;
REVOKE ALL ON FUNCTION public.payroll_apply_regularization(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_payroll_lines(_run_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _count integer; _kind text;
BEGIN
  _count := public.payroll_generate_core(_run_id);
  SELECT run_kind INTO _kind FROM public.payroll_runs WHERE id = _run_id;
  IF _kind = 'regularization' THEN
    _count := public.payroll_apply_regularization(_run_id);
  END IF;
  RETURN _count;
END $function$;
REVOKE ALL ON FUNCTION public.generate_payroll_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_payroll_lines(uuid) TO authenticated;

-- 4. Création d'une régularisation et contrepassation.
CREATE OR REPLACE FUNCTION public.create_payroll_regularization(_run_id uuid, _pay_date date, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _origin public.payroll_runs%ROWTYPE;
  _id uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'create_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusée : hr.create_payroll_run' USING ERRCODE = '42501';
  END IF;
  IF _pay_date IS NULL OR length(btrim(COALESCE(_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Date de paiement et motif de la régularisation obligatoires' USING ERRCODE = 'QG028';
  END IF;
  SELECT * INTO _origin FROM public.payroll_runs WHERE id = _run_id AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  IF _origin.status <> 'posted' THEN
    RAISE EXCEPTION 'Seul un cycle comptabilisé se régularise' USING ERRCODE = 'QG028';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_runs r WHERE r.tenant_id = _tenant AND r.period = _origin.period
      AND r.status = 'posted' AND r.payroll_rules_snapshot ->> 'engine' IS DISTINCT FROM 'v149') THEN
    RAISE EXCEPTION 'La période % a été calculée avant le détail des cotisations : contrepasser le cycle puis le recalculer', _origin.period
      USING ERRCODE = 'QG028';
  END IF;
  INSERT INTO public.payroll_runs (tenant_id, period, pay_date, status, created_by, run_kind, regularizes_run_id, notes)
  VALUES (_tenant, _origin.period, _pay_date, 'draft', auth.uid(), 'regularization',
    COALESCE(_origin.regularizes_run_id, _origin.id), 'Régularisation : ' || btrim(_reason))
  RETURNING id INTO _id;
  RETURN _id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Une régularisation de la période % est déjà en cours', _origin.period USING ERRCODE = 'QG028';
END $function$;
REVOKE ALL ON FUNCTION public.create_payroll_regularization(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_payroll_regularization(uuid, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_payroll_run(_run_id uuid, _reason text, _reverse_date date DEFAULT CURRENT_DATE)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _run public.payroll_runs%ROWTYPE;
  _entry uuid;
  _reversal uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'hr.reverse_payroll') THEN
    RAISE EXCEPTION 'Permission refusée : hr.reverse_payroll' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 3 OR _reverse_date IS NULL THEN
    RAISE EXCEPTION 'Motif et date de contrepassation obligatoires' USING ERRCODE = 'QG028';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  IF _run.status <> 'posted' THEN RAISE EXCEPTION 'Seul un cycle comptabilisé se contrepasse' USING ERRCODE = 'QG028'; END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_runs r WHERE r.tenant_id = _tenant AND r.period = _run.period
      AND r.run_kind = 'regularization' AND r.status = 'posted' AND r.created_at > _run.created_at) THEN
    RAISE EXCEPTION 'Une régularisation comptabilisée postérieure existe : contrepasser d''abord la plus récente' USING ERRCODE = 'QG028';
  END IF;
  _entry := COALESCE(_run.journal_entry_id, (SELECT j.id FROM public.journal_entries j WHERE j.tenant_id = _tenant
    AND j.entry_number = 'JE-PAY-' || _run.period || '-' || substr(_run.id::text, 1, 8)));
  IF _entry IS NULL THEN RAISE EXCEPTION 'Écriture du cycle introuvable' USING ERRCODE = 'QG028'; END IF;
  _reversal := public.reverse_journal_entry(_entry, _reverse_date, 'Contrepassation paie ' || _run.period || ' : ' || btrim(_reason));
  UPDATE public.payroll_runs SET status = 'reversed', reversed_at = now(), reversed_by = auth.uid(),
         reversal_reason = btrim(_reason), reversal_entry_id = _reversal
   WHERE id = _run_id;
  RETURN _reversal;
END $function$;
REVOKE ALL ON FUNCTION public.reverse_payroll_run(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_payroll_run(uuid, text, date) TO authenticated;

-- 5. Précontrôle : V148 ; une régularisation peut être négative, mais doit contenir une différence.
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
  _regularization boolean;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'approve_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusee : approbation paie requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle introuvable' USING ERRCODE = '42501'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Le precontrole exige un cycle brouillon' USING ERRCODE = 'QG028'; END IF;
  _regularization := _run.run_kind = 'regularization';

  SELECT count(*), COALESCE(sum(gross), 0), COALESCE(sum(deductions), 0), COALESCE(sum(taxes), 0),
         COALESCE(sum(net), 0), COALESCE(sum(employer_charges), 0), count(*) FILTER (WHERE net < 0)
    INTO _count, _gross, _deductions, _taxes, _net, _charges, _negative
    FROM public.payroll_lines WHERE tenant_id = _tenant AND run_id = _run_id;
  SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'earning'), 0),
         COALESCE(sum(amount) FILTER (WHERE kind = 'deduction'), 0),
         COALESCE(sum(amount) FILTER (WHERE kind = 'employer_charge'), 0)
    INTO _component_gross, _component_deductions, _component_charges
    FROM public.payroll_component_lines WHERE tenant_id = _tenant AND run_id = _run_id;

  IF _count = 0 THEN
    _findings := _findings || jsonb_build_array(CASE WHEN _regularization
      THEN 'Aucune difference a regulariser pour cette periode.' ELSE 'Aucune ligne de paie calculee.' END);
  END IF;
  IF NOT _regularization AND _gross <= 0 THEN _findings := _findings || jsonb_build_array('Le total brut doit etre superieur a zero.'); END IF;
  IF NOT _regularization AND _negative > 0 THEN
    _findings := _findings || jsonb_build_array(format(
      'Net a payer negatif pour %s salarie(s) : les retenues depassent le brut.', _negative));
  END IF;
  IF _regularization AND NOT EXISTS (SELECT 1 FROM public.payroll_runs r WHERE r.id = _run.regularizes_run_id AND r.status = 'posted') THEN
    _findings := _findings || jsonb_build_array('Le cycle régularisé n''est plus comptabilisé (contrepassé) : régularisation sans objet.');
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
     AND (abs(_gross - _component_gross) > 0.01
       OR (NOT _regularization AND (_component_deductions > _deductions + 0.01 OR _component_charges > _charges + 0.01))
       OR (_regularization AND (abs(_component_deductions - _deductions) > 0.01 OR abs(_component_charges - _charges) > 0.01))) THEN
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
  IF (_deductions <> 0 OR _charges <> 0) AND public.posting_account(_tenant, 'PAYROLL_SOCIAL') IS NULL THEN
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
  IF _taxes <> 0 AND public.posting_account(_tenant, 'PAYROLL_TAX') IS NULL THEN
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

-- 6. Comptabilisation : V149 ; montants signés (un solde négatif passe au côté opposé) ; écriture rattachée au cycle.
CREATE OR REPLACE FUNCTION public.post_payroll_run(_run_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  IF _r.run_kind = 'regular' AND _gross <= 0 THEN RAISE EXCEPTION 'Cycle vide - aucune ligne a comptabiliser'; END IF;
  IF _r.run_kind = 'regularization' AND NOT EXISTS (SELECT 1 FROM public.payroll_lines WHERE run_id = _run_id) THEN
    RAISE EXCEPTION 'Régularisation vide - aucune différence à comptabiliser' USING ERRCODE = 'QG028';
  END IF;

  _entry_number := 'JE-PAY-' || _r.period || '-' || substr(_run_id::text, 1, 8);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, _entry_number, _r.pay_date,
    CASE WHEN _r.run_kind = 'regularization' THEN 'Régularisation paie ' ELSE 'Paie ' END || _r.period || ' (' || _r.payroll_country_code || ')',
    'payroll', 'draft', auth.uid())
  RETURNING id INTO _entry_id;

  IF _r.payroll_rules_snapshot ->> 'engine' = 'v149' THEN
    -- Montant signé par compte : + au côté nominal, − au côté opposé ; le solde décide du côté de la ligne.
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    SELECT _entry_id, s.account_id,
           CASE WHEN s.signed > 0 THEN s.signed ELSE 0 END, CASE WHEN s.signed < 0 THEN -s.signed ELSE 0 END, s.label
      FROM (
        SELECT x.account_id, sum(CASE WHEN x.side = 'D' THEN x.amount ELSE -x.amount END) signed,
               CASE WHEN count(DISTINCT x.label) = 1 THEN min(x.label) ELSE min(x.grp) END label
          FROM (
            SELECT public.hr_component_posting_account(_tenant, COALESCE(l.definition_snapshot ->> 'gl_account_code', ''),
                     CASE WHEN l.kind = 'earning' THEN 'PAYROLL_SALARIES' ELSE 'PAYROLL_EMPLOYER_CHARGES' END) account_id,
                   l.amount, l.label_snapshot label,
                   CASE WHEN l.kind = 'earning' THEN 'Rémunérations' ELSE 'Charges patronales' END grp, 'D' side
              FROM public.payroll_component_lines l
             WHERE l.tenant_id = _tenant AND l.run_id = _run_id AND l.kind IN ('earning', 'employer_charge') AND l.amount <> 0
            UNION ALL
            SELECT public.hr_component_posting_account(_tenant, COALESCE(l.definition_snapshot ->> 'gl_account_code', ''), 'PAYROLL_SOCIAL'),
                   l.amount, l.label_snapshot, 'Retenues et cotisations', 'C'
              FROM public.payroll_component_lines l
             WHERE l.tenant_id = _tenant AND l.run_id = _run_id AND l.kind = 'deduction' AND l.amount <> 0
            UNION ALL
            SELECT public.hr_component_posting_account(_tenant,
                     CASE WHEN COALESCE(l.definition_snapshot ->> 'side', '') = 'employer'
                            OR l.source_type = 'contribution' THEN COALESCE(l.definition_snapshot ->> 'payable_account_code', '') ELSE '' END,
                     'PAYROLL_SOCIAL'),
                   l.amount, l.label_snapshot, 'Organismes sociaux', 'C'
              FROM public.payroll_component_lines l
             WHERE l.tenant_id = _tenant AND l.run_id = _run_id AND l.kind = 'employer_charge' AND l.amount <> 0
          ) x
         GROUP BY x.account_id, x.side
      ) s
     WHERE s.signed <> 0;
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
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_SALARIES'), _gross, 0, 'Salaires bruts');
    IF _patronal > 0 THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_EMPLOYER_CHARGES'), _patronal, 0, 'Charges patronales');
    END IF;
  END IF;

  IF _net <> 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_NET_PAYABLE'),
      CASE WHEN _net < 0 THEN -_net ELSE 0 END, CASE WHEN _net > 0 THEN _net ELSE 0 END,
      CASE WHEN _net < 0 THEN 'Personnel - trop-perçu à récupérer' ELSE 'Personnel - remunerations dues' END);
  END IF;
  IF _r.payroll_rules_snapshot ->> 'engine' IS DISTINCT FROM 'v149' THEN
    _social_credit := _ded + _patronal - _component_deductions;
    IF _social_credit > 0 THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_SOCIAL'), 0, _social_credit, 'Organismes sociaux');
    END IF;
  END IF;
  IF _tax <> 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, public.require_posting_account(_tenant, 'PAYROLL_TAX'),
      CASE WHEN _tax < 0 THEN -_tax ELSE 0 END, CASE WHEN _tax > 0 THEN _tax ELSE 0 END, 'Etat - impot sur salaires');
  END IF;
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry_id;
  UPDATE public.payroll_runs
     SET status = 'posted', executed_by = auth.uid(), executed_at = now(), journal_entry_id = _entry_id,
         notes = COALESCE(notes, '') || ' | JE=' || _entry_number
   WHERE id = _run_id;
  RETURN _entry_id;
END
$function$;
GRANT EXECUTE ON FUNCTION public.post_payroll_run(uuid) TO authenticated;

-- 7. Mouvement rétroactif : approuvable ; les périodes comptabilisées concernées sont tracées pour régularisation.
CREATE OR REPLACE FUNCTION public.approve_employee_movement(_movement_id uuid, _decision_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _movement public.employee_movements%ROWTYPE;
  _periods jsonb;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'approve_employee_movement') THEN
    RAISE EXCEPTION 'Permission refusee : hr.approve_employee_movement' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _movement FROM public.employee_movements m
   WHERE m.id = _movement_id AND m.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mouvement introuvable dans la societe courante' USING ERRCODE = '42501'; END IF;
  IF _movement.status <> 'pending' THEN RAISE EXCEPTION 'Seul un mouvement en attente peut etre approuve' USING ERRCODE = 'QG028'; END IF;
  IF _movement.created_by = auth.uid() THEN RAISE EXCEPTION 'Separation des taches : le createur ne peut approuver son mouvement' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(DISTINCT r.period ORDER BY r.period), '[]'::jsonb) INTO _periods
    FROM public.payroll_runs r WHERE r.tenant_id = _tenant AND r.status = 'posted'
     AND r.period >= to_char(_movement.effective_date, 'YYYY-MM');
  UPDATE public.employee_movements
     SET status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_reason = NULLIF(btrim(_decision_reason), '')
   WHERE id = _movement_id;
  INSERT INTO public.employee_movement_audit (tenant_id, movement_id, event_type, performed_by, details)
  VALUES (_tenant, _movement_id, 'approved', auth.uid(), jsonb_build_object('effective_date', _movement.effective_date,
    'posted_periods_to_regularize', _periods));
  RETURN _movement_id;
END
$function$;

SELECT public.install_tenant_isolation_triggers();
