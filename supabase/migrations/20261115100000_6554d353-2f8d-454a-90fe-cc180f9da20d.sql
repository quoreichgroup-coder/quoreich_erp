-- V61 — Correctif du contrôle du plan comptable (V60) : un compte de classe (code à un chiffre,
-- ex. « 4 Comptes de tiers », que create_syscohada_headings crée lui-même) était signalé « hors plan ».
-- Seul change le test « code hors plan » : un code égal à une classe du référentiel est conforme.

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
  _hint record; _n bigint; _parent text;
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
