import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import i18next from "eslint-plugin-i18next";
import { FICHIERS_PILOTES } from "./scripts/i18n/perimetre-pilote.js";

export default tseslint.config(
  { ignores: ["dist", ".tmp_*/**"] }, // .tmp_* : copies isolées des parcours (ignorées par git)
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // 431 occurrences, concentrées sur la frontière de types générés :
      // `(supabase as any)` / `.from("vue" as never)` — pratique sanctionnée par
      // CLAUDE.md, car `src/integrations/supabase/types.ts` ne doit jamais être
      // édité à la main. En `error`, ces 431 sites rendaient `npm run lint`
      // rouge en permanence, donc inutilisable comme signal. En `warn`, ils
      // restent visibles dans le rapport sans masquer les vraies erreurs.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Périmètre pilote i18n : tout texte visible passe par les catalogues (D-I18N-002, C-06).
    // Exceptions : signes et sigles (mots en capitales, ponctuation), déjà exclus par la règle.
    files: FICHIERS_PILOTES,
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": ["error", {
        mode: "jsx-only",
        "jsx-attributes": { include: ["placeholder", "title", "aria-label", "alt", "label", "heading", "description", "message"] },
        // Exclus : signes, sigles en capitales, identifiants techniques en minuscules (valeurs de thème,
        // codes), chemins d'URL, raccourci clavier. Tout texte rédigé (majuscule, espace) reste contrôlé.
        words: { exclude: ["[0-9!-/:-@[-`{-~·×—→…⌘%©]+", "[A-Z_-]+", "[a-z][a-z0-9_-]*", "/[a-zA-Z0-9_/?=&.-]*", "⌘K", "[A-Z ·]+"] },
      }],
    },
  },
);
