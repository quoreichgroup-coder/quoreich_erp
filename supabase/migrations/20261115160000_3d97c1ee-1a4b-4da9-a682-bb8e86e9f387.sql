-- V67 — Plan comptable, lot PC-6 (livrable docs/audit-erp/12) : migration du plan opérationnel.
--
-- Changer de référentiel (ex. SYSCOHADA → PCG, plan local → plan de groupe) est une migration
-- comptable, pas un paramètre (V18) : elle part d'une correspondance **validée** (V66) et se fait en
-- deux temps, comme les migrations de SAP (conversion de plan) et de Sage (« changement de plan ») :
--   1. simulation obligatoire (droit accounting.reclassify) : `simulate_chart_migration(mapping, date,
--      motif)` calcule et enregistre le plan de migration — par compte : cible (même code, compte à
--      créer, compte existant réutilisé), clé, solde à reclasser à la date, rôles d'imputation à
--      rediriger — et les anomalies bloquantes (cible de regroupement ou bloquée, période fermée) ;
--      rien n'est écrit dans le plan ni dans les écritures ;
--   2. application (`apply_chart_migration`), par une autre personne que l'auteur de la simulation si
--      la société l'exige (paramètre `migration_second_person`) : la simulation est recalculée et doit
--      être identique (sinon : nouvelle simulation), puis en une transaction : comptes cibles créés,
--      **une écriture OD nouvelle** (source `reclassification`, datée) qui solde chaque compte migré vers
--      ses cibles (répartition, arrondi sur la dernière cible), rôles d'imputation redirigés, anciens
--      comptes conservés, désactivés et reliés à leur remplaçant (`replaced_by`), référentiel du plan et
--      de la société mis à jour. Aucune écriture passée n'est modifiée ; l'historique reste consultable.
-- `replace_gl_account` lit désormais le format des codes du référentiel (règle CODE_FORMAT, V64).
-- Droit accounting.reclassify. Erreurs : QG022.

-- ─── Droit et paramètre ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('accounting.reclassify', 'accounting', 'reclassify', 'Migrer le plan comptable et reclasser les soldes')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT 'admin', 'accounting.reclassify' WHERE EXISTS (SELECT 1 FROM public.erp_system_roles WHERE code = 'admin')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code = 'accounting.reclassify' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

ALTER TABLE public.chart_import_settings ADD COLUMN migration_second_person boolean NOT NULL DEFAULT true;
CREATE OR REPLACE FUNCTION public.chart_import_setting(_tenant uuid)
 RETURNS public.chart_import_settings
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s FROM public.chart_import_settings s WHERE s.tenant_id = _tenant),
                  ROW(_tenant, true, true, now(), true, true)::public.chart_import_settings)
$function$;

-- ─── Migrations ───
CREATE TABLE public.chart_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  mapping_id uuid NOT NULL REFERENCES public.chart_mappings(id),
  migration_date date NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  status text NOT NULL DEFAULT 'simulated' CHECK (status IN ('simulated', 'applied', 'cancelled')),
  plan jsonb NOT NULL,
  blocking integer NOT NULL DEFAULT 0,
  entry_id uuid REFERENCES public.journal_entries(id),
  simulated_by uuid NOT NULL,
  simulated_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid,
  applied_at timestamptz
);
ALTER TABLE public.chart_migrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.chart_migrations FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.chart_migrations TO authenticated;

