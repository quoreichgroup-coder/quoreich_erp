-- V75 — Immobilisations : amortissements et cessions comptabilisés (lot F1 ; écarts G-11, G-20 ;
-- audit docs/audit-erp/16).
--
-- Constats : post_monthly_depreciation(_tenant_id, …) et post_asset_disposal ne pouvaient pas
-- fonctionner (colonnes journal_entries.reference et journal_lines.journal_entry_id inexistantes,
-- en-tête inséré « posted » sans lignes) et, réparées telles quelles, auraient écrit dans la société
-- passée en paramètre par n'importe quel utilisateur (G-11) ; tables en FOR ALL ; amortissement cumulé
-- et VNC saisis ; aucune immobilisation n'existe encore (copie réelle et nuage).
--
-- Comme SAP (Asset Accounting : catégorie → comptes, calcul périodique, cession) et Sage
-- (Immobilisations), selon le SYSCOHADA révisé :
-- 1. Catégorie = comptes d'immobilisation (2x), d'amortissements (28x) et de dotation (68x).
-- 2. run_depreciation('AAAA-MM') — droit assets.depreciate : linéaire (premier mois au prorata des
--    jours, paramétrable) ou dégressif (coefficients paramétrables 1,5 / 2 / 2,5 selon la durée, à
--    valider localement, bascule en linéaire quand il devient supérieur) ; UNE écriture OD par calcul,
--    DR 68x / CR 28x par compte ; idempotent (un amortissement par immobilisation et par mois) ;
--    reverse_last_depreciation(motif) contre-passe le dernier calcul.
-- 3. dispose_asset — droit assets.dispose : amortissement du mois jusqu'à la date, sortie DR 28x
--    (cumul) + DR 81x VNC (rôle DISPOSAL_BOOK_VALUE) / CR 2x (coût) ; prix de cession DR 485 (rôle
--    DISPOSAL_RECEIVABLE) ou banque / CR 82x (rôle DISPOSAL_PROCEEDS) ; plus-ou-moins-value tracée.
-- 4. Cumul et VNC calculés (reprise d'un cumul d'ouverture pour un registre existant) ; fiche figée
--    une fois amortie ; tables d'amortissements, de calculs et de cessions en lecture seule.
-- Droits (catalogue 93) : assets.manage, assets.depreciate, assets.dispose, assets.settings. Erreurs : QG025.

-- ─── Droits ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('assets.manage', 'assets', 'manage', 'Gérer les fiches d''immobilisations'),
  ('assets.depreciate', 'assets', 'depreciate', 'Calculer et comptabiliser les amortissements'),
  ('assets.dispose', 'assets', 'dispose', 'Céder ou mettre au rebut une immobilisation'),
  ('assets.settings', 'assets', 'settings', 'Modifier les catégories et paramètres des immobilisations')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES
  ('admin', 'assets.manage'), ('admin', 'assets.depreciate'), ('admin', 'assets.dispose'), ('admin', 'assets.settings'),
  ('asset_admin', 'assets.manage'), ('asset_admin', 'assets.depreciate'), ('asset_admin', 'assets.dispose'), ('asset_admin', 'assets.settings'),
  ('asset_accountant', 'assets.manage'), ('asset_accountant', 'assets.depreciate'), ('asset_accountant', 'assets.dispose'),
  ('asset_clerk', 'assets.manage'), ('asset_controller', 'assets.depreciate'), ('accountant', 'assets.depreciate')) AS v(r, p)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles WHERE code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code LIKE 'assets.%' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

DROP FUNCTION IF EXISTS public.post_monthly_depreciation(uuid, date);
DROP FUNCTION IF EXISTS public.post_asset_disposal(uuid, date, text, numeric, text);

