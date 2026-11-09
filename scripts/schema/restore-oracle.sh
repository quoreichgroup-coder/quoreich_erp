#!/usr/bin/env bash
# Reconstruit la base oracle dans un conteneur PostgreSQL 18.6 jetable.
#
# L'oracle sert à deux choses :
#   1. régénérer les migrations `public` (extract-from-dump.sh) ;
#   2. produire le manifeste de parité de référence.
#
# Usage :
#   bash scripts/schema/restore-oracle.sh <chemin-du-dump> [port]
#
# Le dump n'est JAMAIS versionné : il contient des données de production.

set -euo pipefail

DUMP="${1:?usage: restore-oracle.sh <dump> [port]}"
PORT="${2:-55432}"
NAME="qerp-ref"
DB="qerp_oracle"

[ -f "$DUMP" ] || { echo "dump introuvable : $DUMP" >&2; exit 1; }

echo "== conteneur $NAME (postgres:18.6-alpine) sur le port $PORT =="
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" \
  -e POSTGRES_PASSWORD=ref \
  -e POSTGRES_INITDB_ARGS="--locale=C.UTF-8 --encoding=UTF8" \
  -p "${PORT}:5432" postgres:18.6-alpine >/dev/null

# pg_isready répond avant que la base accepte les connexions (phase « starting up ») :
# on attend qu'une requête aboutisse réellement.
for _ in $(seq 1 90); do
  docker exec "$NAME" psql -U postgres -tAc 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$NAME" psql -U postgres -tAc 'SELECT 1' >/dev/null 2>&1 \
  || { echo "le conteneur $NAME n'accepte pas les connexions" >&2; exit 1; }

export PGPASSWORD=ref
PSQL=(psql -h localhost -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

echo "== rôle de base =="
"${PSQL[@]}" -d postgres -f "$(dirname "$0")/prelude-roles.sql"

echo "== restauration du schéma public =="
# `--no-owner --no-privileges` : les propriétaires et ACL du dump ciblent des rôles
# Supabase inexistants (sandbox_exec, supabase_admin, ...). Les droits sont
# réécrits délibérément dans V15__privileges.sql.
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;"
pg_restore -h localhost -p "$PORT" -U postgres -d "$DB" \
  --no-owner --no-privileges --no-comments "$DUMP" 2> /tmp/qerp-oracle-restore.err || true

# Seules les extensions propres à Supabase (pg_cron, pg_net, supabase_vault) et
# leurs objets dépendants échouent. Toute autre erreur doit faire échouer le script.
if grep -qiE 'erreur|error' /tmp/qerp-oracle-restore.err; then
  if grep -viE 'cron|net|vault|erreurs ignor|errors ignored' /tmp/qerp-oracle-restore.err \
     | grep -qiE 'erreur|error'; then
    echo "ERREUR de restauration hors extensions Supabase :" >&2
    cat /tmp/qerp-oracle-restore.err >&2
    exit 1
  fi
  echo "   (erreurs attendues, limitées aux extensions Supabase : $(grep -ci erreur /tmp/qerp-oracle-restore.err))"
fi

echo "== inventaire =="
"${PSQL[@]}" -d "$DB" -t -A -F' | ' <<'SQL'
SELECT 'tables', count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
UNION ALL SELECT 'views', count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m')
UNION ALL SELECT 'functions', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
UNION ALL SELECT 'triggers', count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
UNION ALL SELECT 'policies', count(*) FROM pg_policies WHERE schemaname='public';
SQL

echo "OK — oracle disponible : postgresql://postgres:ref@localhost:$PORT/$DB"