-- V66 — Plan comptable, lot PC-5 (livrable docs/audit-erp/12) : correspondances entre plans, plans
-- secondaires, comparaison et balance convertie.
--
-- 1. Plans secondaires (plan de groupe, plan d'un autre référentiel, plan Sage / SAP de reporting) :
--    `charts.kind = 'secondary'` + `secondary_chart_accounts` (aucune écriture ne s'y impute ; le code
--    unique par société de `gl_accounts` n'est pas touché). Création depuis un référentiel ou vide.
-- 2. Correspondances : `chart_mappings` (plan opérationnel → référentiel ou plan secondaire) et
--    `chart_mapping_lines` (compte source → code cible, clé de répartition en %, méthode, statut
--    proposé / validé / refusé, auteur, décideur). Proposition automatique (même code, préfixe le plus
--    long, indices d'intitulé du référentiel) **jamais appliquée sans validation** ; décision ligne à
--    ligne ou en lot par une autre personne que l'auteur (paramètre `mapping_second_person`) ;
--    validation de la correspondance : chaque compte actif mouvementé couvert à 100 %.
-- 3. Lecture : `compare_chart_mapping` (écarts de type, comptes non couverts, répartitions) et
--    `mapped_trial_balance` (balance de la période convertie dans le plan cible, lignes validées
--    seulement) — base des exports Sage / SAP et du plan de groupe.
-- Droits : accounting.mapping (proposer), accounting.mapping_validate (valider). Erreurs : QG021.

-- ─── Droits ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('accounting.mapping', 'accounting', 'mapping', 'Proposer des correspondances entre plans comptables'),
  ('accounting.mapping_validate', 'accounting', 'mapping_validate', 'Valider des correspondances entre plans comptables')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES ('admin', 'accounting.mapping'), ('accountant', 'accounting.mapping'), ('admin', 'accounting.mapping_validate')) AS v(r, p)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles WHERE code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code IN ('accounting.mapping', 'accounting.mapping_validate') AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

ALTER TABLE public.chart_import_settings ADD COLUMN mapping_second_person boolean NOT NULL DEFAULT true;
CREATE OR REPLACE FUNCTION public.chart_import_setting(_tenant uuid)
 RETURNS public.chart_import_settings
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s FROM public.chart_import_settings s WHERE s.tenant_id = _tenant),
                  ROW(_tenant, true, true, now(), true)::public.chart_import_settings)
$function$;

-- ─── 1. Plans secondaires ───
CREATE TABLE public.secondary_chart_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  chart_id uuid NOT NULL REFERENCES public.charts(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[0-9A-Za-z._-]+$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  account_type text CHECK (account_type IS NULL OR account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chart_id, code)
);
ALTER TABLE public.secondary_chart_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.secondary_chart_accounts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Administration habilitée" ON public.secondary_chart_accounts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart_admin'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart_admin')
              AND EXISTS (SELECT 1 FROM public.charts c WHERE c.id = chart_id AND c.tenant_id = secondary_chart_accounts.tenant_id AND c.kind = 'secondary'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.secondary_chart_accounts TO authenticated;

CREATE OR REPLACE FUNCTION public.create_secondary_chart(_code text, _name text, _framework text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _id uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'accounting.chart_admin') THEN
    RAISE EXCEPTION 'Droit insuffisant : administrer les plans comptables' USING ERRCODE = '42501';
  END IF;
  IF _framework IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = _framework) THEN
    RAISE EXCEPTION 'Référentiel comptable inconnu : %', _framework USING ERRCODE = 'QG021';
  END IF;
  IF EXISTS (SELECT 1 FROM public.charts WHERE tenant_id = _tenant AND code = upper(btrim(_code))) THEN
    RAISE EXCEPTION 'Un plan de code % existe déjà', upper(btrim(_code)) USING ERRCODE = 'QG021';
  END IF;
  INSERT INTO public.charts (tenant_id, code, name, kind, status, framework_code, framework_version, effective_from, created_by)
  VALUES (_tenant, upper(btrim(_code)), btrim(_name), 'secondary', 'active', _framework,
          (SELECT v.version FROM public.framework_versions v WHERE v.framework_code = _framework AND v.status = 'published' ORDER BY v.effective_from DESC LIMIT 1),
          CURRENT_DATE, auth.uid())
  RETURNING id INTO _id;
  IF _framework IS NOT NULL THEN
    INSERT INTO public.secondary_chart_accounts (tenant_id, chart_id, code, name, account_type)
    SELECT _tenant, _id, r.code, r.name, r.account_type FROM public.framework_reference_accounts r WHERE r.framework_code = _framework;
  END IF;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.create_secondary_chart(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_secondary_chart(text, text, text) TO authenticated;

-- ─── 2. Correspondances ───
CREATE TABLE public.chart_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  source_chart_id uuid NOT NULL REFERENCES public.charts(id),
  target_framework text REFERENCES public.accounting_frameworks(code),
  target_chart_id uuid REFERENCES public.charts(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'archived')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_by uuid,
  validated_at timestamptz,
  CHECK ((target_framework IS NULL) <> (target_chart_id IS NULL))
);
CREATE TABLE public.chart_mapping_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_id uuid NOT NULL REFERENCES public.chart_mappings(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_account_id uuid NOT NULL REFERENCES public.gl_accounts(id),
  target_code text NOT NULL,
  target_name text NOT NULL,
  target_type text,
  ratio numeric(7, 4) NOT NULL DEFAULT 100 CHECK (ratio > 0 AND ratio <= 100),
  method text NOT NULL CHECK (method IN ('same_code', 'prefix', 'label', 'manual')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'validated', 'rejected')),
  proposed_by uuid,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  comment text,
  UNIQUE (mapping_id, source_account_id, target_code)
);
CREATE INDEX chart_mapping_lines_source ON public.chart_mapping_lines (mapping_id, source_account_id);
ALTER TABLE public.chart_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_mapping_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.chart_mappings FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Lecture société" ON public.chart_mapping_lines FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.chart_mappings, public.chart_mapping_lines TO authenticated;

