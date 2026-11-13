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
    {
      name: "sur-site",
      testIgnore: /00-connexion\.spec\.ts/,
      dependencies: ["connexion-sur-site"],
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
