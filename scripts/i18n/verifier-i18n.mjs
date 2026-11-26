#!/usr/bin/env node
/**
 * Contrôle CI de l'i18n (C-06). Échoue (code 1) si :
 *  1. une clé existe dans une langue et pas dans l'autre (fr = source, en) ;
 *  2. les variables {{x}} d'une traduction diffèrent de la source ;
 *  3. une forme plurielle (_one / _other) manque ;
 *  4. le registre des clés d'erreur (services/api/.../i18n/error-keys.json, lu par Java et le front)
 *     et le catalogue errors divergent, ou une traduction d'erreur utilise un paramètre non déclaré ;
 *  5. un fichier pilote contient une locale codée en dur ("fr-FR", "en-US"…) ou toLocale*String ;
 *  6. le nombre de "fr-FR" codés en dur dans src/ augmente (cliquet, base mesurée au PoC) ;
 *  7. la règle ESLint ne détecte plus un texte en dur ajouté dans un fichier pilote (autotest).
 *   npm run i18n:check
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ESLint } from "eslint";
import { FICHIERS_PILOTES } from "./perimetre-pilote.js";

const ROOT = process.cwd();
const LOCALES = join(ROOT, "src/i18n/locales");
const SOURCE = "fr";
const errors = [];
const fail = (msg) => errors.push(msg);

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out); else out[key] = String(v);
  }
  return out;
}
const vars = (text) => [...text.matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map((m) => m[1]).filter((v) => v !== "count").sort();
const pluralBase = (key) => key.replace(/_(zero|one|two|few|many|other)$/, "");

const languages = readdirSync(LOCALES).filter((d) => statSync(join(LOCALES, d)).isDirectory());
const catalogs = {};
for (const lang of languages) {
  catalogs[lang] = {};
  for (const file of readdirSync(join(LOCALES, lang)).filter((f) => f.endsWith(".json"))) {
    catalogs[lang][file.replace(/\.json$/, "")] = flatten(JSON.parse(readFileSync(join(LOCALES, lang, file), "utf8")));
  }
}

// 1-3. Clés, variables, pluriels.
let keyCount = 0;
for (const lang of languages.filter((l) => l !== SOURCE)) {
  const namespaces = new Set([...Object.keys(catalogs[SOURCE]), ...Object.keys(catalogs[lang])]);
  for (const ns of namespaces) {
    const src = catalogs[SOURCE][ns] ?? {};
    const tgt = catalogs[lang][ns] ?? {};
    const srcBases = new Set(Object.keys(src).map(pluralBase));
    const tgtBases = new Set(Object.keys(tgt).map(pluralBase));
    for (const base of srcBases) if (!tgtBases.has(base)) fail(`[${lang}] clé manquante ${ns}:${base}`);
    for (const base of tgtBases) if (!srcBases.has(base)) fail(`[${lang}] clé absente de la source ${ns}:${base}`);
    for (const [key, text] of Object.entries(src)) {
      keyCount += 1;
      if (key.endsWith("_one") && !(key.replace(/_one$/, "_other") in src)) fail(`[${SOURCE}] pluriel incomplet ${ns}:${key}`);
      const other = tgt[key] ?? tgt[`${pluralBase(key)}_other`];
      if (other === undefined) continue;
      if (vars(text).join(",") !== vars(other).join(",")) fail(`[${lang}] variables différentes pour ${ns}:${key} (${vars(text)} ≠ ${vars(other)})`);
      if (!other.trim()) fail(`[${lang}] traduction vide ${ns}:${key}`);
    }
    for (const key of Object.keys(tgt)) {
      if (key.endsWith("_one") && !(key.replace(/_one$/, "_other") in tgt)) fail(`[${lang}] pluriel incomplet ${ns}:${key}`);
    }
  }
}

// 4. Registre des erreurs.
const registry = JSON.parse(readFileSync(join(ROOT, "services/api/src/main/resources/i18n/error-keys.json"), "utf8"));
for (const lang of languages) {
  const catalog = catalogs[lang].errors ?? {};
  for (const [key, params] of Object.entries(registry)) {
    const path = key.replace(/^errors:/, "");
    if (!(path in catalog)) { fail(`[${lang}] clé d'erreur enregistrée sans traduction : ${key}`); continue; }
    for (const v of vars(catalog[path])) if (!params.includes(v)) fail(`[${lang}] ${key} utilise {{${v}}}, non déclaré dans le registre`);
  }
  for (const path of Object.keys(catalog)) if (!(`errors:${path}` in registry)) fail(`[${lang}] traduction d'erreur hors registre : errors:${path}`);
}

// 5-6. Locales codées en dur.
const HARD_LOCALE = /["'`](fr|en)-(FR|BF|GB|US)["'`]|toLocale(Date|Time)?String\(/g;
for (const file of FICHIERS_PILOTES) {
  const hits = readFileSync(join(ROOT, file), "utf8").match(HARD_LOCALE);
  if (hits) fail(`${file} : locale codée en dur (${[...new Set(hits)].join(", ")}) — utiliser useLocaleFormat()`);
}
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__" && name !== "i18n") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.spec\./.test(name) && !p.endsWith("locale-format.ts")) out.push(p);
  }
  return out;
}
let hardCoded = 0;
for (const p of walk(join(ROOT, "src"))) hardCoded += (readFileSync(p, "utf8").match(/["'`]fr-FR["'`]/g) ?? []).length;
const baseline = JSON.parse(readFileSync(join(ROOT, "scripts/i18n/cliquet.json"), "utf8"));
if (hardCoded > baseline.frFR) fail(`"fr-FR" codé en dur : ${hardCoded} occurrences (> ${baseline.frFR} mesurées au PoC). Utiliser src/lib/locale-format.ts.`);

// 7. Autotest de la règle ESLint : un texte en dur dans un fichier pilote doit être refusé.
const eslint = new ESLint({ cwd: ROOT });
const probe = `export function Sonde() { return <p title="Texte en dur">Bonjour le monde</p>; }\n`;
const [result] = await eslint.lintText(probe, { filePath: join(ROOT, FICHIERS_PILOTES[0]) });
const caught = result.messages.filter((m) => m.ruleId === "i18next/no-literal-string").length;
if (caught < 2) fail(`La règle i18next/no-literal-string ne détecte plus les textes en dur des fichiers pilotes (${caught}/2).`);

if (errors.length) {
  console.error(`i18n : ${errors.length} problème(s)\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`i18n : ${languages.join(", ")} cohérents (${keyCount} clés source), ${Object.keys(registry).length} clés d'erreur, `
  + `${FICHIERS_PILOTES.length} fichiers pilotes sans texte ni locale en dur, "fr-FR" codé en dur : ${hardCoded}/${baseline.frFR}, `
  + `autotest ESLint : ${caught} textes détectés. (${relative(ROOT, LOCALES)})`);
