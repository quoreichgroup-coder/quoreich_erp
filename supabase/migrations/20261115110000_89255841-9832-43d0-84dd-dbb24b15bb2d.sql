-- V62 — Plan comptable, lot PC-1 (livrable docs/audit-erp/12) : objet « plan » et comptes configurables.
--
-- 1. charts : plan d'une société (opérationnel ou secondaire, référentiel et version d'origine, statut
--    brouillon / actif / archivé, date d'effet). Chaque société reçoit son plan opérationnel « PRINCIPAL »
--    et tous ses comptes y sont rattachés — aucun code, compte, écriture ni imputation ne change.
--    Un compte créé sans plan va dans le plan opérationnel actif (les fonctions existantes ne changent pas).
--    Plans secondaires et duplication : lot PC-5 (le code reste unique par société d'ici là).
-- 2. Attributs de compte, tous paramétrables par compte : sens normal (débit / crédit, déduit du type par
--    défaut), mode d'imputation (manuelle, automatique seulement — comptes collectifs —, bloquée),
--    lettrable, politique analytique (obligatoire / interdite / facultative, prioritaire sur les règles par
--    préfixe), code TVA par défaut, devise (locale seulement / toutes devises), attributs personnalisés
--    définis par la société (gl_account_attribute_definitions : texte, nombre, date, oui/non, liste,
--    obligatoire ou non).
-- 3. gl_account_history : journal de chaque création et modification de compte (champs avant / après).
-- 4. Contrôle de qualité : solde anormal par rapport au sens normal (ex. compte client créditeur).
-- 5. Droit accounting.chart_admin (plans, attributs personnalisés) ; accounting.chart pour les comptes.
-- Erreurs métier : QG019.

-- ─── Droit ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('accounting.chart_admin', 'accounting', 'chart_admin', 'Administrer les plans comptables et les attributs de compte')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT 'admin', 'accounting.chart_admin' WHERE EXISTS (SELECT 1 FROM public.erp_system_roles WHERE code = 'admin')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code = 'accounting.chart_admin' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── 1. Plans ───
CREATE TABLE public.charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,30}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  kind text NOT NULL DEFAULT 'operational' CHECK (kind IN ('operational', 'secondary')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  framework_code text REFERENCES public.accounting_frameworks(code),
  framework_version text,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charts_tenant_code_key UNIQUE (tenant_id, code),
  CONSTRAINT charts_id_tenant_key UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX charts_one_active_operational ON public.charts (tenant_id) WHERE kind = 'operational' AND status = 'active';
ALTER TABLE public.charts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.charts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Administration habilitée" ON public.charts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart_admin'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart_admin'));
GRANT SELECT, INSERT, UPDATE ON public.charts TO authenticated;

INSERT INTO public.charts (tenant_id, code, name, kind, status, framework_code, framework_version, effective_from)
SELECT t.id, 'PRINCIPAL', 'Plan comptable principal', 'operational', 'active', s.framework_code, f.version,
       COALESCE((SELECT min(e.entry_date) FROM public.journal_entries e WHERE e.tenant_id = t.id), CURRENT_DATE)
  FROM public.tenants t
  LEFT JOIN public.tenant_accounting_settings s ON s.tenant_id = t.id
  LEFT JOIN public.accounting_frameworks f ON f.code = s.framework_code;

-- Plan opérationnel actif d'une société (créé s'il manque : nouvelle société).
CREATE OR REPLACE FUNCTION public.operational_chart_id(_tenant uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
BEGIN
  SELECT id INTO _id FROM public.charts WHERE tenant_id = _tenant AND kind = 'operational' AND status = 'active';
  IF _id IS NULL THEN
    INSERT INTO public.charts (tenant_id, code, name, kind, status)
    VALUES (_tenant, 'PRINCIPAL', 'Plan comptable principal', 'operational', 'active')
    ON CONFLICT (tenant_id, code) DO UPDATE SET status = 'active'
    RETURNING id INTO _id;
  END IF;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.operational_chart_id(uuid) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.gl_accounts ADD COLUMN chart_id uuid;
UPDATE public.gl_accounts g SET chart_id = c.id FROM public.charts c
 WHERE c.tenant_id = g.tenant_id AND c.code = 'PRINCIPAL';
ALTER TABLE public.gl_accounts ALTER COLUMN chart_id SET NOT NULL,
  ADD CONSTRAINT gl_accounts_chart_fkey FOREIGN KEY (chart_id, tenant_id) REFERENCES public.charts (id, tenant_id);
CREATE INDEX gl_accounts_chart_idx ON public.gl_accounts (chart_id);

-- ─── 2. Attributs de compte ───
CREATE TABLE public.gl_account_attribute_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text NOT NULL CHECK (btrim(label) <> ''),
  data_type text NOT NULL CHECK (data_type IN ('text', 'number', 'date', 'boolean', 'list')),
  options text[],
  required boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_account_attribute_definitions_key UNIQUE (tenant_id, key),
  CONSTRAINT gl_account_attribute_list_options CHECK (data_type <> 'list' OR cardinality(options) > 0)
);
ALTER TABLE public.gl_account_attribute_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.gl_account_attribute_definitions FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Administration habilitée" ON public.gl_account_attribute_definitions FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart_admin'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.chart_admin'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gl_account_attribute_definitions TO authenticated;

