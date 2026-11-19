import { defineConfig, devices } from "@playwright/test";

/*
 * Parcours SUR SITE : le front parle uniquement à l'API Java (VITE_QERP_API_URL), connexion comprise (identité
 * sur site, V114), et l'API écrit dans le PostgreSQL local. Aucune requête ne doit partir vers Supabase.
 *
 *   npm run test:e2e:sur-site
 *
 * Prérequis :
 *   - PostgreSQL local (infra/compose.dev.yml) avec la société de test (scripts/e2e/societe-sur-site.sql) et les
 *     deux comptes de test repris du nuage (scripts/identite/reprendre-comptes.sh, FILTRE='%@quoreich-e2e.invalid') ;
 *   - l'API sur 8090 (identité locale par défaut) avec QERP_API_CORS_ALLOWED_ORIGINS=http://localhost:8083 ;
 *   - les identifiants des comptes de test (hors dépôt, comme pour les parcours nuage).
 */
const PORT = process.env.E2E_SUR_SITE_PORT ?? "8083";
const BASE = `http://localhost:${PORT}`;
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";
process.env.E2E_API_URL = API;
// Parcours métier du nuage rejoués sur site (projet « parcours-sur-site ») : société locale, sessions
// locales, tout accès aux données de Supabase compté comme incident (tests/e2e/parcours/outils.ts).
process.env.E2E_SUR_SITE = "1";
process.env.E2E_AUTH_DIR = "test-results-sur-site/.auth";
/**
 * Parcours du nuage rejoués sur site : tous les parcours métier (00 et 01, propres au nuage — création de la
 * société, invitation —, sont remplacés par les deux connexions sur site). Les parcours à trois chiffres
 * passent après les autres : ils s'appuient sur des données créées plus tôt (salarié du parcours 95).
 */
const filtre = process.env.E2E_PARCOURS_SUR_SITE ? new RegExp(process.env.E2E_PARCOURS_SUR_SITE) : null;
const PARCOURS_PORTES = filtre ?? /parcours[\\/](?!0[01]-)\d{2}-[^\\/]*\.spec\.ts$/;
const PARCOURS_SUITE = filtre ? /^$/ : /parcours[\\/]\d{3}-[^\\/]*\.spec\.ts$/;

export default defineConfig({
  testDir: "tests/e2e/sur-site",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-sur-site" }]],
  outputDir: "test-results-sur-site",
  use: {
    baseURL: BASE,
    locale: "fr-FR",
    timezoneId: "Africa/Ouagadougou",
    trace: "retain-on-failure",
    screenshot: "on",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "connexion-sur-site", testMatch: /00-connexion\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "approbateur-sur-site", testMatch: /01-approbateur\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "parcours-sur-site",
      testDir: "tests/e2e/parcours",
      testMatch: PARCOURS_PORTES,
      dependencies: ["connexion-sur-site", "approbateur-sur-site"],
      use: { ...devices["Desktop Chrome"], storageState: "test-results-sur-site/.auth/session.json" },
    },
    {
      name: "parcours-sur-site-suite",
      testDir: "tests/e2e/parcours",
      testMatch: PARCOURS_SUITE,
      dependencies: ["parcours-sur-site"],
      use: { ...devices["Desktop Chrome"], storageState: "test-results-sur-site/.auth/session.json" },
    },
    {
      name: "sur-site",
      testIgnore: /0[01]-(connexion|approbateur)\.spec\.ts/,
      dependencies: ["connexion-sur-site", "approbateur-sur-site"],
      use: { ...devices["Desktop Chrome"], storageState: "test-results-sur-site/.auth/session.json" },
    },
  ],
  webServer: {
    // Les variables du processus priment sur .env.cloud : même front, branché sur l'API.
    command: `npx vite --mode cloud --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: true,
    timeout: 180_000,
    env: { VITE_QERP_API_URL: API },
  },
});