-- Compte cible : (code, intitulé, type) dans le référentiel ou le plan secondaire ; NULL si absent.
CREATE OR REPLACE FUNCTION public.mapping_target(_m public.chart_mappings, _code text)
 RETURNS TABLE (code text, name text, account_type text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.code, r.name, r.account_type FROM public.framework_reference_accounts r WHERE _m.target_framework IS NOT NULL AND r.framework_code = _m.target_framework AND r.code = _code
  UNION ALL
  SELECT s.code, s.name, s.account_type FROM public.secondary_chart_accounts s WHERE _m.target_chart_id IS NOT NULL AND s.chart_id = _m.target_chart_id AND s.code = _code
  LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.mapping_target(public.chart_mappings, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mapping_for(_mapping uuid, _right text, _draft boolean DEFAULT true)
 RETURNS public.chart_mappings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _m public.chart_mappings%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(), _right) THEN RAISE EXCEPTION 'Droit insuffisant (%)', _right USING ERRCODE = '42501'; END IF;
  SELECT * INTO _m FROM public.chart_mappings WHERE id = _mapping AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF _m.id IS NULL THEN RAISE EXCEPTION 'Correspondance introuvable' USING ERRCODE = 'QG021'; END IF;
  IF _draft AND _m.status <> 'draft' THEN
    RAISE EXCEPTION 'Correspondance % : elle ne se modifie plus (créer une nouvelle version)', CASE _m.status WHEN 'validated' THEN 'validée' ELSE 'archivée' END USING ERRCODE = 'QG021';
  END IF;
  RETURN _m;
END $function$;
REVOKE ALL ON FUNCTION public.mapping_for(uuid, text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_chart_mapping(_name text, _target_framework text, _target_chart uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _id uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'accounting.mapping') THEN
    RAISE EXCEPTION 'Droit insuffisant : proposer des correspondances' USING ERRCODE = '42501';
  END IF;
  IF (_target_framework IS NULL) = (_target_chart IS NULL) THEN
    RAISE EXCEPTION 'Choisir un référentiel ou un plan secondaire cible' USING ERRCODE = 'QG021';
  END IF;
  IF _target_framework IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = _target_framework) THEN
    RAISE EXCEPTION 'Référentiel comptable inconnu : %', _target_framework USING ERRCODE = 'QG021';
  END IF;
  IF _target_chart IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.charts WHERE id = _target_chart AND tenant_id = _tenant AND kind = 'secondary') THEN
    RAISE EXCEPTION 'Plan secondaire introuvable' USING ERRCODE = 'QG021';
  END IF;
  INSERT INTO public.chart_mappings (tenant_id, name, source_chart_id, target_framework, target_chart_id, created_by)
  VALUES (_tenant, btrim(_name), public.operational_chart_id(_tenant), _target_framework, _target_chart, auth.uid()) RETURNING id INTO _id;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.create_chart_mapping(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_chart_mapping(text, text, uuid) TO authenticated;

-- Proposition automatique pour les comptes actifs non encore couverts (jamais validée d'office).
CREATE OR REPLACE FUNCTION public.propose_chart_mapping(_mapping uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _m public.chart_mappings%ROWTYPE := public.mapping_for(_mapping, 'accounting.mapping');
  _hints text := COALESCE(_m.target_framework, (SELECT c.framework_code FROM public.charts c WHERE c.id = _m.target_chart_id));
  _a record; _t record; _method text; _n integer := 0;
BEGIN
  FOR _a IN SELECT g.* FROM public.gl_accounts g WHERE g.tenant_id = _m.tenant_id AND g.is_active AND NOT g.is_header
              AND NOT EXISTS (SELECT 1 FROM public.chart_mapping_lines l WHERE l.mapping_id = _mapping AND l.source_account_id = g.id AND l.status <> 'rejected')
            ORDER BY g.code LOOP
    _t := NULL; _method := NULL;
    SELECT x.* INTO _t FROM public.mapping_target(_m, _a.code) x;
    IF _t.code IS NOT NULL THEN _method := 'same_code';
    ELSE
      SELECT x.code, x.name, x.account_type INTO _t FROM (
        SELECT r.code, r.name, r.account_type FROM public.framework_reference_accounts r WHERE _m.target_framework IS NOT NULL AND r.framework_code = _m.target_framework
        UNION ALL SELECT s.code, s.name, s.account_type FROM public.secondary_chart_accounts s WHERE s.chart_id = _m.target_chart_id) x
       WHERE _a.code LIKE x.code || '%' AND length(x.code) > 1 ORDER BY length(x.code) DESC LIMIT 1;
      IF _t.code IS NOT NULL THEN _method := 'prefix';
      ELSIF _hints IS NOT NULL THEN
        SELECT y.* INTO _t FROM public.framework_keyword_hints h, LATERAL public.mapping_target(_m, h.code) y
         WHERE h.framework_code = _hints AND public.normalize_account_label(_a.name) ~ h.pattern ORDER BY h.priority, length(h.code) DESC LIMIT 1;
        IF _t.code IS NOT NULL THEN _method := 'label'; END IF;
      END IF;
    END IF;
    IF _method IS NOT NULL THEN
      INSERT INTO public.chart_mapping_lines (mapping_id, tenant_id, source_account_id, target_code, target_name, target_type, method, proposed_by)
      VALUES (_mapping, _m.tenant_id, _a.id, _t.code, _t.name, _t.account_type, _method, auth.uid())
      ON CONFLICT (mapping_id, source_account_id, target_code) DO UPDATE SET status = 'proposed', method = EXCLUDED.method, proposed_by = auth.uid(),
        proposed_at = now(), decided_by = NULL, decided_at = NULL, comment = NULL;
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END $function$;
REVOKE ALL ON FUNCTION public.propose_chart_mapping(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_chart_mapping(uuid) TO authenticated;

-- Saisie manuelle : remplace les lignes d'un compte source par une ou plusieurs cibles (répartition).
-- _targets : [{code, ratio}] ; la somme des clés vaut 100.
CREATE OR REPLACE FUNCTION public.set_chart_mapping_lines(_mapping uuid, _source_account uuid, _targets jsonb, _comment text DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _m public.chart_mappings%ROWTYPE := public.mapping_for(_mapping, 'accounting.mapping');
  _x record; _t record; _sum numeric := 0; _n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.gl_accounts g WHERE g.id = _source_account AND g.tenant_id = _m.tenant_id) THEN
    RAISE EXCEPTION 'Compte source introuvable' USING ERRCODE = 'QG021';
  END IF;
  IF jsonb_typeof(_targets) <> 'array' OR jsonb_array_length(_targets) = 0 THEN RAISE EXCEPTION 'Au moins un compte cible' USING ERRCODE = 'QG021'; END IF;
  SELECT COALESCE(sum((v ->> 'ratio')::numeric), 0) INTO _sum FROM jsonb_array_elements(_targets) v;
  IF _sum <> 100 THEN RAISE EXCEPTION 'Répartition : la somme des clés doit faire 100 %% (%)', _sum USING ERRCODE = 'QG021'; END IF;
  DELETE FROM public.chart_mapping_lines WHERE mapping_id = _mapping AND source_account_id = _source_account;
  FOR _x IN SELECT v ->> 'code' AS code, (v ->> 'ratio')::numeric AS ratio FROM jsonb_array_elements(_targets) v LOOP
    SELECT y.* INTO _t FROM public.mapping_target(_m, btrim(_x.code)) y;
    IF _t.code IS NULL THEN RAISE EXCEPTION 'Compte cible % absent du plan cible', _x.code USING ERRCODE = 'QG021'; END IF;
    INSERT INTO public.chart_mapping_lines (mapping_id, tenant_id, source_account_id, target_code, target_name, target_type, ratio, method, proposed_by, comment)
    VALUES (_mapping, _m.tenant_id, _source_account, _t.code, _t.name, _t.account_type, _x.ratio, 'manual', auth.uid(), NULLIF(btrim(_comment), ''));
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $function$;
REVOKE ALL ON FUNCTION public.set_chart_mapping_lines(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_chart_mapping_lines(uuid, uuid, jsonb, text) TO authenticated;

-- Décision (ligne à ligne ou en lot) : validateur habilité, autre personne que l'auteur de la ligne si exigé.
CREATE OR REPLACE FUNCTION public.decide_chart_mapping_lines(_mapping uuid, _lines uuid[], _approve boolean, _comment text DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _m public.chart_mappings%ROWTYPE := public.mapping_for(_mapping, 'accounting.mapping_validate');
  _n integer;
BEGIN
  IF NOT _approve AND COALESCE(btrim(_comment), '') = '' THEN RAISE EXCEPTION 'Motif obligatoire pour refuser' USING ERRCODE = 'QG021'; END IF;
  IF (public.chart_import_setting(_m.tenant_id)).mapping_second_person AND EXISTS (
       SELECT 1 FROM public.chart_mapping_lines WHERE mapping_id = _mapping AND id = ANY (_lines) AND proposed_by = auth.uid()) THEN
    RAISE EXCEPTION 'Séparation des tâches : une correspondance est validée par une autre personne que celle qui l''a proposée'
      USING ERRCODE = 'QG021';
  END IF;
  UPDATE public.chart_mapping_lines SET status = CASE WHEN _approve THEN 'validated' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now(),
         comment = COALESCE(NULLIF(btrim(_comment), ''), comment)
   WHERE mapping_id = _mapping AND id = ANY (_lines) AND status = 'proposed';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $function$;
REVOKE ALL ON FUNCTION public.decide_chart_mapping_lines(uuid, uuid[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_chart_mapping_lines(uuid, uuid[], boolean, text) TO authenticated;

-- Comparaison : un rang par compte source actif (et par cible).
CREATE OR REPLACE FUNCTION public.compare_chart_mapping(_mapping uuid)
 RETURNS TABLE (source_account_id uuid, source_code text, source_name text, source_type text, lines bigint,
                line_id uuid, target_code text, target_name text, target_type text, ratio numeric, method text, status text, finding text)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT g.id, g.code, g.name, g.account_type, (SELECT count(*) FROM public.journal_lines j WHERE j.account_id = g.id),
         l.id, l.target_code, l.target_name, l.target_type, l.ratio, l.method, l.status,
         CASE WHEN l.id IS NULL THEN 'Compte non couvert'
              WHEN l.target_type IS NOT NULL AND l.target_type <> g.account_type THEN 'Type différent'
              WHEN (SELECT sum(o.ratio) FROM public.chart_mapping_lines o WHERE o.mapping_id = m.id AND o.source_account_id = g.id AND o.status <> 'rejected') <> 100 THEN 'Répartition incomplète'
         END
    FROM public.chart_mappings m
    JOIN public.gl_accounts g ON g.tenant_id = m.tenant_id AND g.is_active AND NOT g.is_header
    LEFT JOIN public.chart_mapping_lines l ON l.mapping_id = m.id AND l.source_account_id = g.id AND l.status <> 'rejected'
   WHERE m.id = _mapping
   ORDER BY g.code, l.target_code
$function$;
REVOKE ALL ON FUNCTION public.compare_chart_mapping(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compare_chart_mapping(uuid) TO authenticated;

-- Validation de la correspondance : chaque compte mouvementé (ou actif si _all) couvert à 100 % par des lignes validées.
CREATE OR REPLACE FUNCTION public.validate_chart_mapping(_mapping uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _m public.chart_mappings%ROWTYPE := public.mapping_for(_mapping, 'accounting.mapping_validate');
  _manque text; _proposees int;
BEGIN
  SELECT count(*) INTO _proposees FROM public.chart_mapping_lines WHERE mapping_id = _mapping AND status = 'proposed';
  IF _proposees > 0 THEN RAISE EXCEPTION '% ligne(s) encore proposée(s) : à valider ou refuser', _proposees USING ERRCODE = 'QG021'; END IF;
  SELECT string_agg(g.code, ', ' ORDER BY g.code) INTO _manque FROM public.gl_accounts g
   WHERE g.tenant_id = _m.tenant_id AND g.is_active AND NOT g.is_header
     AND EXISTS (SELECT 1 FROM public.journal_lines j WHERE j.account_id = g.id)
     AND COALESCE((SELECT sum(l.ratio) FROM public.chart_mapping_lines l WHERE l.mapping_id = _mapping AND l.source_account_id = g.id AND l.status = 'validated'), 0) <> 100;
  IF _manque IS NOT NULL THEN
    RAISE EXCEPTION 'Comptes mouvementés non couverts à 100 %% par des lignes validées : %', left(_manque, 400) USING ERRCODE = 'QG021';
  END IF;
  UPDATE public.chart_mappings SET status = 'validated', validated_by = auth.uid(), validated_at = now() WHERE id = _mapping;
  RETURN jsonb_build_object('lignes_validees', (SELECT count(*) FROM public.chart_mapping_lines WHERE mapping_id = _mapping AND status = 'validated'));
END $function$;
REVOKE ALL ON FUNCTION public.validate_chart_mapping(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_chart_mapping(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_chart_mapping(_mapping uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _m public.chart_mappings%ROWTYPE := public.mapping_for(_mapping, 'accounting.mapping_validate', false);
BEGIN
  UPDATE public.chart_mappings SET status = 'archived' WHERE id = _m.id;
END $function$;
REVOKE ALL ON FUNCTION public.archive_chart_mapping(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_chart_mapping(uuid) TO authenticated;

-- Balance convertie dans le plan cible (écritures validées de la période, lignes validées, répartition).
CREATE OR REPLACE FUNCTION public.mapped_trial_balance(_mapping uuid, _from date, _to date)
 RETURNS TABLE (target_code text, target_name text, target_type text, debit numeric, credit numeric, balance numeric, sources text)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH mouvements AS (
    SELECT j.account_id, sum(j.debit) AS debit, sum(j.credit) AS credit
      FROM public.journal_lines j JOIN public.journal_entries e ON e.id = j.entry_id
      JOIN public.chart_mappings m ON m.id = _mapping AND m.tenant_id = e.tenant_id
     WHERE e.status IN ('posted', 'reversed') AND (_from IS NULL OR e.entry_date >= _from) AND e.entry_date <= _to
     GROUP BY j.account_id)
  SELECT l.target_code, min(l.target_name), min(l.target_type),
         round(sum(mv.debit * l.ratio / 100), 2), round(sum(mv.credit * l.ratio / 100), 2),
         round(sum((mv.debit - mv.credit) * l.ratio / 100), 2), string_agg(DISTINCT g.code, ', ')
    FROM public.chart_mapping_lines l
    JOIN mouvements mv ON mv.account_id = l.source_account_id
    JOIN public.gl_accounts g ON g.id = l.source_account_id
   WHERE l.mapping_id = _mapping AND l.status = 'validated'
   GROUP BY l.target_code
   ORDER BY l.target_code
$function$;
REVOKE ALL ON FUNCTION public.mapped_trial_balance(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapped_trial_balance(uuid, date, date) TO authenticated;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
