-- V73 — Contrôle budgétaire : budget de référence, engagé / réalisé / disponible, contrôle avant
-- approbation (lot B1, écart G-08 ; audit docs/audit-erp/15).
--
-- Constats : `commit_budget_on_po` ajoutait le total de la commande au RÉALISÉ (actual_amount), deux
-- fois (approuvée puis commandée), jamais libéré, sur le premier budget approuvé trouvé (LIMIT 1),
-- sans compte ni département ; aucun contrôle de disponibilité ; budgets et lignes ouverts en écriture
-- à tout membre (FOR ALL) ; aucun cycle de vie (un budget approuvé restait modifiable) ; droits par
-- rôles hors catalogue. Aucune donnée budgétaire n'existe (ni copie réelle ni nuage).
--
-- Comme SAP (contrôle de disponibilité FM / CO : budget, engagements, réel, disponible ; tolérances
-- avertissement / blocage ; compléments et restitutions de budget tracés) et Sage (contrôle budgétaire
-- sur les engagements d'achat) :
-- 1. Budget : brouillon → soumis → approuvé (par une autre personne, droit budget.approve) → clos ; un
--    seul budget de CONTRÔLE approuvé par exercice ; lignes figées après approbation, révisées par
--    budget_revise_line (motif, journal budget_revisions).
-- 2. Ligne de budget = compte (ses sous-comptes compris : « 60 » couvre 601, 6052…) × période (« AAAA-MM »
--    ou « AAAA » pour l'année) × valeur analytique facultative.
-- 3. Engagé = commandes approuvées non soldées (montant net moins factures fournisseurs approuvées qui
--    les citent), imputées au compte du rôle Achats ; réalisé = écritures validées (débit − crédit) ;
--    disponible = budget − engagé − réalisé. Rien n'est stocké : tout est recalculé (pas de dérive).
-- 4. Contrôle (paramètre budget_settings.control_mode : off par défaut / warn / block ; niveau année ou
--    mois) à la soumission et à l'approbation d'une commande, et à la soumission d'une facture
--    fournisseur sans commande ; dépassement bloquant levé par budget_override_po (droit
--    budget.override, motif obligatoire, tracé sur la commande).
-- Droits (catalogue 89) : budget.manage, budget.approve, budget.override, budget.settings. Erreurs : QG024.

-- ─── Droits ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('budget.manage', 'budget', 'manage', 'Préparer les budgets (saisie, soumission)'),
  ('budget.approve', 'budget', 'approve', 'Approuver et réviser les budgets'),
  ('budget.override', 'budget', 'override', 'Autoriser un dépassement de budget'),
  ('budget.settings', 'budget', 'settings', 'Modifier les paramètres du contrôle budgétaire')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES
  ('admin', 'budget.manage'), ('admin', 'budget.approve'), ('admin', 'budget.override'), ('admin', 'budget.settings'),
  ('budget_admin', 'budget.manage'), ('budget_admin', 'budget.approve'), ('budget_admin', 'budget.override'), ('budget_admin', 'budget.settings'),
  ('budget_planner', 'budget.manage'), ('budget_approver', 'budget.approve'), ('budget_controller', 'budget.override')) AS v(r, p)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles WHERE code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code LIKE 'budget.%' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── L'ancien « engagement » faux disparaît ───
DROP TRIGGER IF EXISTS trg_commit_budget_on_po ON public.purchase_orders;
DROP FUNCTION IF EXISTS public.commit_budget_on_po();

-- ─── Paramètres ───
CREATE TABLE public.budget_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  control_mode text NOT NULL DEFAULT 'off' CHECK (control_mode IN ('off', 'warn', 'block')),
  control_level text NOT NULL DEFAULT 'year' CHECK (control_level IN ('year', 'month')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.budget_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.budget_settings FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.budget_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'budget.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'budget.settings'));
GRANT SELECT, INSERT, UPDATE ON public.budget_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.budget_setting(_tenant uuid)
 RETURNS public.budget_settings
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s FROM public.budget_settings s WHERE s.tenant_id = _tenant), ROW(_tenant, 'off', 'year', now())::public.budget_settings)
$function$;
REVOKE ALL ON FUNCTION public.budget_setting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.budget_setting(uuid) TO authenticated;

