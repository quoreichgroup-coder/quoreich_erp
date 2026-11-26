-- V153 — RH : calendrier des jours fériés, acquisition automatique des congés, libre-service salarié.
--
-- Suite de V152 (limites signalées au propriétaire). Références :
--   * Odoo — jours fériés saisis par la société (aucun par défaut), déduits de la durée des congés sauf pour les types
--     qui les incluent ; acquisition par action planifiée, au prorata du temps travaillé en option ; le salarié saisit
--     ses demandes et voit ses soldes ; approbation par type : responsable congés, approbateur du salarié, ou aucune ;
--   * SAP — calendrier des jours fériés (dates fixes et mobiles, règle de report d'un férié tombant un week-end) ;
--   * Burkina Faso — loi 001-2026/ALT (11 jours chômés et payés) ; les fêtes religieuses (Ramadan, Tabaski, Maouloud)
--     sont fixées chaque année par communiqué : aucune date n'est préremplie, la société saisit son calendrier.
--
-- Règles :
--   * hr_public_holidays : férié ponctuel (date) ou récurrent (jour / mois chaque année), report au lundi s'il tombe un
--     dimanche (option par férié) ; un type de temps exclut les fériés de la durée sauf include_public_holidays ;
--   * acquisition automatique : un type à acquisition dont accrual_from est renseigné acquiert, pour chaque mois
--     COMPLET écoulé depuis cette date, la quantité mensuelle (au prorata des jours de présence si accrual_prorata) ;
--     rattrapage avant toute approbation et toute lecture des soldes, et chaque jour sur site (qerp_jobs) ;
--     une seule acquisition par mois et par type, jamais deux fois ;
--   * libre-service (droit hr.self_service, accordé à tous les rôles système) : un utilisateur rattaché à sa fiche
--     (employees.user_id, rattachement par les RH) saisit ses propres demandes des types ouverts au libre-service,
--     les annule tant qu'elles ne sont pas transmises, et voit ses soldes ; approval_mode du type : 'officer'
--     (détenteur de hr.time_approve), 'manager' (approbateur désigné sur la fiche, sinon responsable), 'none'
--     (approuvée à l'enregistrement, solde contrôlé).

-- 1. Droit de libre-service, accordé à tous les rôles système (il ne donne accès qu'à sa propre fiche).
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('hr.self_service', 'hr', 'self_service', 'Libre-service salarié (ses absences et soldes)')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT s.code, 'hr.self_service' FROM public.erp_system_roles s ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, 'hr.self_service' FROM public.erp_roles r WHERE r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- 2. Calendrier des jours fériés.
CREATE TABLE public.hr_public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  holiday_date date,
  recurring_month integer CHECK (recurring_month IS NULL OR recurring_month BETWEEN 1 AND 12),
  recurring_day integer CHECK (recurring_day IS NULL OR recurring_day BETWEEN 1 AND 31),
  move_if_sunday boolean NOT NULL DEFAULT false,
  reference text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_public_holidays_kind CHECK ((holiday_date IS NOT NULL AND recurring_month IS NULL AND recurring_day IS NULL)
    OR (holiday_date IS NULL AND recurring_month IS NOT NULL AND recurring_day IS NOT NULL))
);
CREATE UNIQUE INDEX hr_public_holidays_one_date ON public.hr_public_holidays (tenant_id, holiday_date) WHERE holiday_date IS NOT NULL;
CREATE UNIQUE INDEX hr_public_holidays_one_recurring ON public.hr_public_holidays (tenant_id, recurring_month, recurring_day)
  WHERE recurring_month IS NOT NULL;
ALTER TABLE public.hr_public_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_public_holidays FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hr_public_holidays TO authenticated;
CREATE POLICY hr_public_holidays_read ON public.hr_public_holidays FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Dates fériées d'une société sur un intervalle (récurrents déclinés par année, report du dimanche au lundi).
CREATE OR REPLACE FUNCTION public.hr_holiday_dates(_tenant uuid, _from date, _to date)
RETURNS TABLE (holiday date, label text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH raw AS (
    SELECT h.holiday_date d, h.label, h.move_if_sunday FROM public.hr_public_holidays h
     WHERE h.tenant_id = _tenant AND h.active AND h.holiday_date IS NOT NULL
       AND h.holiday_date BETWEEN _from - 1 AND _to
    UNION ALL
    SELECT make_date(y, h.recurring_month, h.recurring_day), h.label, h.move_if_sunday
      FROM public.hr_public_holidays h
      CROSS JOIN generate_series(extract(year FROM _from)::int, extract(year FROM _to)::int) y
     WHERE h.tenant_id = _tenant AND h.active AND h.recurring_month IS NOT NULL
       AND h.recurring_day <= extract(day FROM (make_date(y, h.recurring_month, 1) + interval '1 month - 1 day'))::int)
  SELECT DISTINCT CASE WHEN move_if_sunday AND extract(isodow FROM d) = 7 THEN d + 1 ELSE d END, label
    FROM raw WHERE (CASE WHEN move_if_sunday AND extract(isodow FROM d) = 7 THEN d + 1 ELSE d END) BETWEEN _from AND _to
$function$;
REVOKE ALL ON FUNCTION public.hr_holiday_dates(uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_hr_public_holidays(_year integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _y integer := COALESCE(_year, extract(year FROM CURRENT_DATE)::int);
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Société introuvable' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'definitions', COALESCE((SELECT jsonb_agg(to_jsonb(h) - 'tenant_id' ORDER BY COALESCE(h.recurring_month, extract(month FROM h.holiday_date)::int),
        COALESCE(h.recurring_day, extract(day FROM h.holiday_date)::int)) FROM public.hr_public_holidays h WHERE h.tenant_id = _tenant), '[]'::jsonb),
    'year', _y,
    'dates', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', d.holiday, 'label', d.label) ORDER BY d.holiday)
      FROM public.hr_holiday_dates(_tenant, make_date(_y, 1, 1), make_date(_y, 12, 31)) d), '[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.list_hr_public_holidays(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_public_holidays(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_hr_public_holiday(_input jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := NULLIF(_input ->> 'id', '')::uuid;
  _date date := NULLIF(_input ->> 'holiday_date', '')::date;
  _month integer := NULLIF(_input ->> 'recurring_month', '')::integer;
  _day integer := NULLIF(_input ->> 'recurring_day', '')::integer;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'time_settings') THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_settings' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_input ->> 'label', ''))) NOT BETWEEN 1 AND 120
     OR ((_date IS NULL) = (_month IS NULL)) OR ((_month IS NULL) <> (_day IS NULL))
     OR (_month IS NOT NULL AND (_month NOT BETWEEN 1 AND 12 OR _day NOT BETWEEN 1 AND 31
         OR _day > extract(day FROM (make_date(2000, _month, 1) + interval '1 month - 1 day'))::int)) THEN
    RAISE EXCEPTION 'Jour férié invalide : libellé et soit une date, soit un jour et un mois récurrents' USING ERRCODE = 'QG028';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.hr_public_holidays (tenant_id, label, holiday_date, recurring_month, recurring_day, move_if_sunday, reference, active, created_by)
    VALUES (_tenant, btrim(_input ->> 'label'), _date, _month, _day, COALESCE((_input ->> 'move_if_sunday')::boolean, false),
      NULLIF(btrim(_input ->> 'reference'), ''), COALESCE((_input ->> 'active')::boolean, true), auth.uid())
    RETURNING id INTO _id;
  ELSE
    UPDATE public.hr_public_holidays SET label = btrim(_input ->> 'label'), holiday_date = _date, recurring_month = _month,
      recurring_day = _day, move_if_sunday = COALESCE((_input ->> 'move_if_sunday')::boolean, false),
      reference = NULLIF(btrim(_input ->> 'reference'), ''), active = COALESCE((_input ->> 'active')::boolean, true)
     WHERE id = _id AND tenant_id = _tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Jour férié introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN _id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Ce jour férié existe déjà dans le calendrier' USING ERRCODE = 'QG028';
