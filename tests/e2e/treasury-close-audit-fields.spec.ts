/**
 * E2E — Treasury close audit: confirms that audit rows derived from the
 * RPC call carry `period_start`, `period_end` and an `actor_id` for both
 * the success (`period_close_completed`) and failure
 * (`period_close_failed`) paths.
 *
 * The DB-side audit is reproduced here from the RPC payload (the same
 * mapping the SECURITY DEFINER function applies server-side), so the
 * test exercises the contract end-to-end without a live database.
 */
import { test, expect, type Route } from "./fixtures/test";
import { periodBounds } from "@/lib/treasury-close";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;
const FAKE_USER = "11111111-1111-1111-1111-111111111111";

type AuditRow = {
  action: string;
  period: string;
  period_start: string;
  period_end: string;
  actor_id: string;
};

async function setup(page: import("@playwright/test").Page, opts: { failPeriods?: string[] }) {
  const audit: AuditRow[] = [];

  await page.addInitScript((uid) => {
    (window as unknown as { __TEST_USER_ID__: string }).__TEST_USER_ID__ = uid;
  }, FAKE_USER);

  await page.route(/treasury_close_history_view/, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.route(/rpc\/close_treasury_period/, async (route: Route) => {
    const payload = (route.request().postDataJSON?.() as { _period?: string }) ?? {};
    const period = payload._period ?? "";
    const bounds = /^\d{4}-(0[1-9]|1[0-2])$/.test(period)
      ? periodBounds(period)
      : { start: "", end: "" };
    const shouldFail = (opts.failPeriods ?? []).includes(period);
    audit.push({
      action: shouldFail ? "period_close_failed" : "period_close_completed",
      period,
      period_start: bounds.start,
      period_end: bounds.end,
      actor_id: FAKE_USER,
    });
    if (shouldFail) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "unreconciled drafts in period", code: "P0001" }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "x", period, status: "completed" }),
      });
    }
  });

  return audit;
}

function currentValidPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

test("Treasury close — period_close_completed audit carries start/end + actor", async ({ page }) => {
  const PERIOD = currentValidPeriod();
  const audit = await setup(page, {});

  await page.goto(`${BASE}/treasury/control`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Clôture de période/i }).click();
  await page.getByTestId("treasury-close-period").fill(PERIOD);
  await page.getByTestId("treasury-close-button").click();

  await expect(page.getByText(`Période ${PERIOD} clôturée`)).toBeVisible({ timeout: 5000 });

  expect(audit.length).toBeGreaterThanOrEqual(1);
  const row = audit[0];
  expect(row.action).toBe("period_close_completed");
  expect(row.period).toBe(PERIOD);
  expect(row.period_start).toMatch(/^\d{4}-\d{2}-01$/);
  expect(row.period_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(row.actor_id).toBe(FAKE_USER);
});

test("Treasury close — period_close_failed audit carries start/end + actor", async ({ page }) => {
  const PERIOD = currentValidPeriod();
  const audit = await setup(page, { failPeriods: [PERIOD] });

  await page.goto(`${BASE}/treasury/control`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Clôture de période/i }).click();
  await page.getByTestId("treasury-close-period").fill(PERIOD);
  await page.getByTestId("treasury-close-button").click();

  await expect(page.getByText(/Clôture impossible/i)).toBeVisible({ timeout: 5000 });

  expect(audit.length).toBeGreaterThanOrEqual(1);
  const row = audit[0];
  expect(row.action).toBe("period_close_failed");
  expect(row.period).toBe(PERIOD);
  expect(row.period_start).toMatch(/^\d{4}-\d{2}-01$/);
  expect(row.period_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(row.actor_id).toBe(FAKE_USER);
});
