import { defineConfig, devices } from "@playwright/test";

const port = 18084;
const baseURL = `http://localhost:${port}`;
process.env.E2E_TREASURY_READONLY = "1";
process.env.E2E_BASE_URL = baseURL;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /treasury-rbac-(csv|realtime)\.spec\.ts/,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  outputDir: "test-results-treasury-readonly",
  use: {
    ...devices["Desktop Chrome"], baseURL, locale: "fr-FR", trace: "off", screenshot: "off", video: "off",
  },
  webServer: {
    command: `npx vite --mode cloud --port ${port} --strictPort`, url: baseURL,
    timeout: 180_000, reuseExistingServer: false, env: { VITE_QERP_API_URL: "" },
  },
});
