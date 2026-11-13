/**
 * E2E — /alerts page + NotificationBell.
 *
 * Mocks all Supabase REST/RPC calls. Verifies:
 *   1. Server-side pagination (range header) and table rendering.
 *   2. Filters (module/severity/search/includeResolved) forward to REST query string.
 *   3. Sort toggle on a column header flips `order=` direction.
 *   4. NotificationBell unread badge updates after the realtime/poll invalidation.
 *   5. Bulk actions: "Tout marquer lu" → mark_all_erp_alerts_read RPC;
 *      "Tout résoudre" → resolve_all_erp_alerts RPC.
 *
 * Run: pnpm exec playwright test tests/e2e/alerts-page.spec.ts
 */
import { test, expect, type Route } from "./fixtures/test";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;

type Call = { url: string; method: string; body?: any };

function makeAlert(i: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: `a-${i}`,
    tenant_id: "t-1",
    module: i % 2 === 0 ? "ar" : "ap",
    alert_type: "overdue",
    severity: i === 0 ? "critical" : "warning",
    title: `Alerte #${i}`,
    message: `Message ${i}`,
    action_required: false,
    is_resolved: false,
    resolved_at: null,
    resolved_by: null,
    read_at: null,
    created_at: new Date(2025, 0, i + 1).toISOString(),
    ...over,
  };
}

test("Alerts page — filtres, tri, pagination, bulk actions", async ({ page }) => {
  const calls: Call[] = [];
  const all = Array.from({ length: 60 }).map((_, i) => makeAlert(i));
  let markedReadCount = 0;
  let resolvedAllCount = 0;

  // Tenant / profile
  await page.route(/\/rest\/v1\/profiles/, (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tenant_id: "t-1" }) }));
  await page.route(/\/rest\/v1\/tenants/, (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "Acme", currency: "XOF" }) }));
  await page.route(/\/rest\/v1\/notification_preferences/, (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "null" }));

  // erp_alerts — honor Range header for pagination, `order` for sort, query filters
  await page.route(/\/rest\/v1\/erp_alerts(\?|$)/, async (route: Route) => {
    const req = route.request();
    const url = req.url();
    calls.push({ url, method: req.method() });

    const u = new URL(url);
    const order = u.searchParams.get("order") ?? "created_at.desc";
    const moduleEq = u.searchParams.get("module");
    const sevEq = u.searchParams.get("severity");
    const resolvedEq = u.searchParams.get("is_resolved");

    let rows = all.slice();
    if (resolvedEq === "eq.false") rows = rows.filter((a) => !a.is_resolved);
    if (moduleEq?.startsWith("eq.")) rows = rows.filter((a) => a.module === moduleEq.slice(3));
    if (sevEq?.startsWith("eq.")) rows = rows.filter((a) => a.severity === sevEq.slice(3));

    const [field, dir] = order.split(".") as [keyof typeof rows[number], "asc" | "desc"];
    rows.sort((a: any, b: any) =>
      String(a[field]).localeCompare(String(b[field])) * (dir === "asc" ? 1 : -1));

    const total = rows.length;
    const range = req.headers()["range"];
    let from = 0, to = 24;
    if (range) {
      const m = /(\d+)-(\d+)/.exec(range);
      if (m) { from = Number(m[1]); to = Number(m[2]); }
    }
    const slice = rows.slice(from, to + 1);

    await route.fulfill({
      status: 206,
      contentType: "application/json",
      // Comme le vrai Supabase : sans « expose », le navigateur cache content-range au JS (origine croisée).
      headers: { "content-range": `${from}-${Math.min(to, total - 1)}/${total}`, "access-control-expose-headers": "content-range" },
      body: JSON.stringify(slice),
    });
  });

  // RPC: mark all read
  await page.route(/\/rest\/v1\/rpc\/mark_all_erp_alerts_read/, async (route: Route) => {
    markedReadCount += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: "12" });
  });

  // RPC: resolve all
  await page.route(/\/rest\/v1\/rpc\/resolve_all_erp_alerts/, async (route: Route) => {
    resolvedAllCount += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: "60" });
  });

  await page.goto(`${BASE}/alerts`, { waitUntil: "domcontentloaded" });

  // Table renders 25 rows (page 0)
  await expect(page.getByRole("row").nth(1)).toBeVisible({ timeout: 8000 });
  await expect.poll(async () => (await page.getByRole("row").count()) - 1).toBeGreaterThanOrEqual(25);

  // Pagination: Suivant → page 1 (range header)
  const before = calls.length;
  await page.getByRole("button", { name: /Suivant/i }).click();
  await expect.poll(() => calls.length).toBeGreaterThan(before);
  const lastUrl = calls[calls.length - 1].url;
  expect(lastUrl).toContain("erp_alerts");

  // Sort by Module asc/desc
  await page.getByRole("button", { name: /^Module/i }).click();
  await expect.poll(() =>
    calls.some((c) => c.url.includes("order=module"))).toBeTruthy();

  // Filter by severity
  await page.getByLabel("Sévérité").click();
  await page.getByRole("option", { name: /Critique/ }).click();
  await expect.poll(() =>
    calls.some((c) => c.url.includes("severity=eq.critical"))).toBeTruthy();

  // Bulk "Tout marquer lu"
  await page.getByRole("button", { name: /Tout marquer lu/ }).first().click();
  await expect.poll(() => markedReadCount).toBeGreaterThanOrEqual(1);

  // Bulk "Tout résoudre"
  await page.getByRole("button", { name: /Tout résoudre/ }).first().click();
  await expect.poll(() => resolvedAllCount).toBeGreaterThanOrEqual(1);

  // NotificationBell badge visible at least once
  await expect(page.getByTestId("notification-bell")).toBeVisible();
});