-- ─── Rôles de cession ───
INSERT INTO public.posting_roles (code, label, module, description, expected_prefixes) VALUES
  ('DISPOSAL_BOOK_VALUE', 'Valeur comptable des cessions', 'FA', 'Débité de la valeur nette comptable de l''immobilisation sortie', ARRAY['81']),
  ('DISPOSAL_PROCEEDS', 'Produits des cessions d''immobilisations', 'FA', 'Crédité du prix de cession', ARRAY['82']),
  ('DISPOSAL_RECEIVABLE', 'Créances sur cessions d''immobilisations', 'FA', 'Débité du prix de cession à encaisser', ARRAY['485'])
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.framework_reference_accounts (framework_code, code, name, account_type) VALUES
  ('SYSCOHADA_REVISE', '812', 'Valeurs comptables des cessions d''immobilisations corporelles', 'expense'),
  ('SYSCOHADA_REVISE', '822', 'Produits des cessions d''immobilisations corporelles', 'revenue'),
  ('SYSCOHADA_REVISE', '485', 'Créances sur cessions d''immobilisations', 'asset'),
  ('PCG_FR', '675', 'Valeurs comptables des éléments d''actif cédés', 'expense'),
  ('PCG_FR', '775', 'Produits des cessions d''éléments d''actif', 'revenue'),
  ('PCG_FR', '462', 'Créances sur cessions d''immobilisations', 'asset')
ON CONFLICT (framework_code, code) DO NOTHING;
INSERT INTO public.framework_role_expectations (framework_code, role_code, prefixes) VALUES
  ('SYSCOHADA_REVISE', 'DISPOSAL_BOOK_VALUE', ARRAY['81']), ('SYSCOHADA_REVISE', 'DISPOSAL_PROCEEDS', ARRAY['82']), ('SYSCOHADA_REVISE', 'DISPOSAL_RECEIVABLE', ARRAY['485']),
  ('PCG_FR', 'DISPOSAL_BOOK_VALUE', ARRAY['675']), ('PCG_FR', 'DISPOSAL_PROCEEDS', ARRAY['775']), ('PCG_FR', 'DISPOSAL_RECEIVABLE', ARRAY['462'])
ON CONFLICT (framework_code, role_code) DO NOTHING;
INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT v.f, v.c, v.n, v.t FROM (VALUES
  ('SYSCOHADA_REVISE', '812', 'Valeurs comptables des cessions d''immobilisations corporelles', 'expense'),
  ('SYSCOHADA_REVISE', '822', 'Produits des cessions d''immobilisations corporelles', 'revenue'),
  ('SYSCOHADA_REVISE', '485', 'Créances sur cessions d''immobilisations', 'asset'),
  ('PCG_FR', '675', 'Valeurs comptables des éléments d''actif cédés', 'expense'),
  ('PCG_FR', '775', 'Produits des cessions d''éléments d''actif', 'revenue'),
  ('PCG_FR', '462', 'Créances sur cessions d''immobilisations', 'asset')) AS v(f, c, n, t)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_accounts a WHERE a.framework_code = v.f AND a.code = v.c);
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT v.f, v.r, v.c FROM (VALUES
  ('SYSCOHADA_REVISE', 'DISPOSAL_BOOK_VALUE', '812'), ('SYSCOHADA_REVISE', 'DISPOSAL_PROCEEDS', '822'), ('SYSCOHADA_REVISE', 'DISPOSAL_RECEIVABLE', '485'),
  ('PCG_FR', 'DISPOSAL_BOOK_VALUE', '675'), ('PCG_FR', 'DISPOSAL_PROCEEDS', '775'), ('PCG_FR', 'DISPOSAL_RECEIVABLE', '462')) AS v(f, r, c)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults d WHERE d.framework_code = v.f AND d.role_code = v.r);
INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
SELECT s.tenant_id, a.code, a.name, a.account_type
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code IN ('DISPOSAL_BOOK_VALUE', 'DISPOSAL_PROCEEDS', 'DISPOSAL_RECEIVABLE')
  JOIN public.accounting_framework_accounts a ON a.framework_code = d.framework_code AND a.code = d.account_code
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, d.role_code, g.id
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code IN ('DISPOSAL_BOOK_VALUE', 'DISPOSAL_PROCEEDS', 'DISPOSAL_RECEIVABLE')
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = d.account_code AND g.is_active
ON CONFLICT (tenant_id, role_code) DO NOTHING;