END $function$;
REVOKE ALL ON FUNCTION public.save_hr_public_holiday(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_hr_public_holiday(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_hr_public_holiday(_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'time_settings') THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_settings' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.hr_public_holidays WHERE id = _id AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Jour férié introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.delete_hr_public_holiday(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_hr_public_holiday(uuid) TO authenticated;

-- 3. Types : fériés, acquisition automatique, libre-service, approbation. Fiche : compte et approbateur.
ALTER TABLE public.hr_time_types
  ADD COLUMN IF NOT EXISTS include_public_holidays boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accrual_from date,
  ADD COLUMN IF NOT EXISTS accrual_prorata boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS self_service boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_mode text NOT NULL DEFAULT 'officer';
ALTER TABLE public.hr_time_types
  ADD CONSTRAINT hr_time_types_approval_mode_check CHECK (approval_mode IN ('officer', 'manager', 'none')),
  ADD CONSTRAINT hr_time_types_accrual_from_needs_accrual CHECK (accrual_from IS NULL OR accrual_per_month IS NOT NULL);

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS time_approver_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX employees_one_record_per_user ON public.employees (tenant_id, user_id) WHERE user_id IS NOT NULL;

-- Décompte d'une demande : jours ouvrés / calendaires, fériés exclus sauf si le type les inclut.
CREATE OR REPLACE FUNCTION public.hr_time_quantity(_tenant uuid, _start date, _end date, _method text, _include_holidays boolean)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT count(*)::numeric FROM generate_series(_start, _end, interval '1 day') d
   WHERE (_method = 'calendar' OR extract(isodow FROM d) < 6)
     AND (_include_holidays OR d::date NOT IN (SELECT h.holiday FROM public.hr_holiday_dates(_tenant, _start, _end) h))
$function$;
REVOKE ALL ON FUNCTION public.hr_time_quantity(uuid, date, date, text, boolean) FROM PUBLIC, anon, authenticated;

-- 4. Présence sans contexte utilisateur (tâches planifiées) : état effectif et jours présents.
CREATE OR REPLACE FUNCTION public.hr_employee_state_internal(_employee_id uuid, _as_of date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _e public.employees%ROWTYPE; _state jsonb; _m record;
BEGIN
  SELECT * INTO _e FROM public.employees WHERE id = _employee_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _state := jsonb_build_object('base_salary', _e.base_salary, 'currency', _e.currency, 'department', _e.department,
    'job_title', _e.job_title, 'contract_type', _e.contract_type, 'hire_date', _e.hire_date, 'end_date', _e.end_date,
    'status', _e.status, 'payroll_category', _e.payroll_category, 'tax_dependents', _e.tax_dependents);
  FOR _m IN SELECT m.after_values FROM public.employee_movements m
     WHERE m.tenant_id = _e.tenant_id AND m.employee_id = _employee_id AND m.status = 'approved' AND m.effective_date <= _as_of
     ORDER BY m.effective_date, m.decided_at, m.id LOOP
    _state := _state || _m.after_values;
  END LOOP;
  RETURN _state;
END $function$;
REVOKE ALL ON FUNCTION public.hr_employee_state_internal(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hr_employee_presence_days(_employee_id uuid, _start date, _end date)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _e public.employees%ROWTYPE;
  _bounds date[];
  _i integer;
  _seg_start date;
  _seg_end date;
  _state jsonb;
  _hire date;
  _left date;
  _days integer := 0;
BEGIN
  SELECT * INTO _e FROM public.employees WHERE id = _employee_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT array_agg(DISTINCT d ORDER BY d) INTO _bounds FROM (
    SELECT _start AS d UNION SELECT _e.hire_date UNION SELECT _e.end_date + 1
    UNION SELECT m.effective_date FROM public.employee_movements m WHERE m.employee_id = _employee_id AND m.status = 'approved'
    UNION SELECT NULLIF(m.after_values ->> 'end_date', '')::date + 1 FROM public.employee_movements m
     WHERE m.employee_id = _employee_id AND m.status = 'approved') b
  WHERE d IS NOT NULL AND d BETWEEN _start AND _end;
  FOR _i IN 1 .. array_length(_bounds, 1) LOOP
    _seg_start := _bounds[_i];
    _seg_end := CASE WHEN _i < array_length(_bounds, 1) THEN _bounds[_i + 1] - 1 ELSE _end END;
    _state := public.hr_employee_state_internal(_employee_id, _seg_start);
    _hire := NULLIF(_state ->> 'hire_date', '')::date;
    _left := NULLIF(_state ->> 'end_date', '')::date;
    IF COALESCE(_state ->> 'status', '') = 'active' AND (_hire IS NULL OR _hire <= _seg_start) AND (_left IS NULL OR _left >= _seg_start) THEN
      _days := _days + (_seg_end - _seg_start + 1);
    END IF;
  END LOOP;
  RETURN _days;
END $function$;
REVOKE ALL ON FUNCTION public.hr_employee_presence_days(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- 5. Acquisition : un mois (manuel ou automatique) et rattrapage des mois écoulés.
CREATE OR REPLACE FUNCTION public.hr_leave_accrue_month(_tenant uuid, _period text, _actor uuid, _only_automatic boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _start date := to_date(_period || '-01', 'YYYY-MM-DD'); _end date; _days_in_month integer; _count integer;
BEGIN
  _end := (_start + interval '1 month - 1 day')::date;
  _days_in_month := _end - _start + 1;
  INSERT INTO public.hr_leave_ledger (tenant_id, employee_id, type_id, entry_date, quantity, source, period, note, created_by)
  SELECT _tenant, x.employee_id, x.type_id, _end, x.qty, 'accrual', _period,
         'Acquisition ' || _period || CASE WHEN x.prorata AND x.days < _days_in_month THEN ' (' || x.days || ' j de présence)' ELSE '' END,
         _actor
    FROM (SELECT e.id employee_id, t.id type_id, t.accrual_prorata prorata, p.days,
                 CASE WHEN t.accrual_prorata THEN round(t.accrual_per_month * p.days / _days_in_month, 3) ELSE t.accrual_per_month END qty
            FROM public.employees e
            JOIN public.hr_time_types t ON t.tenant_id = e.tenant_id
            CROSS JOIN LATERAL (SELECT public.hr_employee_presence_days(e.id, _start, _end) AS days) p
           WHERE e.tenant_id = _tenant AND t.active AND t.tracks_balance AND t.accrual_per_month IS NOT NULL
             AND (NOT _only_automatic OR t.accrual_from IS NOT NULL)
             AND (t.accrual_from IS NULL OR _end >= t.accrual_from)
             AND p.days > 0) x
   WHERE x.qty > 0
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $function$;
REVOKE ALL ON FUNCTION public.hr_leave_accrue_month(uuid, text, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hr_leave_accrue_due(_tenant uuid, _actor uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _from date; _last date := (date_trunc('month', CURRENT_DATE) - interval '1 day')::date; _m date; _count integer := 0;
BEGIN
  SELECT min(date_trunc('month', t.accrual_from))::date INTO _from FROM public.hr_time_types t
   WHERE t.tenant_id = _tenant AND t.active AND t.tracks_balance AND t.accrual_from IS NOT NULL;
  IF _from IS NULL OR _from > _last THEN RETURN 0; END IF;
  _m := _from;
  WHILE _m <= _last LOOP
    _count := _count + public.hr_leave_accrue_month(_tenant, to_char(_m, 'YYYY-MM'), _actor, true);
    _m := (_m + interval '1 month')::date;
  END LOOP;
  RETURN _count;
END $function$;
REVOKE ALL ON FUNCTION public.hr_leave_accrue_due(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Acquisition manuelle d'un mois (V152) : désormais avec prorata et date de début.
CREATE OR REPLACE FUNCTION public.accrue_hr_leave(_period text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'time_settings') THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_settings' USING ERRCODE = '42501';
  END IF;
  IF _period IS NULL OR _period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Période invalide (format AAAA-MM)' USING ERRCODE = 'QG028';
  END IF;
  RETURN public.hr_leave_accrue_month(_tenant, _period, auth.uid(), false);
END $function$;

-- Tâche planifiée sur site : rattrapage de toutes les sociétés (exécutable par qerp_api seul).
CREATE OR REPLACE FUNCTION qerp_jobs.hr_leave_accrue_all()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _t uuid; _count integer := 0;
BEGIN
  FOR _t IN SELECT DISTINCT tenant_id FROM public.hr_time_types WHERE accrual_from IS NOT NULL AND active LOOP
    _count := _count + public.hr_leave_accrue_due(_t, NULL);
  END LOOP;
  RETURN _count;
END $function$;
REVOKE ALL ON FUNCTION qerp_jobs.hr_leave_accrue_all() FROM PUBLIC;
DO $$
DECLARE _r text;
BEGIN
  FOREACH _r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = _r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION qerp_jobs.hr_leave_accrue_all() FROM %I', _r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qerp_api') THEN
    GRANT EXECUTE ON FUNCTION qerp_jobs.hr_leave_accrue_all() TO qerp_api;
  END IF;
END $$;

-- 6. Création, approbation, lecture (V152 étendu) — logique commune RH / libre-service.
CREATE OR REPLACE FUNCTION public.hr_time_request_create(_tenant uuid, _employee uuid, _type uuid, _start date, _end date,
  _quantity numeric, _reason text, _actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _t public.hr_time_types%ROWTYPE; _max numeric; _qty numeric := _quantity; _id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = _employee AND e.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Salarié introuvable dans la société courante' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _t FROM public.hr_time_types WHERE id = _type AND tenant_id = _tenant AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Type de temps inconnu ou inactif' USING ERRCODE = 'QG028'; END IF;
  IF _start IS NULL OR _end IS NULL OR _end < _start OR date_trunc('month', _start) <> date_trunc('month', _end) THEN
    RAISE EXCEPTION 'Dates invalides : la demande porte sur un seul mois (fin ≥ début ; un congé sur deux mois = deux demandes)' USING ERRCODE = 'QG028';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'Motif obligatoire' USING ERRCODE = 'QG028'; END IF;
  IF _t.unit = 'day' THEN
    _max := public.hr_time_quantity(_tenant, _start, _end, _t.count_method, _t.include_public_holidays);
    _qty := COALESCE(_qty, _max);
    IF _max = 0 THEN RAISE EXCEPTION 'Aucun jour décompté sur ces dates (week-end ou jours fériés)' USING ERRCODE = 'QG028'; END IF;
    IF _qty <= 0 OR _qty > _max THEN
      RAISE EXCEPTION 'Quantité invalide : % jour(s) au plus sur ces dates', _max USING ERRCODE = 'QG028';
    END IF;
  ELSIF _qty IS NULL OR _qty <= 0 THEN
    RAISE EXCEPTION 'Nombre d''heures obligatoire et positif' USING ERRCODE = 'QG028';
  END IF;
  IF _t.kind IN ('absence', 'leave') AND EXISTS (
      SELECT 1 FROM public.hr_time_requests r JOIN public.hr_time_types x ON x.id = r.type_id
       WHERE r.tenant_id = _tenant AND r.employee_id = _employee AND r.status IN ('pending', 'approved')
         AND x.kind IN ('absence', 'leave') AND r.start_date <= _end AND r.end_date >= _start) THEN
    RAISE EXCEPTION 'Une absence ou un congé couvre déjà une partie de ces dates' USING ERRCODE = 'QG028';
  END IF;
  INSERT INTO public.hr_time_requests (tenant_id, employee_id, type_id, start_date, end_date, quantity, reason, created_by)
  VALUES (_tenant, _employee, _type, _start, _end, _qty, btrim(_reason), _actor)
  RETURNING id INTO _id;
  IF _t.approval_mode = 'none' THEN
    PERFORM public.hr_time_request_approve(_id, _actor, 'Approbation automatique (type sans validation)');
  END IF;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.hr_time_request_create(uuid, uuid, uuid, date, date, numeric, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hr_time_request_approve(_id uuid, _actor uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _r public.hr_time_requests%ROWTYPE; _t public.hr_time_types%ROWTYPE; _balance numeric;
BEGIN
  SELECT * INTO _r FROM public.hr_time_requests WHERE id = _id FOR UPDATE;
  SELECT * INTO _t FROM public.hr_time_types WHERE id = _r.type_id;
  IF _t.tracks_balance THEN
    PERFORM public.hr_leave_accrue_due(_r.tenant_id, _actor);
    PERFORM pg_advisory_xact_lock(hashtext(_r.employee_id::text || _r.type_id::text));
    _balance := public.hr_leave_balance(_r.tenant_id, _r.employee_id, _r.type_id);
    IF NOT _t.allow_negative_balance AND _balance < _r.quantity THEN
      RAISE EXCEPTION 'Solde insuffisant : % disponible(s), % demandé(s)', _balance, _r.quantity USING ERRCODE = 'QG028';
    END IF;
    INSERT INTO public.hr_leave_ledger (tenant_id, employee_id, type_id, entry_date, quantity, source, request_id, created_by)
    VALUES (_r.tenant_id, _r.employee_id, _r.type_id, _r.start_date, -_r.quantity, 'request', _id, _actor);
  END IF;
  UPDATE public.hr_time_requests SET status = 'approved', decided_by = _actor, decided_at = now(),
         decision_reason = NULLIF(btrim(_reason), '') WHERE id = _id;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.hr_time_request_approve(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_hr_time_request(_employee uuid, _type uuid, _start date, _end date,
  _quantity numeric, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'time_request') THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_request' USING ERRCODE = '42501';
  END IF;
  RETURN public.hr_time_request_create(_tenant, _employee, _type, _start, _end, _quantity, _reason, auth.uid());
END $function$;

CREATE OR REPLACE FUNCTION public.decide_hr_time_request(_id uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _r public.hr_time_requests%ROWTYPE;
  _t public.hr_time_types%ROWTYPE;
  _manager uuid;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Société introuvable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _r FROM public.hr_time_requests WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _t FROM public.hr_time_types WHERE id = _r.type_id;
  SELECT e.time_approver_user_id INTO _manager FROM public.employees e WHERE e.id = _r.employee_id;
  -- Responsable des congés (droit), ou approbateur désigné sur la fiche quand le type est en mode « manager ».
  IF NOT public.has_hr_perm(auth.uid(), 'time_approve')
     AND NOT (_t.approval_mode = 'manager' AND _manager IS NOT NULL AND _manager = auth.uid()) THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_approve (ou approbateur désigné du salarié)' USING ERRCODE = '42501';
  END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Seule une demande en attente se décide' USING ERRCODE = 'QG028'; END IF;
  IF _t.requires_second_person AND _r.created_by = auth.uid() THEN
    RAISE EXCEPTION 'Séparation des tâches : l''auteur de la demande ne peut pas la décider' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.employees e WHERE e.id = _r.employee_id AND e.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Séparation des tâches : un salarié ne décide pas ses propres demandes' USING ERRCODE = '42501';
  END IF;
  IF NOT _approve THEN
    IF length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'Motif de rejet obligatoire' USING ERRCODE = 'QG028'; END IF;
    UPDATE public.hr_time_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(_reason)
     WHERE id = _id;
    RETURN _id;
  END IF;
  RETURN public.hr_time_request_approve(_id, auth.uid(), _reason);
END $function$;

-- Soldes : rattrapage des acquisitions automatiques avant lecture.
CREATE OR REPLACE FUNCTION public.list_hr_leave_balances()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT (public.has_hr_perm(auth.uid(), 'time_request') OR public.has_hr_perm(auth.uid(), 'time_approve')
      OR public.has_hr_perm(auth.uid(), 'time_settings')) THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_request' USING ERRCODE = '42501';
  END IF;
  PERFORM public.hr_leave_accrue_due(_tenant, auth.uid());
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('employee_id', e.id, 'employee_name', e.first_name || ' ' || e.last_name,
      'matricule', e.matricule, 'type_id', t.id, 'type_label', t.label, 'unit', t.unit,
      'acquired', COALESCE(b.acquired, 0), 'taken', COALESCE(b.taken, 0), 'balance', COALESCE(b.balance, 0))
      ORDER BY e.matricule, t.sort_order)
    FROM public.employees e CROSS JOIN public.hr_time_types t
    LEFT JOIN LATERAL (SELECT sum(l.quantity) FILTER (WHERE l.quantity > 0) acquired,
                              -sum(l.quantity) FILTER (WHERE l.quantity < 0) taken, sum(l.quantity) balance
                         FROM public.hr_leave_ledger l WHERE l.employee_id = e.id AND l.type_id = t.id) b ON true
   WHERE e.tenant_id = _tenant AND t.tenant_id = _tenant AND t.tracks_balance
     AND (e.status = 'active' OR b.balance IS NOT NULL)), '[]'::jsonb);
END $function$;

-- Types : nouveaux paramètres.
CREATE OR REPLACE FUNCTION public.save_hr_time_type(_input jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := NULLIF(_input ->> 'id', '')::uuid;
  _code text := lower(btrim(_input ->> 'code'));
  _component uuid := NULLIF(_input ->> 'component_id', '')::uuid;
  _method text;
  _tracks boolean := COALESCE((_input ->> 'tracks_balance')::boolean, false);
  _accrual numeric := NULLIF(_input ->> 'accrual_per_month', '')::numeric;
  _from date := NULLIF(_input ->> 'accrual_from', '')::date;
  _mode text := COALESCE(NULLIF(_input ->> 'approval_mode', ''), 'officer');
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'time_settings') THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_settings' USING ERRCODE = '42501';
  END IF;
  IF _code IS NULL OR _code !~ '^[a-z0-9][a-z0-9._-]{0,39}$' OR length(btrim(COALESCE(_input ->> 'label', ''))) NOT BETWEEN 1 AND 120
     OR COALESCE(_input ->> 'kind', '') NOT IN ('absence', 'leave', 'overtime')
     OR COALESCE(_input ->> 'unit', '') NOT IN ('day', 'hour')
     OR COALESCE(_input ->> 'count_method', 'working') NOT IN ('calendar', 'working')
     OR _mode NOT IN ('officer', 'manager', 'none') THEN
    RAISE EXCEPTION 'Type de temps invalide (code, libellé, nature, unité, décompte, approbation)' USING ERRCODE = 'QG028';
  END IF;
  IF _accrual IS NOT NULL AND (_accrual <= 0 OR NOT _tracks) THEN
    RAISE EXCEPTION 'Une acquisition mensuelle demande le suivi d''un solde et une valeur positive' USING ERRCODE = 'QG028';
  END IF;
  IF _from IS NOT NULL AND _accrual IS NULL THEN
    RAISE EXCEPTION 'L''acquisition automatique demande une quantité mensuelle' USING ERRCODE = 'QG028';
  END IF;
  IF _component IS NOT NULL THEN
    SELECT c.calculation_method INTO _method FROM public.hr_payroll_components c WHERE c.id = _component AND c.tenant_id = _tenant;
    IF _method IS NULL THEN RAISE EXCEPTION 'Rubrique de paie introuvable dans la société' USING ERRCODE = 'QG028'; END IF;
    IF _method NOT IN ('quantity_rate', 'formula') THEN
      RAISE EXCEPTION 'La rubrique liée doit être en « quantité × taux » ou « formule » : la quantité vient du temps approuvé' USING ERRCODE = 'QG028';
    END IF;
  END IF;
  IF _id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.hr_time_types t WHERE t.tenant_id = _tenant AND t.code = _code) THEN
      RAISE EXCEPTION 'Le type « % » existe déjà : modifiez-le', _code USING ERRCODE = 'QG028';
    END IF;
    INSERT INTO public.hr_time_types (tenant_id, code, label, kind, unit, count_method, component_id, tracks_balance,
      accrual_per_month, allow_negative_balance, requires_second_person, active, sort_order,
      include_public_holidays, accrual_from, accrual_prorata, self_service, approval_mode)
    VALUES (_tenant, _code, btrim(_input ->> 'label'), _input ->> 'kind', _input ->> 'unit',
      COALESCE(NULLIF(_input ->> 'count_method', ''), 'working'), _component, _tracks, _accrual,
      COALESCE((_input ->> 'allow_negative_balance')::boolean, false), COALESCE((_input ->> 'requires_second_person')::boolean, true),
      COALESCE((_input ->> 'active')::boolean, true), COALESCE(NULLIF(_input ->> 'sort_order', '')::integer, 0),
      COALESCE((_input ->> 'include_public_holidays')::boolean, false), _from, COALESCE((_input ->> 'accrual_prorata')::boolean, false),
      COALESCE((_input ->> 'self_service')::boolean, false), _mode)
    RETURNING id INTO _id;
  ELSE
    UPDATE public.hr_time_types SET code = _code, label = btrim(_input ->> 'label'), kind = _input ->> 'kind', unit = _input ->> 'unit',
      count_method = COALESCE(NULLIF(_input ->> 'count_method', ''), 'working'), component_id = _component, tracks_balance = _tracks,
      accrual_per_month = _accrual, allow_negative_balance = COALESCE((_input ->> 'allow_negative_balance')::boolean, false),
      requires_second_person = COALESCE((_input ->> 'requires_second_person')::boolean, true),
      active = COALESCE((_input ->> 'active')::boolean, true), sort_order = COALESCE(NULLIF(_input ->> 'sort_order', '')::integer, 0),
      include_public_holidays = COALESCE((_input ->> 'include_public_holidays')::boolean, false), accrual_from = _from,
      accrual_prorata = COALESCE((_input ->> 'accrual_prorata')::boolean, false),
      self_service = COALESCE((_input ->> 'self_service')::boolean, false), approval_mode = _mode, updated_at = now()
     WHERE id = _id AND tenant_id = _tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Type introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN _id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Code de type de temps déjà utilisé' USING ERRCODE = 'QG028';
END $function$;

-- 7. Rattachement des comptes et approbateurs (RH).
CREATE OR REPLACE FUNCTION public.set_hr_employee_self_service(_employee uuid, _user uuid, _approver uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_employees') THEN
    RAISE EXCEPTION 'Permission refusée : hr.manage_employees' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = _employee AND e.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Salarié introuvable dans la société courante' USING ERRCODE = '42501';
  END IF;
  IF (_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user AND p.tenant_id = _tenant))
     OR (_approver IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _approver AND p.tenant_id = _tenant)) THEN
    RAISE EXCEPTION 'Le compte et l''approbateur doivent être des utilisateurs de la société' USING ERRCODE = 'QG028';
  END IF;
  IF _user IS NOT NULL AND _user = _approver THEN
    RAISE EXCEPTION 'Un salarié ne peut pas être son propre approbateur' USING ERRCODE = 'QG028';
  END IF;
  UPDATE public.employees SET user_id = _user, time_approver_user_id = _approver, updated_at = now()
   WHERE id = _employee AND tenant_id = _tenant;
  RETURN _employee;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Ce compte est déjà rattaché à une autre fiche salarié' USING ERRCODE = 'QG028';
END $function$;
REVOKE ALL ON FUNCTION public.set_hr_employee_self_service(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_hr_employee_self_service(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_hr_self_service_links()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_employees') THEN
    RAISE EXCEPTION 'Permission refusée : hr.manage_employees' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('employee_id', e.id, 'matricule', e.matricule,
      'employee_name', e.first_name || ' ' || e.last_name, 'user_id', e.user_id, 'user_name', u.full_name,
      'approver_user_id', e.time_approver_user_id, 'approver_name', a.full_name) ORDER BY e.matricule)
    FROM public.employees e LEFT JOIN public.profiles u ON u.id = e.user_id LEFT JOIN public.profiles a ON a.id = e.time_approver_user_id
   WHERE e.tenant_id = _tenant), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.list_hr_self_service_links() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_self_service_links() TO authenticated;

-- 8. Libre-service : sa fiche, ses types, ses demandes, ses soldes ; et les demandes qu'on approuve comme manager.
CREATE OR REPLACE FUNCTION public.hr_my_employee_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT e.id FROM public.employees e WHERE e.tenant_id = public.get_user_tenant_id(auth.uid()) AND e.user_id = auth.uid()
$function$;
REVOKE ALL ON FUNCTION public.hr_my_employee_id() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_hr_self_service()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _emp uuid := public.hr_my_employee_id(); _e public.employees%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'self_service') THEN
    RAISE EXCEPTION 'Permission refusée : hr.self_service' USING ERRCODE = '42501';
  END IF;
  IF _emp IS NULL THEN
    RETURN jsonb_build_object('employee', NULL, 'types', '[]'::jsonb, 'requests', '[]'::jsonb, 'balances', '[]'::jsonb,
      'to_approve', public.hr_manager_pending(_tenant));
  END IF;
  PERFORM public.hr_leave_accrue_due(_tenant, NULL);
  SELECT * INTO _e FROM public.employees WHERE id = _emp;
  RETURN jsonb_build_object(
    'employee', jsonb_build_object('id', _e.id, 'matricule', _e.matricule, 'name', _e.first_name || ' ' || _e.last_name,
      'approver_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = _e.time_approver_user_id)),
    'types', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'label', t.label, 'kind', t.kind, 'unit', t.unit,
        'tracks_balance', t.tracks_balance, 'approval_mode', t.approval_mode) ORDER BY t.sort_order, t.label)
      FROM public.hr_time_types t WHERE t.tenant_id = _tenant AND t.active AND t.self_service), '[]'::jsonb),
    'requests', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'type_label', t.label, 'unit', t.unit, 'start_date', r.start_date,
        'end_date', r.end_date, 'quantity', r.quantity, 'reason', r.reason, 'status', r.status, 'decision_reason', r.decision_reason,
        'transferred', r.payroll_run_id IS NOT NULL) ORDER BY r.start_date DESC, r.created_at DESC)
      FROM public.hr_time_requests r JOIN public.hr_time_types t ON t.id = r.type_id WHERE r.employee_id = _emp), '[]'::jsonb),
    'balances', COALESCE((SELECT jsonb_agg(jsonb_build_object('type_id', t.id, 'type_label', t.label, 'unit', t.unit,
        'balance', public.hr_leave_balance(_tenant, _emp, t.id)) ORDER BY t.sort_order)
      FROM public.hr_time_types t WHERE t.tenant_id = _tenant AND t.tracks_balance AND t.active), '[]'::jsonb),
    'to_approve', public.hr_manager_pending(_tenant));
