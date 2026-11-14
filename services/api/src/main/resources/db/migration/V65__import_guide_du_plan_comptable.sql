-- V65 — Plan comptable, lot PC-4 (livrable docs/audit-erp/12) : importation guidée du plan comptable.
--
-- Importation en deux temps (SAP LSMW / Sage « Importer » avec contrôle préalable) :
--   1. préparation (droit accounting.import) : le fichier, lu dans le navigateur selon un profil
--      (colonnes, correspondance des types), est envoyé ligne à ligne ; la base contrôle chaque ligne
--      (format du code selon le référentiel, intitulé, doublon dans le fichier, type, compte existant,
--      parent, cohérence avec le référentiel, attributs obligatoires) et propose une action
--      (créer / mettre à jour l'intitulé / ignorer) ; les lignes se corrigent en ligne ;
--   2. validation (droit accounting.import_validate), par une autre personne que l'auteur si la
--      société l'exige (paramètre, actif par défaut) : refusée s'il reste une erreur, appliquée en une
--      transaction (tout ou rien), parents rattachés, compte rendu enregistré.
-- Profils : profils de plateforme (générique, Sage 300, Sage X3, SAP) et profils de la société.
-- Droit accounting.export : exporter le plan et les rapports d'import. Erreurs métier : QG020.

-- ─── Droits ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('accounting.import', 'accounting', 'import', 'Préparer un import de plan comptable'),
  ('accounting.import_validate', 'accounting', 'import_validate', 'Valider un import de plan comptable préparé'),
  ('accounting.export', 'accounting', 'export', 'Exporter le plan comptable et les rapports')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES ('admin', 'accounting.import'), ('accountant', 'accounting.import'), ('admin', 'accounting.import_validate'),
                             ('admin', 'accounting.export'), ('accountant', 'accounting.export'), ('compliance_auditor', 'accounting.export')) AS v(r, p)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles WHERE code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code IN ('accounting.import', 'accounting.import_validate', 'accounting.export') AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── Paramètres ───
CREATE TABLE public.chart_import_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  require_second_person boolean NOT NULL DEFAULT true,
  allow_label_updates boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chart_import_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.chart_import_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.chart_import_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart_admin'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart_admin'));
GRANT SELECT, INSERT, UPDATE ON public.chart_import_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.chart_import_setting(_tenant uuid)
 RETURNS public.chart_import_settings
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s FROM public.chart_import_settings s WHERE s.tenant_id = _tenant),
                  ROW(_tenant, true, true, now())::public.chart_import_settings)
$function$;
REVOKE ALL ON FUNCTION public.chart_import_setting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chart_import_setting(uuid) TO authenticated;