-- ─── Paramètres ───
CREATE TABLE public.asset_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  declining_coef_short numeric(4, 2) NOT NULL DEFAULT 1.5 CHECK (declining_coef_short >= 1),
  declining_coef_mid numeric(4, 2) NOT NULL DEFAULT 2 CHECK (declining_coef_mid >= 1),
  declining_coef_long numeric(4, 2) NOT NULL DEFAULT 2.5 CHECK (declining_coef_long >= 1),
  first_month_prorata boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.asset_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.asset_settings FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.asset_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'assets.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'assets.settings'));
GRANT SELECT, INSERT, UPDATE ON public.asset_settings TO authenticated;
CREATE OR REPLACE FUNCTION public.asset_setting(_tenant uuid)
 RETURNS public.asset_settings LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s FROM public.asset_settings s WHERE s.tenant_id = _tenant), ROW(_tenant, 1.5, 2, 2.5, true, now())::public.asset_settings)
$function$;
REVOKE ALL ON FUNCTION public.asset_setting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asset_setting(uuid) TO authenticated;

-- ─── Catégories ───
DROP POLICY "Tenant isolation" ON public.asset_categories;
CREATE POLICY "Lecture société" ON public.asset_categories FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.asset_categories FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'assets.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'assets.settings'));

CREATE OR REPLACE FUNCTION public.guard_asset_category()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE _a text; _d text; _e text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN NEW; END IF;
  SELECT code INTO _a FROM public.gl_accounts WHERE id = NEW.gl_asset_account_id AND tenant_id = NEW.tenant_id AND is_active AND NOT is_header;
  SELECT code INTO _d FROM public.gl_accounts WHERE id = NEW.gl_depreciation_account_id AND tenant_id = NEW.tenant_id AND is_active AND NOT is_header;
  SELECT code INTO _e FROM public.gl_accounts WHERE id = NEW.gl_expense_account_id AND tenant_id = NEW.tenant_id AND is_active AND NOT is_header;
  IF _a IS NULL OR _d IS NULL OR _e IS NULL THEN
    RAISE EXCEPTION 'Catégorie : les trois comptes (immobilisation, amortissements, dotation) sont obligatoires, actifs et imputables' USING ERRCODE = 'QG025';
  END IF;
  IF _a !~ '^2[0-7]' THEN RAISE EXCEPTION 'Compte d''immobilisation % : un compte de la classe 2 (hors 28 / 29) est attendu', _a USING ERRCODE = 'QG025'; END IF;
  IF _d !~ '^28' THEN RAISE EXCEPTION 'Compte d''amortissements % : un compte 28x est attendu', _d USING ERRCODE = 'QG025'; END IF;
  IF _e !~ '^68' THEN RAISE EXCEPTION 'Compte de dotation % : un compte 68x est attendu', _e USING ERRCODE = 'QG025'; END IF;
  IF NEW.depreciation_method NOT IN ('straight_line', 'declining_balance') THEN
    RAISE EXCEPTION 'Méthode d''amortissement : linéaire ou dégressif' USING ERRCODE = 'QG025';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_asset_category BEFORE INSERT OR UPDATE ON public.asset_categories FOR EACH ROW EXECUTE FUNCTION public.guard_asset_category();

-- ─── Fiches ───
ALTER TABLE public.assets
  ADD COLUMN in_service_date date,
  ADD COLUMN opening_accumulated numeric(18, 2) NOT NULL DEFAULT 0 CHECK (opening_accumulated >= 0),
  ADD COLUMN opening_date date,
  ADD CONSTRAINT assets_method_check CHECK (depreciation_method IN ('straight_line', 'declining_balance')),
  ADD CONSTRAINT assets_status_check CHECK (status IN ('active', 'fully_depreciated', 'disposed'));
