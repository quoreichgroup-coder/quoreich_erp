import { defineConfig, devices } from "@playwright/test";

/*
 * Parcours métier de bout en bout, CONNECTÉS au projet Supabase du propriétaire (pas de
 * simulation) : connexion réelle, écrans réels, déclencheurs et RLS réels.
 *
 *   npm run test:e2e:parcours
 *
 * Prérequis : le compte de test (scripts/e2e/compte-de-test.sql) et ses identifiants dans
 * E2E_EMAIL / E2E_PASSWORD, ou dans le fichier désigné par E2E_CREDENTIALS_FILE (par défaut
 * C:/Users/Abdouramane/QERP-backups/e2e-credentials.txt, hors dépôt). Sans identifiants, les
 * parcours sont ignorés.
 *
 * Le front tourne en mode « cloud » (.env.cloud, clé publiable seulement) sur 8081 ; un serveur
 * déjà lancé (`PORT=8081 npm run dev:cloud -- --strictPort`) est réutilisé. Toutes les données
 * créées vont dans la société de test du compte, isolée des sociétés réelles par la RLS, et sont
 * préfixées par un identifiant d'exécution (E2E-xxxx).
 */
const PORT = process.env.E2E_PARCOURS_PORT ?? "8081";
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e/parcours",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-parcours" }]],
  outputDir: "test-results-parcours",
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
    { name: "connexion", testMatch: /00-connexion\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "parcours",
      testIgnore: /00-connexion\.spec\.ts/,
      dependencies: ["connexion"],
      use: { ...devices["Desktop Chrome"], storageState: "test-results-parcours/.auth/session.json" },
    },
  ],
  webServer: {
    command: `npx vite --mode cloud --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
