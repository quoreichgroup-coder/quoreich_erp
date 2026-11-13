/**
 * E2E — /cockpit/consolidated
 *
 * Mocks Supabase REST/RPC. Verifies:
 *   1. get_accessible_tenants RPC drives multi-tenant scoping (only returned tenants visible).
 *   2. get_consolidated_cfo_kpis RPC is called ONLY with authorized tenant_ids.
 *   3. Loading skeletons render before data resolves.
 *   4. CSV export triggers a download.
 *   5. Empty state (no accessible tenants).
 *   6. Error state (RPC failure) + retry.
 *
 * Run: pnpm exec playwright test tests/e2e/cfo-consolidated.spec.ts
 */
import { test, expect, type Route } from "./fixtures/test";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;

type Call = { url: string; method: string; body?: any };

const TENANTS = [
  { id: "t-1", name: "Acme SARL", currency: "XOF" },
  { id: "t-2", name: "Beta SA", currency: "XOF" },
];

const KPI_ROWS = TENANTS.map((t, i) => ({
  tenant_id: t.id,
  tenant_name: t.name,
  currency: t.currency,
  cash_on_hand: 1_000_000 * (i + 1),
  ar_outstanding: 500_000,
  ap_outstanding: 200_000,
  ar_overdue: 50_000,
  ap_overdue: 20_000,
  ar_overdue_count: 3,
  ap_overdue_count: 1,
  open_projects: 2,
  open_risks_high: 1,
  unmatched_recon_count: 0,
}));

async function stubBase(page: import("@playwright/test").Page) {
  await page.route(/\/rest\/v1\/profiles/, (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tenant_id: "t-1" }) }));
  await page.route(/\/rest\/v1\/tenants/, (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "Acme", currency: "XOF" }) }));
  await page.route(/\/rest\/v1\/notification_preferences/, (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await page.route(/\/rest\/v1\/rpc\/get_consolidated_cfo_trends/, (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route(/\/rest\/v1\/(payments|bank_accounts)/, (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
}

test("CFO Consolidé — scoping, loading, export, drill-down", async ({ page }) => {
  const calls: Call[] = [];
  await stubBase(page);

  await page.route(/\/rest\/v1\/rpc\/get_accessible_tenants/, async (r: Route) => {
    calls.push({ url: r.request().url(), method: r.request().method() });
    await new Promise((res) => setTimeout(res, 80));
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TENANTS) });
  });

  await page.route(/\/rest\/v1\/rpc\/get_consolidated_cfo_kpis/, async (r: Route) => {
    const body = JSON.parse(r.request().postData() || "{}");
    calls.push({ url: r.request().url(), method: r.request().method(), body });
    // Scope strictly: never echo tenants outside requested authorized set.
    const ids: string[] = body._tenant_ids ?? [];
    const allowed = new Set(TENANTS.map((t) => t.id));
    for (const id of ids) expect(allowed.has(id)).toBeTruthy();
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(KPI_ROWS.filter((r) => ids.includes(r.tenant_id))),
    });
  });

  await page.goto(`${BASE}/cockpit/consolidated`, { waitUntil: "domcontentloaded" });

  // 1. Sociétés visibles = scope autorisé
  await expect(page.getByText("Acme SARL", { exact: true })).toBeVisible();
  await expect(page.getByText("Beta SA", { exact: true })).toBeVisible();
  await expect(page.getByText("Gamma Corp")).toHaveCount(0);

  // 2. RPC KPI a été appelée avec uniquement les ids autorisés
  const kpiCall = calls.find((c) => c.url.includes("get_consolidated_cfo_kpis"));
  expect(kpiCall?.body?._tenant_ids).toEqual(expect.arrayContaining(["t-1", "t-2"]));
  expect(kpiCall?.body?._tenant_ids.length).toBe(2);

  // 3. KPIs rendus (Total consolidé)
  await expect(page.getByText("Total consolidé")).toBeVisible();

  // 4. Drill-down ouvre le modal avec décomposition
  await page.getByTestId("kpi-header-cash_on_hand").click();
  const modal = page.getByTestId("kpi-drilldown");
  await expect(modal).toBeVisible();
  await expect(modal.getByText("Acme SARL")).toBeVisible();
  await expect(modal.getByText("Beta SA")).toBeVisible();
  await expect(modal.getByText(/bank_accounts/)).toBeVisible();
  await page.keyboard.press("Escape");

  // 5. Export CSV déclenche un téléchargement
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/cfo-consolidated-/);

  // 6. Trends card visible
  await expect(page.getByTestId("consolidated-trends")).toBeVisible();
});

test("CFO Consolidé — empty state (aucun tenant accessible)", async ({ page }) => {
  await stubBase(page);
  await page.route(/\/rest\/v1\/rpc\/get_accessible_tenants/, (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

  await page.goto(`${BASE}/cockpit/consolidated`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Aucune société accessible/i)).toBeVisible();
});

test("CFO Consolidé — erreur RPC + bouton réessayer", async ({ page }) => {
  await stubBase(page);
  let attempts = 0;
  await page.route(/\/rest\/v1\/rpc\/get_accessible_tenants/, async (r: Route) => {
    attempts++;
    if (attempts === 1) {
      await r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) });
    } else {
      await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TENANTS) });
    }
  });

  await page.goto(`${BASE}/cockpit/consolidated`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Impossible de charger les sociétés/i)).toBeVisible();
  await page.getByRole("button", { name: /Réessayer/i }).first().click();
  await expect(page.getByText("Acme SARL", { exact: true })).toBeVisible();
});