UPDATE public.assets SET in_service_date = acquisition_date WHERE in_service_date IS NULL;
CREATE UNIQUE INDEX assets_code_unique ON public.assets (tenant_id, asset_code);

DROP POLICY "Tenant isolation" ON public.assets;
CREATE POLICY "Lecture société" ON public.assets FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion habilitée" ON public.assets FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'assets.manage'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'assets.manage'));

CREATE OR REPLACE FUNCTION public.guard_asset()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE _app boolean := current_user IN ('authenticated', 'anon', 'qerp_api'); _used boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF _app AND (EXISTS (SELECT 1 FROM public.depreciation_entries WHERE asset_id = OLD.id) OR OLD.status = 'disposed') THEN
      RAISE EXCEPTION 'Immobilisation % amortie ou cédée : elle ne se supprime pas', OLD.asset_code USING ERRCODE = 'QG025';
    END IF;
    RETURN OLD;
  END IF;
  IF _app THEN
    IF NEW.acquisition_cost IS NULL OR NEW.acquisition_cost <= 0 THEN RAISE EXCEPTION 'Coût d''acquisition positif requis' USING ERRCODE = 'QG025'; END IF;
    IF NEW.salvage_value < 0 OR NEW.salvage_value >= NEW.acquisition_cost THEN RAISE EXCEPTION 'Valeur résiduelle : entre 0 et le coût' USING ERRCODE = 'QG025'; END IF;
    IF NEW.useful_life_months IS NULL OR NEW.useful_life_months <= 0 THEN RAISE EXCEPTION 'Durée d''utilisation (mois) positive requise' USING ERRCODE = 'QG025'; END IF;
    IF NEW.opening_accumulated > NEW.acquisition_cost - NEW.salvage_value THEN RAISE EXCEPTION 'Cumul d''ouverture supérieur à la base amortissable' USING ERRCODE = 'QG025'; END IF;
    NEW.in_service_date := COALESCE(NEW.in_service_date, NEW.acquisition_date);
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'active'; NEW.disposal_date := NULL; NEW.disposal_amount := NULL; NEW.accumulated_depreciation := NEW.opening_accumulated;
    ELSE
      _used := EXISTS (SELECT 1 FROM public.depreciation_entries WHERE asset_id = OLD.id);
      IF OLD.status = 'disposed' THEN RAISE EXCEPTION 'Immobilisation % cédée : sa fiche est figée', OLD.asset_code USING ERRCODE = 'QG025'; END IF;
      IF (NEW.status, NEW.disposal_date, NEW.disposal_amount, NEW.accumulated_depreciation) IS DISTINCT FROM (OLD.status, OLD.disposal_date, OLD.disposal_amount, OLD.accumulated_depreciation) THEN
        RAISE EXCEPTION 'Cumul, statut et cession d''une immobilisation sont calculés (amortissements, cession)' USING ERRCODE = 'QG025';
      END IF;
      IF _used AND (NEW.acquisition_cost, NEW.salvage_value, NEW.useful_life_months, NEW.depreciation_method, NEW.in_service_date, NEW.category_id, NEW.opening_accumulated)
                   IS DISTINCT FROM (OLD.acquisition_cost, OLD.salvage_value, OLD.useful_life_months, OLD.depreciation_method, OLD.in_service_date, OLD.category_id, OLD.opening_accumulated) THEN
        RAISE EXCEPTION 'Immobilisation % amortie : coût, durée, méthode, mise en service et catégorie sont figés', OLD.asset_code USING ERRCODE = 'QG025';
      END IF;
    END IF;
  END IF;
  NEW.net_book_value := NEW.acquisition_cost - NEW.accumulated_depreciation;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_asset BEFORE INSERT OR UPDATE OR DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.guard_asset();

