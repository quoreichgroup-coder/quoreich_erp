-- V152 — RH : absences, congés et heures supplémentaires, transmis à la paie (audit docs/audit-erp/32, P2).
--
-- Constat : aucune table, fonction ni écran ne gérait les absences, congés ou heures supplémentaires ; une absence non
-- payée ou des heures supplémentaires ne pouvaient passer en paie que par une variable saisie à la main.
-- Références : Odoo Congés (types d'absence liés à un type de prestation de paie, allocations et acquisition mensuelle,
-- approbation par un responsable, absences non payées), SAP Time Management (types d'absence, contingents) ;
-- Burkina Faso, Code du travail (loi 028-2008/AN) : congé acquis par mois de service, heures supplémentaires majorées —
-- les durées et majorations ne sont PAS préremplies (les sources consultées se contredisent) : la société les saisit.
--
-- Règles :
--   * hr_time_types (droit hr.time_settings) : nature absence / congé / heures supplémentaires, unité jour ou heure,
--     décompte calendaire ou jours ouvrés (lundi-vendredi), rubrique de paie liée (quantité × taux ou formule : la
--     quantité vient du temps approuvé), suivi d'un solde, acquisition mensuelle, solde négatif permis ou non,
--     approbation par une seconde personne ;
--   * hr_time_requests : demande sur un seul mois (droit hr.time_request), approbation ou rejet motivé (hr.time_approve,
--     jamais par l'auteur quand le type l'exige), solde contrôlé à l'approbation, chevauchement d'absences refusé,
--     annulation tant qu'elle n'est pas transmise à un cycle ;
--   * hr_leave_ledger : acquisitions (une par mois et par type), prises, annulations, ajustements motivés ;
--   * transfer_hr_time_to_payroll(cycle) : chaque demande approuvée du mois dont le type a une rubrique devient une
--     variable approuvée du cycle (une par demande, montant = quantité) ; le calcul V150 l'applique.

-- 1. Droits.
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('hr.time_request', 'hr', 'time_request', 'Saisir les absences, congés et heures'),
  ('hr.time_approve', 'hr', 'time_approve', 'Approuver les absences, congés et heures'),
  ('hr.time_settings', 'hr', 'time_settings', 'Paramétrer les absences, congés et heures')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES ('admin', 'hr.time_request'), ('admin', 'hr.time_approve'), ('admin', 'hr.time_settings'),
  ('hr_admin', 'hr.time_request'), ('hr_admin', 'hr.time_approve'), ('hr_admin', 'hr.time_settings'),
  ('hr_clerk', 'hr.time_request'), ('hr_approver', 'hr.time_approve')) AS v(r, p)
WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r
JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
WHERE r.is_system AND sp.permission_code IN ('hr.time_request', 'hr.time_approve', 'hr.time_settings')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- 2. Types de temps.
CREATE TABLE public.hr_time_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('absence', 'leave', 'overtime')),
  unit text NOT NULL CHECK (unit IN ('day', 'hour')),
  count_method text NOT NULL DEFAULT 'working' CHECK (count_method IN ('calendar', 'working')),
  component_id uuid,
  tracks_balance boolean NOT NULL DEFAULT false,
  accrual_per_month numeric(8,3) CHECK (accrual_per_month IS NULL OR accrual_per_month > 0),
  allow_negative_balance boolean NOT NULL DEFAULT false,
  requires_second_person boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CONSTRAINT hr_time_types_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT hr_time_types_accrual_needs_balance CHECK (accrual_per_month IS NULL OR tracks_balance),
  FOREIGN KEY (component_id, tenant_id) REFERENCES public.hr_payroll_components (id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE public.hr_time_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  type_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  quantity numeric(10,2) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  variable_id uuid REFERENCES public.payroll_run_variables(id) ON DELETE SET NULL,
  CONSTRAINT hr_time_requests_dates CHECK (end_date >= start_date AND date_trunc('month', start_date) = date_trunc('month', end_date)),
  CONSTRAINT hr_time_requests_id_tenant UNIQUE (id, tenant_id),
  FOREIGN KEY (type_id, tenant_id) REFERENCES public.hr_time_types (id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX hr_time_requests_employee_idx ON public.hr_time_requests (tenant_id, employee_id, start_date);
CREATE INDEX hr_time_requests_status_idx ON public.hr_time_requests (tenant_id, status, start_date);

CREATE TABLE public.hr_leave_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  type_id uuid NOT NULL,
  entry_date date NOT NULL,
  quantity numeric(10,3) NOT NULL CHECK (quantity <> 0),
  source text NOT NULL CHECK (source IN ('accrual', 'request', 'cancellation', 'adjustment')),
  request_id uuid REFERENCES public.hr_time_requests(id) ON DELETE RESTRICT,
  period text CHECK (period IS NULL OR period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (type_id, tenant_id) REFERENCES public.hr_time_types (id, tenant_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX hr_leave_ledger_one_accrual_per_month
  ON public.hr_leave_ledger (tenant_id, employee_id, type_id, period) WHERE source = 'accrual';
CREATE INDEX hr_leave_ledger_balance_idx ON public.hr_leave_ledger (tenant_id, employee_id, type_id);

ALTER TABLE public.hr_time_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_time_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_time_types, public.hr_time_requests, public.hr_leave_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hr_time_types, public.hr_time_requests, public.hr_leave_ledger TO authenticated;
CREATE POLICY hr_time_types_read ON public.hr_time_types FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY hr_time_requests_read ON public.hr_time_requests FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_hr_perm(auth.uid(), 'time_request')
    OR public.has_hr_perm(auth.uid(), 'time_approve') OR public.has_hr_perm(auth.uid(), 'view_payroll')));
CREATE POLICY hr_leave_ledger_read ON public.hr_leave_ledger FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_hr_perm(auth.uid(), 'time_request')
    OR public.has_hr_perm(auth.uid(), 'time_approve') OR public.has_hr_perm(auth.uid(), 'time_settings')));

CREATE OR REPLACE FUNCTION public.reject_hr_leave_ledger_change() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Le registre des congés est immuable : passer un ajustement motivé' USING ERRCODE = 'QG028';
END $function$;
CREATE TRIGGER trg_hr_leave_ledger_immutable BEFORE UPDATE OR DELETE ON public.hr_leave_ledger
  FOR EACH ROW EXECUTE FUNCTION public.reject_hr_leave_ledger_change();