-- ─── Profils ───
-- column_map : pour chaque champ (code, name, type, parent, header, normal_balance), les en-têtes de
-- colonne acceptés ; type_map / balance_map : valeurs du fichier → valeurs QUOREICH.
CREATE TABLE public.import_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,30}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  source text NOT NULL DEFAULT 'generic' CHECK (source IN ('generic', 'sage300', 'sagex3', 'sap', 'other')),
  delimiter text NOT NULL DEFAULT ';' CHECK (delimiter IN (';', ',', E'\t', '|')),
  column_map jsonb NOT NULL,
  type_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  balance_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(column_map) = 'object' AND column_map ? 'code' AND column_map ? 'name')
);
CREATE UNIQUE INDEX import_profiles_code ON public.import_profiles (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
ALTER TABLE public.import_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture des profils" ON public.import_profiles FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Profils de la société" ON public.import_profiles FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.import'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.import'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_profiles TO authenticated;

INSERT INTO public.import_profiles (tenant_id, code, name, source, delimiter, column_map, type_map, balance_map, notes) VALUES
  (NULL, 'QUOREICH', 'Modèle QUOREICH (export / import)', 'generic', ',',
   '{"code": ["Code", "Compte", "Numéro de compte", "N° compte"], "name": ["Intitulé", "Libellé", "Nom"], "type": ["Type", "Nature"],
     "parent": ["Parent", "Compte parent"], "header": ["Regroupement", "Titre"], "normal_balance": ["Sens", "Sens normal"]}',
   '{}', '{}', 'Format de l''export du plan : réimportable tel quel'),
  (NULL, 'SAGE300', 'Sage 300 — Comptes du grand livre', 'sage300', ',',
   '{"code": ["Account No.", "Account Number", "ACCTID", "Compte"], "name": ["Description", "ACCTDESC", "Intitulé"],
     "type": ["Account Type", "ACCTTYPE"], "header": [], "normal_balance": ["Normal Balance", "ACCTBAL"], "parent": ["Account Group", "ACCTGRPCOD"]}',
   '{"b": "", "i": "", "r": "equity"}', '{"d": "debit", "debit": "debit", "c": "credit", "credit": "credit"}',
   'Le type Sage 300 (bilan / gestion) ne distingue pas actif et passif : le type vient du référentiel'),
  (NULL, 'SAGEX3', 'Sage X3 — Plan de comptes (GACCOUNT)', 'sagex3', ';',
   '{"code": ["Compte", "ACC", "Numéro"], "name": ["Intitulé", "DES", "Intitulé long"], "type": ["Nature", "Type"],
     "parent": ["Compte de regroupement", "Parent"], "header": ["Compte de totalisation", "Titre"], "normal_balance": ["Sens", "Sens normal"]}',
   '{}', '{"d": "debit", "c": "credit"}', NULL),
  (NULL, 'SAP', 'SAP — Comptes généraux (SKA1 / SKAT)', 'sap', ';',
   '{"code": ["G/L Account", "SAKNR", "Compte général"], "name": ["Long Text", "TXT50", "G/L Acct Long Text", "Short Text", "TXT20"],
     "type": ["Account Type", "GLACCOUNT_TYPE", "Type de compte"], "parent": ["Group Account", "BILKT"], "header": [], "normal_balance": []}',
   '{"x": "", "n": "", "p": "expense", "s": ""}', '{}',
   'Types SAP (X bilan, P charges primaires, N non opérationnel, S) complétés par le référentiel');

-- ─── Exécutions et lignes ───
CREATE TABLE public.chart_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.import_profiles(id),
  file_name text NOT NULL,
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'validated', 'cancelled')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_by uuid,
  validated_at timestamptz,
  cancel_reason text
);
CREATE INDEX chart_import_runs_tenant ON public.chart_import_runs (tenant_id, created_at DESC);
CREATE TABLE public.chart_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.chart_import_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  code text,
  name text,
  raw_type text,
  account_type text,
  parent_code text,
  is_header boolean NOT NULL DEFAULT false,
  normal_balance text,
  action text NOT NULL DEFAULT 'create' CHECK (action IN ('create', 'update', 'skip')),
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'warning', 'error')),
  messages text[] NOT NULL DEFAULT '{}',
  account_id uuid REFERENCES public.gl_accounts(id),
  UNIQUE (run_id, line_no)
);
ALTER TABLE public.chart_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture habilitée" ON public.chart_import_runs FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
         AND (public.has_permission(auth.uid(), 'accounting.import') OR public.has_permission(auth.uid(), 'accounting.import_validate')));
CREATE POLICY "Lecture habilitée" ON public.chart_import_rows FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
         AND (public.has_permission(auth.uid(), 'accounting.import') OR public.has_permission(auth.uid(), 'accounting.import_validate')));
GRANT SELECT ON public.chart_import_runs, public.chart_import_rows TO authenticated;