-- ─── Calculs d'amortissement ───
CREATE TABLE public.depreciation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  assets_count integer NOT NULL DEFAULT 0,
  total numeric(18, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  reversal_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX depreciation_runs_one_period ON public.depreciation_runs (tenant_id, period) WHERE status = 'posted';
ALTER TABLE public.depreciation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.depreciation_runs FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.depreciation_runs TO authenticated;

ALTER TABLE public.depreciation_entries
  ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  ADD COLUMN run_id uuid REFERENCES public.depreciation_runs(id),
  ADD COLUMN kind text NOT NULL DEFAULT 'periodic' CHECK (kind IN ('periodic', 'disposal'));
UPDATE public.depreciation_entries e SET tenant_id = a.tenant_id FROM public.assets a WHERE a.id = e.asset_id;
CREATE UNIQUE INDEX depreciation_entries_one_month ON public.depreciation_entries (asset_id, period_date);
DROP POLICY "Access via asset" ON public.depreciation_entries;
CREATE POLICY "Lecture société" ON public.depreciation_entries FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.depreciation_entries FROM authenticated, anon;
DROP POLICY "tenant access asset_disposals" ON public.asset_disposals;
CREATE POLICY "Lecture société" ON public.asset_disposals FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.asset_disposals FROM authenticated, anon;

-- Cumul et VNC recalculés à chaque amortissement ajouté ou retiré.
CREATE OR REPLACE FUNCTION public.refresh_asset_depreciation()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _id uuid := COALESCE(NEW.asset_id, OLD.asset_id);
BEGIN
  UPDATE public.assets a SET
    accumulated_depreciation = a.opening_accumulated + COALESCE((SELECT sum(e.amount) FROM public.depreciation_entries e WHERE e.asset_id = a.id), 0),
    net_book_value = a.acquisition_cost - a.opening_accumulated - COALESCE((SELECT sum(e.amount) FROM public.depreciation_entries e WHERE e.asset_id = a.id), 0),
    status = CASE WHEN a.status = 'disposed' THEN 'disposed'
                  WHEN a.acquisition_cost - a.opening_accumulated - COALESCE((SELECT sum(e.amount) FROM public.depreciation_entries e WHERE e.asset_id = a.id), 0) <= a.salvage_value
                  THEN 'fully_depreciated' ELSE 'active' END
   WHERE a.id = _id;
  RETURN NULL;
END $function$;
CREATE TRIGGER trg_refresh_asset_depreciation AFTER INSERT OR UPDATE OR DELETE ON public.depreciation_entries FOR EACH ROW EXECUTE FUNCTION public.refresh_asset_depreciation();

-- Dotation d'une immobilisation pour un mois (jusqu'au jour _until inclus pour une cession).
CREATE OR REPLACE FUNCTION public.asset_depreciation_amount(_a public.assets, _period date, _until date DEFAULT NULL)
 RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _s public.asset_settings := public.asset_setting(_a.tenant_id);
  _start date := date_trunc('month', _period)::date;
  _end date := (date_trunc('month', _period) + interval '1 month - 1 day')::date;
  _days numeric := extract(day FROM _end);
  _base numeric := _a.acquisition_cost - _a.salvage_value;
  _done numeric := _a.opening_accumulated + COALESCE((SELECT sum(e.amount) FROM public.depreciation_entries e WHERE e.asset_id = _a.id AND e.period_date < _start), 0);
  _left numeric := _base - _done;
  _elapsed int; _remaining int; _years numeric; _coef numeric; _monthly numeric; _share numeric := 1;
