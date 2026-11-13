-- Suppression d'une société et de toutes ses données. IRRÉVERSIBLE une fois enregistrée.
--
-- SIMULATION PAR DÉFAUT (transaction annulée). Pour enregistrer, donner l'identifiant ET le nom
-- exact de la société, plus appliquer=oui :
--
--   psql "$URL" -v societe=<uuid> -v nom='<nom exact>' -v appliquer=oui -f scripts/data/supprimer-societe.sql
--
-- Les tables qui référencent la société SANS suppression en cascade sont vidées de ses lignes
-- d'abord (liste lue dans le catalogue, donc à jour) ; les autres suivent par cascade ; les profils
-- rattachés repassent « sans société » (ON DELETE SET NULL) : leurs comptes existent toujours et
-- arrivent sur l'écran d'accueil à la connexion suivante. Les déclencheurs métier restent actifs :
-- une écriture comptabilisée, par exemple, bloque la suppression (il faut alors décider autrement).
\set ON_ERROR_STOP on
\if :{?appliquer}
\else
  \set appliquer non
\endif

BEGIN;
SELECT set_config('qerp.societe', :'societe', true) IS NOT NULL AND set_config('qerp.nom', :'nom', true) IS NOT NULL AS parametres_lus;

DO $$
DECLARE
  _id uuid := current_setting('qerp.societe')::uuid;
  _nom text;
  _r record;
  _n bigint;
BEGIN
  SELECT name INTO _nom FROM public.tenants WHERE id = _id;
  IF _nom IS NULL THEN RAISE EXCEPTION 'Société % introuvable', _id; END IF;
  IF _nom IS DISTINCT FROM current_setting('qerp.nom') THEN
    RAISE EXCEPTION 'Le nom donné (%) ne correspond pas à la société % (%) : rien n''est fait', current_setting('qerp.nom'), _id, _nom;
  END IF;
  FOR _r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.confrelid = 'public.tenants'::regclass AND c.contype = 'f' AND c.confdeltype IN ('a', 'r')
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I = $1', _r.tbl, _r.col) USING _id;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n > 0 THEN RAISE NOTICE '% : % ligne(s)', _r.tbl, _n; END IF;
  END LOOP;
  DELETE FROM public.tenants WHERE id = _id;
  RAISE NOTICE 'Société « % » (%) supprimée', _nom, _id;
END $$;

SELECT (:'appliquer' = 'oui') AS enregistrer \gset
SELECT CASE WHEN :'appliquer' = 'oui' THEN 'ENREGISTRÉ' ELSE 'SIMULATION : rien n''est supprimé (-v appliquer=oui pour enregistrer)' END AS mode;
\if :enregistrer
COMMIT;
\else
ROLLBACK;
\endif