ALTER TABLE public.gl_accounts
  ADD COLUMN normal_balance text CHECK (normal_balance IN ('debit', 'credit')),
  ADD COLUMN posting_mode text NOT NULL DEFAULT 'manual' CHECK (posting_mode IN ('manual', 'automatic_only', 'blocked')),
  ADD COLUMN reconcilable boolean NOT NULL DEFAULT false,
  ADD COLUMN analytic_policy text CHECK (analytic_policy IN ('optional', 'required', 'forbidden')),
  ADD COLUMN default_tax_code_id uuid REFERENCES public.tax_codes(id),
  ADD COLUMN currency_mode text NOT NULL DEFAULT 'local' CHECK (currency_mode IN ('local', 'any')),
  ADD COLUMN custom_attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom_attributes) = 'object'),
  ADD COLUMN updated_at timestamptz;
COMMENT ON COLUMN public.gl_accounts.posting_mode IS 'manual : toute écriture ; automatic_only : pas d''OD manuelle (compte collectif, sous-ledger) ; blocked : aucune nouvelle ligne.';
COMMENT ON COLUMN public.gl_accounts.analytic_policy IS 'NULL : règles analytiques par préfixe ; sinon prioritaire sur elles pour tous les axes actifs.';

UPDATE public.gl_accounts SET normal_balance = CASE WHEN account_type IN ('asset', 'expense') THEN 'debit' ELSE 'credit' END;
ALTER TABLE public.gl_accounts ALTER COLUMN normal_balance SET NOT NULL;
UPDATE public.gl_accounts g SET reconcilable = true
 WHERE EXISTS (SELECT 1 FROM public.tenant_posting_accounts p WHERE p.gl_account_id = g.id
                AND p.role_code IN ('AR_RECEIVABLE', 'AP_PAYABLE', 'CUSTOMER_ADVANCE'));

-- Valeurs par défaut et contrôle des attributs personnalisés (avant la garde V60, qui reste en place).
CREATE OR REPLACE FUNCTION public.default_gl_account_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _d record;
  _v jsonb;