END $function$;

CREATE OR REPLACE FUNCTION public.hr_manager_pending(_tenant uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'employee_name', e.first_name || ' ' || e.last_name, 'matricule', e.matricule,
      'type_label', t.label, 'unit', t.unit, 'start_date', r.start_date, 'end_date', r.end_date, 'quantity', r.quantity, 'reason', r.reason)
      ORDER BY r.start_date), '[]'::jsonb)
    FROM public.hr_time_requests r JOIN public.employees e ON e.id = r.employee_id JOIN public.hr_time_types t ON t.id = r.type_id
   WHERE r.tenant_id = _tenant AND r.status = 'pending' AND t.approval_mode = 'manager' AND e.time_approver_user_id = auth.uid()
$function$;
REVOKE ALL ON FUNCTION public.hr_manager_pending(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_hr_self_service() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_hr_self_service() TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_my_time_request(_type uuid, _start date, _end date, _quantity numeric, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _emp uuid := public.hr_my_employee_id();
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'self_service') THEN
    RAISE EXCEPTION 'Permission refusée : hr.self_service' USING ERRCODE = '42501';
  END IF;
  IF _emp IS NULL THEN RAISE EXCEPTION 'Votre compte n''est rattaché à aucune fiche salarié : contactez les RH' USING ERRCODE = 'QG028'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hr_time_types t WHERE t.id = _type AND t.tenant_id = _tenant AND t.self_service AND t.active) THEN
    RAISE EXCEPTION 'Ce type ne se demande pas en libre-service' USING ERRCODE = 'QG028';
  END IF;
  RETURN public.hr_time_request_create(_tenant, _emp, _type, _start, _end, _quantity, _reason, auth.uid());
