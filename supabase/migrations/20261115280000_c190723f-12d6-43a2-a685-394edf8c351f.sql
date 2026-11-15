-- V79 — Budget : plus aucune règle codée en dur, sens des comptes, scénarios, saisonnalité.
--   1. Paramètres (budget_settings, droit budget.settings) : méthode d'atterrissage (prudente = le plus élevé des
--      engagements connus et du rythme du réalisé ; rythme seul ; engagements seuls), répartition mensuelle des
--      lignes annuelles (par douzièmes ou au profil du réalisé de l'exercice précédent), types de comptes
--      budgétables (charges et produits par défaut ; immobilisations pour un budget d'investissement…), appliqués
--      par la base à la saisie, à l'import et aux prévisions.
--   2. Scénarios de budget par société (budget_scenarios : code, libellé, actif), clé étrangère depuis budgets ;
--      un scénario « base » est créé à la première utilisation, modifiable et désactivable.
--   3. Réalisé au sens normal du compte (gl_accounts.normal_balance) : un compte de produits se réalise au crédit.
--      Avant V79, une ligne de produits (7x) affichait un réalisé négatif. budget_status dit la nature de la ligne.
--   4. Réalisé mensuel de l'exercice précédent (profil de saisonnalité).

-- ───────────────────────── 1. Paramètres ─────────────────────────
ALTER TABLE public.budget_settings
  ADD COLUMN forecast_method text NOT NULL DEFAULT 'prudent' CHECK (forecast_method IN ('prudent', 'run_rate', 'commitments')),
  ADD COLUMN annual_spread text NOT NULL DEFAULT 'even' CHECK (annual_spread IN ('even', 'prior_year')),
  ADD COLUMN budgetable_types text[] NOT NULL DEFAULT ARRAY['expense', 'revenue']
    CHECK (cardinality(budgetable_types) > 0 AND budgetable_types <@ ARRAY['asset', 'liability', 'equity', 'revenue', 'expense']);

CREATE OR REPLACE FUNCTION public.budget_setting(_tenant uuid)
 RETURNS budget_settings
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s FROM public.budget_settings s WHERE s.tenant_id = _tenant),
                  ROW(_tenant, 'off', 'year', now(), true, true, true, 90, false, 0, 'prudent', 'even', ARRAY['expense', 'revenue'])::public.budget_settings)
$function$;

-- Compte budgétable : de la société, et d'un type admis par les paramètres.
CREATE OR REPLACE FUNCTION public.budget_account_ok(_tenant uuid, _account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.gl_accounts g WHERE g.id = _account AND g.tenant_id = _tenant
                  AND g.account_type = ANY ((public.budget_setting(_tenant)).budgetable_types))
$function$;

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
  IF (TG_OP = 'INSERT' OR NEW.gl_account_id IS DISTINCT FROM OLD.gl_account_id) AND NOT public.budget_account_ok(_b.tenant_id, NEW.gl_account_id) THEN
    RAISE EXCEPTION 'Ligne de budget : le type de ce compte n''est pas budgétable (Paramètres du budget → Contrôle budgétaire)' USING ERRCODE = 'QG024';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_budget_forecast_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _f public.budget_forecasts%ROWTYPE;
BEGIN
  SELECT * INTO _f FROM public.budget_forecasts WHERE id = COALESCE(NEW.forecast_id, OLD.forecast_id);
  IF _f.id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF current_user IN ('authenticated', 'anon', 'qerp_api') AND _f.status = 'published' THEN
    RAISE EXCEPTION 'Prévision « % » publiée : ses lignes sont figées', _f.name USING ERRCODE = 'QG024';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.tenant_id IS DISTINCT FROM _f.tenant_id THEN
    RAISE EXCEPTION 'Ligne de prévision : société différente de celle de la prévision' USING ERRCODE = 'QG017';
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.gl_account_id IS DISTINCT FROM OLD.gl_account_id) AND NOT public.budget_account_ok(_f.tenant_id, NEW.gl_account_id) THEN
    RAISE EXCEPTION 'Ligne de prévision : le type de ce compte n''est pas budgétable (Paramètres du budget → Contrôle budgétaire)' USING ERRCODE = 'QG024';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;

