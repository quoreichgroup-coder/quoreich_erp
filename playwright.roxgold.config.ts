import { defineConfig, devices } from "@playwright/test";

// Dedicated real-company run. It never imports the simulated backend fixtures.
const storageState = process.env.E2E_ROXGOLD_STATE;
const interactive = process.env.E2E_ROXGOLD_INTERACTIVE === "1";

export default defineConfig({
  testDir: "tests/e2e/roxgold",
  workers: 1,
  retries: 0,
  timeout: interactive ? 720_000 : 90_000,
  reporter: "list",
  outputDir: "test-results-roxgold",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:8081",
    locale: "fr-FR",
    storageState,
    headless: !interactive,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