END $function$;
REVOKE ALL ON FUNCTION public.submit_my_time_request(uuid, date, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_my_time_request(uuid, date, date, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_time_request(_id uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _emp uuid := public.hr_my_employee_id(); _r public.hr_time_requests%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR _emp IS NULL OR NOT public.has_hr_perm(auth.uid(), 'self_service') THEN
    RAISE EXCEPTION 'Permission refusée : hr.self_service' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _r FROM public.hr_time_requests WHERE id = _id AND tenant_id = _tenant AND employee_id = _emp FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande introuvable parmi les vôtres' USING ERRCODE = '42501'; END IF;
  IF _r.status NOT IN ('pending', 'approved') OR _r.payroll_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'Demande non annulable (décidée, annulée ou déjà transmise à la paie)' USING ERRCODE = 'QG028';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'Motif d''annulation obligatoire' USING ERRCODE = 'QG028'; END IF;
  IF _r.status = 'approved' AND EXISTS (SELECT 1 FROM public.hr_leave_ledger l WHERE l.request_id = _id AND l.source = 'request') THEN
    INSERT INTO public.hr_leave_ledger (tenant_id, employee_id, type_id, entry_date, quantity, source, request_id, note, created_by)
    VALUES (_tenant, _r.employee_id, _r.type_id, _r.start_date, _r.quantity, 'cancellation', _id, btrim(_reason), auth.uid());
  END IF;
  UPDATE public.hr_time_requests SET status = 'cancelled', decision_reason = btrim(_reason),
         decided_by = COALESCE(decided_by, auth.uid()), decided_at = COALESCE(decided_at, now()) WHERE id = _id;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.cancel_my_time_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_time_request(uuid, text) TO authenticated;

-- Liste RH : les nouveaux champs des types.
CREATE OR REPLACE FUNCTION public.list_hr_time_types()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Société introuvable' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t) - 'tenant_id' || jsonb_build_object('component_code', c.code, 'component_label', c.label)
      ORDER BY t.sort_order, t.label)
    FROM public.hr_time_types t LEFT JOIN public.hr_payroll_components c ON c.id = t.component_id
   WHERE t.tenant_id = _tenant), '[]'::jsonb);
END $function$;

SELECT public.install_tenant_isolation_triggers();
