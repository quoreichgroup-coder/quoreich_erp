-- V76 — Référentiels : types admis d'un compte de référence « mixte ».
--
-- Un compte de référence sans type (classe 4, 5, 8…) était tenu pour « actif ou passif ». Or la classe 8
-- du SYSCOHADA (charges et produits hors activités ordinaires : 81 valeurs comptables des cessions, 82
-- produits des cessions…) relève du résultat, et la classe 1 des capitaux propres ou des dettes : le
-- contrôle du plan signalait à tort une erreur sur le regroupement « 8 », créé avec le type « charges »
-- dès que V75 a ajouté 812 / 822 (parcours 50-comptabilite).
-- framework_reference_accounts.allowed_types dit les types admis ; contrôle du plan et création des
-- regroupements l'utilisent (défaut inchangé : actif ou passif).

ALTER TABLE public.framework_reference_accounts ADD COLUMN allowed_types text[]
  CHECK (allowed_types IS NULL OR allowed_types <@ ARRAY['asset', 'liability', 'equity', 'revenue', 'expense']);
UPDATE public.framework_reference_accounts SET allowed_types = ARRAY['expense', 'revenue'] WHERE framework_code = 'SYSCOHADA_REVISE' AND code = '8';
UPDATE public.framework_reference_accounts SET allowed_types = ARRAY['equity', 'liability'] WHERE code = '1' AND account_type IS NULL;