BEGIN
  IF NEW.chart_id IS NULL THEN NEW.chart_id := public.operational_chart_id(NEW.tenant_id); END IF;
  IF NEW.normal_balance IS NULL OR (TG_OP = 'UPDATE' AND NEW.account_type IS DISTINCT FROM OLD.account_type AND NEW.normal_balance = OLD.normal_balance) THEN
    NEW.normal_balance := CASE WHEN NEW.account_type IN ('asset', 'expense') THEN 'debit' ELSE 'credit' END;
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  FOR _d IN SELECT * FROM public.gl_account_attribute_definitions WHERE tenant_id = NEW.tenant_id AND is_active LOOP
    _v := NEW.custom_attributes -> _d.key;
    IF _v IS NULL OR _v = 'null'::jsonb OR (jsonb_typeof(_v) = 'string' AND btrim(_v #>> '{}') = '') THEN
      IF _d.required AND NOT NEW.is_header THEN
        RAISE EXCEPTION 'Attribut « % » obligatoire pour le compte %', _d.label, NEW.code USING ERRCODE = 'QG019';
      END IF;
      CONTINUE;
    END IF;
    IF (_d.data_type = 'number' AND jsonb_typeof(_v) <> 'number')
       OR (_d.data_type = 'boolean' AND jsonb_typeof(_v) <> 'boolean')
       OR (_d.data_type IN ('text', 'date', 'list') AND jsonb_typeof(_v) <> 'string')
       OR (_d.data_type = 'date' AND (_v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$')
       OR (_d.data_type = 'list' AND NOT ((_v #>> '{}') = ANY (_d.options))) THEN
      RAISE EXCEPTION 'Attribut « % » du compte % : valeur invalide (%)', _d.label, NEW.code, _v #>> '{}' USING ERRCODE = 'QG019';
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_default_gl_account_fields BEFORE INSERT OR UPDATE ON public.gl_accounts
  FOR EACH ROW EXECUTE FUNCTION public.default_gl_account_fields();

-- ─── 3. Historique ───
CREATE TABLE public.gl_account_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  account_code text NOT NULL,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changes jsonb NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gl_account_history_account_idx ON public.gl_account_history (account_id, id);
ALTER TABLE public.gl_account_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture habilitée" ON public.gl_account_history FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
         AND (public.has_permission(auth.uid(), 'accounting.chart') OR public.has_permission(auth.uid(), 'accounting.chart_admin')));
GRANT SELECT ON public.gl_account_history TO authenticated;

CREATE OR REPLACE FUNCTION public.log_gl_account_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _o jsonb; _n jsonb; _diff jsonb := '{}'::jsonb; _k text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.gl_account_history (tenant_id, account_id, account_code, action, changes, changed_by)
    VALUES (OLD.tenant_id, OLD.id, OLD.code, 'delete', to_jsonb(OLD) - 'created_at' - 'updated_at', auth.uid());
    RETURN OLD;
  END IF;
  _n := to_jsonb(NEW) - 'created_at' - 'updated_at';
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.gl_account_history (tenant_id, account_id, account_code, action, changes, changed_by)
    VALUES (NEW.tenant_id, NEW.id, NEW.code, 'insert', _n, auth.uid());
    RETURN NEW;
  END IF;
  _o := to_jsonb(OLD) - 'created_at' - 'updated_at';
  FOR _k IN SELECT jsonb_object_keys(_n) LOOP
    IF _o -> _k IS DISTINCT FROM _n -> _k THEN
      _diff := _diff || jsonb_build_object(_k, jsonb_build_array(_o -> _k, _n -> _k));
    END IF;
  END LOOP;
  IF _diff <> '{}'::jsonb THEN
    INSERT INTO public.gl_account_history (tenant_id, account_id, account_code, action, changes, changed_by)
    VALUES (NEW.tenant_id, NEW.id, NEW.code, 'update', _diff, auth.uid());
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_log_gl_account_changes AFTER INSERT OR UPDATE OR DELETE ON public.gl_accounts
  FOR EACH ROW EXECUTE FUNCTION public.log_gl_account_changes();

-- ─── Imputation : mode d'imputation du compte ───
CREATE OR REPLACE FUNCTION public.guard_journal_line_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _a record;
  _source text;
BEGIN
  SELECT code, is_active, is_header, posting_mode INTO _a FROM public.gl_accounts WHERE id = NEW.account_id;
  IF _a.is_header THEN
    RAISE EXCEPTION 'Compte % : compte de regroupement, non imputable (choisir un sous-compte)', _a.code USING ERRCODE = 'QG019';
  END IF;
  IF NOT _a.is_active THEN
    RAISE EXCEPTION 'Compte % inactif : imputation refusée', _a.code USING ERRCODE = 'QG019';
  END IF;
  IF _a.posting_mode = 'blocked' THEN
    RAISE EXCEPTION 'Compte % : imputation bloquée par son paramétrage', _a.code USING ERRCODE = 'QG019';
  END IF;
  IF _a.posting_mode = 'automatic_only' THEN
    SELECT source INTO _source FROM public.journal_entries WHERE id = NEW.entry_id;
    IF _source = 'manual' THEN
      RAISE EXCEPTION 'Compte % : compte collectif, alimenté par les pièces (factures, règlements) et non par une écriture manuelle', _a.code
        USING ERRCODE = 'QG019', HINT = 'Passer par la pièce du module concerné, ou changer le mode d''imputation du compte.';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- ─── Reclassement : source « reclassification » (journal OD) ───
CREATE OR REPLACE FUNCTION public.reclassify_gl_account_balance(_account_id uuid, _entry_date date, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.require_chart_right();
  _old public.gl_accounts%ROWTYPE;
  _target public.gl_accounts%ROWTYPE;
  _solde numeric;
  _entry uuid;
  _date date := COALESCE(_entry_date, CURRENT_DATE);
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Motif du reclassement obligatoire' USING ERRCODE = 'QG019'; END IF;
  SELECT * INTO _old FROM public.gl_accounts WHERE id = _account_id AND tenant_id = _tenant;
  IF NOT FOUND OR _old.replaced_by IS NULL THEN
    RAISE EXCEPTION 'Seul un compte remplacé se reclasse (remplacez-le d''abord par le compte SYSCOHADA)' USING ERRCODE = 'QG019';
  END IF;
  SELECT * INTO _target FROM public.gl_accounts WHERE id = _old.replaced_by;
  SELECT COALESCE(sum(l.debit - l.credit), 0) INTO _solde
    FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.entry_id
   WHERE l.account_id = _old.id AND e.status IN ('posted', 'reversed');
  IF _solde = 0 THEN RAISE EXCEPTION 'Compte % soldé : rien à reclasser', _old.code USING ERRCODE = 'QG019'; END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'GL');

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-RECL-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6), _date,
          'Reclassement ' || _old.code || ' → ' || _target.code || ' — ' || btrim(_reason), 'reclassification', 'draft', auth.uid())
  RETURNING id INTO _entry;
  -- Le compte remplacé est inactif : la garde d'imputation le refuserait ; l'écriture de reclassement
  -- est la seule exception, ouverte le temps de l'insertion.
  UPDATE public.gl_accounts SET is_active = true WHERE id = _old.id;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry, _target.id, GREATEST(_solde, 0), GREATEST(-_solde, 0), 'Reclassement depuis ' || _old.code),
         (_entry, _old.id, GREATEST(-_solde, 0), GREATEST(_solde, 0), 'Reclassement vers ' || _target.code);
  UPDATE public.gl_accounts SET is_active = false WHERE id = _old.id;
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;
  RETURN _entry;
END $function$;

-- ─── Analytique : politique du compte ───
CREATE OR REPLACE FUNCTION public.enforce_analytics()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Sources qui savent aujourd'hui fournir une imputation (manuelle, facture
  -- client via client ou facture, encaissement). À étendre avec les lots 3 et 4.
  _sources_controlees constant text[] := ARRAY['manual', 'ar_invoice', 'ar_receipt'];
  _p record;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN RETURN NEW; END IF;
  -- Une contre-passation reproduit une écriture déjà contrôlée.
  IF NEW.source = 'reversal' THEN RETURN NEW; END IF;

  -- 1. Sections imputées utilisables à la date de l'écriture.
  SELECT a.name AS axe, v.code AS section, g.code AS compte INTO _p
  FROM public.journal_lines l
  JOIN public.journal_line_analytics la ON la.line_id = l.id
  JOIN public.analytic_values v ON v.id = la.value_id
  JOIN public.analytic_axes a ON a.id = la.axis_id
  JOIN public.gl_accounts g ON g.id = l.account_id
  WHERE l.entry_id = NEW.id
    AND (NOT v.is_active OR NOT a.is_active
         OR (v.valid_from IS NOT NULL AND NEW.entry_date < v.valid_from)
         OR (v.valid_to IS NOT NULL AND NEW.entry_date > v.valid_to))
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Imputation analytique invalide : la section % de l''axe « % » n''est pas utilisable le % (compte %)',
      _p.section, _p.axe, NEW.entry_date, _p.compte
      USING ERRCODE = 'QG002',
            HINT = 'Réactiver la section, corriger ses dates de validité, ou en choisir une autre.';
  END IF;

  -- 2. Règles : pour chaque ligne et chaque axe actif, la règle au préfixe le plus long.
  SELECT a.name AS axe, g.code AS compte, r.requirement INTO _p
  FROM public.journal_lines l
  JOIN public.gl_accounts g ON g.id = l.account_id
  JOIN public.analytic_axes a ON a.tenant_id = NEW.tenant_id AND a.is_active
  JOIN LATERAL (
    SELECT g.analytic_policy AS requirement WHERE g.analytic_policy IN ('required', 'forbidden')
    UNION ALL
    (SELECT ru.requirement FROM public.analytic_rules ru
      WHERE g.analytic_policy IS NULL AND ru.axis_id = a.id AND g.code LIKE ru.account_prefix || '%'
      ORDER BY length(ru.account_prefix) DESC
      LIMIT 1)) r ON true
  LEFT JOIN public.journal_line_analytics la ON la.line_id = l.id AND la.axis_id = a.id
  WHERE l.entry_id = NEW.id
    AND ((r.requirement = 'required' AND la.line_id IS NULL AND NEW.source = ANY (_sources_controlees))
      OR (r.requirement = 'forbidden' AND la.line_id IS NOT NULL))
  ORDER BY a.sort_order, a.code, g.code
  LIMIT 1;
  IF FOUND THEN
    IF _p.requirement = 'required' THEN
      RAISE EXCEPTION 'Imputation analytique incomplète : l''axe « % » est obligatoire sur le compte % (écriture %)',
        _p.axe, _p.compte, NEW.entry_number
        USING ERRCODE = 'QG002',
              HINT = 'Choisir une section sur la pièce, ou définir une section par défaut pour le client.';
    ELSE
      RAISE EXCEPTION 'Imputation analytique interdite : l''axe « % » ne s''applique pas au compte % (écriture %)',
        _p.axe, _p.compte, NEW.entry_number
        USING ERRCODE = 'QG002';
    END IF;
  END IF;

  RETURN NEW;
END; $function$;

-- ─── Qualité : solde anormal ───
CREATE OR REPLACE FUNCTION public.chart_of_accounts_issues()
 RETURNS TABLE (account_id uuid, code text, name text, severity text, issue text, detail text,
                suggested_code text, suggested_name text, suggested_type text, lines bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _a record; _ref public.syscohada_reference_accounts%ROWTYPE; _typed public.syscohada_reference_accounts%ROWTYPE;
  _hint record; _n bigint; _parent text; _solde numeric;
BEGIN
  IF _tenant IS NULL THEN RETURN; END IF;
  FOR _a IN SELECT * FROM public.gl_accounts g WHERE g.tenant_id = _tenant AND g.is_active ORDER BY g.code LOOP
    SELECT count(*) INTO _n FROM public.journal_lines l WHERE l.account_id = _a.id;
    _ref := public.syscohada_reference_of(_a.code);
    SELECT r.* INTO _typed FROM public.syscohada_reference_accounts r
     WHERE _a.code LIKE r.code || '%' AND r.account_type IS NOT NULL ORDER BY length(r.code) DESC LIMIT 1;
    SELECT h.code AS hcode, r.name AS hname, r.account_type AS htype INTO _hint
      FROM public.syscohada_keyword_hints h JOIN public.syscohada_reference_accounts r ON r.code = h.code
     WHERE public.normalize_account_label(_a.name) ~ h.pattern ORDER BY h.priority, length(h.code) DESC LIMIT 1;

    IF _ref.code IS NULL OR (length(_ref.code) = 1 AND _a.code <> _ref.code) THEN
      account_id := _a.id; code := _a.code; name := _a.name; severity := 'error'; issue := 'Code hors plan SYSCOHADA';
      detail := 'Aucun compte SYSCOHADA à deux chiffres ne correspond au préfixe ' || left(_a.code, 2);
      suggested_code := _hint.hcode; suggested_name := _hint.hname; suggested_type := COALESCE(_hint.htype, _a.account_type); lines := _n; RETURN NEXT;
    ELSE
      IF (_ref.account_type IS NULL AND _a.account_type NOT IN ('asset', 'liability'))
         OR (_ref.account_type IS NOT NULL AND _a.account_type <> _ref.account_type)
         OR (_ref.account_type IS NULL AND _typed.code IS NOT NULL AND length(_typed.code) > 1 AND _typed.account_type <> _a.account_type) THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := 'error'; issue := 'Classe et type incohérents';
        detail := 'Le compte SYSCOHADA ' || _ref.code || ' « ' || _ref.name || ' » est de type ' || COALESCE(_ref.account_type, 'actif ou passif')
          || ', le compte est déclaré ' || _a.account_type;
        suggested_code := _hint.hcode; suggested_name := _hint.hname; suggested_type := COALESCE(_hint.htype, _a.account_type); lines := _n; RETURN NEXT;
      ELSIF NOT public.labels_compatible(_a.name, _ref.name) THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := 'warning'; issue := 'Intitulé différent du compte SYSCOHADA';
        detail := 'Le code ' || _a.code || ' relève de ' || _ref.code || ' « ' || _ref.name || ' »';
        suggested_code := _hint.hcode; suggested_name := _hint.hname; suggested_type := COALESCE(_hint.htype, _a.account_type); lines := _n; RETURN NEXT;
      END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM public.gl_accounts o WHERE o.tenant_id = _tenant AND o.is_active AND o.id <> _a.id
                AND public.normalize_account_label(o.name) = public.normalize_account_label(_a.name)) THEN
      account_id := _a.id; code := _a.code; name := _a.name; severity := 'warning'; issue := 'Doublon d''intitulé';
      SELECT string_agg(o.code, ', ' ORDER BY o.code) INTO detail FROM public.gl_accounts o
       WHERE o.tenant_id = _tenant AND o.is_active AND o.id <> _a.id AND public.normalize_account_label(o.name) = public.normalize_account_label(_a.name);
      detail := 'Même intitulé que ' || detail; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
    END IF;

    IF _a.parent_id IS NOT NULL THEN
      SELECT p.code INTO _parent FROM public.gl_accounts p WHERE p.id = _a.parent_id;
      IF NOT (_a.code LIKE _parent || '%') THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := 'error'; issue := 'Compte parent incohérent';
        detail := 'Parent ' || _parent || ' qui n''est pas un préfixe du code'; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.gl_accounts p WHERE p.tenant_id = _tenant AND p.id <> _a.id AND _a.code LIKE p.code || '%' AND length(p.code) < length(_a.code)) THEN
      account_id := _a.id; code := _a.code; name := _a.name; severity := 'info'; issue := 'Sous-compte non rattaché';
      detail := 'Un compte de regroupement existe : lancer « Rattacher les sous-comptes »'; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
    END IF;

    IF _n > 0 AND NOT _a.is_header THEN
      SELECT COALESCE(sum(l.debit - l.credit), 0) INTO _solde FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.entry_id
       WHERE l.account_id = _a.id AND e.status IN ('posted', 'reversed');
      IF (_a.normal_balance = 'debit' AND _solde < 0) OR (_a.normal_balance = 'credit' AND _solde > 0) THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := 'warning'; issue := 'Solde anormal';
        detail := 'Solde ' || CASE WHEN _solde < 0 THEN 'créditeur ' ELSE 'débiteur ' END || to_char(abs(_solde), 'FM999G999G999G990D00')
          || ' pour un compte de sens normal ' || CASE _a.normal_balance WHEN 'debit' THEN 'débiteur' ELSE 'créditeur' END;
        suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
      END IF;
    END IF;

    IF _a.is_header AND _n > 0 THEN
      account_id := _a.id; code := _a.code; name := _a.name; severity := 'error'; issue := 'Compte de regroupement mouvementé';
      detail := _n || ' ligne(s) d''écriture sur un compte non imputable'; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
    END IF;
  END LOOP;

  -- Imputations automatiques hors classe attendue.
  FOR _a IN
    SELECT g.id, g.code, g.name, r.code AS role, r.label, r.expected_prefixes
      FROM public.tenant_posting_accounts t JOIN public.posting_roles r ON r.code = t.role_code
      JOIN public.gl_accounts g ON g.id = t.gl_account_id
     WHERE t.tenant_id = _tenant AND r.expected_prefixes IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM unnest(r.expected_prefixes) p WHERE g.code LIKE p || '%')
  LOOP
    SELECT count(*) INTO _n FROM public.journal_lines l WHERE l.account_id = _a.id;
    account_id := _a.id; code := _a.code; name := _a.name; severity := 'error'; issue := 'Imputation automatique hors classe attendue';
    detail := 'Le rôle « ' || _a.label || ' » attend un compte ' || array_to_string(_a.expected_prefixes, ' ou ') || 'x';
    SELECT r.code, r.name, r.account_type INTO suggested_code, suggested_name, suggested_type
      FROM public.syscohada_reference_accounts r WHERE r.code = (
        SELECT d.account_code FROM public.accounting_framework_role_defaults d WHERE d.framework_code = 'SYSCOHADA_REVISE' AND d.role_code = _a.role);
    lines := _n; RETURN NEXT;
  END LOOP;
END $function$;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
