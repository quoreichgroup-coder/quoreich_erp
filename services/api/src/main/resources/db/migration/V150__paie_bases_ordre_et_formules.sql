-- V150 — Paie : ordre de calcul, bases de calcul nommées, méthodes quantité × taux, barème et formule contrôlée
-- (audit docs/audit-erp/32-audit-rh-paie.md, P1 « moteur et rubriques »).
--
-- Constat : une rubrique ne savait calculer qu'un montant fixe ou un % du salaire de base ; l'ordre de calcul était
-- l'ordre alphabétique du code ; aucune rubrique ne pouvait s'appuyer sur une autre (heures supplémentaires =
-- heures × taux horaire, prime d'ancienneté = barème selon l'ancienneté, indemnité = % du brut cotisable…).
-- Références : Odoo — règles salariales évaluées par séquence, une règle utilisant les résultats des règles de
-- séquence inférieure, catégories qui cumulent ; SAP — règles de calcul et cumuls (bases) ; Sage Paie — rubriques
-- de base, de cumul et de calcul.
--
-- Règles :
--   * priority (1 à 9999, défaut 100) fixe l'ordre de calcul ; à priorité égale, l'ordre du code (comportement
--     antérieur conservé) ;
--   * une rubrique ne peut utiliser (formule, base) que des rubriques de priorité STRICTEMENT inférieure : un cycle
--     de dépendances est impossible ; le contrôle porte sur toute la société à chaque enregistrement ;
--   * payroll_bases : base nommée = salaire de base (option) + somme de rubriques ; codes de bases et de rubriques
--     dans un même espace de noms ;
--   * méthodes : fixed, percent_base (sur le salaire de base ou une base nommée), quantity_rate (quantité × taux ;
--     quantité de l'affectation, ou de la variable approuvée du cycle), scale (tranches sur le salaire de base ou une
--     base nommée : montant ou %), formula (langage contrôlé, jamais exécuté comme SQL) ;
--   * formule : nombres, + − × ÷, comparaisons (< <= > >= = <>), parenthèses, MIN, MAX, ROUND, FLOOR, CEIL, ABS, IF ;
--     variables BASE, GROSS, QTY, RATE, DAYS_PRESENT, DAYS_TOTAL, RATIO, DEPENDENTS, SENIORITY_MONTHS ; références
--     [code] à une rubrique ou une base ; analysée en notation polonaise inverse et évaluée par PL/pgSQL.

-- 1. Rubriques : ordre, base, formule, barème.
ALTER TABLE public.hr_payroll_components
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS base_code text,
  ADD COLUMN IF NOT EXISTS formula text,
  ADD COLUMN IF NOT EXISTS scale jsonb,
  ADD COLUMN IF NOT EXISTS scale_mode text;
ALTER TABLE public.hr_payroll_components
  ADD CONSTRAINT hr_payroll_components_priority_check CHECK (priority BETWEEN 1 AND 9999),
  ADD CONSTRAINT hr_payroll_components_formula_check CHECK (formula IS NULL OR length(formula) BETWEEN 1 AND 500),
  ADD CONSTRAINT hr_payroll_components_scale_check CHECK (scale IS NULL OR jsonb_typeof(scale) = 'array'),
  ADD CONSTRAINT hr_payroll_components_scale_mode_check CHECK (scale_mode IS NULL OR scale_mode IN ('amount', 'percent'));
ALTER TABLE public.hr_payroll_components DROP CONSTRAINT hr_payroll_components_calculation_method_check;
ALTER TABLE public.hr_payroll_components ADD CONSTRAINT hr_payroll_components_calculation_method_check
  CHECK (calculation_method IN ('fixed', 'percent_base', 'quantity_rate', 'scale', 'formula'));

ALTER TABLE public.payroll_component_lines DROP CONSTRAINT payroll_component_lines_calculation_method_check;
ALTER TABLE public.payroll_component_lines ADD CONSTRAINT payroll_component_lines_calculation_method_check
  CHECK (calculation_method IN ('fixed', 'percent_base', 'contribution', 'quantity_rate', 'scale', 'formula'));

-- Quantité d'une affectation (heures, jours, unités) pour les rubriques quantité × taux ou formule.
ALTER TABLE public.hr_employee_payroll_components
  ADD COLUMN IF NOT EXISTS quantity numeric(18,4) CHECK (quantity IS NULL OR quantity >= 0);

-- 2. Bases nommées.
CREATE TABLE public.payroll_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  include_base_salary boolean NOT NULL DEFAULT true,
  component_codes text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
ALTER TABLE public.payroll_bases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_bases FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payroll_bases TO authenticated;
CREATE POLICY payroll_bases_read ON public.payroll_bases FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_hr_perm(auth.uid(), 'view_payroll') OR public.has_hr_perm(auth.uid(), 'manage_payroll_components')));