-- Plan de migration : un rang par (compte source, cible) des lignes validées.
CREATE OR REPLACE FUNCTION public.chart_migration_plan(_mapping uuid, _date date)
 RETURNS TABLE (source_account_id uuid, source_code text, source_name text, target_code text, target_name text, target_type text,
                target_account_id uuid, ratio numeric, action text, balance numeric, moved numeric, roles text, problem text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH m AS (SELECT * FROM public.chart_mappings WHERE id = _mapping),
  l AS (
    SELECT cl.*, g.code AS scode, g.name AS sname,
           row_number() OVER (PARTITION BY cl.source_account_id ORDER BY cl.ratio, cl.target_code) AS rang,
           count(*) OVER (PARTITION BY cl.source_account_id) AS nb
      FROM public.chart_mapping_lines cl JOIN m ON m.id = cl.mapping_id
      JOIN public.gl_accounts g ON g.id = cl.source_account_id
     WHERE cl.status = 'validated'),
  s AS (
    SELECT j.account_id, sum(j.debit - j.credit) AS solde
      FROM public.journal_lines j JOIN public.journal_entries e ON e.id = j.entry_id JOIN m ON m.tenant_id = e.tenant_id
     WHERE e.status IN ('posted', 'reversed') AND e.entry_date <= _date
     GROUP BY j.account_id)
  SELECT l.source_account_id, l.scode, l.sname, l.target_code, l.target_name, l.target_type, t.id, l.ratio,
         CASE WHEN l.target_code = l.scode THEN 'same' WHEN t.id IS NULL THEN 'create' ELSE 'reuse' END,
         COALESCE(s.solde, 0),
         CASE WHEN l.target_code = l.scode THEN 0
              WHEN l.rang < l.nb THEN round(COALESCE(s.solde, 0) * l.ratio / 100, 2)
              ELSE COALESCE(s.solde, 0) - COALESCE((SELECT sum(round(COALESCE(s.solde, 0) * o.ratio / 100, 2)) FROM l o
                                                     WHERE o.source_account_id = l.source_account_id AND o.rang < l.nb), 0) END,
         (SELECT string_agg(p.role_code, ', ' ORDER BY p.role_code) FROM public.tenant_posting_accounts p WHERE p.gl_account_id = l.source_account_id AND l.target_code <> l.scode AND l.rang = l.nb),
         CASE WHEN t.id IS NOT NULL AND t.is_header AND l.target_code <> l.scode THEN 'Cible ' || l.target_code || ' : compte de regroupement'
              WHEN t.id IS NOT NULL AND t.posting_mode = 'blocked' AND l.target_code <> l.scode THEN 'Cible ' || l.target_code || ' : imputation bloquée'
              WHEN t.id IS NOT NULL AND t.replaced_by IS NOT NULL THEN 'Cible ' || l.target_code || ' : compte déjà remplacé'
         END
    FROM l
    CROSS JOIN m
    LEFT JOIN public.gl_accounts t ON t.tenant_id = m.tenant_id AND t.code = l.target_code
    LEFT JOIN s ON s.account_id = l.source_account_id
   ORDER BY l.scode, l.rang
$function$;
REVOKE ALL ON FUNCTION public.chart_migration_plan(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chart_migration_mapping(_mapping uuid)
 RETURNS public.chart_mappings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _m public.chart_mappings%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'accounting.reclassify') THEN
    RAISE EXCEPTION 'Droit insuffisant : migrer le plan comptable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _m FROM public.chart_mappings WHERE id = _mapping AND tenant_id = public.get_user_tenant_id(auth.uid());
  IF _m.id IS NULL THEN RAISE EXCEPTION 'Correspondance introuvable' USING ERRCODE = 'QG022'; END IF;
  IF _m.status <> 'validated' THEN RAISE EXCEPTION 'Seule une correspondance validée sert à migrer le plan' USING ERRCODE = 'QG022'; END IF;
  RETURN _m;
END $function$;
REVOKE ALL ON FUNCTION public.chart_migration_mapping(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chart_migration_plan_json(_mapping uuid, _date date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(to_jsonb(p) - 'target_account_id' ORDER BY p.source_code, p.target_code), '[]'::jsonb)
    FROM public.chart_migration_plan(_mapping, _date) p
$function$;
REVOKE ALL ON FUNCTION public.chart_migration_plan_json(uuid, date) FROM PUBLIC, anon, authenticated;

-- 1. Simulation (obligatoire) : rien n'est écrit hors de chart_migrations.
CREATE OR REPLACE FUNCTION public.simulate_chart_migration(_mapping uuid, _date date, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _m public.chart_mappings%ROWTYPE := public.chart_migration_mapping(_mapping);
  _plan jsonb; _blocking int; _id uuid;
BEGIN
  IF _date IS NULL THEN RAISE EXCEPTION 'Date de migration obligatoire' USING ERRCODE = 'QG022'; END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'Motif de la migration obligatoire' USING ERRCODE = 'QG022'; END IF;
  _plan := public.chart_migration_plan_json(_mapping, _date);
  IF jsonb_array_length(_plan) = 0 THEN RAISE EXCEPTION 'Correspondance sans ligne validée : rien à migrer' USING ERRCODE = 'QG022'; END IF;
  SELECT count(*) INTO _blocking FROM jsonb_array_elements(_plan) x WHERE x ->> 'problem' IS NOT NULL;
  BEGIN
    PERFORM public.assert_fiscal_period_open(_m.tenant_id, _date, 'GL');
  EXCEPTION WHEN OTHERS THEN
    _plan := _plan || jsonb_build_array(jsonb_build_object('problem', 'Période fermée au ' || _date || ' : ' || SQLERRM));
    _blocking := _blocking + 1;
  END;
  UPDATE public.chart_migrations SET status = 'cancelled' WHERE mapping_id = _mapping AND status = 'simulated';
  INSERT INTO public.chart_migrations (tenant_id, mapping_id, migration_date, reason, plan, blocking, simulated_by)
  VALUES (_m.tenant_id, _mapping, _date, btrim(_reason), _plan, _blocking, auth.uid()) RETURNING id INTO _id;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.simulate_chart_migration(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.simulate_chart_migration(uuid, date, text) TO authenticated;

-- 2. Application, tout ou rien.
CREATE OR REPLACE FUNCTION public.apply_chart_migration(_migration uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _mig public.chart_migrations%ROWTYPE;
  _m public.chart_mappings%ROWTYPE;
  _p record; _entry uuid; _created int := 0; _replaced int := 0; _roles int := 0; _lines int := 0; _n int;
  _main uuid; _fw text;
BEGIN
  SELECT * INTO _mig FROM public.chart_migrations WHERE id = _migration AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF _mig.id IS NULL THEN RAISE EXCEPTION 'Migration introuvable' USING ERRCODE = 'QG022'; END IF;
  _m := public.chart_migration_mapping(_mig.mapping_id);
  IF _mig.status <> 'simulated' THEN RAISE EXCEPTION 'Seule une simulation en cours s''applique (état : %)', _mig.status USING ERRCODE = 'QG022'; END IF;
  IF (public.chart_import_setting(_mig.tenant_id)).migration_second_person AND _mig.simulated_by = auth.uid() THEN
    RAISE EXCEPTION 'Séparation des tâches : la migration est appliquée par une autre personne que celle qui l''a simulée' USING ERRCODE = 'QG022';
  END IF;
  IF _mig.blocking > 0 THEN RAISE EXCEPTION 'Simulation avec % anomalie(s) bloquante(s) : corriger puis simuler à nouveau', _mig.blocking USING ERRCODE = 'QG022'; END IF;
  IF public.chart_migration_plan_json(_mig.mapping_id, _mig.migration_date) IS DISTINCT FROM _mig.plan THEN
    RAISE EXCEPTION 'Le plan ou les soldes ont changé depuis la simulation : simuler à nouveau' USING ERRCODE = 'QG022';
  END IF;
  PERFORM public.assert_fiscal_period_open(_mig.tenant_id, _mig.migration_date, 'GL');

  -- Comptes cibles.
  FOR _p IN SELECT DISTINCT target_code, target_name, target_type, source_code FROM public.chart_migration_plan(_mig.mapping_id, _mig.migration_date)
             WHERE action = 'create' LOOP
    IF NOT EXISTS (SELECT 1 FROM public.gl_accounts WHERE tenant_id = _mig.tenant_id AND code = _p.target_code) THEN
      INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
      VALUES (_mig.tenant_id, _p.target_code, _p.target_name,
              COALESCE(_p.target_type, (SELECT g.account_type FROM public.gl_accounts g WHERE g.tenant_id = _mig.tenant_id AND g.code = _p.source_code)));
      _created := _created + 1;
    END IF;
  END LOOP;
  UPDATE public.gl_accounts t SET is_active = true
   WHERE t.tenant_id = _mig.tenant_id AND NOT t.is_active AND t.replaced_by IS NULL
     AND t.code IN (SELECT p.target_code FROM public.chart_migration_plan(_mig.mapping_id, _mig.migration_date) p WHERE p.action = 'reuse');

  -- Écriture OD de reclassement (une seule, datée).
  IF EXISTS (SELECT 1 FROM public.chart_migration_plan(_mig.mapping_id, _mig.migration_date) WHERE action <> 'same' AND moved <> 0) THEN
    INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
    VALUES (_mig.tenant_id, 'JE-MIG-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6), _mig.migration_date,
            'Migration du plan comptable — ' || _mig.reason, 'reclassification', 'draft', auth.uid())
    RETURNING id INTO _entry;
    FOR _p IN SELECT p.*, t.id AS tid FROM public.chart_migration_plan(_mig.mapping_id, _mig.migration_date) p
               JOIN public.gl_accounts t ON t.tenant_id = _mig.tenant_id AND t.code = p.target_code
              WHERE p.action <> 'same' AND p.moved <> 0 LOOP
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry, _p.tid, GREATEST(_p.moved, 0), GREATEST(-_p.moved, 0), 'Migration depuis ' || _p.source_code),
             (_entry, _p.source_account_id, GREATEST(-_p.moved, 0), GREATEST(_p.moved, 0), 'Migration vers ' || _p.target_code);
      _lines := _lines + 2;
    END LOOP;
    UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;
  END IF;

  -- Rôles redirigés, anciens comptes conservés, désactivés, reliés à la cible principale (clé la plus forte).
  FOR _p IN SELECT DISTINCT p.source_account_id FROM public.chart_migration_plan(_mig.mapping_id, _mig.migration_date) p WHERE p.action <> 'same' LOOP
    SELECT t.id INTO _main FROM public.chart_migration_plan(_mig.mapping_id, _mig.migration_date) p
      JOIN public.gl_accounts t ON t.tenant_id = _mig.tenant_id AND t.code = p.target_code
     WHERE p.source_account_id = _p.source_account_id ORDER BY p.ratio DESC, p.target_code LIMIT 1;
    UPDATE public.tenant_posting_accounts SET gl_account_id = _main, updated_at = now(), updated_by = auth.uid()
     WHERE tenant_id = _mig.tenant_id AND gl_account_id = _p.source_account_id;
    GET DIAGNOSTICS _n = ROW_COUNT; _roles := _roles + _n;
    UPDATE public.gl_accounts SET replaced_by = _main, is_active = false WHERE id = _p.source_account_id;
    _replaced := _replaced + 1;
  END LOOP;

  -- Référentiel du plan opérationnel et de la société.
  _fw := COALESCE(_m.target_framework, (SELECT c.framework_code FROM public.charts c WHERE c.id = _m.target_chart_id));
  IF _fw IS NOT NULL THEN
    UPDATE public.charts SET framework_code = _fw, updated_at = now(),
           framework_version = (SELECT v.version FROM public.framework_versions v WHERE v.framework_code = _fw AND v.status = 'published' ORDER BY v.effective_from DESC LIMIT 1)
     WHERE id = public.operational_chart_id(_mig.tenant_id);
    INSERT INTO public.tenant_accounting_settings (tenant_id, framework_code, applied_by) VALUES (_mig.tenant_id, _fw, auth.uid())
    ON CONFLICT (tenant_id) DO UPDATE SET framework_code = EXCLUDED.framework_code, applied_at = now(), applied_by = EXCLUDED.applied_by;
  END IF;

  UPDATE public.chart_migrations SET status = 'applied', applied_by = auth.uid(), applied_at = now(), entry_id = _entry WHERE id = _migration;
  RETURN jsonb_build_object('comptes_crees', _created, 'comptes_remplaces', _replaced, 'roles_rediriges', _roles,
                            'lignes_reclassement', _lines, 'ecriture', _entry, 'referentiel', _fw);
END $function$;
REVOKE ALL ON FUNCTION public.apply_chart_migration(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_chart_migration(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_chart_migration(_migration uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _mig public.chart_migrations%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'accounting.reclassify') THEN RAISE EXCEPTION 'Droit insuffisant : migrer le plan comptable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _mig FROM public.chart_migrations WHERE id = _migration AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF _mig.id IS NULL OR _mig.status <> 'simulated' THEN RAISE EXCEPTION 'Aucune simulation en cours à annuler' USING ERRCODE = 'QG022'; END IF;
  UPDATE public.chart_migrations SET status = 'cancelled' WHERE id = _migration;
END $function$;
REVOKE ALL ON FUNCTION public.cancel_chart_migration(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_chart_migration(uuid) TO authenticated;

-- Remplacement unitaire (V60) : format des codes selon le référentiel (règle CODE_FORMAT).
CREATE OR REPLACE FUNCTION public.replace_gl_account(_account_id uuid, _new_code text, _new_name text, _new_type text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.require_chart_right();
  _old public.gl_accounts%ROWTYPE;
  _new uuid;
  _fw text := public.chart_framework(_tenant);
  _pattern text;
BEGIN
  SELECT * INTO _old FROM public.gl_accounts WHERE id = _account_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte introuvable dans la société active' USING ERRCODE = 'QG019'; END IF;
  IF public.quality_rule_severity(_tenant, _fw, 'CODE_FORMAT') = 'error' THEN
    SELECT r.params ->> 'pattern' INTO _pattern FROM public.framework_quality_rules r WHERE r.framework_code = _fw AND r.rule_code = 'CODE_FORMAT';
  END IF;
  IF COALESCE(btrim(_new_code), '') = '' OR (_pattern IS NOT NULL AND _new_code !~ _pattern) THEN
    RAISE EXCEPTION 'Code du compte de remplacement invalide' USING ERRCODE = 'QG019';
  END IF;
  IF _new_code = _old.code THEN RAISE EXCEPTION 'Le compte de remplacement doit avoir un autre code' USING ERRCODE = 'QG019'; END IF;
  SELECT id INTO _new FROM public.gl_accounts WHERE tenant_id = _tenant AND code = _new_code;
  IF _new IS NULL THEN
    IF _new_type IS NULL OR _new_type NOT IN ('asset', 'liability', 'equity', 'revenue', 'expense') THEN
      RAISE EXCEPTION 'Type du compte de remplacement requis' USING ERRCODE = 'QG019';
    END IF;
    INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
    VALUES (_tenant, _new_code, COALESCE(NULLIF(btrim(_new_name), ''), _old.name), _new_type) RETURNING id INTO _new;
  ELSE
    UPDATE public.gl_accounts SET is_active = true WHERE id = _new AND NOT is_active;
  END IF;
  UPDATE public.tenant_posting_accounts SET gl_account_id = _new, updated_at = now(), updated_by = auth.uid()
   WHERE tenant_id = _tenant AND gl_account_id = _old.id;
  UPDATE public.gl_accounts SET replaced_by = _new, is_active = false WHERE id = _old.id;
  RETURN _new;
END $function$;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