-- Type QUOREICH depuis une valeur de fichier : table du profil d'abord, puis libellés usuels.
CREATE OR REPLACE FUNCTION public.import_account_type(_raw text, _map jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE _v text := public.normalize_account_label(_raw);
BEGIN
  IF _v = '' THEN RETURN NULL; END IF;
  IF _map ? _v THEN RETURN NULLIF(_map ->> _v, ''); END IF;
  RETURN CASE
    WHEN _v IN ('asset', 'actif', 'a', 'actifs') THEN 'asset'
    WHEN _v IN ('liability', 'passif', 'l', 'p', 'dette', 'dettes', 'passifs') THEN 'liability'
    WHEN _v IN ('equity', 'capitaux propres', 'capitaux', 'cp', 'e', 'fonds propres') THEN 'equity'
    WHEN _v IN ('revenue', 'income', 'produit', 'produits', 'r', 'pr') THEN 'revenue'
    WHEN _v IN ('expense', 'charge', 'charges', 'c', 'ch') THEN 'expense'
    ELSE '?' END;
END $function$;

-- Contrôle de toutes les lignes d'une exécution (relancé après chaque correction).
CREATE OR REPLACE FUNCTION public.chart_import_check(_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.chart_import_runs%ROWTYPE;
  _p public.import_profiles%ROWTYPE;
  _s public.chart_import_settings;
  _fw text; _pattern text; _row record; _m text[]; _err boolean; _warn boolean;
  _type text; _ref public.framework_reference_accounts%ROWTYPE; _ex public.gl_accounts%ROWTYPE; _used boolean; _action text;
  _parent text; _required text;
BEGIN
  SELECT * INTO _r FROM public.chart_import_runs WHERE id = _run;
  SELECT * INTO _p FROM public.import_profiles WHERE id = _r.profile_id;
  _s := public.chart_import_setting(_r.tenant_id);
  _fw := public.chart_framework(_r.tenant_id);
  IF public.quality_rule_severity(_r.tenant_id, _fw, 'CODE_FORMAT') = 'error' THEN
    SELECT q.params ->> 'pattern' INTO _pattern FROM public.framework_quality_rules q WHERE q.framework_code = _fw AND q.rule_code = 'CODE_FORMAT';
  END IF;
  SELECT string_agg(d.label, ', ') INTO _required FROM public.gl_account_attribute_definitions d
   WHERE d.tenant_id = _r.tenant_id AND d.is_active AND d.required;

  FOR _row IN SELECT * FROM public.chart_import_rows WHERE run_id = _run ORDER BY line_no LOOP
    _m := '{}'; _err := false; _warn := false; _action := _row.action; _ex := NULL; _ref := NULL;
    IF _action = 'skip' AND _row.messages @> ARRAY['Ignorée à la demande'] THEN
      UPDATE public.chart_import_rows SET status = 'ok', messages = ARRAY['Ignorée à la demande'] WHERE id = _row.id;
      CONTINUE;
    END IF;
    _action := 'create';
    IF COALESCE(btrim(_row.code), '') = '' THEN _m := array_append(_m, 'Code manquant'::text); _err := true;
    ELSIF _pattern IS NOT NULL AND _row.code !~ _pattern THEN _m := array_append(_m, ('Code hors format du référentiel (' || _pattern || ')')::text); _err := true;
    END IF;
    IF COALESCE(btrim(_row.name), '') = '' THEN _m := array_append(_m, 'Intitulé manquant'::text); _err := true; END IF;
    IF btrim(COALESCE(_row.code, '')) <> '' AND EXISTS (SELECT 1 FROM public.chart_import_rows o WHERE o.run_id = _run AND o.id <> _row.id AND o.code = _row.code
                 AND NOT (o.action = 'skip' AND o.messages @> ARRAY['Ignorée à la demande'])) THEN
      _m := array_append(_m, 'Code en double dans le fichier'::text); _err := true;
    END IF;

    _type := _row.account_type;
    IF _type IS NULL AND _row.raw_type IS NOT NULL THEN _type := public.import_account_type(_row.raw_type, COALESCE(_p.type_map, '{}')); END IF;
    IF _type = '?' THEN _m := array_append(_m, ('Type inconnu : ' || _row.raw_type)::text); _err := true; _type := NULL; END IF;
    IF _row.code IS NOT NULL THEN _ref := public.framework_reference_of(_fw, _row.code); END IF;
    IF _type IS NULL THEN
      SELECT r.account_type INTO _type FROM public.framework_reference_accounts r
       WHERE r.framework_code = _fw AND _row.code LIKE r.code || '%' AND r.account_type IS NOT NULL ORDER BY length(r.code) DESC LIMIT 1;
      IF _type IS NULL AND NOT _err THEN _m := array_append(_m, 'Type à préciser (le référentiel ne le déduit pas)'::text); _err := true;
      ELSIF _type IS NOT NULL THEN _m := array_append(_m, 'Type déduit du référentiel'::text); END IF;
    ELSIF _ref.account_type IS NOT NULL AND _ref.account_type <> _type THEN
      _m := array_append(_m, ('Type différent du référentiel (' || _ref.code || ' : ' || _ref.account_type || ')')::text); _warn := true;
    END IF;
    IF _row.code IS NOT NULL AND _ref.code IS NULL THEN _m := array_append(_m, 'Code hors plan du référentiel'::text); _warn := true; END IF;

    IF _row.code IS NOT NULL THEN
      SELECT * INTO _ex FROM public.gl_accounts g WHERE g.tenant_id = _r.tenant_id AND g.code = _row.code;
    END IF;
    IF _ex.id IS NOT NULL THEN
      _used := EXISTS (SELECT 1 FROM public.journal_lines l WHERE l.account_id = _ex.id);
      IF _type IS NOT NULL AND _type <> _ex.account_type THEN
        IF _used THEN _m := array_append(_m, 'Compte existant mouvementé : son type ne change pas'::text); _err := true;
        ELSE _m := array_append(_m, 'Compte existant : type mis à jour'::text); _warn := true; _action := 'update'; END IF;
      END IF;
      IF public.normalize_account_label(_ex.name) <> public.normalize_account_label(_row.name) THEN
        IF _s.allow_label_updates THEN _m := array_append(_m, 'Compte existant : intitulé mis à jour'::text); _warn := true; _action := 'update';
        ELSE _m := array_append(_m, 'Compte existant : intitulé conservé (mise à jour désactivée)'::text); END IF;
      END IF;
      IF _action = 'create' THEN _action := 'skip'; _m := array_append(_m, 'Compte déjà présent, inchangé'::text); END IF;
    ELSIF _required IS NOT NULL AND NOT _row.is_header THEN
      _m := array_append(_m, ('Attributs obligatoires à renseigner : ' || _required)::text); _err := true;
    END IF;

    _parent := NULLIF(btrim(COALESCE(_row.parent_code, '')), '');
    IF _parent IS NOT NULL AND _row.code IS NOT NULL THEN
      IF NOT (_row.code LIKE _parent || '%' AND length(_row.code) > length(_parent)) THEN
        _m := array_append(_m, ('Parent ' || _parent || ' : pas un préfixe du code')::text); _err := true;
      ELSIF NOT EXISTS (SELECT 1 FROM public.gl_accounts g WHERE g.tenant_id = _r.tenant_id AND g.code = _parent)
            AND NOT EXISTS (SELECT 1 FROM public.chart_import_rows o WHERE o.run_id = _run AND o.code = _parent) THEN
        _m := array_append(_m, ('Parent ' || _parent || ' absent du plan et du fichier')::text); _err := true;
      END IF;
    END IF;

    UPDATE public.chart_import_rows SET account_type = COALESCE(_type, account_type), action = _action,
           status = CASE WHEN _err THEN 'error' WHEN _warn THEN 'warning' ELSE 'ok' END, messages = _m
     WHERE id = _row.id;
  END LOOP;

  UPDATE public.chart_import_runs SET summary = (
    SELECT jsonb_build_object('lignes', count(*), 'erreurs', count(*) FILTER (WHERE status = 'error'),
             'avertissements', count(*) FILTER (WHERE status = 'warning'), 'a_creer', count(*) FILTER (WHERE action = 'create'),
             'a_mettre_a_jour', count(*) FILTER (WHERE action = 'update'), 'ignorees', count(*) FILTER (WHERE action = 'skip'))
      FROM public.chart_import_rows WHERE run_id = _run)
   WHERE id = _run;
  RETURN (SELECT summary FROM public.chart_import_runs WHERE id = _run);
END $function$;
REVOKE ALL ON FUNCTION public.chart_import_check(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chart_import_run_for(_run uuid, _right text)
 RETURNS public.chart_import_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _r public.chart_import_runs%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), _right) THEN
    RAISE EXCEPTION 'Droit insuffisant (%)', _right USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _r FROM public.chart_import_runs WHERE id = _run AND tenant_id = _tenant FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Import introuvable' USING ERRCODE = 'QG020'; END IF;
  IF _r.status <> 'prepared' THEN RAISE EXCEPTION 'Import déjà % : il ne se modifie plus', CASE _r.status WHEN 'validated' THEN 'validé' ELSE 'annulé' END USING ERRCODE = 'QG020'; END IF;
  RETURN _r;
END $function$;
REVOKE ALL ON FUNCTION public.chart_import_run_for(uuid, text) FROM PUBLIC, anon, authenticated;

-- 1. Préparation. _rows : [{code, name, type, parent, header, normal_balance}] (valeurs du fichier).
CREATE OR REPLACE FUNCTION public.prepare_chart_import(_profile_id uuid, _file_name text, _rows jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _p public.import_profiles%ROWTYPE; _run uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'accounting.import') THEN
    RAISE EXCEPTION 'Droit insuffisant : préparer un import de plan comptable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _p FROM public.import_profiles WHERE id = _profile_id AND (tenant_id IS NULL OR tenant_id = _tenant);
  IF _p.id IS NULL THEN RAISE EXCEPTION 'Profil d''import introuvable' USING ERRCODE = 'QG020'; END IF;
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 THEN RAISE EXCEPTION 'Fichier vide' USING ERRCODE = 'QG020'; END IF;
  IF jsonb_array_length(_rows) > 10000 THEN RAISE EXCEPTION 'Fichier trop volumineux (10 000 lignes au plus)' USING ERRCODE = 'QG020'; END IF;

  INSERT INTO public.chart_import_runs (tenant_id, profile_id, file_name, created_by)
  VALUES (_tenant, _p.id, COALESCE(NULLIF(btrim(_file_name), ''), 'import.csv'), auth.uid()) RETURNING id INTO _run;
  INSERT INTO public.chart_import_rows (run_id, tenant_id, line_no, code, name, raw_type, parent_code, is_header, normal_balance)
  SELECT _run, _tenant, x.n::int, NULLIF(regexp_replace(COALESCE(x.v ->> 'code', ''), '\s', '', 'g'), ''), NULLIF(btrim(x.v ->> 'name'), ''),
         NULLIF(btrim(x.v ->> 'type'), ''), NULLIF(regexp_replace(COALESCE(x.v ->> 'parent', ''), '\s', '', 'g'), ''),
         public.normalize_account_label(x.v ->> 'header') IN ('oui', 'o', 'yes', 'y', 'x', 'true', '1', 'vrai'),
         CASE WHEN COALESCE(_p.balance_map, '{}') ? public.normalize_account_label(x.v ->> 'normal_balance')
              THEN NULLIF(_p.balance_map ->> public.normalize_account_label(x.v ->> 'normal_balance'), '')
              WHEN public.normalize_account_label(x.v ->> 'normal_balance') IN ('debit', 'd', 'debiteur') THEN 'debit'
              WHEN public.normalize_account_label(x.v ->> 'normal_balance') IN ('credit', 'c', 'crediteur') THEN 'credit' END
    FROM jsonb_array_elements(_rows) WITH ORDINALITY AS x(v, n);
  PERFORM public.chart_import_check(_run);
  RETURN _run;
END $function$;
REVOKE ALL ON FUNCTION public.prepare_chart_import(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_chart_import(uuid, text, jsonb) TO authenticated;

-- Correction d'une ligne (ou « ignorer » : _skip = true), puis nouveau contrôle de l'exécution.
CREATE OR REPLACE FUNCTION public.update_chart_import_row(_row_id uuid, _code text, _name text, _type text, _parent text, _header boolean, _skip boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row public.chart_import_rows%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.chart_import_rows WHERE id = _row_id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Ligne introuvable' USING ERRCODE = 'QG020'; END IF;
  PERFORM public.chart_import_run_for(_row.run_id, 'accounting.import');
  IF _type IS NOT NULL AND _type NOT IN ('asset', 'liability', 'equity', 'revenue', 'expense') THEN
    RAISE EXCEPTION 'Type invalide : %', _type USING ERRCODE = 'QG020';
  END IF;
  UPDATE public.chart_import_rows SET code = NULLIF(regexp_replace(COALESCE(_code, ''), '\s', '', 'g'), ''), name = NULLIF(btrim(_name), ''),
         account_type = _type, raw_type = CASE WHEN _type IS NULL THEN raw_type END,
         parent_code = NULLIF(regexp_replace(COALESCE(_parent, ''), '\s', '', 'g'), ''), is_header = COALESCE(_header, false),
         action = CASE WHEN _skip THEN 'skip' ELSE 'create' END, messages = CASE WHEN _skip THEN ARRAY['Ignorée à la demande'] ELSE '{}' END
   WHERE id = _row_id;
  RETURN public.chart_import_check(_row.run_id);
END $function$;
REVOKE ALL ON FUNCTION public.update_chart_import_row(uuid, text, text, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_chart_import_row(uuid, text, text, text, text, boolean, boolean) TO authenticated;

-- 2. Validation : tout ou rien.
CREATE OR REPLACE FUNCTION public.validate_chart_import(_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.chart_import_runs%ROWTYPE := public.chart_import_run_for(_run, 'accounting.import_validate');
  _summary jsonb; _row record; _id uuid; _n_create int := 0; _n_update int := 0; _n_link int := 0;
BEGIN
  IF (public.chart_import_setting(_r.tenant_id)).require_second_person AND _r.created_by = auth.uid() THEN
    RAISE EXCEPTION 'Séparation des tâches : l''import doit être validé par une autre personne que celle qui l''a préparé'
      USING ERRCODE = 'QG020', HINT = 'Paramètre « Validation par une autre personne » (Plans et référentiels → Import).';
  END IF;
  _summary := public.chart_import_check(_run);
  IF (_summary ->> 'erreurs')::int > 0 THEN
    RAISE EXCEPTION 'Import refusé : % ligne(s) en erreur à corriger ou ignorer', _summary ->> 'erreurs' USING ERRCODE = 'QG020';
  END IF;

  FOR _row IN SELECT * FROM public.chart_import_rows WHERE run_id = _run AND action = 'create' ORDER BY length(code), code LOOP
    INSERT INTO public.gl_accounts (tenant_id, code, name, account_type, is_header, normal_balance)
    VALUES (_r.tenant_id, _row.code, _row.name, _row.account_type, _row.is_header, _row.normal_balance) RETURNING id INTO _id;
    UPDATE public.chart_import_rows SET account_id = _id WHERE id = _row.id;
    _n_create := _n_create + 1;
  END LOOP;
  FOR _row IN SELECT i.*, g.id AS gid FROM public.chart_import_rows i JOIN public.gl_accounts g ON g.tenant_id = _r.tenant_id AND g.code = i.code
               WHERE i.run_id = _run AND i.action = 'update' LOOP
    UPDATE public.gl_accounts SET name = CASE WHEN (public.chart_import_setting(_r.tenant_id)).allow_label_updates THEN _row.name ELSE name END,
           account_type = _row.account_type
     WHERE id = _row.gid;
    UPDATE public.chart_import_rows SET account_id = _row.gid WHERE id = _row.id;
    _n_update := _n_update + 1;
  END LOOP;
  -- Parents : celui du fichier, sinon le plus long préfixe existant.
  FOR _row IN SELECT i.account_id, COALESCE(
                 (SELECT p.id FROM public.gl_accounts p WHERE p.tenant_id = _r.tenant_id AND p.code = i.parent_code),
                 (SELECT p.id FROM public.gl_accounts p WHERE p.tenant_id = _r.tenant_id AND i.code LIKE p.code || '%' AND length(p.code) < length(i.code)
                   ORDER BY length(p.code) DESC LIMIT 1)) AS pid
                FROM public.chart_import_rows i
               WHERE i.run_id = _run AND i.action IN ('create', 'update') LOOP
    IF _row.pid IS NOT NULL THEN
      UPDATE public.gl_accounts SET parent_id = _row.pid WHERE id = _row.account_id AND parent_id IS DISTINCT FROM _row.pid;
      IF FOUND THEN _n_link := _n_link + 1; END IF;
    END IF;
  END LOOP;

  _summary := _summary || jsonb_build_object('crees', _n_create, 'mis_a_jour', _n_update, 'rattaches', _n_link);
  UPDATE public.chart_import_runs SET status = 'validated', validated_by = auth.uid(), validated_at = now(), summary = _summary WHERE id = _run;
  RETURN _summary;
END $function$;
REVOKE ALL ON FUNCTION public.validate_chart_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_chart_import(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_chart_import(_run uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.chart_import_runs%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM public.chart_import_runs WHERE id = _run AND tenant_id = public.get_user_tenant_id(auth.uid());
  IF _r.id IS NOT NULL AND NOT public.has_permission(auth.uid(), 'accounting.import_validate') THEN
    _r := public.chart_import_run_for(_run, 'accounting.import');
  ELSE
    _r := public.chart_import_run_for(_run, 'accounting.import_validate');
  END IF;
  UPDATE public.chart_import_runs SET status = 'cancelled', cancel_reason = NULLIF(btrim(_reason), '') WHERE id = _run;
END $function$;
REVOKE ALL ON FUNCTION public.cancel_chart_import(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_chart_import(uuid, text) TO authenticated;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