-- ─── Budgets et lignes ───
UPDATE public.budgets SET status = 'draft' WHERE status NOT IN ('draft', 'submitted', 'approved', 'closed');
ALTER TABLE public.budgets
  ADD CONSTRAINT budgets_status_check CHECK (status IN ('draft', 'submitted', 'approved', 'closed')),
  ADD CONSTRAINT budgets_fiscal_year_check CHECK (fiscal_year ~ '^\d{4}$'),
  ADD COLUMN is_control boolean NOT NULL DEFAULT false,
  ADD COLUMN submitted_by uuid,
  ADD COLUMN submitted_at timestamptz;
CREATE UNIQUE INDEX budgets_one_control ON public.budgets (tenant_id, fiscal_year) WHERE is_control AND status = 'approved';

ALTER TABLE public.budget_lines
  ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  ADD COLUMN analytic_value_id uuid REFERENCES public.analytic_values(id),
  ADD CONSTRAINT budget_lines_period_check CHECK (period ~ '^\d{4}(-(0[1-9]|1[0-2]))?$'),
  ADD CONSTRAINT budget_lines_planned_check CHECK (planned_amount >= 0);
UPDATE public.budget_lines l SET tenant_id = b.tenant_id FROM public.budgets b WHERE b.id = l.budget_id;
CREATE UNIQUE INDEX budget_lines_unique ON public.budget_lines (budget_id, gl_account_id, period, COALESCE(analytic_value_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE public.budget_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  budget_line_id uuid NOT NULL REFERENCES public.budget_lines(id) ON DELETE CASCADE,
  old_amount numeric(18, 2) NOT NULL,
  new_amount numeric(18, 2) NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.budget_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.budget_revisions FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.budget_revisions TO authenticated;

DROP POLICY "Tenant isolation" ON public.budgets;
CREATE POLICY "Lecture société" ON public.budgets FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Préparation habilitée" ON public.budgets FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'budget.manage'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'budget.manage'));
DROP POLICY "Access via budget" ON public.budget_lines;
CREATE POLICY "Lecture société" ON public.budget_lines FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Préparation habilitée" ON public.budget_lines FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'budget.manage'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'budget.manage'));

-- Gardes : un budget change d'état par fonctions ; ses lignes ne se modifient qu'en brouillon.
CREATE OR REPLACE FUNCTION public.guard_budget()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft'; NEW.is_control := false; NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.created_by := auth.uid();
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Budget « % » : seul un budget en brouillon se modifie ou se supprime (réviser ses lignes une fois approuvé)', OLD.status
      USING ERRCODE = 'QG024';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.status, NEW.is_control, NEW.approved_by) IS DISTINCT FROM (OLD.status, OLD.is_control, OLD.approved_by) THEN
    RAISE EXCEPTION 'Le statut d''un budget change par soumission, approbation ou clôture' USING ERRCODE = 'QG024';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;
CREATE TRIGGER trg_guard_budget BEFORE INSERT OR UPDATE OR DELETE ON public.budgets FOR EACH ROW EXECUTE FUNCTION public.guard_budget();

CREATE OR REPLACE FUNCTION public.guard_budget_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _b public.budgets%ROWTYPE;
BEGIN
  SELECT * INTO _b FROM public.budgets WHERE id = COALESCE(NEW.budget_id, OLD.budget_id);
  IF TG_OP = 'DELETE' AND NOT FOUND THEN RETURN OLD; END IF;
  IF current_user IN ('authenticated', 'anon', 'qerp_api') AND _b.status <> 'draft' THEN
    RAISE EXCEPTION 'Budget « % » : ses lignes ne se modifient qu''en brouillon (approuvé : réviser la ligne avec un motif)', _b.status
      USING ERRCODE = 'QG024';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.tenant_id := _b.tenant_id;
  IF left(NEW.period, 4) <> _b.fiscal_year THEN
    RAISE EXCEPTION 'Ligne de budget : la période % n''appartient pas à l''exercice %', NEW.period, _b.fiscal_year USING ERRCODE = 'QG024';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gl_accounts g WHERE g.id = NEW.gl_account_id AND g.tenant_id = _b.tenant_id) THEN
    RAISE EXCEPTION 'Ligne de budget : compte de la société requis' USING ERRCODE = 'QG024';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_budget_line BEFORE INSERT OR UPDATE OR DELETE ON public.budget_lines FOR EACH ROW EXECUTE FUNCTION public.guard_budget_line();

