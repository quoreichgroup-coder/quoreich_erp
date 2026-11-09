#!/usr/bin/env bash
# Vérifie le critère de sortie du lot 0, de bout en bout :
#
#   1. restaure le dump dans un PostgreSQL 18.6 jetable (oracle) ;
#   2. régénère les migrations `public` et compare le résultat à l'existant
#      (aucune dérive silencieuse entre le dump et les fichiers versionnés) ;
#   3. rejoue toutes les migrations sur une base VIDE ;
#   4. compare objet par objet au manifeste de référence ;
#   5. exécute la recette négative d'isolation.
#
# Usage :
#   bash scripts/schema/verify-lot0.sh <chemin-du-dump>
#
# Sortie : code 0 si et seulement si les cinq étapes passent.

set -euo pipefail

DUMP="${1:?usage: verify-lot0.sh <chemin-du-dump>}"
PORT="${PORT:-55432}"
MIGRATIONS="services/api/src/main/resources/db/migration"
MANIFESTE="services/api/src/test/resources/schema-manifest/public.manifest.tsv"
FIXTURES="services/api/src/test/resources/fixtures"
export PGPASSWORD=ref
PSQL=(psql -h localhost -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

fail() { echo; echo "ÉCHEC : $*" >&2; exit 1; }

echo "== 1/5  oracle =="
bash scripts/schema/restore-oracle.sh "$DUMP" "$PORT"

echo
echo "== 2/5  régénération des migrations et contrôle de dérive =="
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PGHOST=localhost PGPORT="$PORT" PGUSER=postgres PGDATABASE=qerp_oracle \
  bash scripts/schema/extract-from-dump.sh "$TMP" >/dev/null
derive=0
for f in "$TMP"/V*__public_*.sql; do
  cible="$MIGRATIONS/$(basename "$f")"
  if ! cmp -s "$f" "$cible"; then
    echo "   dérive sur $(basename "$f") :" >&2
    diff -u "$cible" "$f" | head -15 >&2 || true
    derive=1
  fi
done
[ "$derive" -eq 0 ] || fail "les migrations versionnées ne correspondent plus au dump"
echo "   les migrations versionnées sont identiques à la régénération"

echo
echo "== 3/5  reconstruction depuis une base vide =="
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS qerp_rebuild;" -c "CREATE DATABASE qerp_rebuild;"
for v in $(seq 1 15); do
  f=$(ls "$MIGRATIONS"/V${v}__*.sql)
  "${PSQL[@]}" -d qerp_rebuild -f "$f" >/dev/null
done
echo "   15 migrations appliquées"

echo
echo "== 4/5  parité objet par objet =="
"${PSQL[@]}" -d qerp_oracle  -f scripts/schema/schema-manifest.sql > "$TMP/oracle.tsv"
"${PSQL[@]}" -d qerp_rebuild -f scripts/schema/schema-manifest.sql > "$TMP/rebuild.tsv"
if diff -q "$TMP/oracle.tsv" "$TMP/rebuild.tsv" >/dev/null; then
  echo "   IDENTIQUE — $(wc -l < "$TMP/rebuild.tsv") lignes de manifeste, zéro écart"
else
  echo "   ÉCARTS :" >&2
  diff -u "$TMP/oracle.tsv" "$TMP/rebuild.tsv" | head -40 >&2
  fail "le schéma reconstruit diffère du dump"
fi
if cmp -s "$TMP/oracle.tsv" "$MANIFESTE"; then
  echo "   le manifeste versionné est à jour"
else
  fail "le manifeste versionné ($MANIFESTE) n'est plus à jour"
fi

echo
echo "== 5/5  recette négative d'isolation =="
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS qerp_test;" -c "CREATE DATABASE qerp_test;"
for v in $(seq 1 15); do
  "${PSQL[@]}" -d qerp_test -f "$(ls "$MIGRATIONS"/V${v}__*.sql)" >/dev/null
done
"${PSQL[@]}" -d qerp_test -f "$FIXTURES/reference-dataset.sql" >/dev/null
"${PSQL[@]}" -d qerp_test -f "$FIXTURES/rls-isolation-test.sql" 2>&1 \
  | grep -E '^NOTICE:  OK|RECETTE' || fail "la recette d'isolation a échoué"

echo
echo "LOT 0 : CRITÈRE DE SORTIE ATTEINT"