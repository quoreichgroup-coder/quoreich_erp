#!/usr/bin/env bash
# Reprise des comptes du nuage dans l'identité sur site (V114) : même identifiant, même empreinte bcrypt, donc
# chaque utilisateur garde son mot de passe. Les empreintes passent d'une base à l'autre par un tube : elles ne
# sont jamais écrites sur disque ni affichées.
#
# SIMULATION PAR DÉFAUT (transaction annulée, comptes comptés). Pour enregistrer : APPLIQUER=oui.
#
#   SOURCE_DB_URL=<base Supabase> CIBLE_DB_URL=<base sur site, rôle propriétaire> \
#   [FILTRE='%@quoreich-e2e.invalid'] [APPLIQUER=oui] bash scripts/identite/reprendre-comptes.sh
#
# - SOURCE_DB_URL : Supabase, pooler de transactions (port 6543, sslmode=require) ; lecture de auth.users.
# - CIBLE_DB_URL : PostgreSQL sur site avec un rôle propriétaire (auth.users et qerp_identity sont fermés à
#   qerp_api), par exemple postgresql://postgres:…@localhost:54433/qerp_reel. Le schéma doit être en V114.
# - FILTRE : motif ILIKE sur l'adresse (défaut : tous les comptes).
# Règles : voir reprendre-comptes.sql.
set -euo pipefail

: "${SOURCE_DB_URL:?SOURCE_DB_URL requis (base Supabase)}"
: "${CIBLE_DB_URL:?CIBLE_DB_URL requis (base sur site, rôle propriétaire)}"
FILTRE="${FILTRE:-%}"
APPLIQUER="${APPLIQUER:-non}"
export PGCLIENTENCODING=UTF8
ICI="$(cd "$(dirname "$0")" && pwd)"

echo -n "Comptes du nuage sans empreinte bcrypt (non repris) : "
psql "$SOURCE_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -v filtre="$FILTRE" <<'SQL'
SELECT count(*) FROM auth.users WHERE email ILIKE :'filtre' AND (encrypted_password IS NULL OR encrypted_password !~ '^[$]2[aby][$]');
SQL

psql "$SOURCE_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -v filtre="$FILTRE" -f "$ICI/extraire-comptes.sql" \
  | psql "$CIBLE_DB_URL" -X -q -v ON_ERROR_STOP=1 -v appliquer="$APPLIQUER" -f "$ICI/reprendre-comptes.sql"