BEGIN
  IF _a.in_service_date IS NULL OR _a.in_service_date > COALESCE(_until, _end) OR _left <= 0 THEN RETURN 0; END IF;
  _elapsed := (extract(year FROM age(_start, date_trunc('month', _a.in_service_date))) * 12 + extract(month FROM age(_start, date_trunc('month', _a.in_service_date))))::int;
  IF _a.opening_date IS NOT NULL AND _period <= _a.opening_date THEN RETURN 0; END IF;
  _remaining := greatest(_a.useful_life_months - _elapsed, 1);
  IF _a.depreciation_method = 'declining_balance' THEN
    _years := _a.useful_life_months / 12.0;
    _coef := CASE WHEN _years <= 4 THEN _s.declining_coef_short WHEN _years <= 6 THEN _s.declining_coef_mid ELSE _s.declining_coef_long END;
    _monthly := greatest((_a.acquisition_cost - _done) * _coef / _years / 12, _left / _remaining);
  ELSE
    _monthly := _base / _a.useful_life_months;
  END IF;
  -- Prorata des jours : du jour de mise en service (premier mois, si paramétré) au jour de sortie.
  _share := ((COALESCE(_until, _end) - greatest(_start, CASE WHEN _s.first_month_prorata THEN _a.in_service_date ELSE _start END)) + 1) / _days;
  RETURN round(least(_monthly * _share, _left), 2);
END $function$;
REVOKE ALL ON FUNCTION public.asset_depreciation_amount(public.assets, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_depreciation(_period text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _start date; _end date; _run uuid; _entry uuid; _a record; _amt numeric; _n int := 0; _total numeric := 0; _missing text;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'assets.depreciate') THEN
    RAISE EXCEPTION 'Droit insuffisant : calculer les amortissements' USING ERRCODE = '42501';
  END IF;
  IF _period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Période attendue au format AAAA-MM' USING ERRCODE = 'QG025'; END IF;
  _start := to_date(_period || '-01', 'YYYY-MM-DD'); _end := (_start + interval '1 month - 1 day')::date;
  IF EXISTS (SELECT 1 FROM public.depreciation_runs WHERE tenant_id = _tenant AND period = _period AND status = 'posted') THEN
    RAISE EXCEPTION 'Amortissements de % déjà calculés (contre-passer le calcul pour le refaire)', _period USING ERRCODE = 'QG025';
  END IF;
  SELECT string_agg(a.asset_code, ', ') INTO _missing FROM public.assets a
   WHERE a.tenant_id = _tenant AND a.status = 'active' AND a.in_service_date <= _end AND a.category_id IS NULL;
  IF _missing IS NOT NULL THEN RAISE EXCEPTION 'Immobilisations sans catégorie (comptes inconnus) : %', left(_missing, 300) USING ERRCODE = 'QG025'; END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _end, 'ASSETS');

  INSERT INTO public.depreciation_runs (tenant_id, period, created_by) VALUES (_tenant, _period, auth.uid()) RETURNING id INTO _run;
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-AMORT-' || _period || '-' || substr(gen_random_uuid()::text, 1, 6), _end, 'Dotations aux amortissements ' || _period, 'depreciation', 'draft', auth.uid())
  RETURNING id INTO _entry;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.dotations (expense uuid, accum uuid, amount numeric) ON COMMIT DROP;
  TRUNCATE pg_temp.dotations;
  FOR _a IN SELECT a.*, c.gl_expense_account_id, c.gl_depreciation_account_id FROM public.assets a JOIN public.asset_categories c ON c.id = a.category_id
             WHERE a.tenant_id = _tenant AND a.status = 'active' AND a.in_service_date <= _end
               AND NOT EXISTS (SELECT 1 FROM public.depreciation_entries e WHERE e.asset_id = a.id AND e.period_date = _start) LOOP
    _amt := public.asset_depreciation_amount((SELECT x FROM public.assets x WHERE x.id = _a.id), _start);
    CONTINUE WHEN _amt <= 0;
    INSERT INTO public.depreciation_entries (tenant_id, asset_id, period_date, amount, accumulated, net_book_value, journal_entry_id, run_id)
    VALUES (_tenant, _a.id, _start, _amt, _a.accumulated_depreciation + _amt, _a.acquisition_cost - _a.accumulated_depreciation - _amt, _entry, _run);
    INSERT INTO pg_temp.dotations VALUES (_a.gl_expense_account_id, _a.gl_depreciation_account_id, _amt);
    _n := _n + 1; _total := _total + _amt;
  END LOOP;
  IF _n = 0 THEN
    DELETE FROM public.journal_entries WHERE id = _entry;
    DELETE FROM public.depreciation_runs WHERE id = _run;
    RETURN jsonb_build_object('immobilisations', 0, 'total', 0);
  END IF;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  SELECT _entry, expense, sum(amount), 0, 'Dotations aux amortissements ' || _period FROM pg_temp.dotations GROUP BY expense;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  SELECT _entry, accum, 0, sum(amount), 'Amortissements ' || _period FROM pg_temp.dotations GROUP BY accum;
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;
  UPDATE public.depreciation_runs SET journal_entry_id = _entry, assets_count = _n, total = _total WHERE id = _run;
  RETURN jsonb_build_object('immobilisations', _n, 'total', _total, 'ecriture', _entry);
