import { defineConfig, devices } from "@playwright/test";

/*
 * Parcours SUR SITE : le front parle à l'API Java (VITE_QERP_API_URL), qui écrit dans le
 * PostgreSQL local. Identité : jetons du projet Supabase tant que Keycloak n'existe pas.
 *
 *   npm run test:e2e:sur-site
 *
 * Prérequis :
 *   - PostgreSQL local (infra/compose.dev.yml) avec la société de test (scripts/e2e/societe-sur-site.sql) ;
 *   - l'API sur 8090 avec SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_JWK_SET_URI=<projet>/auth/v1/.well-known/jwks.json,
 *     SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_JWS_ALGORITHMS=ES256 et
 *     QERP_API_CORS_ALLOWED_ORIGINS=http://localhost:8083 ;
 *   - le compte de test (identifiants hors dépôt, comme pour les parcours nuage).
 *
 * Périmètre : ce que l'API porte aujourd'hui (Lot 2 : clients, factures et encaissements AR,
 * paramétrage comptable, analytique, autorisations). Les autres modules passent encore par
 * Supabase et seront portés aux Lots 3 à 5 ; les parcours vérifient qu'AUCUNE écriture du
 * périmètre sur site ne part vers Supabase.
 */
const PORT = process.env.E2E_SUR_SITE_PORT ?? "8083";
const BASE = `http://localhost:${PORT}`;
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";
process.env.E2E_API_URL = API;
// Parcours métier du nuage rejoués sur site (projet « parcours-sur-site ») : société locale, sessions
// locales, tout accès aux données de Supabase compté comme incident (tests/e2e/parcours/outils.ts).
process.env.E2E_SUR_SITE = "1";
process.env.E2E_AUTH_DIR = "test-results-sur-site/.auth";
/** Parcours du nuage dont tous les modules sont portés sur l'API (étendu module par module). */
const PARCOURS_PORTES = process.env.E2E_PARCOURS_SUR_SITE ? new RegExp(process.env.E2E_PARCOURS_SUR_SITE) : /(10-tiers|20-achats|30-fournisseurs|40-clients|50-comptabilite|60-crm|61-crm|70-stocks|71-inventaires|80-tresorerie|81-tresorerie|90-budget|91-immobilisations|92-budget|93-budget|94-budget)/;

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