-- ───────────────────────── 2. Scénarios ─────────────────────────
CREATE TABLE public.budget_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_]{1,30}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code));
ALTER TABLE public.budget_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.budget_scenarios FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.budget_scenarios FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'budget.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'budget.settings'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_scenarios TO authenticated;

-- Scénarios déjà utilisés, puis « base » pour chaque société qui n'en a aucun.
INSERT INTO public.budget_scenarios (tenant_id, code, name)
SELECT DISTINCT b.tenant_id, lower(regexp_replace(b.scenario, '[^a-zA-Z0-9_]', '_', 'g')),
       CASE WHEN b.scenario = 'base' THEN 'Budget de référence' ELSE initcap(b.scenario) END
  FROM public.budgets b WHERE b.scenario IS NOT NULL
ON CONFLICT (tenant_id, code) DO NOTHING;
UPDATE public.budgets SET scenario = lower(regexp_replace(scenario, '[^a-zA-Z0-9_]', '_', 'g')) WHERE scenario !~ '^[a-z0-9_]{1,30}$';

CREATE OR REPLACE FUNCTION public.ensure_budget_scenarios(_tenant uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO public.budget_scenarios (tenant_id, code, name, description)
  SELECT _tenant, 'base', 'Budget de référence', 'Créé automatiquement ; modifiable et désactivable'
   WHERE NOT EXISTS (SELECT 1 FROM public.budget_scenarios WHERE tenant_id = _tenant)
  ON CONFLICT (tenant_id, code) DO NOTHING
$function$;
REVOKE EXECUTE ON FUNCTION public.ensure_budget_scenarios(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_budget_scenario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.ensure_budget_scenarios(NEW.tenant_id);
  -- Sans scénario choisi : le premier scénario actif de la société, dans l'ordre d'affichage paramétré.
  IF NEW.scenario IS NULL THEN
    SELECT s.code INTO NEW.scenario FROM public.budget_scenarios s WHERE s.tenant_id = NEW.tenant_id AND s.is_active ORDER BY s.sort_order, s.name LIMIT 1;
    IF NEW.scenario IS NULL THEN RAISE EXCEPTION 'Aucun scénario de budget actif (Budget → Données de base → Scénarios)' USING ERRCODE = 'QG024'; END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.scenario IS DISTINCT FROM OLD.scenario THEN
    IF NOT EXISTS (SELECT 1 FROM public.budget_scenarios s WHERE s.tenant_id = NEW.tenant_id AND s.code = NEW.scenario AND s.is_active) THEN
      RAISE EXCEPTION 'Scénario « % » inconnu ou désactivé (Budget → Données de base → Scénarios)', NEW.scenario USING ERRCODE = 'QG024';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_budget_scenario BEFORE INSERT OR UPDATE OF scenario ON public.budgets FOR EACH ROW EXECUTE FUNCTION public.guard_budget_scenario();

ALTER TABLE public.budgets ALTER COLUMN scenario DROP DEFAULT;
ALTER TABLE public.budgets ADD CONSTRAINT budgets_scenario_fkey FOREIGN KEY (tenant_id, scenario)
  REFERENCES public.budget_scenarios (tenant_id, code) ON UPDATE CASCADE;

-- ───────────────────────── 3. Sens des comptes ─────────────────────────
CREATE OR REPLACE FUNCTION public.budget_actual(_tenant uuid, _code text, _from date, _to date, _value uuid DEFAULT NULL)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(CASE WHEN g.normal_balance = 'credit' THEN l.credit - l.debit ELSE l.debit - l.credit END), 0)
    FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.entry_id
    JOIN public.gl_accounts g ON g.id = l.account_id
   WHERE e.tenant_id = _tenant AND e.status IN ('posted', 'reversed') AND e.entry_date BETWEEN _from AND _to AND g.code LIKE _code || '%'
     AND (_value IS NULL OR EXISTS (SELECT 1 FROM public.journal_line_analytics la WHERE la.line_id = l.id AND la.value_id = ANY (public.analytic_value_scope(_value))))
$function$;

DROP FUNCTION public.budget_status(text);
CREATE FUNCTION public.budget_status(_fiscal_year text)
 RETURNS TABLE(line_id uuid, account_id uuid, account_code text, account_name text, period text, analytic_value_id uuid, analytic_code text, analytic_name text,
               nature text, planned numeric, precommitted numeric, committed numeric, actual numeric, available numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH b AS (SELECT * FROM public.budgets WHERE tenant_id = public.get_user_tenant_id(auth.uid()) AND fiscal_year = _fiscal_year AND is_control AND status = 'approved'),
  r AS (
    SELECT l.id, g.id AS gid, g.code, g.name, l.period, l.planned_amount, l.analytic_value_id, v.code AS vcode, v.name AS vname, b.tenant_id,
           CASE WHEN g.normal_balance = 'credit' THEN 'revenue' ELSE 'expense' END AS nature,
           CASE WHEN length(l.period) = 4 THEN make_date(l.period::int, 1, 1) ELSE to_date(l.period || '-01', 'YYYY-MM-DD') END AS f,
           CASE WHEN length(l.period) = 4 THEN make_date(l.period::int, 12, 31) ELSE (to_date(l.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date END AS t
      FROM b JOIN public.budget_lines l ON l.budget_id = b.id JOIN public.gl_accounts g ON g.id = l.gl_account_id
      LEFT JOIN public.analytic_values v ON v.id = l.analytic_value_id),
  c AS (
    SELECT r.*, public.budget_precommitted(r.tenant_id, r.code, r.f, r.t, NULL, r.analytic_value_id) AS pre,
           public.budget_committed(r.tenant_id, r.code, r.f, r.t, NULL, r.analytic_value_id) AS com,
           public.budget_actual(r.tenant_id, r.code, r.f, r.t, r.analytic_value_id) AS act FROM r)
  SELECT c.id, c.gid, c.code, c.name, c.period, c.analytic_value_id, c.vcode, c.vname, c.nature, c.planned_amount, c.pre, c.com, c.act,
         c.planned_amount - c.pre - c.com - c.act
    FROM c ORDER BY c.code, c.vcode NULLS FIRST, c.period
$function$;
REVOKE EXECUTE ON FUNCTION public.budget_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.budget_status(text) TO authenticated;

-- ───────────────────────── 4. Saisonnalité ─────────────────────────
CREATE FUNCTION public.budget_prior_year_monthly(_fiscal_year text)
 RETURNS TABLE(line_id uuid, month int, actual numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.id, m.m, public.budget_actual(b.tenant_id, g.code, make_date(_fiscal_year::int - 1, m.m, 1),
                                         (make_date(_fiscal_year::int - 1, m.m, 1) + interval '1 month - 1 day')::date, l.analytic_value_id)
    FROM public.budgets b JOIN public.budget_lines l ON l.budget_id = b.id JOIN public.gl_accounts g ON g.id = l.gl_account_id
    CROSS JOIN generate_series(1, 12) AS m(m)
   WHERE b.tenant_id = public.get_user_tenant_id(auth.uid()) AND b.fiscal_year = _fiscal_year AND b.is_control AND b.status = 'approved'
     AND _fiscal_year ~ '^\d{4}$' AND length(l.period) = 4
   ORDER BY 1, 2
$function$;
REVOKE EXECUTE ON FUNCTION public.budget_prior_year_monthly(text), public.budget_account_ok(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.budget_prior_year_monthly(text), public.budget_account_ok(uuid, uuid) TO authenticated;

-- Import : comptes des types budgétables paramétrés.
CREATE OR REPLACE FUNCTION public.budget_import_resolve(_tenant uuid, _rows jsonb, _with_period boolean, _year text)
 RETURNS TABLE(line_no integer, gl_account_id uuid, analytic_value_id uuid, period text, amount numeric, comment text, error text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r jsonb; _n int := 0; _code text; _sec text; _per text; _amt numeric; _acc uuid; _val uuid; _cnt int; _e text[];
BEGIN
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 THEN RAISE EXCEPTION 'Fichier vide' USING ERRCODE = 'QG024'; END IF;
  IF jsonb_array_length(_rows) > 20000 THEN RAISE EXCEPTION 'Fichier trop volumineux (20 000 lignes au plus)' USING ERRCODE = 'QG024'; END IF;
  FOR _r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    _n := _n + 1; _e := '{}'; _acc := NULL; _val := NULL;
    line_no := COALESCE((_r ->> 'line')::int, _n + 1);
    _code := NULLIF(regexp_replace(COALESCE(_r ->> 'account', ''), '\s', '', 'g'), '');
    _sec := NULLIF(btrim(COALESCE(_r ->> 'section', '')), '');
    _per := NULLIF(btrim(COALESCE(_r ->> 'period', '')), '');
    BEGIN _amt := round((_r ->> 'amount')::numeric, 2); EXCEPTION WHEN others THEN _amt := NULL; END;
    IF _code IS NULL THEN _e := array_append(_e, 'compte manquant');
    ELSE
      SELECT g.id INTO _acc FROM public.gl_accounts g WHERE g.tenant_id = _tenant AND g.code = _code AND g.is_active AND g.account_type = ANY ((public.budget_setting(_tenant)).budgetable_types);
      IF _acc IS NULL THEN _e := array_append(_e, 'compte ' || _code || ' inconnu, inactif ou d''un type non budgétable (paramètres du budget)'); END IF;
    END IF;
    IF _sec IS NOT NULL AND lower(_sec) NOT IN ('toutes', 'toutes les sections') THEN
      IF position('/' IN _sec) > 0 THEN
        SELECT v.id INTO _val FROM public.analytic_values v JOIN public.analytic_axes a ON a.id = v.axis_id
         WHERE v.tenant_id = _tenant AND v.is_active AND a.is_active AND upper(a.code) = upper(split_part(_sec, '/', 1)) AND upper(v.code) = upper(split_part(_sec, '/', 2));
        IF _val IS NULL THEN _e := array_append(_e, 'section ' || _sec || ' inconnue ou inactive'); END IF;
      ELSE
        SELECT count(*), min(v.id::text)::uuid INTO _cnt, _val FROM public.analytic_values v JOIN public.analytic_axes a ON a.id = v.axis_id
         WHERE v.tenant_id = _tenant AND v.is_active AND a.is_active AND upper(v.code) = upper(split_part(_sec, ' ', 1));
        IF _cnt = 0 THEN _e := array_append(_e, 'section ' || _sec || ' inconnue ou inactive'); _val := NULL;
        ELSIF _cnt > 1 THEN _e := array_append(_e, 'section ' || _sec || ' présente sur plusieurs axes : écrire AXE/CODE'); _val := NULL;
        END IF;
      END IF;
    END IF;
    IF _with_period THEN
      _per := COALESCE(_per, _year);
      IF _per !~ '^\d{4}(-(0[1-9]|1[0-2]))?$' OR left(_per, 4) <> _year THEN _e := array_append(_e, 'période ' || _per || ' hors exercice ' || _year || ' (AAAA ou AAAA-MM)'); END IF;
    END IF;
    IF _amt IS NULL OR _amt < 0 THEN _e := array_append(_e, 'montant invalide'); END IF;
    gl_account_id := _acc; analytic_value_id := _val; period := CASE WHEN _with_period THEN _per END; amount := _amt;
    comment := NULLIF(btrim(COALESCE(_r ->> 'comment', '')), '');
    error := CASE WHEN cardinality(_e) > 0 THEN 'ligne ' || line_no || ' : ' || array_to_string(_e, ', ') END;
    RETURN NEXT;
  END LOOP;
END $function$;

SELECT public.install_tenant_isolation_triggers();
