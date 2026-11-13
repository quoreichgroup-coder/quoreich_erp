import { defineConfig, devices } from "@playwright/test";
import { fakeSessionStorageState } from "./tests/e2e/fixtures/session";

/*
 * Tests de bout en bout (tests/e2e). Lancer : `npm run test:e2e` (ou un fichier :
 * `npm run test:e2e -- tests/e2e/cfo-consolidated.spec.ts`).
 *
 * Port dédié, 8082 par défaut : 8080 est tenu sur ce poste par un conteneur Frappe et 8081 par le
 * serveur de développement, qui est souvent lancé avec VITE_QERP_API_URL. Or la plupart des specs
 * simulent Supabase avec page.route : branché sur l'API Java, le front interrogerait
 * localhost:8090 et les simulations ne verraient rien passer. Playwright démarre donc son propre
 * Vite, sans API, et le réutilise s'il tourne déjà.
 *
 * Les specs lisent process.env.PORT (et E2E_BASE_URL pour les specs connectées) au chargement :
 * on les fixe ici, avant le chargement des specs, et les workers en héritent.
 */
const PORT = process.env.E2E_PORT ?? "8082";
process.env.PORT = PORT;
process.env.E2E_BASE_URL ??= `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  // Poste chargé (une vingtaine de conteneurs) : peu de workers, délais larges.
  workers: process.env.CI ? 2 : 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL,
    // Session factice (voir tests/e2e/fixtures/session.ts) : sans elle, tout écran privé redirige vers /login.
    storageState: fakeSessionStorageState(`http://localhost:${PORT}`),
    locale: "fr-FR",
    timezoneId: "Africa/Ouagadougou",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Vide = isApiEnabled() faux : le front parle à Supabase, que les specs simulent.
    env: { VITE_QERP_API_URL: "" },
  },
});