END $function$;
REVOKE ALL ON FUNCTION public.run_depreciation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_depreciation(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_last_depreciation(_reason text)
 RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _r public.depreciation_runs%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'assets.depreciate') THEN
    RAISE EXCEPTION 'Droit insuffisant : calculer les amortissements' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'Motif obligatoire' USING ERRCODE = 'QG025'; END IF;
  SELECT * INTO _r FROM public.depreciation_runs WHERE tenant_id = _tenant AND status = 'posted' ORDER BY period DESC LIMIT 1 FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Aucun calcul d''amortissement à contre-passer' USING ERRCODE = 'QG025'; END IF;
  IF EXISTS (SELECT 1 FROM public.depreciation_entries e JOIN public.assets a ON a.id = e.asset_id WHERE e.run_id = _r.id AND a.status = 'disposed') THEN
    RAISE EXCEPTION 'Une immobilisation du calcul a été cédée depuis : contre-passation refusée' USING ERRCODE = 'QG025';
  END IF;
  PERFORM public.reverse_journal_entry(_r.journal_entry_id, (to_date(_r.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date, btrim(_reason));
  DELETE FROM public.depreciation_entries WHERE run_id = _r.id;
  UPDATE public.depreciation_runs SET status = 'reversed', reversal_reason = btrim(_reason) WHERE id = _r.id;
  RETURN _r.period;
END $function$;
REVOKE ALL ON FUNCTION public.reverse_last_depreciation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_last_depreciation(text) TO authenticated;

-- ─── Cession ───
CREATE OR REPLACE FUNCTION public.dispose_asset(_asset uuid, _date date, _type text, _price numeric, _proceeds text DEFAULT 'receivable', _notes text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _a public.assets%ROWTYPE; _c public.asset_categories%ROWTYPE; _start date := date_trunc('month', _date)::date;
  _partial numeric; _accum numeric; _nbv numeric; _entry uuid; _price2 numeric := round(COALESCE(_price, 0), 2); _cash uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'assets.dispose') THEN
    RAISE EXCEPTION 'Droit insuffisant : céder une immobilisation' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _a FROM public.assets WHERE id = _asset AND tenant_id = _tenant FOR UPDATE;
  IF _a.id IS NULL THEN RAISE EXCEPTION 'Immobilisation introuvable' USING ERRCODE = 'QG025'; END IF;
  IF _a.status = 'disposed' THEN RAISE EXCEPTION 'Immobilisation déjà cédée' USING ERRCODE = 'QG025'; END IF;
  IF _type NOT IN ('sale', 'scrap') THEN RAISE EXCEPTION 'Type de sortie : cession ou mise au rebut' USING ERRCODE = 'QG025'; END IF;
  IF _date IS NULL OR _date < _a.in_service_date THEN RAISE EXCEPTION 'Date de sortie postérieure à la mise en service requise' USING ERRCODE = 'QG025'; END IF;
  IF _price2 < 0 OR (_type = 'scrap' AND _price2 > 0) THEN RAISE EXCEPTION 'Prix de cession : positif pour une cession, nul pour une mise au rebut' USING ERRCODE = 'QG025'; END IF;
  SELECT * INTO _c FROM public.asset_categories WHERE id = _a.category_id;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Immobilisation sans catégorie : comptes inconnus' USING ERRCODE = 'QG025'; END IF;
  IF EXISTS (SELECT 1 FROM public.depreciation_entries WHERE asset_id = _a.id AND period_date >= _start) THEN
    RAISE EXCEPTION 'Le mois de la sortie est déjà amorti : contre-passer le calcul de ce mois avant de céder' USING ERRCODE = 'QG025';
  END IF;
  -- Les mois précédant la sortie sont amortis (dernier amortissement, reprise d'ouverture ou mois d'avant la mise en service).
  IF _a.net_book_value > _a.salvage_value AND greatest(
       COALESCE((SELECT max(e.period_date) FROM public.depreciation_entries e WHERE e.asset_id = _a.id), '0001-01-01'::date),
       COALESCE(date_trunc('month', _a.opening_date)::date, '0001-01-01'::date),
       (date_trunc('month', _a.in_service_date) - interval '1 month')::date) < (_start - interval '1 month')::date THEN
    RAISE EXCEPTION 'Calculer d''abord les amortissements jusqu''au mois précédant la sortie' USING ERRCODE = 'QG025';
  END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'ASSETS');

  _partial := public.asset_depreciation_amount(_a, _start, _date);
  _accum := _a.accumulated_depreciation + _partial;
  _nbv := _a.acquisition_cost - _accum;
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-CESS-' || to_char(_date, 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6), _date,
          CASE WHEN _type = 'sale' THEN 'Cession de l''immobilisation ' ELSE 'Mise au rebut de l''immobilisation ' END || _a.asset_code || ' — ' || _a.name, 'asset_disposal', 'draft', auth.uid())
  RETURNING id INTO _entry;
  IF _partial > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description) VALUES
      (_entry, _c.gl_expense_account_id, _partial, 0, 'Dotation du mois de sortie'), (_entry, _c.gl_depreciation_account_id, 0, _partial, 'Dotation du mois de sortie');
    INSERT INTO public.depreciation_entries (tenant_id, asset_id, period_date, amount, accumulated, net_book_value, journal_entry_id, kind)
    VALUES (_tenant, _a.id, _start, _partial, _accum, _nbv, _entry, 'disposal');
  END IF;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description) VALUES
    (_entry, _c.gl_depreciation_account_id, _accum, 0, 'Sortie : amortissements cumulés'),
    (_entry, public.require_posting_account(_tenant, 'DISPOSAL_BOOK_VALUE'), _nbv, 0, 'Sortie : valeur nette comptable'),
    (_entry, _c.gl_asset_account_id, 0, _a.acquisition_cost, 'Sortie : coût d''acquisition');
  IF _price2 > 0 THEN
    _cash := CASE WHEN _proceeds = 'bank' THEN public.treasury_gl_account(_tenant, NULL, 'bank_transfer') ELSE public.require_posting_account(_tenant, 'DISPOSAL_RECEIVABLE') END;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description) VALUES
      (_entry, _cash, _price2, 0, 'Prix de cession'), (_entry, public.require_posting_account(_tenant, 'DISPOSAL_PROCEEDS'), 0, _price2, 'Produit de cession');
  END IF;
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;
  INSERT INTO public.asset_disposals (tenant_id, asset_id, disposal_date, disposal_type, sale_price, net_book_value_at_disposal, gain_loss, journal_entry_id, notes, created_by)
  VALUES (_tenant, _a.id, _date, _type, _price2, _nbv, _price2 - _nbv, _entry, NULLIF(btrim(_notes), ''), auth.uid());
  UPDATE public.assets SET status = 'disposed', disposal_date = _date, disposal_amount = _price2 WHERE id = _a.id;
  RETURN jsonb_build_object('valeur_nette', _nbv, 'prix', _price2, 'plus_ou_moins_value', _price2 - _nbv, 'ecriture', _entry);
END $function$;
REVOKE ALL ON FUNCTION public.dispose_asset(uuid, date, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispose_asset(uuid, date, text, numeric, text, text) TO authenticated;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