CREATE OR REPLACE FUNCTION public.refresh_budget_total()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.budgets b SET total_amount = COALESCE((SELECT sum(l.planned_amount) FROM public.budget_lines l WHERE l.budget_id = b.id), 0)
   WHERE b.id = COALESCE(NEW.budget_id, OLD.budget_id);
  RETURN NULL;
END $function$;
CREATE TRIGGER trg_refresh_budget_total AFTER INSERT OR UPDATE OR DELETE ON public.budget_lines FOR EACH ROW EXECUTE FUNCTION public.refresh_budget_total();

-- ─── Cycle de vie ───
CREATE OR REPLACE FUNCTION public.budget_for(_budget uuid, _right text)
 RETURNS public.budgets LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _b public.budgets%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(), _right) THEN RAISE EXCEPTION 'Droit insuffisant (%)', _right USING ERRCODE = '42501'; END IF;
  SELECT * INTO _b FROM public.budgets WHERE id = _budget AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Budget introuvable' USING ERRCODE = 'QG024'; END IF;
  RETURN _b;
END $function$;
REVOKE ALL ON FUNCTION public.budget_for(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.budget_submit(_budget uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _b public.budgets%ROWTYPE := public.budget_for(_budget, 'budget.manage');
BEGIN
  IF _b.status <> 'draft' THEN RAISE EXCEPTION 'Seul un budget en brouillon se soumet' USING ERRCODE = 'QG024'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.budget_lines WHERE budget_id = _budget) THEN RAISE EXCEPTION 'Budget sans ligne' USING ERRCODE = 'QG024'; END IF;
  UPDATE public.budgets SET status = 'submitted', submitted_by = auth.uid(), submitted_at = now() WHERE id = _budget;
END $function$;

-- Approbation par une autre personne ; _control : devient le budget de contrôle de l'exercice.
CREATE OR REPLACE FUNCTION public.budget_approve(_budget uuid, _control boolean DEFAULT true)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _b public.budgets%ROWTYPE := public.budget_for(_budget, 'budget.approve');
BEGIN
  IF _b.status <> 'submitted' THEN RAISE EXCEPTION 'Seul un budget soumis s''approuve' USING ERRCODE = 'QG024'; END IF;
  IF auth.uid() IN (_b.created_by, _b.submitted_by) THEN
    RAISE EXCEPTION 'Séparation des tâches : un budget est approuvé par une autre personne que celle qui l''a préparé' USING ERRCODE = 'QG024';
  END IF;
  IF _control THEN
    UPDATE public.budgets SET is_control = false WHERE tenant_id = _b.tenant_id AND fiscal_year = _b.fiscal_year AND is_control AND id <> _budget;
  END IF;
  UPDATE public.budgets SET status = 'approved', approved_by = auth.uid(), approved_at = now(), is_control = _control WHERE id = _budget;
END $function$;

CREATE OR REPLACE FUNCTION public.budget_reject(_budget uuid, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _b public.budgets%ROWTYPE := public.budget_for(_budget, 'budget.approve');
BEGIN
  IF _b.status <> 'submitted' THEN RAISE EXCEPTION 'Seul un budget soumis se renvoie' USING ERRCODE = 'QG024'; END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'Motif obligatoire' USING ERRCODE = 'QG024'; END IF;
  UPDATE public.budgets SET status = 'draft', submitted_by = NULL, submitted_at = NULL WHERE id = _budget;
END $function$;

CREATE OR REPLACE FUNCTION public.budget_close(_budget uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _b public.budgets%ROWTYPE := public.budget_for(_budget, 'budget.approve');
BEGIN
  IF _b.status <> 'approved' THEN RAISE EXCEPTION 'Seul un budget approuvé se clôt' USING ERRCODE = 'QG024'; END IF;
  UPDATE public.budgets SET status = 'closed', is_control = false WHERE id = _budget;
END $function$;

-- Révision d'une ligne approuvée (complément ou restitution), motivée et tracée.
CREATE OR REPLACE FUNCTION public.budget_revise_line(_line uuid, _amount numeric, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _l public.budget_lines%ROWTYPE; _b public.budgets%ROWTYPE;
BEGIN
  SELECT * INTO _l FROM public.budget_lines WHERE id = _line FOR UPDATE;
  IF _l.id IS NULL THEN RAISE EXCEPTION 'Ligne de budget introuvable' USING ERRCODE = 'QG024'; END IF;
  _b := public.budget_for(_l.budget_id, 'budget.approve');
  IF _b.status <> 'approved' THEN RAISE EXCEPTION 'Seule une ligne d''un budget approuvé se révise (brouillon : modifier la ligne)' USING ERRCODE = 'QG024'; END IF;
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'Montant révisé positif ou nul requis' USING ERRCODE = 'QG024'; END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'Motif de la révision obligatoire' USING ERRCODE = 'QG024'; END IF;
  INSERT INTO public.budget_revisions (tenant_id, budget_line_id, old_amount, new_amount, reason, created_by)
  VALUES (_l.tenant_id, _l.id, _l.planned_amount, round(_amount, 2), btrim(_reason), auth.uid());
  UPDATE public.budget_lines SET planned_amount = round(_amount, 2) WHERE id = _line;
END $function$;
DO $$
DECLARE _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY['budget_submit(uuid)', 'budget_approve(uuid, boolean)', 'budget_reject(uuid, text)', 'budget_close(uuid)', 'budget_revise_line(uuid, numeric, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', _f);
  END LOOP;
END $$;

-- ─── Engagé, réalisé, disponible ───
-- Réalisé : écritures validées du compte et de ses sous-comptes sur la période (débit − crédit).
CREATE OR REPLACE FUNCTION public.budget_actual(_tenant uuid, _code text, _from date, _to date)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(l.debit - l.credit), 0) FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.entry_id
    JOIN public.gl_accounts g ON g.id = l.account_id
   WHERE e.tenant_id = _tenant AND e.status IN ('posted', 'reversed') AND e.entry_date BETWEEN _from AND _to AND g.code LIKE _code || '%'
$function$;

-- Engagé : commandes approuvées non soldées (net − factures approuvées qui les citent), au compte du rôle
-- Achats, datées de la commande ; _except : la commande en cours de contrôle.
CREATE OR REPLACE FUNCTION public.budget_committed(_tenant uuid, _code text, _from date, _to date, _except uuid DEFAULT NULL)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(greatest(po.total - COALESCE((SELECT sum(i.subtotal) FROM public.ap_invoices i
                                                       WHERE i.po_id = po.id AND i.approval_status = 'approved'), 0), 0)), 0)
    FROM public.purchase_orders po
   WHERE po.tenant_id = _tenant AND po.status IN ('approved', 'ordered', 'partially_received', 'received')
     AND po.order_date BETWEEN _from AND _to AND (_except IS NULL OR po.id <> _except)
     AND EXISTS (SELECT 1 FROM public.gl_accounts g WHERE g.id = public.posting_account(_tenant, 'PURCHASES') AND g.code LIKE _code || '%')
$function$;

-- Ligne de budget la plus précise couvrant un compte à une date (budget de contrôle, niveau paramétré).
CREATE OR REPLACE FUNCTION public.budget_availability(_tenant uuid, _account uuid, _date date, _except uuid DEFAULT NULL)
 RETURNS TABLE (budget_code text, period_from date, period_to date, planned numeric, committed numeric, actual numeric, available numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _level text := (public.budget_setting(_tenant)).control_level; _code text; _bc text; _y text := to_char(_date, 'YYYY'); _f date; _t date; _p numeric;
BEGIN
  SELECT g.code INTO _code FROM public.gl_accounts g WHERE g.id = _account AND g.tenant_id = _tenant;
  IF _code IS NULL THEN RETURN; END IF;
  SELECT g.code INTO _bc FROM public.budget_lines l JOIN public.budgets b ON b.id = l.budget_id AND b.is_control AND b.status = 'approved' AND b.fiscal_year = _y
    JOIN public.gl_accounts g ON g.id = l.gl_account_id
   WHERE b.tenant_id = _tenant AND _code LIKE g.code || '%' AND (_level = 'year' OR l.period = to_char(_date, 'YYYY-MM'))
   ORDER BY length(g.code) DESC LIMIT 1;
  IF _bc IS NULL THEN RETURN; END IF;
  IF _level = 'year' THEN _f := make_date(_y::int, 1, 1); _t := make_date(_y::int, 12, 31);
  ELSE _f := date_trunc('month', _date)::date; _t := (date_trunc('month', _date) + interval '1 month - 1 day')::date; END IF;
  SELECT COALESCE(sum(l.planned_amount), 0) INTO _p FROM public.budget_lines l JOIN public.budgets b ON b.id = l.budget_id AND b.is_control AND b.status = 'approved' AND b.fiscal_year = _y
    JOIN public.gl_accounts g ON g.id = l.gl_account_id
   WHERE b.tenant_id = _tenant AND g.code = _bc AND (_level = 'year' OR l.period = to_char(_date, 'YYYY-MM'));
  budget_code := _bc; period_from := _f; period_to := _t; planned := _p;
  committed := public.budget_committed(_tenant, _bc, _f, _t, _except);
  actual := public.budget_actual(_tenant, _bc, _f, _t);
  available := _p - committed - actual;
  RETURN NEXT;
END $function$;
REVOKE ALL ON FUNCTION public.budget_availability(uuid, uuid, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.budget_availability(uuid, uuid, date, uuid) TO authenticated;

-- Suivi de toutes les lignes du budget de contrôle (écran « Disponible »).
CREATE OR REPLACE FUNCTION public.budget_status(_fiscal_year text)
 RETURNS TABLE (line_id uuid, account_id uuid, account_code text, account_name text, period text, planned numeric, committed numeric, actual numeric, available numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH b AS (SELECT * FROM public.budgets WHERE tenant_id = public.get_user_tenant_id(auth.uid()) AND fiscal_year = _fiscal_year AND is_control AND status = 'approved'),
  r AS (
    SELECT l.id, g.id AS gid, g.code, g.name, l.period, l.planned_amount,
           CASE WHEN length(l.period) = 4 THEN make_date(l.period::int, 1, 1) ELSE to_date(l.period || '-01', 'YYYY-MM-DD') END AS f,
           CASE WHEN length(l.period) = 4 THEN make_date(l.period::int, 12, 31) ELSE (to_date(l.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date END AS t
      FROM b JOIN public.budget_lines l ON l.budget_id = b.id JOIN public.gl_accounts g ON g.id = l.gl_account_id)
  SELECT r.id, r.gid, r.code, r.name, r.period, r.planned_amount,
         public.budget_committed((SELECT tenant_id FROM b), r.code, r.f, r.t),
         public.budget_actual((SELECT tenant_id FROM b), r.code, r.f, r.t),
         r.planned_amount - public.budget_committed((SELECT tenant_id FROM b), r.code, r.f, r.t) - public.budget_actual((SELECT tenant_id FROM b), r.code, r.f, r.t)
    FROM r ORDER BY r.code, r.period
$function$;
REVOKE ALL ON FUNCTION public.budget_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.budget_status(text) TO authenticated;

-- ─── Contrôle à la soumission / approbation des commandes ───
ALTER TABLE public.purchase_orders
  ADD COLUMN budget_warning text,
  ADD COLUMN budget_override_reason text,
  ADD COLUMN budget_override_by uuid,
  ADD COLUMN budget_override_at timestamptz;

CREATE OR REPLACE FUNCTION public.check_budget_on_po()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _mode text := (public.budget_setting(NEW.tenant_id)).control_mode; _a record; _acc uuid;
BEGIN
  IF _mode = 'off' OR NEW.status NOT IN ('pending_approval', 'approved') OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  _acc := public.posting_account(NEW.tenant_id, 'PURCHASES');
  IF _acc IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO _a FROM public.budget_availability(NEW.tenant_id, _acc, NEW.order_date, NEW.id);
  IF _a.budget_code IS NULL OR NEW.total <= _a.available THEN NEW.budget_warning := NULL; RETURN NEW; END IF;
  IF _mode = 'warn' OR NEW.budget_override_reason IS NOT NULL THEN
    NEW.budget_warning := format('Dépassement du budget %s : commande %s pour %s disponibles', _a.budget_code, NEW.total, _a.available);
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Budget dépassé (compte %, du % au %) : commande % pour % disponibles (budget %, engagé %, réalisé %)',
    _a.budget_code, _a.period_from, _a.period_to, NEW.total, _a.available, _a.planned, _a.committed, _a.actual
    USING ERRCODE = 'QG024', HINT = 'Réduire la commande, réviser le budget, ou faire autoriser le dépassement (droit « Autoriser un dépassement de budget »).';
END $function$;
CREATE TRIGGER trg_check_budget_on_po BEFORE UPDATE OF status ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.check_budget_on_po();

-- Dépassement autorisé (motif tracé) : la commande peut ensuite être soumise ou approuvée.
CREATE OR REPLACE FUNCTION public.budget_override_po(_po uuid, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_permission(auth.uid(), 'budget.override') THEN RAISE EXCEPTION 'Droit insuffisant : autoriser un dépassement de budget' USING ERRCODE = '42501'; END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'Motif obligatoire' USING ERRCODE = 'QG024'; END IF;
  UPDATE public.purchase_orders SET budget_override_reason = btrim(_reason), budget_override_by = auth.uid(), budget_override_at = now()
   WHERE id = _po AND tenant_id = public.get_user_tenant_id(auth.uid()) AND status IN ('draft', 'rejected', 'pending_approval');
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable ou déjà approuvée' USING ERRCODE = 'QG024'; END IF;
END $function$;
REVOKE ALL ON FUNCTION public.budget_override_po(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.budget_override_po(uuid, text) TO authenticated;

-- Facture fournisseur sans commande : contrôle par compte de charge à la soumission.
CREATE OR REPLACE FUNCTION public.check_budget_on_ap_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _mode text := (public.budget_setting(NEW.tenant_id)).control_mode; _r record; _a record;
BEGIN
  IF _mode = 'off' OR NEW.po_id IS NOT NULL OR NEW.approval_status <> 'submitted' OR OLD.approval_status = 'submitted' THEN RETURN NEW; END IF;
  FOR _r IN
    SELECT COALESCE(l.expense_account_id, public.posting_account(NEW.tenant_id, 'PURCHASES')) AS acc, sum(l.net_amount) AS amount
      FROM public.ap_invoice_lines l WHERE l.invoice_id = NEW.id GROUP BY 1
    UNION ALL
    SELECT public.posting_account(NEW.tenant_id, 'PURCHASES'), NEW.subtotal WHERE NOT EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = NEW.id)
  LOOP
    CONTINUE WHEN _r.acc IS NULL;
    SELECT * INTO _a FROM public.budget_availability(NEW.tenant_id, _r.acc, NEW.invoice_date);
    IF _a.budget_code IS NOT NULL AND _r.amount > _a.available AND _mode = 'block' THEN
      RAISE EXCEPTION 'Budget dépassé (compte %, du % au %) : facture % pour % disponibles', _a.budget_code, _a.period_from, _a.period_to, _r.amount, _a.available
        USING ERRCODE = 'QG024', HINT = 'Réviser le budget ou rattacher la facture à une commande autorisée.';
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_check_budget_on_ap_invoice BEFORE UPDATE OF approval_status ON public.ap_invoices FOR EACH ROW EXECUTE FUNCTION public.check_budget_on_ap_invoice();

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