-- 3. Langage de formule : analyse (notation polonaise inverse), évaluation, références.
CREATE OR REPLACE FUNCTION public.payroll_formula_rpn(_expr text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $function$
DECLARE
  _s text := COALESCE(_expr, '');
  _n integer := length(COALESCE(_expr, ''));
  _i integer := 1;
  _ch text;
  _m text[];
  _tok text;
  _prev text := 'start';
  _out text[] := '{}';
  _ops text[] := '{}';
  _argc integer[] := '{}';
  _top text;
  _k integer;
  _fname text;
  _funcs text[] := ARRAY['MIN', 'MAX', 'ROUND', 'FLOOR', 'CEIL', 'ABS', 'IF'];
  _vars text[] := ARRAY['BASE', 'GROSS', 'QTY', 'RATE', 'DAYS_PRESENT', 'DAYS_TOTAL', 'RATIO', 'DEPENDENTS', 'SENIORITY_MONTHS'];
BEGIN
  IF btrim(_s) = '' OR _n > 500 THEN
    RAISE EXCEPTION 'Formule vide ou trop longue (500 caractères au plus)' USING ERRCODE = 'QG028';
  END IF;
  WHILE _i <= _n LOOP
    _ch := substr(_s, _i, 1);
    IF _ch ~ '\s' THEN _i := _i + 1; CONTINUE; END IF;

    IF _ch ~ '[0-9]' THEN
      IF _prev = 'operand' THEN RAISE EXCEPTION 'Formule : opérateur manquant avant « % »', substr(_s, _i, 10) USING ERRCODE = 'QG028'; END IF;
      _m := regexp_match(substr(_s, _i), '^([0-9]+(\.[0-9]+)?)');
      _out := _out || ('n:' || _m[1]);
      _i := _i + length(_m[1]); _prev := 'operand'; CONTINUE;
    END IF;

    IF _ch = '[' THEN
      IF _prev = 'operand' THEN RAISE EXCEPTION 'Formule : opérateur manquant avant « % »', substr(_s, _i, 10) USING ERRCODE = 'QG028'; END IF;
      _m := regexp_match(substr(_s, _i), '^\[([^\]]*)\]');
      IF _m IS NULL OR lower(btrim(_m[1])) !~ '^[a-z0-9][a-z0-9._-]{0,39}$' THEN
        RAISE EXCEPTION 'Formule : référence [code] invalide près de « % »', substr(_s, _i, 15) USING ERRCODE = 'QG028';
      END IF;
      _out := _out || ('r:' || lower(btrim(_m[1])));
      _i := _i + length(_m[1]) + 2; _prev := 'operand'; CONTINUE;
    END IF;

    IF _ch ~ '[A-Za-z_]' THEN
      _m := regexp_match(substr(_s, _i), '^([A-Za-z_][A-Za-z0-9_]*)');
      _tok := upper(_m[1]);
      _i := _i + length(_m[1]);
      IF ltrim(substr(_s, _i)) LIKE '(%' THEN
        IF NOT _tok = ANY(_funcs) THEN
          RAISE EXCEPTION 'Formule : fonction inconnue « % » (MIN, MAX, ROUND, FLOOR, CEIL, ABS, IF)', _tok USING ERRCODE = 'QG028';
        END IF;
        IF _prev = 'operand' THEN RAISE EXCEPTION 'Formule : opérateur manquant avant « % »', _tok USING ERRCODE = 'QG028'; END IF;
        _ops := _ops || ('f:' || _tok); _prev := 'func'; CONTINUE;
      END IF;
      IF NOT _tok = ANY(_vars) THEN
        RAISE EXCEPTION 'Formule : variable inconnue « % » (une rubrique ou une base s''écrit entre crochets : [code])', _tok USING ERRCODE = 'QG028';
      END IF;
      IF _prev = 'operand' THEN RAISE EXCEPTION 'Formule : opérateur manquant avant « % »', _tok USING ERRCODE = 'QG028'; END IF;
      _out := _out || ('v:' || _tok); _prev := 'operand'; CONTINUE;
    END IF;

    IF _ch = '(' THEN
      IF _prev = 'operand' THEN RAISE EXCEPTION 'Formule : opérateur manquant avant « ( »' USING ERRCODE = 'QG028'; END IF;
      _argc := _argc || CASE WHEN _prev = 'func' THEN 1 ELSE -1 END;
      _ops := _ops || '('::text;
      _i := _i + 1; _prev := 'lparen'; CONTINUE;
    END IF;

    IF _ch = ',' OR _ch = ')' THEN
      IF _prev <> 'operand' THEN RAISE EXCEPTION 'Formule : expression incomplète avant « % »', _ch USING ERRCODE = 'QG028'; END IF;
      LOOP
        IF coalesce(array_length(_ops, 1), 0) = 0 THEN
          RAISE EXCEPTION 'Formule : « % » sans parenthèse ouvrante', _ch USING ERRCODE = 'QG028';
        END IF;
        _top := _ops[array_length(_ops, 1)];
        EXIT WHEN _top = '(';
        _out := _out || _top; _ops := _ops[1:array_length(_ops, 1) - 1];
      END LOOP;
      _k := _argc[array_length(_argc, 1)];
      IF _ch = ',' THEN
        IF _k < 0 THEN RAISE EXCEPTION 'Formule : virgule en dehors d''une fonction' USING ERRCODE = 'QG028'; END IF;
        _argc[array_length(_argc, 1)] := _k + 1;
        _i := _i + 1; _prev := 'comma'; CONTINUE;
      END IF;
      _ops := _ops[1:array_length(_ops, 1) - 1];
      _argc := _argc[1:array_length(_argc, 1) - 1];
      IF _k >= 1 THEN
        _fname := substr(_ops[array_length(_ops, 1)], 3);
        _ops := _ops[1:array_length(_ops, 1) - 1];
        IF (_fname IN ('FLOOR', 'CEIL', 'ABS') AND _k <> 1) OR (_fname = 'ROUND' AND _k NOT IN (1, 2))
           OR (_fname = 'IF' AND _k <> 3) THEN
          RAISE EXCEPTION 'Formule : nombre d''arguments incorrect pour %', _fname USING ERRCODE = 'QG028';
        END IF;
        _out := _out || ('f:' || _fname || ':' || _k);
      END IF;
      _i := _i + 1; _prev := 'operand'; CONTINUE;
    END IF;

    -- Opérateurs.
    IF substr(_s, _i, 2) IN ('<=', '>=', '<>') THEN _tok := substr(_s, _i, 2);
    ELSIF _ch IN ('+', '-', '*', '/', '<', '>', '=') THEN _tok := _ch;
    ELSE RAISE EXCEPTION 'Formule : caractère non autorisé « % »', _ch USING ERRCODE = 'QG028';
    END IF;
    _i := _i + length(_tok);
    IF _prev <> 'operand' THEN
      IF _tok = '+' THEN CONTINUE; END IF;
      IF _tok <> '-' THEN RAISE EXCEPTION 'Formule : opérande manquant avant « % »', _tok USING ERRCODE = 'QG028'; END IF;
      _tok := 'neg';
    END IF;
    LOOP
      EXIT WHEN coalesce(array_length(_ops, 1), 0) = 0;
      _top := _ops[array_length(_ops, 1)];
      EXIT WHEN _top NOT LIKE 'o:%';
      EXIT WHEN NOT (
        (CASE substr(_top, 3) WHEN 'neg' THEN 4 WHEN '*' THEN 3 WHEN '/' THEN 3 WHEN '+' THEN 2 WHEN '-' THEN 2 ELSE 1 END)
        > (CASE _tok WHEN 'neg' THEN 4 WHEN '*' THEN 3 WHEN '/' THEN 3 WHEN '+' THEN 2 WHEN '-' THEN 2 ELSE 1 END)
        OR ((CASE substr(_top, 3) WHEN 'neg' THEN 4 WHEN '*' THEN 3 WHEN '/' THEN 3 WHEN '+' THEN 2 WHEN '-' THEN 2 ELSE 1 END)
          = (CASE _tok WHEN 'neg' THEN 4 WHEN '*' THEN 3 WHEN '/' THEN 3 WHEN '+' THEN 2 WHEN '-' THEN 2 ELSE 1 END)
          AND _tok <> 'neg'));
      _out := _out || _top; _ops := _ops[1:array_length(_ops, 1) - 1];
    END LOOP;
    _ops := _ops || ('o:' || _tok);
    _prev := 'operator';
  END LOOP;
  IF _prev <> 'operand' THEN RAISE EXCEPTION 'Formule : expression incomplète en fin de formule' USING ERRCODE = 'QG028'; END IF;
  WHILE coalesce(array_length(_ops, 1), 0) > 0 LOOP
    _top := _ops[array_length(_ops, 1)];
    IF _top = '(' OR _top LIKE 'f:%' THEN RAISE EXCEPTION 'Formule : parenthèse ouvrante non fermée' USING ERRCODE = 'QG028'; END IF;
    _out := _out || _top; _ops := _ops[1:array_length(_ops, 1) - 1];
  END LOOP;
  RETURN _out;
END $function$;

CREATE OR REPLACE FUNCTION public.payroll_formula_eval(_rpn text[], _vars jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $function$
DECLARE
  _st numeric[] := '{}';
  _t text;
  _a numeric;
  _b numeric;
  _k integer;
  _name text;
  _args numeric[];
  _len integer;
BEGIN
  FOREACH _t IN ARRAY _rpn LOOP
    _len := coalesce(array_length(_st, 1), 0);
    IF _t LIKE 'n:%' THEN
      _st := _st || substr(_t, 3)::numeric;
    ELSIF _t LIKE 'v:%' THEN
      _st := _st || COALESCE(NULLIF(_vars ->> substr(_t, 3), '')::numeric, 0);
    ELSIF _t LIKE 'r:%' THEN
      _st := _st || COALESCE(NULLIF(_vars -> 'refs' ->> substr(_t, 3), '')::numeric, 0);
    ELSIF _t = 'o:neg' THEN
      _st[_len] := -_st[_len];
    ELSIF _t LIKE 'o:%' THEN
      _b := _st[_len]; _a := _st[_len - 1]; _st := _st[1:_len - 2];
      _st := _st || CASE substr(_t, 3)
        WHEN '+' THEN _a + _b WHEN '-' THEN _a - _b WHEN '*' THEN _a * _b
        WHEN '/' THEN CASE WHEN _b = 0 THEN NULL ELSE _a / _b END
        WHEN '<' THEN (_a < _b)::int WHEN '<=' THEN (_a <= _b)::int WHEN '>' THEN (_a > _b)::int
        WHEN '>=' THEN (_a >= _b)::int WHEN '=' THEN (_a = _b)::int ELSE (_a <> _b)::int END;
      IF substr(_t, 3) = '/' AND _b = 0 THEN
        RAISE EXCEPTION 'Formule : division par zéro' USING ERRCODE = '22012';
      END IF;
    ELSE
      _name := split_part(_t, ':', 2);
      _k := split_part(_t, ':', 3)::integer;
      _args := _st[_len - _k + 1:_len];
      _st := _st[1:_len - _k];
      _st := _st || CASE _name
        WHEN 'MIN' THEN (SELECT min(x) FROM unnest(_args) x)
        WHEN 'MAX' THEN (SELECT max(x) FROM unnest(_args) x)
        WHEN 'ROUND' THEN round(_args[1], COALESCE(_args[2], 0)::int)
        WHEN 'FLOOR' THEN floor(_args[1]) WHEN 'CEIL' THEN ceil(_args[1]) WHEN 'ABS' THEN abs(_args[1])
        WHEN 'IF' THEN CASE WHEN _args[1] <> 0 THEN _args[2] ELSE _args[3] END END;
    END IF;
  END LOOP;
  IF coalesce(array_length(_st, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'Formule : expression invalide' USING ERRCODE = 'QG028';
  END IF;
  RETURN _st[1];
END $function$;

CREATE OR REPLACE FUNCTION public.payroll_formula_refs(_formula text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT COALESCE(array_agg(DISTINCT substr(t, 3)), '{}') FROM unnest(public.payroll_formula_rpn(_formula)) t WHERE t LIKE 'r:%'
$function$;
GRANT EXECUTE ON FUNCTION public.payroll_formula_rpn(text), public.payroll_formula_eval(text[], jsonb),
  public.payroll_formula_refs(text) TO authenticated;

-- Essai d'une formule avec des valeurs données (écran « Tester la formule »). Variables absentes = 0.
CREATE OR REPLACE FUNCTION public.payroll_formula_try(_formula text, _vars jsonb DEFAULT '{}'::jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT public.payroll_formula_eval(public.payroll_formula_rpn(_formula), COALESCE(_vars, '{}'::jsonb))
$function$;
GRANT EXECUTE ON FUNCTION public.payroll_formula_try(text, jsonb) TO authenticated;

-- 4. Barème : tranches [{up_to, value}] croissantes, dernière sans limite.
CREATE OR REPLACE FUNCTION public.payroll_scale_valid(_scale jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $function$
DECLARE _e jsonb; _i integer := 0; _n integer; _prev numeric := NULL; _up numeric;
BEGIN
  IF _scale IS NULL OR jsonb_typeof(_scale) <> 'array' THEN RETURN false; END IF;
  _n := jsonb_array_length(_scale);
  IF _n = 0 THEN RETURN false; END IF;
  FOR _e IN SELECT value FROM jsonb_array_elements(_scale) LOOP
    _i := _i + 1;
    IF jsonb_typeof(_e) <> 'object' OR jsonb_typeof(_e -> 'value') <> 'number' OR NOT (_e ? 'up_to') THEN RETURN false; END IF;
    IF _e -> 'up_to' = 'null'::jsonb THEN
      IF _i <> _n THEN RETURN false; END IF;
    ELSE
      IF jsonb_typeof(_e -> 'up_to') <> 'number' OR _i = _n THEN RETURN false; END IF;
      _up := (_e ->> 'up_to')::numeric;
      IF _prev IS NOT NULL AND _up <= _prev THEN RETURN false; END IF;
      _prev := _up;
    END IF;
  END LOOP;
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.payroll_scale_value(_scale jsonb, _x numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT (e ->> 'value')::numeric FROM jsonb_array_elements(_scale) WITH ORDINALITY AS t(e, o)
   WHERE e -> 'up_to' = 'null'::jsonb OR _x <= (e ->> 'up_to')::numeric
   ORDER BY o LIMIT 1
$function$;

-- 5. Dépendances : une rubrique n'utilise que des rubriques de priorité strictement inférieure. Interne.
CREATE OR REPLACE FUNCTION public.payroll_dependency_issues(_tenant uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _c record;
  _dep text;
  _deps text[];
  _x record;
  _b public.payroll_bases%ROWTYPE;
  _issues text[] := '{}';
BEGIN
  FOR _c IN SELECT * FROM public.hr_payroll_components WHERE tenant_id = _tenant AND (formula IS NOT NULL OR base_code IS NOT NULL) LOOP
    _deps := CASE WHEN _c.formula IS NOT NULL THEN public.payroll_formula_refs(_c.formula) ELSE '{}' END
      || CASE WHEN _c.base_code IS NOT NULL THEN ARRAY[_c.base_code] ELSE '{}' END;
    FOREACH _dep IN ARRAY _deps LOOP
      SELECT code, priority INTO _x FROM public.hr_payroll_components WHERE tenant_id = _tenant AND code = _dep;
      IF FOUND THEN
        IF _x.priority >= _c.priority THEN
          _issues := _issues || format('« %s » (priorité %s) utilise « %s » (priorité %s) : une rubrique ne peut utiliser que des rubriques calculées avant elle',
            _c.code, _c.priority, _dep, _x.priority);
        END IF;
        CONTINUE;
      END IF;
      SELECT * INTO _b FROM public.payroll_bases WHERE tenant_id = _tenant AND code = _dep;
      IF NOT FOUND THEN
        _issues := _issues || format('« %s » : référence « %s » inconnue (ni rubrique ni base)', _c.code, _dep);
        CONTINUE;
      END IF;
      FOR _x IN SELECT code, priority FROM public.hr_payroll_components
          WHERE tenant_id = _tenant AND code = ANY(_b.component_codes) AND priority >= _c.priority LOOP
        _issues := _issues || format('« %s » (priorité %s) utilise la base « %s », qui contient « %s » (priorité %s) calculée après elle',
          _c.code, _c.priority, _b.code, _x.code, _x.priority);
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN _issues;
END $function$;
REVOKE ALL ON FUNCTION public.payroll_dependency_issues(uuid) FROM PUBLIC, anon, authenticated;

-- 6. Bases : lecture et enregistrement.
CREATE OR REPLACE FUNCTION public.list_payroll_bases()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR (NOT public.has_hr_perm(auth.uid(), 'view_payroll')
      AND NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components')) THEN
    RAISE EXCEPTION 'Droit insuffisant pour consulter les bases de paie' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(b) - 'tenant_id' ORDER BY b.code) FROM public.payroll_bases b
    WHERE b.tenant_id = _tenant), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.list_payroll_bases() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_payroll_bases() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_payroll_base(_input jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := NULLIF(_input ->> 'id', '')::uuid;
  _code text := lower(btrim(_input ->> 'code'));
  _codes text[];
  _unknown text;
  _issues text[];
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_payroll_components' USING ERRCODE = '42501';
  END IF;
  IF _code IS NULL OR _code !~ '^[a-z0-9][a-z0-9._-]{0,39}$' OR length(btrim(COALESCE(_input ->> 'label', ''))) NOT BETWEEN 1 AND 120
     OR (_input ? 'component_codes' AND jsonb_typeof(_input -> 'component_codes') <> 'array') THEN
    RAISE EXCEPTION 'Base de calcul invalide (code, libellé, rubriques)' USING ERRCODE = 'QG028';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(value))), '{}') INTO _codes
    FROM jsonb_array_elements_text(COALESCE(_input -> 'component_codes', '[]'::jsonb));
  SELECT c INTO _unknown FROM unnest(_codes) c
   WHERE NOT EXISTS (SELECT 1 FROM public.hr_payroll_components p WHERE p.tenant_id = _tenant AND p.code = c) LIMIT 1;
  IF _unknown IS NOT NULL THEN RAISE EXCEPTION 'Rubrique « % » inconnue dans la base', _unknown USING ERRCODE = 'QG028'; END IF;
  IF EXISTS (SELECT 1 FROM public.hr_payroll_components p WHERE p.tenant_id = _tenant AND p.code = _code) THEN
    RAISE EXCEPTION 'Le code « % » est déjà celui d''une rubrique', _code USING ERRCODE = 'QG028';
  END IF;
  IF _id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.payroll_bases b WHERE b.tenant_id = _tenant AND b.code = _code) THEN
      RAISE EXCEPTION 'La base « % » existe déjà : modifiez-la', _code USING ERRCODE = 'QG028';
    END IF;
    INSERT INTO public.payroll_bases (tenant_id, code, label, include_base_salary, component_codes, active)
    VALUES (_tenant, _code, btrim(_input ->> 'label'), COALESCE((_input ->> 'include_base_salary')::boolean, true), _codes,
      COALESCE((_input ->> 'active')::boolean, true))
    RETURNING id INTO _id;
  ELSE
    UPDATE public.payroll_bases SET code = _code, label = btrim(_input ->> 'label'),
      include_base_salary = COALESCE((_input ->> 'include_base_salary')::boolean, include_base_salary),
      component_codes = _codes, active = COALESCE((_input ->> 'active')::boolean, active), updated_at = now()
     WHERE id = _id AND tenant_id = _tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Base introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  END IF;
  _issues := public.payroll_dependency_issues(_tenant);
  IF cardinality(_issues) > 0 THEN RAISE EXCEPTION 'Ordre de calcul impossible : %', array_to_string(_issues, ' ; ') USING ERRCODE = 'QG028'; END IF;
  RETURN _id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Code de base déjà utilisé' USING ERRCODE = 'QG028';
END $function$;
REVOKE ALL ON FUNCTION public.save_payroll_base(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_payroll_base(jsonb) TO authenticated;

-- 7. Rubriques : lecture et enregistrement (V149 + ordre, base, formule, barème).
DROP FUNCTION public.list_hr_payroll_components(boolean);
CREATE FUNCTION public.list_hr_payroll_components(_include_inactive boolean DEFAULT false)
RETURNS TABLE (id uuid, tenant_id uuid, code text, label text, kind text, calculation_method text,
  amount numeric, cap numeric, effective_from date, effective_to date, gl_account_code text,
  printable boolean, active boolean, sort_order integer, taxable boolean,
  subject_employee_social boolean, subject_employer_social boolean, prorated boolean,
  tax_exempt_pct numeric, tax_exempt_cap numeric, priority integer, base_code text, formula text,
  scale jsonb, scale_mode text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR (NOT public.has_hr_perm(auth.uid(), 'view_payroll')
      AND NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components')) THEN
    RAISE EXCEPTION 'Droit insuffisant pour consulter les rubriques de paie' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT c.id, c.tenant_id, c.code, c.label, c.kind, c.calculation_method, c.amount, c.cap,
      c.effective_from, c.effective_to, c.gl_account_code, c.printable, c.active, c.sort_order,
      c.taxable, c.subject_employee_social, c.subject_employer_social, c.prorated, c.tax_exempt_pct, c.tax_exempt_cap,
      c.priority, c.base_code, c.formula, c.scale, c.scale_mode
    FROM public.hr_payroll_components c
   WHERE c.tenant_id = _tenant AND (_include_inactive OR c.active)
   ORDER BY c.sort_order, c.label, c.code;
END
$function$;
REVOKE ALL ON FUNCTION public.list_hr_payroll_components(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_payroll_components(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_hr_payroll_component(_input jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := NULLIF(_input->>'id', '')::uuid;
  _code text := lower(btrim(_input->>'code'));
  _label text := btrim(_input->>'label');
  _kind text := _input->>'kind';
  _method text := _input->>'calculation_method';
  _amount numeric := NULLIF(_input->>'amount', '')::numeric;
  _cap numeric := nullif(_input->>'cap', '')::numeric;
  _from date := (_input->>'effective_from')::date;
  _to date := nullif(_input->>'effective_to', '')::date;
  _exempt_pct numeric := nullif(_input->>'tax_exempt_pct', '')::numeric;
  _exempt_cap numeric := nullif(_input->>'tax_exempt_cap', '')::numeric;
  _priority integer := COALESCE(NULLIF(_input->>'priority', '')::integer, 100);
  _base_code text := NULLIF(lower(btrim(_input->>'base_code')), '');
  _formula text := NULLIF(btrim(_input->>'formula'), '');
  _scale jsonb := CASE WHEN jsonb_typeof(_input->'scale') = 'array' THEN _input->'scale' END;
  _scale_mode text := NULLIF(_input->>'scale_mode', '');
  _refs text[];
  _issues text[];
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_payroll_components' USING ERRCODE = '42501';
  END IF;
  IF _code IS NULL OR _code !~ '^[a-z0-9][a-z0-9._-]{0,39}$' OR _label IS NULL OR length(_label) NOT BETWEEN 1 AND 120
     OR _kind IS NULL OR _kind NOT IN ('earning', 'deduction', 'employer_charge')
     OR _method IS NULL OR _method NOT IN ('fixed', 'percent_base', 'quantity_rate', 'scale', 'formula')
     OR _from IS NULL OR (_to IS NOT NULL AND _to < _from) OR (_cap IS NOT NULL AND _cap <= 0)
     OR _priority NOT BETWEEN 1 AND 9999
     OR (_exempt_pct IS NOT NULL AND _exempt_pct NOT BETWEEN 0 AND 100) OR (_exempt_cap IS NOT NULL AND _exempt_cap < 0) THEN
    RAISE EXCEPTION 'Definition de rubrique de paie invalide' USING ERRCODE = 'QG028';
  END IF;
  -- Paramètres propres à chaque méthode ; les autres sont effacés.
  IF _method IN ('fixed', 'percent_base', 'quantity_rate') THEN
    IF _amount IS NULL OR _amount <= 0 OR (_method = 'percent_base' AND _amount > 100) THEN
      RAISE EXCEPTION 'Montant, taux ou prix unitaire obligatoire et positif (taux ≤ 100 %%)' USING ERRCODE = 'QG028';
    END IF;
  ELSE
    _amount := COALESCE(_amount, 0);
  END IF;
  IF _method = 'scale' THEN
    IF NOT public.payroll_scale_valid(_scale) OR _scale_mode IS NULL OR _scale_mode NOT IN ('amount', 'percent') THEN
      RAISE EXCEPTION 'Barème invalide : tranches croissantes {up_to, value}, dernière sans limite, mode montant ou %%' USING ERRCODE = 'QG028';
    END IF;
  ELSE
    _scale := NULL; _scale_mode := NULL;
  END IF;
  IF _method = 'formula' THEN
    IF _formula IS NULL THEN RAISE EXCEPTION 'Formule obligatoire' USING ERRCODE = 'QG028'; END IF;
    _refs := public.payroll_formula_refs(_formula);
    BEGIN
      PERFORM public.payroll_formula_eval(public.payroll_formula_rpn(_formula),
        jsonb_build_object('BASE', 1, 'GROSS', 1, 'QTY', 1, 'RATE', 1, 'DAYS_PRESENT', 1, 'DAYS_TOTAL', 1, 'RATIO', 1,
          'DEPENDENTS', 1, 'SENIORITY_MONTHS', 1,
          'refs', COALESCE((SELECT jsonb_object_agg(r, 1) FROM unnest(_refs) r), '{}'::jsonb)));
    EXCEPTION WHEN division_by_zero THEN NULL;
    END;
    IF _code = ANY(_refs) THEN RAISE EXCEPTION 'Une formule ne peut pas se référencer elle-même' USING ERRCODE = 'QG028'; END IF;
  ELSE
    _formula := NULL;
  END IF;
  IF _method NOT IN ('percent_base', 'scale') THEN _base_code := NULL; END IF;
  IF _base_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.payroll_bases b WHERE b.tenant_id = _tenant AND b.code = _base_code) THEN
    RAISE EXCEPTION 'Base de calcul « % » inconnue', _base_code USING ERRCODE = 'QG028';
  END IF;
  IF (_exempt_pct IS NOT NULL OR _exempt_cap IS NOT NULL)
     AND (_kind <> 'earning' OR NOT COALESCE((_input->>'taxable')::boolean, false)) THEN
    RAISE EXCEPTION 'Une exonération partielle ne s''applique qu''à un gain imposable' USING ERRCODE = 'QG028';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_bases b WHERE b.tenant_id = _tenant AND b.code = _code) THEN
    RAISE EXCEPTION 'Le code « % » est déjà celui d''une base de calcul', _code USING ERRCODE = 'QG028';
  END IF;
  IF _id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.hr_payroll_components c WHERE c.tenant_id = _tenant AND c.code = _code) THEN
      RAISE EXCEPTION 'Le code de rubrique « % » existe deja : modifiez la rubrique existante', _code USING ERRCODE = 'QG028';
    END IF;
    INSERT INTO public.hr_payroll_components
      (tenant_id, code, label, kind, calculation_method, amount, cap, effective_from, effective_to,
       gl_account_code, printable, active, sort_order, taxable, subject_employee_social, subject_employer_social, prorated,
       tax_exempt_pct, tax_exempt_cap, priority, base_code, formula, scale, scale_mode)
    VALUES (_tenant, _code, _label, _kind, _method, _amount, _cap, _from, _to,
      nullif(btrim(_input->>'gl_account_code'), ''), COALESCE((_input->>'printable')::boolean, true),
      COALESCE((_input->>'active')::boolean, true), COALESCE((_input->>'sort_order')::integer, 0),
      COALESCE((_input->>'taxable')::boolean, false),
      COALESCE((_input->>'subject_employee_social')::boolean, false),
      COALESCE((_input->>'subject_employer_social')::boolean, false),
      COALESCE((_input->>'prorated')::boolean, false), _exempt_pct, _exempt_cap,
      _priority, _base_code, _formula, _scale, _scale_mode)
    RETURNING id INTO _id;
  ELSE
    IF EXISTS (SELECT 1 FROM public.hr_payroll_components c WHERE c.tenant_id = _tenant AND c.code = _code AND c.id <> _id) THEN
      RAISE EXCEPTION 'Le code de rubrique « % » est deja utilise par une autre rubrique', _code USING ERRCODE = 'QG028';
    END IF;
    UPDATE public.hr_payroll_components SET
      code = _code, label = _label, kind = _kind, calculation_method = _method, amount = _amount, cap = _cap,
      effective_from = _from, effective_to = _to, gl_account_code = nullif(btrim(_input->>'gl_account_code'), ''),
      printable = COALESCE((_input->>'printable')::boolean, printable),
      active = COALESCE((_input->>'active')::boolean, active),
      sort_order = COALESCE((_input->>'sort_order')::integer, sort_order),
      taxable = COALESCE((_input->>'taxable')::boolean, taxable),
      subject_employee_social = COALESCE((_input->>'subject_employee_social')::boolean, subject_employee_social),
      subject_employer_social = COALESCE((_input->>'subject_employer_social')::boolean, subject_employer_social),
      prorated = COALESCE((_input->>'prorated')::boolean, prorated),
      tax_exempt_pct = _exempt_pct, tax_exempt_cap = _exempt_cap,
      priority = _priority, base_code = _base_code, formula = _formula, scale = _scale, scale_mode = _scale_mode,
      updated_at = now()
    WHERE id = _id AND tenant_id = _tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rubrique introuvable dans la societe courante' USING ERRCODE = '42501'; END IF;
  END IF;
  _issues := public.payroll_dependency_issues(_tenant);
  IF cardinality(_issues) > 0 THEN
    RAISE EXCEPTION 'Ordre de calcul impossible : %', array_to_string(_issues, ' ; ') USING ERRCODE = 'QG028';
  END IF;
  RETURN _id;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Definition de rubrique de paie invalide' USING ERRCODE = 'QG028';
END
$function$;

-- 8. Affectations : quantité.
DROP FUNCTION public.list_hr_employee_payroll_components(uuid);
CREATE FUNCTION public.list_hr_employee_payroll_components(_employee uuid)
RETURNS TABLE (id uuid, tenant_id uuid, employee_id uuid, component_id uuid, code text, label text,
  kind text, calculation_method text, amount numeric, amount_override numeric, cap numeric,
  effective_from date, effective_to date, active boolean, quantity numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR (NOT public.has_hr_perm(auth.uid(), 'view_payroll')
      AND NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components')) THEN
    RAISE EXCEPTION 'Droit insuffisant pour consulter les affectations de paie' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = _employee AND e.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Salarie introuvable dans la societe courante' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT a.id, a.tenant_id, a.employee_id, c.id, c.code, c.label, c.kind,
      c.calculation_method, COALESCE(a.amount_override, c.amount), a.amount_override, c.cap,
      a.effective_from, a.effective_to, a.active, a.quantity
    FROM public.hr_employee_payroll_components a
    JOIN public.hr_payroll_components c ON c.id = a.component_id AND c.tenant_id = a.tenant_id
   WHERE a.tenant_id = _tenant AND a.employee_id = _employee
   ORDER BY a.effective_from DESC, c.sort_order, c.code;
END
$function$;
REVOKE ALL ON FUNCTION public.list_hr_employee_payroll_components(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hr_employee_payroll_components(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_hr_employee_payroll_component(_employee uuid, _input jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _component uuid := (_input->>'component_id')::uuid;
  _amount numeric := nullif(_input->>'amount_override', '')::numeric;
  _quantity numeric := nullif(_input->>'quantity', '')::numeric;
  _from date := (_input->>'effective_from')::date;
  _to date := nullif(_input->>'effective_to', '')::date;
  _active boolean := COALESCE((_input->>'active')::boolean, true);
  _id uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'manage_payroll_components') THEN
    RAISE EXCEPTION 'Permission refusee : hr.manage_payroll_components' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = _employee AND e.tenant_id = _tenant)
     OR NOT EXISTS (SELECT 1 FROM public.hr_payroll_components c
       WHERE c.id = _component AND c.tenant_id = _tenant AND c.active)
     OR _from IS NULL OR (_to IS NOT NULL AND _to < _from) OR (_amount IS NOT NULL AND _amount < 0)
     OR (_quantity IS NOT NULL AND _quantity < 0) THEN
    RAISE EXCEPTION 'Affectation de rubrique invalide' USING ERRCODE = 'QG028';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hr_employee_payroll_components a
      WHERE a.tenant_id = _tenant AND a.employee_id = _employee AND a.component_id = _component
        AND a.effective_from <> _from
        AND (_to IS NULL OR a.effective_from <= _to)
        AND (a.effective_to IS NULL OR a.effective_to >= _from)) THEN
    RAISE EXCEPTION 'Les dates de cette rubrique chevauchent une affectation existante' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.hr_employee_payroll_components
    (tenant_id, employee_id, component_id, amount_override, quantity, effective_from, effective_to, active, created_by)
  VALUES (_tenant, _employee, _component, _amount, _quantity, _from, _to, _active, auth.uid())
  ON CONFLICT (tenant_id, employee_id, component_id, effective_from) DO UPDATE SET
    amount_override = EXCLUDED.amount_override, quantity = EXCLUDED.quantity, effective_to = EXCLUDED.effective_to,
    active = EXCLUDED.active, updated_at = now()
  RETURNING id INTO _id;
  RETURN _id;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Affectation de rubrique invalide' USING ERRCODE = 'QG028';
END
$function$;

-- 9. Calcul du cycle : V149, rubriques dans l'ordre de priorité, toutes méthodes, références et bases.
CREATE OR REPLACE FUNCTION public.generate_payroll_lines(_run_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _run public.payroll_runs%ROWTYPE;
  _rules jsonb;
  _employee public.employees%ROWTYPE;
  _state jsonb;
  _segment record;
  _segments jsonb;
  _item record;
  _c jsonb;
  _e jsonb;
  _period_start date;
  _period_end date;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _unit numeric;
  _mode text;
  _days_total numeric;
  _days_present numeric;
  _weight numeric;
  _weighted_base numeric;
  _ratio numeric;
  _base numeric(18,2);
  _rate numeric(18,4);
  _qty numeric;
  _base_value numeric(18,2);
  _values jsonb;
  _refs jsonb;
  _seniority integer;
  _hire date;
  _amount numeric(18,2);
  _exempt numeric(18,2);
  _gross numeric(18,2);
  _earned numeric(18,2);
  _component_deductions numeric(18,2);
  _component_charges numeric(18,2);
  _employee_base numeric(18,2);
  _employer_base numeric(18,2);
  _taxable_gross numeric(18,2);
  _floor numeric;
  _e_base numeric(18,2);
  _r_base numeric(18,2);
  _e_amount numeric(18,2);
  _r_amount numeric(18,2);
  _employee_contrib numeric(18,2);
  _employer_contrib numeric(18,2);
  _tax_deductible numeric(18,2);
  _taxable numeric(18,2);
  _abatement numeric(18,2);
  _net_taxable numeric(18,2);
  _tax_before numeric(18,2);
  _dependents integer;
  _reduction numeric;
  _taxes numeric(18,2);
  _net numeric(18,2);
  _count integer := 0;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'create_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusee : role Saisie RH requis' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id FOR UPDATE;
  IF _run.tenant_id IS NULL OR _run.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Cycle non modifiable (statut %)', _run.status; END IF;
  IF _run.period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Periode de paie invalide (format attendu AAAA-MM)' USING ERRCODE = 'QG028';
  END IF;
  _period_start := to_date(_run.period || '-01', 'YYYY-MM-DD');
  _period_end := (_period_start + interval '1 month - 1 day')::date;
  IF EXISTS (SELECT 1 FROM public.payroll_run_variables v WHERE v.tenant_id = _tenant
       AND v.run_id = _run_id AND v.status = 'pending') THEN
    RAISE EXCEPTION 'Toutes les variables doivent etre approuvees ou rejetees avant calcul' USING ERRCODE = 'QG028';
  END IF;
  IF cardinality(public.payroll_dependency_issues(_tenant)) > 0 THEN
    RAISE EXCEPTION 'Ordre de calcul des rubriques impossible : %', array_to_string(public.payroll_dependency_issues(_tenant), ' ; ')
      USING ERRCODE = 'QG028';
  END IF;
  _rules := public.payroll_effective_rules(_tenant, _period_start);
  _unit := (_rules ->> 'rounding_unit')::numeric;
  _mode := _rules ->> 'rounding_mode';
  _days_total := public.payroll_day_weight(_period_start, _period_end, _period_end, _rules ->> 'proration_method');

  DELETE FROM public.payroll_component_lines WHERE run_id = _run_id;
  DELETE FROM public.payroll_lines WHERE run_id = _run_id;
  FOR _employee IN SELECT e.* FROM public.employees e WHERE e.tenant_id = _tenant ORDER BY e.id LOOP
    _days_present := 0; _weighted_base := 0; _state := NULL; _segments := '[]'::jsonb;
    FOR _segment IN SELECT * FROM public.payroll_presence_segments(_employee.id, _period_start, _period_end) LOOP
      IF _segment.present THEN
        _weight := public.payroll_day_weight(_segment.segment_start, _segment.segment_end, _period_end, _rules ->> 'proration_method');
        IF COALESCE(upper(btrim(_segment.state->>'currency')), '') <> (_rules ->> 'currency_code') THEN
          RAISE EXCEPTION 'Devise des salaries differente de la devise du bareme de paie' USING ERRCODE = 'QG028';
        END IF;
        _days_present := _days_present + _weight;
        _weighted_base := _weighted_base
          + GREATEST(COALESCE(NULLIF(_segment.state->>'base_salary', '')::numeric, 0), 0) * _weight;
        _state := _segment.state;
        _segments := _segments || jsonb_build_array(jsonb_build_object('from', _segment.segment_start,
          'to', _segment.segment_end, 'days', _weight, 'base_salary', _segment.state->'base_salary'));
      END IF;
    END LOOP;
    CONTINUE WHEN _days_present <= 0;

    _ratio := LEAST(_days_present / _days_total, 1);
    _base := ROUND(_weighted_base / _days_total, 2);
    _earned := 0; _component_deductions := 0; _component_charges := 0;
    _employee_base := _base; _employer_base := _base; _taxable_gross := _base;
    _values := '{}'::jsonb;
    _hire := NULLIF(_state ->> 'hire_date', '')::date;
    _seniority := CASE WHEN _hire IS NULL OR _hire > _period_end THEN 0
      ELSE (extract(year FROM age(_period_end, _hire)) * 12 + extract(month FROM age(_period_end, _hire)))::integer END;
    _dependents := LEAST(COALESCE(NULLIF(_state ->> 'tax_dependents', '')::integer, 0),
      COALESCE(NULLIF(_rules ->> 'family_max_dependents', '')::integer, 30));

    FOR _item IN
      SELECT c.id component_id, c.code, c.label, c.kind, c.calculation_method,
        c.taxable, c.subject_employee_social, c.subject_employer_social, c.cap, c.prorated,
        c.tax_exempt_pct, c.tax_exempt_cap, c.priority, c.base_code, c.formula, c.scale, c.scale_mode,
        c.printable, c.sort_order, c.gl_account_code, c.amount definition_amount,
        COALESCE(a.amount_override, c.amount) rate_amount, NULL::numeric variable_amount, a.quantity assigned_quantity,
        'employee_assignment'::text source_type, a.id source_id
      FROM public.hr_employee_payroll_components a
      JOIN public.hr_payroll_components c ON c.id = a.component_id AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = _tenant AND a.employee_id = _employee.id AND a.active
        AND a.effective_from <= _period_end AND (a.effective_to IS NULL OR a.effective_to >= _period_start)
        AND c.active AND c.effective_from <= _period_end AND (c.effective_to IS NULL OR c.effective_to >= _period_start)
      UNION ALL
      SELECT c.id, c.code, c.label, c.kind, c.calculation_method,
        c.taxable, c.subject_employee_social, c.subject_employer_social, c.cap, c.prorated,
        c.tax_exempt_pct, c.tax_exempt_cap, c.priority, c.base_code, c.formula, c.scale, c.scale_mode,
        c.printable, c.sort_order, c.gl_account_code, c.amount, c.amount, v.amount, NULL::numeric,
        'payroll_variable'::text, v.id
      FROM public.payroll_run_variables v
      JOIN public.hr_payroll_components c ON c.id = v.component_id AND c.tenant_id = v.tenant_id
      WHERE v.tenant_id = _tenant AND v.run_id = _run_id AND v.employee_id = _employee.id
        AND v.status = 'approved' AND c.active
      ORDER BY priority, code, source_type, source_id
    LOOP
      _rate := _item.rate_amount;
      -- Quantité : variable approuvée (pour quantité × taux et formule, la variable porte la quantité), sinon affectation.
      _qty := CASE WHEN _item.source_type = 'payroll_variable' THEN _item.variable_amount ELSE COALESCE(_item.assigned_quantity, 0) END;
      -- Références : rubriques déjà calculées et bases nommées à cet instant.
      _refs := _values || COALESCE((SELECT jsonb_object_agg(b.code,
          (CASE WHEN b.include_base_salary THEN _base ELSE 0 END)
          + COALESCE((SELECT sum((_values ->> x)::numeric) FROM unnest(b.component_codes) x WHERE _values ? x), 0))
        FROM public.payroll_bases b WHERE b.tenant_id = _tenant AND b.active), '{}'::jsonb);
      _base_value := CASE WHEN _item.base_code IS NULL THEN _base ELSE COALESCE((_refs ->> _item.base_code)::numeric, 0) END;
      _amount := CASE
        WHEN _item.calculation_method = 'quantity_rate' THEN _qty * _rate
        WHEN _item.calculation_method = 'formula' THEN public.payroll_formula_eval(public.payroll_formula_rpn(_item.formula),
          jsonb_build_object('BASE', _base, 'GROSS', _base + _earned, 'QTY', _qty, 'RATE', _rate,
            'DAYS_PRESENT', _days_present, 'DAYS_TOTAL', _days_total, 'RATIO', _ratio, 'DEPENDENTS', _dependents,
            'SENIORITY_MONTHS', _seniority, 'refs', _refs))
        WHEN _item.source_type = 'payroll_variable' THEN _item.variable_amount
        WHEN _item.calculation_method = 'scale' THEN CASE WHEN _item.scale_mode = 'percent'
          THEN _base_value * public.payroll_scale_value(_item.scale, _base_value) / 100
          ELSE public.payroll_scale_value(_item.scale, _base_value) END
        WHEN _item.calculation_method = 'fixed' AND _item.prorated THEN _rate * _ratio
        WHEN _item.calculation_method = 'fixed' THEN _rate
        ELSE _base_value * _rate / 100 END;
      IF _item.cap IS NOT NULL THEN _amount := LEAST(_amount, _item.cap); END IF;
      _amount := ROUND(GREATEST(COALESCE(_amount, 0), 0), 2);
      _values := _values || jsonb_build_object(_item.code, COALESCE((_values ->> _item.code)::numeric, 0) + _amount);
      _exempt := 0;
      IF _item.kind = 'earning' THEN
        _earned := _earned + _amount;
        IF _item.taxable THEN
          IF _item.tax_exempt_pct IS NOT NULL OR _item.tax_exempt_cap IS NOT NULL THEN
            _exempt := LEAST(_amount, COALESCE(_base * _item.tax_exempt_pct / 100, _amount), COALESCE(_item.tax_exempt_cap, _amount));
          END IF;
          _taxable_gross := _taxable_gross + _amount - _exempt;
        END IF;
        IF _item.subject_employee_social THEN _employee_base := _employee_base + _amount; END IF;
        IF _item.subject_employer_social THEN _employer_base := _employer_base + _amount; END IF;
      ELSIF _item.kind = 'deduction' THEN
        _component_deductions := _component_deductions + _amount;
      ELSE
        _component_charges := _component_charges + _amount;
      END IF;
      INSERT INTO public.payroll_component_lines
        (tenant_id, run_id, employee_id, component_id, code_snapshot, label_snapshot, kind,
         calculation_method, calculation_base, rate_snapshot, amount, source_type, source_id, definition_snapshot)
      VALUES (_tenant, _run_id, _employee.id, _item.component_id, _item.code, _item.label, _item.kind,
        _item.calculation_method,
        CASE WHEN _item.calculation_method IN ('quantity_rate', 'formula') THEN COALESCE(_qty, 0) ELSE _base_value END,
        CASE WHEN _item.calculation_method = 'formula'
               OR (_item.source_type = 'payroll_variable' AND _item.calculation_method NOT IN ('quantity_rate')) THEN NULL
             ELSE _rate END,
        _amount, _item.source_type, _item.source_id,
        jsonb_build_object('definition_amount', _item.definition_amount, 'rate_amount', _rate, 'cap', _item.cap,
          'sort_order', _item.sort_order, 'prorated', _item.prorated, 'presence_ratio', ROUND(_ratio, 6),
          'tax_exempt_amount', _exempt, 'priority', _item.priority, 'base_code', _item.base_code,
          'base_value', _base_value, 'quantity', _qty, 'formula', _item.formula, 'scale', _item.scale,
          'scale_mode', _item.scale_mode,
          'taxable', _item.taxable, 'subject_employee_social', _item.subject_employee_social,
          'subject_employer_social', _item.subject_employer_social, 'printable', _item.printable,
          'gl_account_code', _item.gl_account_code, 'period_start', _period_start, 'period_end', _period_end));
    END LOOP;

    _employee_contrib := 0; _employer_contrib := 0; _tax_deductible := 0;
    FOR _c IN SELECT value FROM jsonb_array_elements(_rules -> 'contributions') LOOP
      _floor := COALESCE(NULLIF(_c ->> 'base_floor', '')::numeric, 0);
      _e_base := GREATEST(LEAST(_employee_base, COALESCE(NULLIF(_c ->> 'employee_ceiling', '')::numeric, _employee_base)) - _floor, 0);
      _r_base := GREATEST(LEAST(_employer_base, COALESCE(NULLIF(_c ->> 'employer_ceiling', '')::numeric, _employer_base)) - _floor, 0);
      _e_amount := public.payroll_round(_e_base * COALESCE((_c ->> 'employee_rate_pct')::numeric, 0) / 100, _unit, _mode);
      _r_amount := public.payroll_round(_r_base * COALESCE((_c ->> 'employer_rate_pct')::numeric, 0) / 100, _unit, _mode);
      IF _e_amount > 0 THEN
        INSERT INTO public.payroll_component_lines (tenant_id, run_id, employee_id, code_snapshot, label_snapshot, kind,
          calculation_method, calculation_base, rate_snapshot, amount, source_type, definition_snapshot)
        VALUES (_tenant, _run_id, _employee.id, _c ->> 'code', (_c ->> 'label') || ' (part salariale)', 'deduction',
          'contribution', _e_base, (_c ->> 'employee_rate_pct')::numeric, _e_amount, 'contribution',
          jsonb_build_object('contribution', _c, 'side', 'employee', 'sort_order', 100000 + COALESCE((_c ->> 'sort_order')::integer, 0),
            'printable', true, 'gl_account_code', _c ->> 'payable_account_code', 'payable_account_code', _c ->> 'payable_account_code',
            'period_start', _period_start, 'period_end', _period_end));
        _employee_contrib := _employee_contrib + _e_amount;
        IF COALESCE((_c ->> 'deductible_from_tax')::boolean, true) THEN _tax_deductible := _tax_deductible + _e_amount; END IF;
      END IF;
      IF _r_amount > 0 THEN
        INSERT INTO public.payroll_component_lines (tenant_id, run_id, employee_id, code_snapshot, label_snapshot, kind,
          calculation_method, calculation_base, rate_snapshot, amount, source_type, definition_snapshot)
        VALUES (_tenant, _run_id, _employee.id, _c ->> 'code', (_c ->> 'label') || ' (part patronale)', 'employer_charge',
          'contribution', _r_base, (_c ->> 'employer_rate_pct')::numeric, _r_amount, 'contribution',
          jsonb_build_object('contribution', _c, 'side', 'employer', 'sort_order', 200000 + COALESCE((_c ->> 'sort_order')::integer, 0),
            'printable', true, 'gl_account_code', _c ->> 'employer_account_code', 'payable_account_code', _c ->> 'payable_account_code',
            'period_start', _period_start, 'period_end', _period_end));
        _employer_contrib := _employer_contrib + _r_amount;
      END IF;
    END LOOP;

    _taxable := GREATEST(_taxable_gross - _tax_deductible, 0);
    SELECT value INTO _e FROM jsonb_array_elements(_rules -> 'tax_abatements') value
     WHERE NULLIF(btrim(value ->> 'category'), '') IS NOT DISTINCT FROM NULLIF(_state ->> 'payroll_category', '')
        OR NULLIF(btrim(value ->> 'category'), '') IS NULL
     ORDER BY (NULLIF(btrim(value ->> 'category'), '') IS NULL) LIMIT 1;
    _abatement := 0;
    IF _e IS NOT NULL THEN
      _abatement := (CASE WHEN _e ->> 'basis' = 'taxable_gross' THEN _taxable_gross ELSE _base END)
        * (_e ->> 'rate_pct')::numeric / 100;
      IF NULLIF(_e ->> 'min_amount', '') IS NOT NULL THEN _abatement := GREATEST(_abatement, (_e ->> 'min_amount')::numeric); END IF;
      IF NULLIF(_e ->> 'max_amount', '') IS NOT NULL THEN _abatement := LEAST(_abatement, (_e ->> 'max_amount')::numeric); END IF;
      _abatement := ROUND(LEAST(_abatement, _taxable), 2);
    END IF;
    _net_taxable := _taxable - _abatement;
    IF NULLIF(_rules ->> 'taxable_rounding_unit', '') IS NOT NULL THEN
      _net_taxable := public.payroll_round(_net_taxable, (_rules ->> 'taxable_rounding_unit')::numeric, 'down');
    END IF;
    _tax_before := public.compute_progressive_payroll_tax(_net_taxable, _rules -> 'income_tax_bands');
    _reduction := NULL;
    SELECT (value ->> 'reduction_pct')::numeric INTO _reduction FROM jsonb_array_elements(_rules -> 'family_reductions') value
     WHERE (value ->> 'dependents')::integer <= _dependents ORDER BY (value ->> 'dependents')::integer DESC LIMIT 1;
    _taxes := public.payroll_round(_tax_before * (1 - COALESCE(_reduction, 0) / 100), _unit, _mode);

    INSERT INTO public.payroll_component_lines
      (tenant_id, run_id, employee_id, code_snapshot, label_snapshot, kind, calculation_method,
       calculation_base, amount, source_type, definition_snapshot)
    VALUES (_tenant, _run_id, _employee.id, 'BASE_SALARY', 'Salaire de base', 'earning', 'fixed',
      _base, _base, 'base_salary', jsonb_build_object('employee_state', _state, 'as_of', _period_end,
        'presence', jsonb_build_object('method', _rules ->> 'proration_method', 'days_present', _days_present,
          'days_total', _days_total, 'ratio', ROUND(_ratio, 6), 'segments', _segments),
        'seniority_months', _seniority,
        'tax', jsonb_build_object('taxable_gross', _taxable_gross, 'deductible_contributions', _tax_deductible,
          'abatement', _abatement, 'abatement_rule', _e, 'net_taxable', _net_taxable, 'tax_before_reduction', _tax_before,
          'dependents', _dependents, 'reduction_pct', COALESCE(_reduction, 0), 'tax', _taxes),
        'rule_version_id', _rules -> 'version_id'));

    _gross := ROUND(_base + _earned, 2);
    _net := ROUND(_gross - _employee_contrib - _component_deductions - _taxes, 2);
    INSERT INTO public.payroll_lines
      (tenant_id, run_id, employee_id, gross, deductions, taxes, net, employer_charges, department_snapshot)
    VALUES (_tenant, _run_id, _employee.id, _gross, ROUND(_employee_contrib + _component_deductions, 2), _taxes,
        _net, ROUND(_employer_contrib + _component_charges, 2), COALESCE(_state->>'department', ''));
    _count := _count + 1;
  END LOOP;
  UPDATE public.payroll_runs
     SET gross_total = COALESCE((SELECT SUM(gross) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         net_total = COALESCE((SELECT SUM(net) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         deductions_total = COALESCE((SELECT SUM(deductions) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         taxes_total = COALESCE((SELECT SUM(taxes) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         employer_charges_total = COALESCE((SELECT SUM(employer_charges) FROM public.payroll_lines WHERE run_id = _run_id), 0),
         employee_count = _count, payroll_country_code = _rules ->> 'country_code',
         payroll_currency_code = _rules ->> 'currency_code',
         payroll_rules_snapshot = _rules || jsonb_build_object(
           'rules_effective_from', _rules -> 'effective_from', 'rules_reference', _rules -> 'reference',
           'rules_validated_at', _rules -> 'validated_at', 'rules_validated_by', _rules -> 'validated_by',
           'bases', COALESCE((SELECT jsonb_agg(to_jsonb(b) - 'tenant_id') FROM public.payroll_bases b
             WHERE b.tenant_id = _tenant AND b.active), '[]'::jsonb),
           'components_snapshot', true)
   WHERE id = _run_id;
  INSERT INTO public.payroll_run_audit (tenant_id, run_id, event_type, from_status, to_status, performed_by, details)
  VALUES (_tenant, _run_id, 'lines_generated', _run.status, _run.status, auth.uid(),
    jsonb_build_object('line_count', _count, 'country', _rules ->> 'country_code',
      'currency', _rules ->> 'currency_code', 'employment_state_as_of', _period_end,
      'rules_source', _rules ->> 'source', 'rule_version_id', _rules -> 'version_id',
      'proration_method', _rules ->> 'proration_method',
      'component_line_count', (SELECT count(*) FROM public.payroll_component_lines WHERE run_id = _run_id)));
  RETURN _count;
END
$function$;

SELECT public.install_tenant_isolation_triggers();
