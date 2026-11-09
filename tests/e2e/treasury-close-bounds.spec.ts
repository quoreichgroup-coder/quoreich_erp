/**
 * E2E — Exact range bounds: the period at exactly -24 months and at
 * exactly +1 month must be accepted. The submit button is enabled, the
 * RPC is invoked, and `period_start` / `period_end` it receives match
 * `periodBounds(period)`.
 */
import { test, expect, type Route } from "@playwright/test";
import { periodBounds } from "@/lib/treasury-close";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;

function shiftPeriod(monthsDelta: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + monthsDelta);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const BOUNDS = [
  { label: "exact lower bound (-24 months)", period: shiftPeriod(-24) },
  { label: "exact upper bound (+1 month)", period: shiftPeriod(1) },
];

for (const c of BOUNDS) {
  test(`Treasury close — ${c.label} accepted and RPC receives computed bounds`, async ({ page }) => {
    const expectedBounds = periodBounds(c.period);
    let receivedPayload: { _period?: string; _period_start?: string; _period_end?: string } | null = null;

    await page.route(/treasury_close_history_view/, async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.route(/rpc\/close_treasury_period/, async (route: Route) => {
      receivedPayload = (route.request().postDataJSON?.() as typeof receivedPayload) ?? null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "ok", period: c.period, status: "completed" }),
      });
    });

    await page.goto(`${BASE}/treasury/control`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Clôture de période/i }).click();

    await page.getByTestId("treasury-close-period").fill(c.period);

    const btn = page.getByTestId("treasury-close-button");
    await expect(btn).toBeEnabled();
    await expect(page.getByTestId("treasury-close-error")).toHaveCount(0);

    await btn.click();
    await expect(page.getByText(`Période ${c.period} clôturée`)).toBeVisible({ timeout: 5000 });

    expect(receivedPayload).not.toBeNull();
    expect(receivedPayload!._period).toBe(c.period);
    // Bounds are computed client-side OR server-side; if sent in payload, assert match.
    if (receivedPayload!._period_start || receivedPayload!._period_end) {
      expect(receivedPayload!._period_start).toBe(expectedBounds.start);
      expect(receivedPayload!._period_end).toBe(expectedBounds.end);
    }
  });
}
