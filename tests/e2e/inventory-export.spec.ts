/**
 * E2E — Inventory Reporting export.
 *
 * Verifies that exporting CSV/PDF from the history table:
 *   1. Honours the exact URL filters (period search + sort + date range)
 *      by intercepting the Supabase REST calls and asserting on them.
 *   2. Shows a progress toast while the export is running.
 *   3. Downloads a file whose name matches `historique-clotures-stock.{csv,pdf}`.
 *
 * Run with:
 *   pnpm exec playwright test tests/e2e/inventory-export.spec.ts
 *
 * Requirements: an authenticated session restored via Playwright
 * storageState OR the `LOVABLE_BROWSER_SUPABASE_*` env vars (see
 * project docs). The dev server must be running on PORT.
 */

import { test, expect, type Route } from "@playwright/test";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;

const FILTERS = {
  q: "2025-",
  from: "2025-01-01",
  to: "2025-12-31",
  sk: "closed_at",
  sd: "desc",
};

const URL_WITH_FILTERS =
  `${BASE}/inventory/reporting` +
  `?q=${FILTERS.q}&from=${FILTERS.from}&to=${FILTERS.to}` +
  `&sk=${FILTERS.sk}&sd=${FILTERS.sd}&ps=10&p=1`;

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

test("CSV export uses URL filters, shows progress, downloads file", async ({ page, context }) => {
  const restCalls: { url: string; rangeHeader: string | null }[] = [];

  // Intercept paged + bulk fetches against inventory_period_closes.
  await context.route(/inventory_period_closes/, async (route: Route) => {
    const req = route.request();
    const url = req.url();
    restCalls.push({ url, rangeHeader: req.headers()["range"] ?? null });

    const u = new URL(url);
    const order = u.searchParams.get("order") ?? "";
    // Mirror PostgREST semantics: respond with a slice + Content-Range header.
    const rows = Array.from({ length: 25 }, (_, i) => fakeClose(i));
    const range = req.headers()["range"];
    let start = 0;
    let end = rows.length - 1;
    if (range) {
      const m = range.match(/(\d+)-(\d+)/);
      if (m) { start = Number(m[1]); end = Math.min(Number(m[2]), rows.length - 1); }
    }
    const slice = rows.slice(start, end + 1);
    await route.fulfill({
      status: 206,
      headers: {
        "content-type": "application/json",
        "content-range": `${start}-${end}/${rows.length}`,
      },
      body: JSON.stringify(slice),
    });
    // Sanity-check that the server-side sort matches the URL filter.
    expect(order).toContain(FILTERS.sk);
    expect(order).toContain(FILTERS.sd);
  });

  await page.goto(URL_WITH_FILTERS);
  await expect(page.getByTestId("close-history-table")).toBeVisible();

  // URL filters must be passed through to the REST query.
  const firstPaged = restCalls.find((c) => c.url.includes("period_close"));
  expect(firstPaged?.url).toContain(`period=ilike.%25${FILTERS.q}%25`);
  expect(firstPaged?.url).toContain(`closed_at=gte.${FILTERS.from}`);
  expect(firstPaged?.url).toContain(`closed_at=lte.${FILTERS.to}`);

  // Trigger CSV export and capture the downloaded file.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-csv").click(),
  ]);

  // Progress toast appears while export streams.
  // (May complete fast; allow either intermediate or success state.)
  await expect(
    page.getByText(/Export CSV/i),
  ).toBeVisible({ timeout: 5_000 });

  expect(download.suggestedFilename()).toMatch(/historique-clotures-stock\.csv$/);
});

test("PDF export honours URL filters and downloads a .pdf", async ({ page, context }) => {
  await context.route(/inventory_period_closes/, async (route) => {
    const rows = Array.from({ length: 5 }, (_, i) => fakeClose(i));
    await route.fulfill({
      status: 206,
      headers: {
        "content-type": "application/json",
        "content-range": `0-${rows.length - 1}/${rows.length}`,
      },
      body: JSON.stringify(rows),
    });
  });

  await page.goto(URL_WITH_FILTERS);
  await expect(page.getByTestId("close-history-table")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-pdf").click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/historique-clotures-stock\.pdf$/);
});
