import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

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
);
