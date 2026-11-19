-- Écriture des comptes repris (CSV sur l'entrée standard, produit par extraire-comptes.sql) dans l'identité sur
-- site (V114). Simulation par défaut ; -v appliquer=oui pour enregistrer. Rôle propriétaire requis.
--
-- Règles : un compte déjà présent avec le même identifiant reçoit l'adresse et l'empreinte du nuage (verrou levé) ;
-- une adresse déjà prise sur site par un AUTRE identifiant est signalée et non reprise (jamais fusionnée) ; le
-- profil manquant est créé sans société (la société d'un profil existant n'est pas touchée).
\set ON_ERROR_STOP on
\if :{?appliquer}
\else
  \set appliquer non
\endif
SELECT :'appliquer' = 'oui' AS enregistrer \gset

BEGIN;
CREATE TEMP TABLE reprise (id uuid, email text, password_hash text, email_confirmed_at timestamptz, full_name text, created_at timestamptz)
  ON COMMIT DROP;
\copy reprise FROM pstdin WITH (FORMAT csv)

SELECT count(*) AS comptes_lus_dans_le_nuage FROM reprise;
SELECT r.email AS adresse_deja_prise_par_un_autre_compte
  FROM reprise r JOIN qerp_identity.accounts a ON a.email = r.email AND a.user_id <> r.id;
DELETE FROM reprise r USING qerp_identity.accounts a WHERE a.email = r.email AND a.user_id <> r.id;

INSERT INTO auth.users (id) SELECT id FROM reprise ON CONFLICT (id) DO NOTHING;
WITH m AS (
  INSERT INTO qerp_identity.accounts (user_id, email, password_hash, email_confirmed_at, created_at)
  SELECT id, email, password_hash, COALESCE(email_confirmed_at, now()), COALESCE(created_at, now()) FROM reprise
  ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
    email_confirmed_at = COALESCE(qerp_identity.accounts.email_confirmed_at, EXCLUDED.email_confirmed_at),
    failed_attempts = 0, locked_until = NULL, password_changed_at = now()
  RETURNING (xmax = 0) AS cree
)
SELECT count(*) FILTER (WHERE cree) AS comptes_crees, count(*) FILTER (WHERE NOT cree) AS comptes_mis_a_jour FROM m;
INSERT INTO public.profiles (id, full_name) SELECT id, full_name FROM reprise ON CONFLICT (id) DO NOTHING;
INSERT INTO qerp_identity.events (user_id, email, event, detail) SELECT id, email, 'password_changed', 'reprise du nuage' FROM reprise;

\if :enregistrer
COMMIT;
\echo 'ENREGISTRÉ.'
\else
ROLLBACK;
\echo 'SIMULATION : rien n''est enregistré (APPLIQUER=oui pour enregistrer).'
\endif