CREATE OR REPLACE FUNCTION public.chart_of_accounts_issues()
 RETURNS TABLE(account_id uuid, code text, name text, severity text, issue text, detail text, suggested_code text, suggested_name text, suggested_type text, lines bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _fw text; _fw_name text; _sev text; _pattern text;
  _a record; _ref public.framework_reference_accounts%ROWTYPE; _typed public.framework_reference_accounts%ROWTYPE;
  _hint record; _n bigint; _parent text; _solde numeric;
BEGIN
  IF _tenant IS NULL THEN RETURN; END IF;
  _fw := public.chart_framework(_tenant);
  SELECT COALESCE(f.short_label, f.name) INTO _fw_name FROM public.accounting_frameworks f WHERE f.code = _fw;
  SELECT r.params ->> 'pattern' INTO _pattern FROM public.framework_quality_rules r WHERE r.framework_code = _fw AND r.rule_code = 'CODE_FORMAT';

  FOR _a IN SELECT * FROM public.gl_accounts g WHERE g.tenant_id = _tenant AND g.is_active ORDER BY g.code LOOP
    SELECT count(*) INTO _n FROM public.journal_lines l WHERE l.account_id = _a.id;
    _ref := public.framework_reference_of(_fw, _a.code);
    SELECT r.* INTO _typed FROM public.framework_reference_accounts r
     WHERE r.framework_code = _fw AND _a.code LIKE r.code || '%' AND r.account_type IS NOT NULL ORDER BY length(r.code) DESC LIMIT 1;
    _hint := NULL;
    SELECT h.code AS hcode, r.name AS hname, r.account_type AS htype INTO _hint
      FROM public.framework_keyword_hints h JOIN public.framework_reference_accounts r ON r.framework_code = h.framework_code AND r.code = h.code
     WHERE h.framework_code = _fw AND public.normalize_account_label(_a.name) ~ h.pattern ORDER BY h.priority, length(h.code) DESC LIMIT 1;

    _sev := public.quality_rule_severity(_tenant, _fw, 'CODE_FORMAT');
    IF _sev IS NOT NULL AND _pattern IS NOT NULL AND _a.code !~ _pattern THEN
      account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Format du code de compte';
      detail := 'Le code ne respecte pas le format du référentiel ' || COALESCE(_fw_name, _fw);
      suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
    END IF;

    IF _ref.code IS NULL OR (length(_ref.code) = 1 AND _a.code <> _ref.code) THEN
      _sev := public.quality_rule_severity(_tenant, _fw, 'CODE_OUTSIDE_PLAN');
      IF _sev IS NOT NULL THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Code hors plan ' || COALESCE(_fw_name, _fw);
        detail := 'Aucun compte du référentiel ne correspond au préfixe ' || left(_a.code, 2);
        suggested_code := _hint.hcode; suggested_name := _hint.hname; suggested_type := COALESCE(_hint.htype, _a.account_type); lines := _n; RETURN NEXT;
      END IF;
    ELSE
      IF (_ref.account_type IS NULL AND _a.account_type <> ALL (COALESCE(_ref.allowed_types, ARRAY['asset', 'liability'])))
         OR (_ref.account_type IS NOT NULL AND _a.account_type <> _ref.account_type)
         OR (_ref.account_type IS NULL AND _typed.code IS NOT NULL AND length(_typed.code) > 1 AND _typed.account_type <> _a.account_type) THEN
        _sev := public.quality_rule_severity(_tenant, _fw, 'TYPE_MISMATCH');
        IF _sev IS NOT NULL THEN
          account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Classe et type incohérents';
          detail := 'Le compte ' || _ref.code || ' « ' || _ref.name || ' » du référentiel est de type ' || COALESCE(_ref.account_type, array_to_string(COALESCE(_ref.allowed_types, ARRAY['asset', 'liability']), ' ou '))
            || ', le compte est déclaré ' || _a.account_type;
          suggested_code := _hint.hcode; suggested_name := _hint.hname; suggested_type := COALESCE(_hint.htype, _a.account_type); lines := _n; RETURN NEXT;
        END IF;
      ELSIF NOT public.labels_compatible(_a.name, _ref.name) THEN
        _sev := public.quality_rule_severity(_tenant, _fw, 'LABEL_MISMATCH');
        IF _sev IS NOT NULL THEN
          account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Intitulé différent du compte ' || COALESCE(_fw_name, _fw);
          detail := 'Le code ' || _a.code || ' relève de ' || _ref.code || ' « ' || _ref.name || ' »';
          suggested_code := _hint.hcode; suggested_name := _hint.hname; suggested_type := COALESCE(_hint.htype, _a.account_type); lines := _n; RETURN NEXT;
        END IF;
      END IF;
    END IF;

    _sev := public.quality_rule_severity(_tenant, _fw, 'DUPLICATE_LABEL');
    IF _sev IS NOT NULL AND EXISTS (SELECT 1 FROM public.gl_accounts o WHERE o.tenant_id = _tenant AND o.is_active AND o.id <> _a.id
                AND public.normalize_account_label(o.name) = public.normalize_account_label(_a.name)) THEN
      account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Doublon d''intitulé';
      SELECT string_agg(o.code, ', ' ORDER BY o.code) INTO detail FROM public.gl_accounts o
       WHERE o.tenant_id = _tenant AND o.is_active AND o.id <> _a.id AND public.normalize_account_label(o.name) = public.normalize_account_label(_a.name);
      detail := 'Même intitulé que ' || detail; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
    END IF;

    IF _a.parent_id IS NOT NULL THEN
      SELECT p.code INTO _parent FROM public.gl_accounts p WHERE p.id = _a.parent_id;
      _sev := public.quality_rule_severity(_tenant, _fw, 'PARENT_MISMATCH');
      IF _sev IS NOT NULL AND NOT (_a.code LIKE _parent || '%') THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Compte parent incohérent';
        detail := 'Parent ' || _parent || ' qui n''est pas un préfixe du code'; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.gl_accounts p WHERE p.tenant_id = _tenant AND p.id <> _a.id AND _a.code LIKE p.code || '%' AND length(p.code) < length(_a.code)) THEN
      _sev := public.quality_rule_severity(_tenant, _fw, 'UNLINKED_SUBACCOUNT');
      IF _sev IS NOT NULL THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Sous-compte non rattaché';
        detail := 'Un compte de regroupement existe : lancer « Rattacher les sous-comptes »'; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
      END IF;
    END IF;

    IF _n > 0 AND NOT _a.is_header THEN
      _sev := public.quality_rule_severity(_tenant, _fw, 'ABNORMAL_BALANCE');
      IF _sev IS NOT NULL THEN
        SELECT COALESCE(sum(l.debit - l.credit), 0) INTO _solde FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.entry_id
         WHERE l.account_id = _a.id AND e.status IN ('posted', 'reversed');
        IF (_a.normal_balance = 'debit' AND _solde < 0) OR (_a.normal_balance = 'credit' AND _solde > 0) THEN
          account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Solde anormal';
          detail := 'Solde ' || CASE WHEN _solde < 0 THEN 'créditeur ' ELSE 'débiteur ' END || to_char(abs(_solde), 'FM999G999G999G990D00')
            || ' pour un compte de sens normal ' || CASE _a.normal_balance WHEN 'debit' THEN 'débiteur' ELSE 'créditeur' END;
          suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
        END IF;
      END IF;
    END IF;

    IF _a.is_header AND _n > 0 THEN
      _sev := public.quality_rule_severity(_tenant, _fw, 'HEADER_POSTED');
      IF _sev IS NOT NULL THEN
        account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Compte de regroupement mouvementé';
        detail := _n || ' ligne(s) d''écriture sur un compte non imputable'; suggested_code := NULL; suggested_name := NULL; suggested_type := NULL; lines := _n; RETURN NEXT;
      END IF;
    END IF;
  END LOOP;

  _sev := public.quality_rule_severity(_tenant, _fw, 'ROLE_OUTSIDE_CLASS');
  IF _sev IS NULL THEN RETURN; END IF;
  FOR _a IN
    SELECT g.id, g.code, g.name, r.code AS role, r.label, x.prefixes
      FROM public.tenant_posting_accounts t JOIN public.posting_roles r ON r.code = t.role_code
      JOIN public.framework_role_expectations x ON x.framework_code = _fw AND x.role_code = r.code
      JOIN public.gl_accounts g ON g.id = t.gl_account_id
     WHERE t.tenant_id = _tenant AND NOT EXISTS (SELECT 1 FROM unnest(x.prefixes) p WHERE g.code LIKE p || '%')
  LOOP
    SELECT count(*) INTO _n FROM public.journal_lines l WHERE l.account_id = _a.id;
    account_id := _a.id; code := _a.code; name := _a.name; severity := _sev; issue := 'Imputation automatique hors classe attendue';
    detail := 'Le rôle « ' || _a.label || ' » attend un compte ' || array_to_string(_a.prefixes, ' ou ') || 'x';
    suggested_code := NULL; suggested_name := NULL; suggested_type := NULL;
    SELECT r.code, r.name, r.account_type INTO suggested_code, suggested_name, suggested_type
      FROM public.framework_reference_accounts r WHERE r.framework_code = _fw AND r.code = (
        SELECT d.account_code FROM public.accounting_framework_role_defaults d WHERE d.framework_code = _fw AND d.role_code = _a.role);
    lines := _n; RETURN NEXT;
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.create_syscohada_headings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.require_chart_right();
  _fw text := public.chart_framework(_tenant);
  _n integer;
BEGIN
  WITH besoins AS (
    SELECT DISTINCT r.code, r.name, r.account_type, r.allowed_types
      FROM public.gl_accounts g
      JOIN public.framework_reference_accounts r ON r.framework_code = _fw AND g.code LIKE r.code || '%' AND length(r.code) < length(g.code)
     WHERE g.tenant_id = _tenant AND g.is_active AND NOT g.is_header
       AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts_issues() i WHERE i.account_id = g.id AND i.severity = 'error')
  )
  INSERT INTO public.gl_accounts (tenant_id, code, name, account_type, is_header)
  SELECT _tenant, b.code, b.name,
         COALESCE(b.account_type, b.allowed_types[1], CASE WHEN b.code LIKE '4%' OR b.code LIKE '5%' THEN 'asset' WHEN b.code LIKE '1%' THEN 'liability' ELSE 'expense' END), true
    FROM besoins b
   WHERE NOT EXISTS (SELECT 1 FROM public.gl_accounts e WHERE e.tenant_id = _tenant AND e.code = b.code);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $function$;
