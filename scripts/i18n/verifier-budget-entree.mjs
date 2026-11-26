#!/usr/bin/env node
/**
 * Budget du premier écran (C-06, décision D-I18N-011 du 26 nov. 2026) : somme gzip (niveau 9) de toutes les
 * ressources que dist/index.html charge au démarrage (<script src>, <link href> .js / .css).
 * Échoue si elle dépasse la référence mesurée avant le PoC (256,3 Ko) + la marge validée (22 Ko).
 *   npm run build && npm run i18n:budget
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const dist = process.argv[2] ?? "dist";
const budget = JSON.parse(readFileSync("scripts/i18n/budget-entree.json", "utf8"));
const html = readFileSync(join(dist, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="\/?([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
let gz = 0;
for (const r of refs) gz += gzipSync(readFileSync(join(dist, r)), { level: 9 }).length;
const ko = Math.round((gz / 1024) * 10) / 10;
const plafond = Math.round((budget.reference_gzip_ko + budget.marge_ko) * 10) / 10;
const ligne = `Premier écran : ${refs.length} ressources, ${ko} Ko gzip (plafond ${plafond} = référence ${budget.reference_gzip_ko} + marge ${budget.marge_ko}).`;
if (ko > plafond) { console.error(`${ligne} DÉPASSEMENT de ${Math.round((ko - plafond) * 10) / 10} Ko.`); process.exit(1); }
console.log(ligne);
