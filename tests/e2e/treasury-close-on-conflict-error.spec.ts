/**
 * E2E — When the backend RPC `close_treasury_period` fails with the Postgres
 * `42P10` "no unique or exclusion constraint matching the ON CONFLICT
 * specification" error, the UI must:
 *   - Show a clear toast referencing the missing constraint.
 *   - NOT add a duplicate row to the visible history.
 *   - Keep the history table accessible and the close button re-enabled.
 */
import { test, expect, type Route } from "./fixtures/test";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;
const PERIOD = "2025-07";

test("Treasury close — ON CONFLICT failure shows clear toast and does not duplicate history", async ({ page }) => {
  const existing = [{
    id: "00000000-0000-0000-0000-0000000000ee",
    period: "2025-04",
    status: "completed",
    total_balance: 0,
    accounts_count: 0,
    reconciliations_count: 0,
    error_message: null,
    closed_by: "11111111-1111-1111-1111-111111111111",
    closed_at: new Date().toISOString(),
    closed_by_name: "Tester",
  }];

  await page.route(/treasury_close_history_view/, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(existing) });
  });

  await page.route(/rpc\/close_treasury_period/, async (route: Route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        code: "42P10",
        message: "there is no unique or exclusion constraint matching the ON CONFLICT specification",
      }),
    });
  });

  await page.goto(`${BASE}/treasury/control`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Clôture de période/i }).click();

  const historyBefore = await page.getByTestId(/^treasury-close-row-/).count();

  await page.getByTestId("treasury-close-period").fill(PERIOD);
  await page.getByTestId("treasury-close-button").click();

  // Clear toast surfaced
  await expect(page.getByText(/Clôture impossible/i)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/Conflit de contrainte|contrainte UNIQUE/i)).toBeVisible();

  // History remains accessible and untouched
  await expect(page.getByTestId("treasury-close-history")).toBeVisible();
  const historyAfter = await page.getByTestId(/^treasury-close-row-/).count();
  expect(historyAfter).toBe(historyBefore);
  await expect(page.getByTestId(`treasury-close-row-${PERIOD}`)).toHaveCount(0);

  // Button re-enabled, no stuck progress indicator
  await expect(page.getByTestId("treasury-close-button")).toBeEnabled();
  await expect(page.getByTestId("treasury-close-progress")).toHaveCount(0);
});
