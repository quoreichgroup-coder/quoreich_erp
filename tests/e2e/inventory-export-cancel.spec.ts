/**
 * E2E — Inventory Reporting export cancellation.
 *
 * Verifies that cancelling an in-flight CSV/PDF export:
 *   1. Surfaces a toast labelled « Export annulé ».
 *   2. Does NOT trigger a file download (cancellation = no file).
 *   3. Inserts an `inventory_role_audit` row with action=export_aborted
 *      whose `comment` JSON contains the URL filters that were active.
 *
 * Run with:
 *   pnpm exec playwright test tests/e2e/inventory-export-cancel.spec.ts
 */
import { test, expect, type Route } from "./fixtures/test";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;

const FILTERS = { q: "2025-", from: "2025-01-01", to: "2025-12-31", sk: "closed_at", sd: "desc" };
const URL_WITH_FILTERS =
  `${BASE}/inventory/reporting` +
  `?q=${FILTERS.q}&from=${FILTERS.from}&to=${FILTERS.to}&sk=${FILTERS.sk}&sd=${FILTERS.sd}&ps=10&p=1`;

function fakeClose(i: number) {
  return {
    id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    period: `2025-${String((i % 12) + 1).padStart(2, "0")}`,
    closed_at: `2025-${String((i % 12) + 1).padStart(2, "0")}-15T10:00:00Z`,
    closed_by: "tester",
    total_value: 1000 + i,
    total_qty: 10 + i,
    items_count: 5,
    snapshot: [],
  };
}

test("cancelling an in-flight export shows the cancel toast and logs export_aborted with URL filters", async ({ page, context }) => {
  const auditInserts: Array<Record<string, unknown>> = [];
  let pagedCalls = 0;

  await context.route(/inventory_period_closes/, async (route: Route) => {
    pagedCalls += 1;
    const range = route.request().headers()["range"];
    // First call satisfies the page render fast; subsequent bulk-export pages stall
    // long enough for the user (test) to click "Annuler".
    const isInitial = pagedCalls === 1;
    const rows = Array.from({ length: 50 }, (_, i) => fakeClose(i));
    let start = 0;
    let end = rows.length - 1;
    if (range) {
      const m = range.match(/(\d+)-(\d+)/);
      if (m) { start = Number(m[1]); end = Math.min(Number(m[2]), rows.length - 1); }
    }
    if (!isInitial) await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({
      status: 206,
      headers: { "content-type": "application/json", "access-control-expose-headers": "content-range", "content-range": `${start}-${end}/${rows.length}` },
      body: JSON.stringify(rows.slice(start, end + 1)),
    });
  });

  await context.route(/inventory_role_audit/, async (route: Route) => {
    if (route.request().method() === "POST") {
      try { auditInserts.push(JSON.parse(route.request().postData() ?? "{}")); } catch { /* ignore */ }
      await route.fulfill({ status: 201, headers: { "content-type": "application/json" }, body: "[]" });
      return;
    }
    await route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: "[]" });
  });

  await page.goto(URL_WITH_FILTERS);
  await expect(page.getByTestId("close-history-table")).toBeVisible();

  // Track downloads — there must be none after cancellation.
  let downloadOccurred = false;
  page.on("download", () => { downloadOccurred = true; });

  // Start CSV export, then cancel before the bulk fetch resolves.
  await page.getByTestId("export-csv").click();
  await page.getByTestId("cancel-export").click();

  // Cancel toast: "Export CSV annulé — N ligne(s) chargée(s)"
  await expect(page.getByText(/Export\s+CSV\s+annul/i)).toBeVisible({ timeout: 5_000 });

  // Give the audit insert a moment to flush.
  await page.waitForTimeout(300);
  expect(downloadOccurred).toBe(false);

  const aborted = auditInserts.find((r) => r.action === "export_aborted");
  expect(aborted, "expected export_aborted audit row").toBeTruthy();
  const comment = String(aborted?.comment ?? "");
  expect(comment).toContain("historique-clotures");
  // Filters from the URL must be embedded in the audit JSON payload.
  expect(comment).toContain(`"from":"${FILTERS.from}"`);
  expect(comment).toContain(`"to":"${FILTERS.to}"`);
  expect(comment).toContain(`"sortKey":"${FILTERS.sk}"`);
  expect(comment).toContain(`"sortDir":"${FILTERS.sd}"`);
});