-- 3. Décompte : jours calendaires, ou jours ouvrés du lundi au vendredi.
CREATE OR REPLACE FUNCTION public.hr_time_days(_start date, _end date, _method text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE WHEN _method = 'calendar' THEN (_end - _start + 1)::numeric
    ELSE (SELECT count(*)::numeric FROM generate_series(_start, _end, interval '1 day') d WHERE extract(isodow FROM d) < 6) END
$function$;
GRANT EXECUTE ON FUNCTION public.hr_time_days(date, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.hr_leave_balance(_tenant uuid, _employee uuid, _type uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(sum(quantity), 0) FROM public.hr_leave_ledger
   WHERE tenant_id = _tenant AND employee_id = _employee AND type_id = _type
$function$;
REVOKE ALL ON FUNCTION public.hr_leave_balance(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 4. Paramétrage des types.
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
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'time_settings') THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_settings' USING ERRCODE = '42501';
  END IF;
  IF _code IS NULL OR _code !~ '^[a-z0-9][a-z0-9._-]{0,39}$' OR length(btrim(COALESCE(_input ->> 'label', ''))) NOT BETWEEN 1 AND 120
     OR COALESCE(_input ->> 'kind', '') NOT IN ('absence', 'leave', 'overtime')
     OR COALESCE(_input ->> 'unit', '') NOT IN ('day', 'hour')
     OR COALESCE(_input ->> 'count_method', 'working') NOT IN ('calendar', 'working') THEN
    RAISE EXCEPTION 'Type de temps invalide (code, libellé, nature, unité, décompte)' USING ERRCODE = 'QG028';
  END IF;
  IF _accrual IS NOT NULL AND (_accrual <= 0 OR NOT _tracks) THEN
    RAISE EXCEPTION 'Une acquisition mensuelle demande le suivi d''un solde et une valeur positive' USING ERRCODE = 'QG028';
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
      accrual_per_month, allow_negative_balance, requires_second_person, active, sort_order)
    VALUES (_tenant, _code, btrim(_input ->> 'label'), _input ->> 'kind', _input ->> 'unit',
      COALESCE(NULLIF(_input ->> 'count_method', ''), 'working'), _component, _tracks, _accrual,
      COALESCE((_input ->> 'allow_negative_balance')::boolean, false), COALESCE((_input ->> 'requires_second_person')::boolean, true),
      COALESCE((_input ->> 'active')::boolean, true), COALESCE(NULLIF(_input ->> 'sort_order', '')::integer, 0))
    RETURNING id INTO _id;
  ELSE
    UPDATE public.hr_time_types SET code = _code, label = btrim(_input ->> 'label'), kind = _input ->> 'kind', unit = _input ->> 'unit',
      count_method = COALESCE(NULLIF(_input ->> 'count_method', ''), 'working'), component_id = _component, tracks_balance = _tracks,
      accrual_per_month = _accrual, allow_negative_balance = COALESCE((_input ->> 'allow_negative_balance')::boolean, false),
      requires_second_person = COALESCE((_input ->> 'requires_second_person')::boolean, true),
      active = COALESCE((_input ->> 'active')::boolean, true), sort_order = COALESCE(NULLIF(_input ->> 'sort_order', '')::integer, 0),
      updated_at = now()
     WHERE id = _id AND tenant_id = _tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Type introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN _id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Code de type de temps déjà utilisé' USING ERRCODE = 'QG028';
END $function$;
REVOKE ALL ON FUNCTION public.save_hr_time_type(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_hr_time_type(jsonb) TO authenticated;

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
REVOKE ALL ON FUNCTION public.list_hr_time_types() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_time_types() TO authenticated;

-- 5. Demandes.
CREATE OR REPLACE FUNCTION public.submit_hr_time_request(_employee uuid, _type uuid, _start date, _end date,
  _quantity numeric, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _t public.hr_time_types%ROWTYPE;
  _max numeric;
  _qty numeric := _quantity;
  _id uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'time_request') THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_request' USING ERRCODE = '42501';
  END IF;
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
    _max := public.hr_time_days(_start, _end, _t.count_method);
    _qty := COALESCE(_qty, _max);
    IF _max = 0 THEN RAISE EXCEPTION 'Aucun jour décompté sur ces dates (week-end ?)' USING ERRCODE = 'QG028'; END IF;
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
  VALUES (_tenant, _employee, _type, _start, _end, _qty, btrim(_reason), auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.submit_hr_time_request(uuid, uuid, date, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_hr_time_request(uuid, uuid, date, date, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_hr_time_request(_id uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _r public.hr_time_requests%ROWTYPE;
  _t public.hr_time_types%ROWTYPE;
  _balance numeric;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'time_approve') THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_approve' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _r FROM public.hr_time_requests WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Seule une demande en attente se décide' USING ERRCODE = 'QG028'; END IF;
  SELECT * INTO _t FROM public.hr_time_types WHERE id = _r.type_id;
  IF _t.requires_second_person AND _r.created_by = auth.uid() THEN
    RAISE EXCEPTION 'Séparation des tâches : l''auteur de la demande ne peut pas la décider' USING ERRCODE = '42501';
  END IF;
  IF NOT _approve THEN
    IF length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'Motif de rejet obligatoire' USING ERRCODE = 'QG028'; END IF;
    UPDATE public.hr_time_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(_reason)
     WHERE id = _id;
    RETURN _id;
  END IF;
  IF _t.tracks_balance THEN
    PERFORM pg_advisory_xact_lock(hashtext(_r.employee_id::text || _r.type_id::text));
    _balance := public.hr_leave_balance(_tenant, _r.employee_id, _r.type_id);
    IF NOT _t.allow_negative_balance AND _balance < _r.quantity THEN
      RAISE EXCEPTION 'Solde insuffisant : % disponible(s), % demandé(s)', _balance, _r.quantity USING ERRCODE = 'QG028';
    END IF;
    INSERT INTO public.hr_leave_ledger (tenant_id, employee_id, type_id, entry_date, quantity, source, request_id, created_by)
    VALUES (_tenant, _r.employee_id, _r.type_id, _r.start_date, -_r.quantity, 'request', _id, auth.uid());
  END IF;
  UPDATE public.hr_time_requests SET status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_reason = NULLIF(btrim(_reason), '') WHERE id = _id;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.decide_hr_time_request(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_hr_time_request(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_hr_time_request(_id uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _r public.hr_time_requests%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT (public.has_hr_perm(auth.uid(), 'time_request') OR public.has_hr_perm(auth.uid(), 'time_approve')) THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_request' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'Motif d''annulation obligatoire' USING ERRCODE = 'QG028'; END IF;
  SELECT * INTO _r FROM public.hr_time_requests WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  IF _r.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'Demande déjà rejetée ou annulée' USING ERRCODE = 'QG028'; END IF;
  IF _r.payroll_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'Demande déjà transmise à un cycle de paie : la retirer en supprimant ou régularisant le cycle' USING ERRCODE = 'QG028';
  END IF;
  IF _r.status = 'approved' AND EXISTS (SELECT 1 FROM public.hr_leave_ledger l WHERE l.request_id = _id AND l.source = 'request') THEN
    INSERT INTO public.hr_leave_ledger (tenant_id, employee_id, type_id, entry_date, quantity, source, request_id, note, created_by)
    VALUES (_tenant, _r.employee_id, _r.type_id, _r.start_date, _r.quantity, 'cancellation', _id, btrim(_reason), auth.uid());
  END IF;
  UPDATE public.hr_time_requests SET status = 'cancelled', decision_reason = btrim(_reason),
         decided_by = COALESCE(decided_by, auth.uid()), decided_at = COALESCE(decided_at, now()) WHERE id = _id;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.cancel_hr_time_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_hr_time_request(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_hr_time_requests(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT (public.has_hr_perm(auth.uid(), 'time_request') OR public.has_hr_perm(auth.uid(), 'time_approve')
      OR public.has_hr_perm(auth.uid(), 'view_payroll')) THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_request' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(r) - 'tenant_id' || jsonb_build_object(
      'employee_name', e.first_name || ' ' || e.last_name, 'matricule', e.matricule,
      'type_code', t.code, 'type_label', t.label, 'type_kind', t.kind, 'unit', t.unit,
      'payroll_period', p.period) ORDER BY r.start_date DESC, r.created_at DESC)
    FROM public.hr_time_requests r
    JOIN public.employees e ON e.id = r.employee_id
    JOIN public.hr_time_types t ON t.id = r.type_id
    LEFT JOIN public.payroll_runs p ON p.id = r.payroll_run_id
   WHERE r.tenant_id = _tenant AND (_from IS NULL OR r.end_date >= _from) AND (_to IS NULL OR r.start_date <= _to)), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.list_hr_time_requests(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_time_requests(date, date) TO authenticated;

-- 6. Soldes : acquisition mensuelle, ajustement, lecture.
CREATE OR REPLACE FUNCTION public.accrue_hr_leave(_period text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _start date;
  _end date;
  _count integer;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'time_settings') THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_settings' USING ERRCODE = '42501';
  END IF;
  IF _period IS NULL OR _period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Période invalide (format AAAA-MM)' USING ERRCODE = 'QG028';
  END IF;
  _start := to_date(_period || '-01', 'YYYY-MM-DD');
  _end := (_start + interval '1 month - 1 day')::date;
  -- Acquis pour chaque salarié présent au moins un jour du mois (même règle de présence que la paie).
  INSERT INTO public.hr_leave_ledger (tenant_id, employee_id, type_id, entry_date, quantity, source, period, note, created_by)
  SELECT _tenant, e.id, t.id, _end, t.accrual_per_month, 'accrual', _period, 'Acquisition ' || _period, auth.uid()
    FROM public.employees e CROSS JOIN public.hr_time_types t
   WHERE e.tenant_id = _tenant AND t.tenant_id = _tenant AND t.active AND t.tracks_balance AND t.accrual_per_month IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.payroll_presence_segments(e.id, _start, _end) s WHERE s.present)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $function$;
REVOKE ALL ON FUNCTION public.accrue_hr_leave(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accrue_hr_leave(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.adjust_hr_leave_balance(_employee uuid, _type uuid, _quantity numeric, _date date, _note text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _id bigint;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'time_settings') THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_settings' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(_quantity, 0) = 0 OR _date IS NULL OR length(btrim(COALESCE(_note, ''))) < 3 THEN
    RAISE EXCEPTION 'Quantité non nulle, date et motif obligatoires (reprise de solde, correction…)' USING ERRCODE = 'QG028';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = _employee AND e.tenant_id = _tenant)
     OR NOT EXISTS (SELECT 1 FROM public.hr_time_types t WHERE t.id = _type AND t.tenant_id = _tenant AND t.tracks_balance) THEN
    RAISE EXCEPTION 'Salarié ou type à solde introuvable dans la société' USING ERRCODE = 'QG028';
  END IF;
  INSERT INTO public.hr_leave_ledger (tenant_id, employee_id, type_id, entry_date, quantity, source, note, created_by)
  VALUES (_tenant, _employee, _type, _date, _quantity, 'adjustment', btrim(_note), auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.adjust_hr_leave_balance(uuid, uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_hr_leave_balance(uuid, uuid, numeric, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_hr_leave_balances()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT (public.has_hr_perm(auth.uid(), 'time_request') OR public.has_hr_perm(auth.uid(), 'time_approve')
      OR public.has_hr_perm(auth.uid(), 'time_settings')) THEN
    RAISE EXCEPTION 'Permission refusée : hr.time_request' USING ERRCODE = '42501';
  END IF;
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
REVOKE ALL ON FUNCTION public.list_hr_leave_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_leave_balances() TO authenticated;

-- 7. Transmission à la paie : une variable approuvée par demande, sur la rubrique du type.
CREATE OR REPLACE FUNCTION public.transfer_hr_time_to_payroll(_run_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _run public.payroll_runs%ROWTYPE;
  _start date;
  _end date;
  _r record;
  _variable uuid;
  _count integer := 0;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'create_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusée : hr.create_payroll_run' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Le temps se transmet à un cycle brouillon' USING ERRCODE = 'QG028'; END IF;
  _start := to_date(_run.period || '-01', 'YYYY-MM-DD');
  _end := (_start + interval '1 month - 1 day')::date;
  FOR _r IN
    SELECT r.*, t.component_id, t.label type_label, t.unit
      FROM public.hr_time_requests r JOIN public.hr_time_types t ON t.id = r.type_id
     WHERE r.tenant_id = _tenant AND r.status = 'approved' AND r.payroll_run_id IS NULL AND t.component_id IS NOT NULL
       AND r.start_date BETWEEN _start AND _end
     ORDER BY r.start_date, r.id FOR UPDATE OF r
  LOOP
    INSERT INTO public.payroll_run_variables (tenant_id, run_id, employee_id, component_id, source_key, amount, reason,
      status, created_by, decided_by, decided_at, decision_reason)
    VALUES (_tenant, _run_id, _r.employee_id, _r.component_id, 'time:' || _r.id, _r.quantity,
      _r.type_label || ' du ' || to_char(_r.start_date, 'DD/MM') || ' au ' || to_char(_r.end_date, 'DD/MM') || ' : '
        || _r.quantity || CASE WHEN _r.unit = 'day' THEN ' jour(s)' ELSE ' heure(s)' END,
      'approved', auth.uid(), _r.decided_by, now(), 'Approuvé dans Temps et absences')
    RETURNING id INTO _variable;
    UPDATE public.hr_time_requests SET payroll_run_id = _run_id, variable_id = _variable WHERE id = _r.id;
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END $function$;
REVOKE ALL ON FUNCTION public.transfer_hr_time_to_payroll(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_hr_time_to_payroll(uuid) TO authenticated;

SELECT public.install_tenant_isolation_triggers();
