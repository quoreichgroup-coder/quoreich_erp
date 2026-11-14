-- V69 — Correspondances : import d'un modèle rempli (Excel ou CSV), tout ou rien.
--
-- Le modèle téléchargé liste chaque compte du plan opérationnel (une ligne par cible existante, une
-- ligne vide pour un compte non couvert) avec des colonnes séparées : Compte source, Intitulé source,
-- Type source, Compte cible, Intitulé cible, Clé (%), Commentaire. L'utilisateur complète Compte cible
-- (et Clé pour une répartition), puis réimporte : `import_chart_mapping_lines(mapping, lignes)`
-- remplace les lignes des comptes cités, qui redeviennent des propositions (V66 : jamais validées
-- d'office, décision par une autre personne). Refus global, avec la liste des lignes en cause, si un
-- compte source ou cible est inconnu, une clé invalide ou une répartition différente de 100 %.
-- Lignes sans compte cible : ignorées (compte laissé tel quel).

CREATE OR REPLACE FUNCTION public.import_chart_mapping_lines(_mapping uuid, _rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _m public.chart_mappings%ROWTYPE := public.mapping_for(_mapping, 'accounting.mapping');
  _errors text[] := '{}'; _r record; _t record; _src record; _sources int := 0; _lines int := 0;
BEGIN
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 THEN RAISE EXCEPTION 'Fichier vide' USING ERRCODE = 'QG021'; END IF;
  IF jsonb_array_length(_rows) > 20000 THEN RAISE EXCEPTION 'Fichier trop volumineux (20 000 lignes au plus)' USING ERRCODE = 'QG021'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.import_correspondance (
    line_no int, source_code text, source_id uuid, target_code text, ratio numeric, comment text) ON COMMIT DROP;
  TRUNCATE pg_temp.import_correspondance;
  INSERT INTO pg_temp.import_correspondance (line_no, source_code, target_code, ratio, comment)
  SELECT COALESCE((x.v ->> 'line')::int, x.n::int), NULLIF(regexp_replace(COALESCE(x.v ->> 'source', ''), '\s', '', 'g'), ''),
         NULLIF(regexp_replace(COALESCE(x.v ->> 'target', ''), '\s', '', 'g'), ''),
         CASE WHEN COALESCE(btrim(x.v ->> 'ratio'), '') = '' THEN NULL
              WHEN replace(replace(btrim(x.v ->> 'ratio'), '%', ''), ',', '.') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
              THEN replace(replace(btrim(x.v ->> 'ratio'), '%', ''), ',', '.')::numeric ELSE -1 END,
         NULLIF(btrim(x.v ->> 'comment'), '')
    FROM jsonb_array_elements(_rows) WITH ORDINALITY AS x(v, n)
   WHERE NULLIF(btrim(COALESCE(x.v ->> 'target', '')), '') IS NOT NULL;

  UPDATE pg_temp.import_correspondance i SET source_id = g.id
    FROM public.gl_accounts g WHERE g.tenant_id = _m.tenant_id AND g.code = i.source_code;

  FOR _r IN SELECT * FROM pg_temp.import_correspondance ORDER BY line_no LOOP
    IF _r.source_code IS NULL THEN _errors := array_append(_errors, 'ligne ' || _r.line_no || ' : compte source manquant');
    ELSIF _r.source_id IS NULL THEN _errors := array_append(_errors, 'ligne ' || _r.line_no || ' : compte source ' || _r.source_code || ' absent du plan');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.mapping_target(_m, _r.target_code)) THEN
      _errors := array_append(_errors, 'ligne ' || _r.line_no || ' : compte cible ' || _r.target_code || ' absent du plan cible');
    END IF;
    IF _r.ratio IS NOT NULL AND (_r.ratio <= 0 OR _r.ratio > 100) THEN
      _errors := array_append(_errors, 'ligne ' || _r.line_no || ' : clé invalide (entre 0 et 100 %)');
    END IF;
  END LOOP;
  -- Clé absente : 100 % si la cible est seule pour ce compte.
  UPDATE pg_temp.import_correspondance i SET ratio = 100
   WHERE i.ratio IS NULL AND (SELECT count(*) FROM pg_temp.import_correspondance o WHERE o.source_code = i.source_code) = 1;
  FOR _src IN SELECT source_code, sum(ratio) AS total, bool_or(ratio IS NULL) AS sans_cle, count(DISTINCT target_code) AS cibles, count(*) AS n
                FROM pg_temp.import_correspondance WHERE source_id IS NOT NULL GROUP BY source_code ORDER BY source_code LOOP
    IF _src.sans_cle THEN _errors := array_append(_errors, 'compte ' || _src.source_code || ' : clé obligatoire pour une répartition sur plusieurs cibles');
    ELSIF _src.total <> 100 THEN _errors := array_append(_errors, 'compte ' || _src.source_code || ' : répartition de ' || _src.total || ' % (100 % attendus)');
    END IF;
    IF _src.cibles < _src.n THEN _errors := array_append(_errors, 'compte ' || _src.source_code || ' : même cible répétée'); END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.import_correspondance) THEN
    RAISE EXCEPTION 'Aucune ligne avec un compte cible : compléter la colonne « Compte cible »' USING ERRCODE = 'QG021';
  END IF;
  IF cardinality(_errors) > 0 THEN
    RAISE EXCEPTION 'Import refusé, rien n''a été modifié (% anomalie(s)) : %', cardinality(_errors),
      array_to_string(_errors[1:15], ' ; ') || CASE WHEN cardinality(_errors) > 15 THEN ' ; …' ELSE '' END USING ERRCODE = 'QG021';
  END IF;

  DELETE FROM public.chart_mapping_lines l WHERE l.mapping_id = _mapping
     AND l.source_account_id IN (SELECT DISTINCT source_id FROM pg_temp.import_correspondance);
  FOR _r IN SELECT * FROM pg_temp.import_correspondance ORDER BY source_code, line_no LOOP
    SELECT y.* INTO _t FROM public.mapping_target(_m, _r.target_code) y;
    INSERT INTO public.chart_mapping_lines (mapping_id, tenant_id, source_account_id, target_code, target_name, target_type, ratio, method, proposed_by, comment)
    VALUES (_mapping, _m.tenant_id, _r.source_id, _t.code, _t.name, _t.account_type, _r.ratio, 'manual', auth.uid(), _r.comment);
    _lines := _lines + 1;
  END LOOP;
  SELECT count(DISTINCT source_id) INTO _sources FROM pg_temp.import_correspondance;
  RETURN jsonb_build_object('comptes', _sources, 'lignes', _lines);
END $function$;
REVOKE ALL ON FUNCTION public.import_chart_mapping_lines(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_chart_mapping_lines(uuid, jsonb) TO authenticated;
