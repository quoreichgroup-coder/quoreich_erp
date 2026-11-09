#!/usr/bin/env bash
# Régénère les migrations Flyway V3..V14 du schéma `public` à partir de la base oracle.
#
# Prérequis : la base oracle contient le schéma `public` restauré depuis le dump
#             (voir scripts/schema/restore-oracle.sh), et les binaires pg_dump /
#             pg_restore sont dans le PATH.
#
# Usage :
#   PGHOST=localhost PGPORT=55432 PGUSER=postgres PGPASSWORD=ref PGDATABASE=postgres \
#     bash scripts/schema/extract-from-dump.sh [dossier-de-sortie]
#
# Principe : on ne restaure JAMAIS la sortie brute. On découpe la sortie de pg_dump
# par classes d'objets via la liste TOC (pg_restore -L), ce qui garantit l'ordre de
# dépendance et exclut par construction les extensions, publications, ACL et
# propriétaires qui n'existent pas hors Supabase.

set -euo pipefail

OUT="${1:-services/api/src/main/resources/db/migration}"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

command -v pg_dump >/dev/null || { echo "pg_dump introuvable" >&2; exit 1; }
[ -n "${PGDATABASE:-}" ] || { echo "PGDATABASE non défini" >&2; exit 1; }

mkdir -p "$OUT"

echo "== 1/3  extraction du schéma public =="
pg_dump -Fc --schema=public --schema-only --no-owner --no-privileges \
        -f "$BUILD/public_schema.dump"

echo "== 2/3  découpage par classes d'objets =="
pg_restore -l "$BUILD/public_schema.dump" > "$BUILD/toc"

# On retire l'en-tête de commentaires, la création du schéma public et le COMMENT
# sur le schéma : `public` existe déjà dans toute base PostgreSQL.
grep -vE '^;|^$' "$BUILD/toc" | grep -vE ' SCHEMA | COMMENT ' > "$BUILD/base.toc"

split_class() {  # $1 = nom de fichier, $2 = motif TOC, $3 = filtre d'exclusion optionnel
  if [ -n "${3:-}" ]; then
    grep -E " $2 " "$BUILD/base.toc" | grep -vE "$3" > "$BUILD/l_$1.toc"
  else
    grep -E " $2 " "$BUILD/base.toc" > "$BUILD/l_$1.toc"
  fi
}

split_class types       'TYPE'
split_class sequences   'SEQUENCE'
split_class tables      'TABLE'
split_class constraints 'CONSTRAINT' 'FK CONSTRAINT'
split_class indexes     'INDEX'
split_class functions   'FUNCTION'
split_class views       'VIEW'
split_class rules       'RULE'
split_class rls         'ROW SECURITY'
split_class policies    'POLICY'
split_class triggers    'TRIGGER'
split_class fks         'FK CONSTRAINT'

# Contrôle de complétude : chaque entrée TOC doit être couverte exactement une fois.
total=$(cat "$BUILD"/l_*.toc | wc -l)
attendu=$(wc -l < "$BUILD/base.toc")
if [ "$total" -ne "$attendu" ]; then
  echo "DÉCOUPAGE INCOMPLET : $total entrées couvertes pour $attendu attendues" >&2
  exit 1
fi

echo "== 3/3  génération des migrations =="
i=3
for name in types sequences tables constraints indexes functions views rules rls policies triggers fks; do
  f=$(printf '%s/V%d__public_%s.sql' "$OUT" "$i" "$name")
  pg_restore -L "$BUILD/l_$name.toc" --no-owner --no-privileges \
             -f "$f" "$BUILD/public_schema.dump"

  # Nettoyage indispensable pour Flyway (JDBC ne comprend pas les méta-commandes psql)
  # et pour la portabilité (aucun propriétaire).
  sed -i \
    -e '/^\\restrict /d' \
    -e '/^\\unrestrict /d' \
    -e "/^SELECT pg_catalog\.set_config('search_path', '', false);/d" \
    -e '/^-- PostgreSQL database dump complete$/d' \
    -e '/^ALTER .* OWNER TO .*;$/d' \
    "$f"

  if grep -qE '^\\|OWNER TO|supabase|GRANT |REVOKE ' "$f"; then
    echo "RÉSIDU non nettoyé dans $f :" >&2
    grep -nE '^\\|OWNER TO|supabase|GRANT |REVOKE ' "$f" | head -5 >&2
    exit 1
  fi

  printf '  %-34s %6s lignes\n' "$(basename "$f")" "$(wc -l < "$f")"
  i=$((i + 1))
done

echo "OK — $(ls "$OUT"/V*__public_*.sql | wc -l) migrations public régénérées dans $OUT"