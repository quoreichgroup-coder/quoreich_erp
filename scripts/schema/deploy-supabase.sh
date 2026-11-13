#!/usr/bin/env bash
# Déploie sur Supabase (nuage) les migrations postérieures à la base de référence, pour que la
# base Supabase reste identique à la base PostgreSQL sur site (Flyway).
#
#   SUPABASE_DB_URL=postgresql://… scripts/schema/deploy-supabase.sh            applique ce qui manque
#   SUPABASE_DB_URL=…               scripts/schema/deploy-supabase.sh --dry-run  liste ce qui manque
#   scripts/schema/deploy-supabase.sh --print-bundle > rattrapage.sql            script unique à coller
#                                                                                dans Supabase → SQL Editor
#
# Règles :
#   - le contrôle des jumelles (check-migration-twins.mjs) passe d'abord : on ne déploie jamais
#     une migration qui n'existe pas aussi sur site ;
#   - registre qerp_deploy.applied_migrations (nom du fichier, empreinte SHA-256 du SQL
#     exécutable, date, mode) ; chaque migration s'applique dans SA transaction, avec son
#     inscription au registre — tout ou rien ;
#   - une migration déjà déployée dont le SQL a changé est refusée : on n'édite jamais une
#     migration appliquée, on en écrit une nouvelle ;
#   - les fichiers antérieurs au 12 novembre 2026 sont la base de référence (dump de
#     production) et ne sont jamais rejoués.
#
# SUPABASE_DB_URL : chaîne de connexion directe (port 5432) ou pooler en mode session, avec un
# rôle propriétaire du schéma public (postgres). Elle ne doit jamais être écrite dans le dépôt :
# en CI, c'est le secret SUPABASE_DB_URL de l'environnement GitHub « supabase-production ».
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/supabase/migrations"
CUTOFF="20261112000000"
MODE="apply"
case "${1:-}" in
  --dry-run) MODE="dry-run" ;;
  --print-bundle) MODE="bundle" ;;
  "") ;;
  *) echo "Option inconnue : $1" >&2; exit 2 ;;
esac

node "$ROOT/scripts/schema/check-migration-twins.mjs" >&2

# Fichiers postérieurs à la base de référence, dans l'ordre d'horodatage.
mapfile -t FILES < <(cd "$DIR" && ls -1 ./*.sql | sed 's#^\./##' | sort | awk -v c="$CUTOFF" 'substr($0,1,14) >= c')

# Empreinte du SQL exécutable (mêmes règles que le contrôle des jumelles).
fingerprint() {
  sed 's/\r$//; s/[[:space:]]*$//' "$1" | grep -v '^[[:space:]]*--' | grep -v '^$' | sha256sum | cut -d' ' -f1
}

LEDGER_DDL="CREATE SCHEMA IF NOT EXISTS qerp_deploy;
CREATE TABLE IF NOT EXISTS qerp_deploy.applied_migrations (
  filename text PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user,
  mode text NOT NULL DEFAULT 'applied' CHECK (mode IN ('applied', 'bundle'))
);
REVOKE ALL ON SCHEMA qerp_deploy FROM PUBLIC;"

if [[ "$MODE" == "bundle" ]]; then
  echo "-- QUOREICH — rattrapage des migrations sur Supabase, en une seule transaction."
  echo "-- À coller dans Supabase → SQL Editor. Tout ou rien : en cas d'erreur, rien n'est appliqué."
  echo "-- Les migrations déjà inscrites au registre qerp_deploy.applied_migrations sont sautées."
  echo "-- Produit par scripts/schema/deploy-supabase.sh --print-bundle ($(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?'))."
  echo "BEGIN;"
  echo "SET LOCAL search_path TO public, extensions;"
  echo "$LEDGER_DDL"
  for f in "${FILES[@]}"; do
    sha="$(fingerprint "$DIR/$f")"
    echo
    echo "-- ════════════════ $f ════════════════"
    # Le SQL d'une migration ne se conditionne pas : ce paquet sert au rattrapage d'une base où
    # aucune de ces migrations n'est passée. Si l'une est déjà au registre, tout s'arrête (rien
    # n'est appliqué) et le script, qui saute les migrations appliquées, prend le relais.
    echo "DO \$qerp_guard\$ BEGIN IF EXISTS (SELECT 1 FROM qerp_deploy.applied_migrations WHERE filename = '$f') THEN"
    echo "  RAISE EXCEPTION 'Migration % déjà au registre : lancez scripts/schema/deploy-supabase.sh, qui saute les migrations appliquées', '$f';"
    echo "END IF; END \$qerp_guard\$;"
    cat "$DIR/$f"
    echo
    echo "INSERT INTO qerp_deploy.applied_migrations (filename, sha256, mode) VALUES ('$f', '$sha', 'bundle');"
  done
  echo
  echo "SELECT count(*) AS migrations_au_registre FROM qerp_deploy.applied_migrations;"
  echo "COMMIT;"
  exit 0
fi

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL manquant : la base Supabase ne peut pas être mise à jour (voir en tête du script).}"
PSQL=(psql "$SUPABASE_DB_URL" -X -q -At -v ON_ERROR_STOP=1)

"${PSQL[@]}" -c "$LEDGER_DDL" >/dev/null

applied=0; pending=0
for f in "${FILES[@]}"; do
  sha="$(fingerprint "$DIR/$f")"
  known="$("${PSQL[@]}" -c "SELECT sha256 FROM qerp_deploy.applied_migrations WHERE filename = '$f'")"
  if [[ -n "$known" ]]; then
    if [[ "$known" != "$sha" ]]; then
      echo "ERREUR : $f a déjà été déployée avec un autre contenu. Une migration appliquée ne se modifie pas : écrire une nouvelle migration." >&2
      exit 1
    fi
    continue
  fi
  pending=$((pending + 1))
  if [[ "$MODE" == "dry-run" ]]; then
    echo "à appliquer : $f"
    continue
  fi
  echo "application : $f"
  # search_path fixé dans la transaction, comme Flyway en local : une connexion du pooler peut
  # hériter d'un search_path vide laissé par un script précédent (pg_dump commence par
  # set_config('search_path', '', false)), et un type non qualifié serait alors introuvable.
  { echo "SET LOCAL search_path TO public, extensions;"; cat "$DIR/$f"; echo
    echo "INSERT INTO qerp_deploy.applied_migrations (filename, sha256) VALUES ('$f', '$sha');"; } \
    | "${PSQL[@]}" --single-transaction -f - >/dev/null
  applied=$((applied + 1))
done

if [[ "$MODE" == "dry-run" ]]; then
  echo "$pending migration(s) en attente sur Supabase."
else
  # Réglages propres à Supabase (publication temps réel), rejouables sans effet.
  "${PSQL[@]}" --single-transaction -f "$ROOT/scripts/schema/supabase-platform.sql" >/dev/null
  echo "Supabase à jour : $applied migration(s) appliquée(s), ${#FILES[@]} au total depuis la base de référence."
fi
