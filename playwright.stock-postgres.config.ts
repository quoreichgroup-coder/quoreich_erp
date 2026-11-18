import { defineConfig, devices } from "@playwright/test";

if (!process.env.QERP_STOCK_TEST_JWT_SECRET) {
  throw new Error("Lancer scripts/e2e/verify-stock-postgres.ps1 pour préparer la base isolée.");
}

const port = 18102;
const baseURL = `http://127.0.0.1:${port}`;
const buildDir = "test-results-stock-postgres-web";

export default defineConfig({
  testDir: "tests/e2e/stock-postgres",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results-stock-postgres",
  use: { ...devices["Desktop Chrome"], baseURL, locale: "fr-FR", trace: "off", screenshot: "only-on-failure" },
  webServer: {
    command: `npm run build -- --mode development --outDir ${buildDir} && npx vite preview --host 127.0.0.1 --port ${port} --strictPort --outDir ${buildDir}`,
    url: baseURL,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      VITE_QERP_API_URL: "",
      VITE_SUPABASE_URL: "http://127.0.0.1:18101",
      VITE_SUPABASE_PUBLISHABLE_KEY: "local-stock-postgres-test",
    },
  },
});
