#!/usr/bin/env node
/**
 * Vérifie que `src/api/qerp-schema.ts` correspond au contrat OpenAPI versionné.
 *
 * <h2>Pourquoi pas `git diff --exit-code`</h2>
 * C'était la première version de ce contrôle, et elle ne pouvait pas échouer :
 * `git diff` ignore les fichiers non suivis, et un fichier supprimé ne produit
 * aucune différence. Le contrôle passait donc dans les deux cas où il aurait dû
 * échouer. Ici la comparaison porte sur le contenu réellement généré : elle ne
 * dépend ni de l'état de l'index, ni de la présence du fichier.
 *
 * <h2>Ce que l'échec signifie</h2>
 * Le backend a changé de contrat, et le front compile encore contre l'ancien.
 * Le message donne la commande qui corrige, et rien d'autre.
 *
 * Usage : node scripts/api/check-openapi-client.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("../..", import.meta.url));
const contrat = join(racine, "services/api/openapi/qerp-api.json");
const versionne = join(racine, "src/api/qerp-schema.ts");

// Le lanceur de `node_modules/.bin` est un script `.cmd` sous Windows, et
// `execFileSync` refuse de l'exécuter sans interpréteur depuis la correction de
// sécurité de Node 18.20/20.12. On appelle donc le point d'entrée JavaScript
// directement, avec l'interpréteur courant : c'est le même code, sans passer par
// un shell, donc sans dépendre de la plateforme ni d'un échappement d'arguments.
const pointDEntree = join(racine, "node_modules", "openapi-typescript", "bin", "cli.js");

const temporaire = mkdtempSync(join(tmpdir(), "qerp-openapi-"));
const genere = join(temporaire, "qerp-schema.ts");

try {
  execFileSync(process.execPath, [pointDEntree, contrat, "-o", genere], { stdio: "pipe" });
} catch (erreur) {
  console.error(
    "Impossible de générer les types depuis le contrat.\n" +
      "Vérifiez que services/api/openapi/qerp-api.json est un document OpenAPI valide.\n" +
      (erreur.stderr ? erreur.stderr.toString() : erreur.message),
  );
  rmSync(temporaire, { recursive: true, force: true });
  process.exit(1);
}

let attendu;
try {
  attendu = readFileSync(versionne, "utf8");
} catch {
  console.error(
    `${versionne} est absent. Régénérez-le avec :\n\n  npm run api:types\n`,
  );
  rmSync(temporaire, { recursive: true, force: true });
  process.exit(1);
}

const obtenu = readFileSync(genere, "utf8");
rmSync(temporaire, { recursive: true, force: true });

if (attendu === obtenu) {
  console.log("src/api/qerp-schema.ts correspond au contrat OpenAPI.");
  process.exit(0);
}

// Un diff complet ferait des centaines de lignes : on nomme les premières.
const lignesAttendues = attendu.split("\n");
const lignesObtenues = obtenu.split("\n");
const differences = [];
for (let i = 0; i < Math.max(lignesAttendues.length, lignesObtenues.length); i++) {
  if (lignesAttendues[i] !== lignesObtenues[i]) {
    differences.push(
      `  ligne ${i + 1}\n    versionné : ${lignesAttendues[i] ?? "(absent)"}\n    généré    : ${lignesObtenues[i] ?? "(absent)"}`,
    );
    if (differences.length === 10) break;
  }
}

console.error(
  "src/api/qerp-schema.ts ne correspond plus au contrat OpenAPI du backend.\n" +
    "Le front compilerait donc contre un contrat qui ne décrit plus le serveur.\n\n" +
    differences.join("\n") +
    "\n\nCorrigez avec :\n\n  npm run api:types\n",
);
process.exit(1);
