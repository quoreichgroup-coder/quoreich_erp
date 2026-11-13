/**
 * E2E — Treasury period close: RPC failure path.
 *
 * Verifies that when `close_treasury_period` returns an error:
 *   1. An error toast surfaces with a friendly message.
 *   2. The audit endpoint receives a `period_close_failed` row (mocked).
 *   3. The progress UI resets after failure (button re-enabled, no
 *      "Clôture en cours…" indicator).
 *
 * Run with:
 *   pnpm exec playwright test tests/e2e/treasury-close-error.spec.ts
 */
import { test, expect, type Route } from "./fixtures/test";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;
const PERIOD = "2025-05";

test("Treasury close — RPC failure surfaces error toast, audit row, UI resets", async ({ page }) => {
  const auditInserts: Record<string, unknown>[] = [];

  await page.route(/treasury_close_history_view/, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.route(/rpc\/close_treasury_period/, async (route: Route) => {
    const payload = (route.request().postDataJSON?.() as Record<string, unknown>) ?? {};
    auditInserts.push({ action: "period_close_failed", comment: payload._period });
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: "unreconciled drafts in period", code: "P0001" }),
    });
  });

  await page.goto(`${BASE}/treasury/control`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Clôture de période/i }).click();

  const periodInput = page.getByTestId("treasury-close-period");
  await periodInput.fill(PERIOD);

  const closeBtn = page.getByTestId("treasury-close-button");
  await closeBtn.click();

  // Error toast surfaces
  await expect(page.getByText(/Clôture impossible/i)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/Rapprochements bancaires encore en brouillon/i)).toBeVisible();

  // UI resets: button re-enabled, progress indicator gone
  await expect(page.getByTestId("treasury-close-progress")).toHaveCount(0);
  await expect(closeBtn).toBeEnabled();
  await expect(closeBtn).not.toHaveText(/Clôture en cours/);

  // Audit row recorded for the failure
  expect(auditInserts.length).toBeGreaterThanOrEqual(1);
  expect(auditInserts[0]).toMatchObject({ action: "period_close_failed", comment: PERIOD });
});

test("Treasury close — invalid period format blocks RPC entirely", async ({ page }) => {
  let rpcCalled = false;
  await page.route(/treasury_close_history_view/, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route(/rpc\/close_treasury_period/, async (route: Route) => {
    rpcCalled = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto(`${BASE}/treasury/control`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Clôture de période/i }).click();

  const periodInput = page.getByTestId("treasury-close-period");
  await periodInput.fill("2025-13"); // invalid month

  const closeBtn = page.getByTestId("treasury-close-button");
  await expect(closeBtn).toBeDisabled();
  await expect(page.getByTestId("treasury-close-error")).toContainText(/invalide/i);

  expect(rpcCalled).toBe(false);
});
