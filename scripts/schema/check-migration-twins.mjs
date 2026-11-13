#!/usr/bin/env node
/**
 * Les deux bases — PostgreSQL sur site (Flyway, services/api/.../db/migration) et Supabase en
 * nuage (supabase/migrations) — doivent rester identiques en permanence. Ce contrôle, joué par
 * la CI, échoue dès qu'elles peuvent diverger :
 *
 *   1. chaque migration Flyway postérieure à la base de référence (V16 et suivantes) a une
 *      jumelle Supabase au SQL identique — seules les lignes de commentaire peuvent différer ;
 *   2. chaque migration Supabase postérieure à la base de référence a sa migration Flyway :
 *      une migration créée par Lovable, sans équivalent sur site, est refusée ;
 *   3. l'ordre est le même des deux côtés (V croissant ⇔ horodatage croissant).
 *
 * La base de référence (V1..V15) correspond au dump de production du 9 novembre 2026, dont les
 * migrations Supabase antérieures au 12 novembre 2026 font partie.
 *
 * Usage : node scripts/schema/check-migration-twins.mjs   (code de sortie 1 en cas d'écart)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const flywayDir = join(root, "services/api/src/main/resources/db/migration");
const supabaseDir = join(root, "supabase/migrations");
const FIRST_POST_BASELINE_VERSION = 16;
const SUPABASE_CUTOFF = "20261112000000"; // tout ce qui précède est dans la base de référence

/** SQL exécutable : lignes de commentaire et lignes vides ôtées, fins de ligne normalisées. */
const normalize = (sql) =>
  sql.replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "" && !/^\s*--/.test(line))
    .join("\n");

const flyway = readdirSync(flywayDir)
  .map((name) => ({ name, m: /^V(\d+)__.+\.sql$/.exec(name) }))
  .filter((f) => f.m && Number(f.m[1]) >= FIRST_POST_BASELINE_VERSION)
  .map((f) => ({ name: f.name, version: Number(f.m[1]), body: normalize(readFileSync(join(flywayDir, f.name), "utf8")) }))
  .sort((a, b) => a.version - b.version);

const supabase = readdirSync(supabaseDir)
  .filter((name) => name.endsWith(".sql") && name.slice(0, 14) >= SUPABASE_CUTOFF)
  .sort()
  .map((name) => ({ name, body: normalize(readFileSync(join(supabaseDir, name), "utf8")) }));

const errors = [];
const pairs = [];
for (const f of flyway) {
  const twins = supabase.filter((s) => s.body === f.body);
  if (twins.length === 0) errors.push(`${f.name} : aucune jumelle identique dans supabase/migrations/ — le nuage ne la recevrait pas.`);
  else if (twins.length > 1) errors.push(`${f.name} : plusieurs jumelles identiques (${twins.map((t) => t.name).join(", ")}).`);
  else pairs.push({ flyway: f, supabase: twins[0] });
}
for (const s of supabase) {
  if (!pairs.some((p) => p.supabase.name === s.name)) {
    errors.push(`supabase/migrations/${s.name} : aucune migration Flyway identique — la base sur site ne la recevrait pas `
      + `(créer services/api/src/main/resources/db/migration/V<n>__….sql au même contenu).`);
  }
}
for (let i = 1; i < pairs.length; i++) {
  if (pairs[i].supabase.name < pairs[i - 1].supabase.name) {
    errors.push(`Ordre différent : ${pairs[i].flyway.name} passe avant ${pairs[i - 1].flyway.name} côté Supabase.`);
  }
}

if (errors.length > 0) {
  console.error(`Migrations désynchronisées entre PostgreSQL sur site et Supabase (${errors.length}) :`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Migrations synchronisées : ${pairs.length} paires (V${flyway[0]?.version}..V${flyway.at(-1)?.version}), même contenu et même ordre.`);
