/**
 * E2E — Treasury period close: out-of-range / invalid format edge cases.
 *
 * The RPC must NEVER be called when the period sits outside the allowed
 * window (default: 24 months past → 1 month future) or has an invalid
 * shape. Each case asserts:
 *   - button disabled
 *   - validation error visible
 *   - `close_treasury_period` route never hit
 */
import { test, expect, type Route } from "@playwright/test";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;

function shiftPeriod(monthsDelta: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + monthsDelta);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const CASES: { label: string; period: string; expect: RegExp }[] = [
  { label: "too old (-25 months)", period: shiftPeriod(-25), expect: /hors plage autorisée/i },
  { label: "too far future (+2 months)", period: shiftPeriod(2), expect: /hors plage autorisée/i },
  { label: "invalid month", period: "2025-13", expect: /invalide/i },
  { label: "invalid format", period: "abcd-ef", expect: /invalide/i },
];

for (const c of CASES) {
  test(`Treasury close — ${c.label} blocks the RPC`, async ({ page }) => {
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

    const input = page.getByTestId("treasury-close-period");
    await input.fill(c.period);

    const btn = page.getByTestId("treasury-close-button");
    await expect(btn).toBeDisabled();
    await expect(page.getByTestId("treasury-close-error")).toContainText(c.expect);

    // Even a forced click must be a no-op.
    await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
    expect(rpcCalled).toBe(false);
  });
}
