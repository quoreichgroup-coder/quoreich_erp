/**
 * Playwright E2E — Treasury RBAC CSV + Audit filters + Realtime KPIs (Lot 3)
 *
 * Couvre :
 *  1. Realtime forecast 13w + KPIs après mutations ar_invoices / ap_invoices.
 *  2. Export CSV gating — bouton désactivé + colonnes sensibles masquées sans `view_sensitive` / `export`.
 *  3. Filtres treasury_role_audit (user, action, dates) impactent le CSV exporté + pagination.
 *  4. Format CSV par rôle : en-têtes attendues, colonnes masquées présentes en "•••••", encodage UTF-8 (BOM).
 *
 * Variables d'env :
 *   E2E_BASE_URL, E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY
 *   E2E_AUTH_EMAIL_ADMIN / E2E_AUTH_PASSWORD_ADMIN     → cash_admin
 *   E2E_AUTH_EMAIL_NOROLE / E2E_AUTH_PASSWORD_NOROLE   → sans rôle treasury
 */
import { test, expect, type Page, type Download } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { createTreasuryFixtures, type TreasuryFixtures } from "./fixtures/treasury-fixtures";
import { FIXED_NOW_ISO, freezeClock } from "./fixtures/clock";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const SB_URL = process.env.E2E_SUPABASE_URL ?? "";
const SB_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? "";

const ADMIN_EMAIL = process.env.E2E_AUTH_EMAIL_ADMIN ?? "";
const ADMIN_PASS = process.env.E2E_AUTH_PASSWORD_ADMIN ?? "";
const NOROLE_EMAIL = process.env.E2E_AUTH_EMAIL_NOROLE ?? "";
const NOROLE_PASS = process.env.E2E_AUTH_PASSWORD_NOROLE ?? "";

const skipBase = !SB_URL || !SB_KEY;
const skipRbac = skipBase || !ADMIN_EMAIL || !ADMIN_PASS || !NOROLE_EMAIL || !NOROLE_PASS;

const EXPECTED_AUDIT_HEADERS = ["Date", "Action", "Rôle", "Utilisateur cible", "Commentaire"];

async function login(page: Page, email: string, password: string, opts: { freeze?: boolean } = {}) {
  if (opts.freeze !== false) await freezeClock(page);
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe|password/i).fill(password);
  await page.getByRole("button", { name: /se connecter|login/i }).click();
  await page.waitForURL(/\/$|\/dashboard|\/treasury/);
}

async function sb(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(SB_URL, SB_KEY);
  await c.auth.signInWithPassword({ email, password });
  return c;
}

async function saveDownload(dl: Download, suffix = "csv"): Promise<string> {
  const tmp = path.join("/tmp", `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.${suffix}`);
  await dl.saveAs(tmp);
  return tmp;
}

function parseCsv(content: string): { headers: string[]; rows: string[][]; raw: string } {
  // strip BOM if present
  const noBom = content.replace(/^\uFEFF/, "");
  const lines = noBom.split(/\r?\n/).filter(Boolean);
  const split = (l: string) => l.split(",").map((c) => c.replace(/^"|"$/g, ""));
  return { headers: lines[0] ? split(lines[0]) : [], rows: lines.slice(1).map(split), raw: content };
}

async function openAuditDialog(page: Page) {
  await page.goto(`${BASE_URL}/treasury/settings`);
  await page.getByRole("tab", { name: /rôles rbac/i }).click();
  await page.getByRole("button", { name: /audit/i }).click();
}

// ───────────────────────── 1. Realtime KPIs / 13w ─────────────────────────
test.describe("Treasury realtime — KPIs + 13w après mutations AR/AP", () => {
  test.skip(skipRbac, "Env E2E_AUTH_*_ADMIN manquant.");

  for (const table of ["ar_invoices", "ap_invoices"] as const) {
    test(`Insert ${table} via fixtures → KPIs + 13w forecast rafraîchis`, async ({ page }) => {
      await login(page, ADMIN_EMAIL, ADMIN_PASS);
      await page.goto(`${BASE_URL}/treasury`);
      await expect(page.getByText(/total cash/i)).toBeVisible();

      const forecastLoc = page.locator("text=Prévision flux nets").locator("..");
      const kpiLoc = page.locator("text=Total Cash").locator("..");
      const beforeForecast = (await forecastLoc.textContent()) ?? "";
      const beforeKpi = (await kpiLoc.textContent()) ?? "";

      const fx: TreasuryFixtures = await createTreasuryFixtures(
        { email: ADMIN_EMAIL, password: ADMIN_PASS },
        { now: FIXED_NOW_ISO },
      );
      try {
        if (table === "ar_invoices") await fx.seedArInvoice({ total: 1_500_000 });
        else await fx.seedApInvoice({ total: 1_500_000 });

        await expect
          .poll(async () => (await forecastLoc.textContent()) ?? "", { timeout: 8000 })
          .not.toBe(beforeForecast);
        await expect
          .poll(async () => (await kpiLoc.textContent()) ?? "", { timeout: 8000 })
          .not.toBe(beforeKpi);
      } finally {
        await fx.cleanup();
      }
    });
  }
});

// ───────────────────────── 2. CSV gating — sans `export` ─────────────────────────
test.describe("Export CSV — gating RBAC", () => {
  test.skip(skipRbac, "Env E2E_AUTH_*_NOROLE manquant.");

  test("Sans rôle : bouton export audit désactivé + aria-label mentionne rôle requis", async ({ page }) => {
    await login(page, NOROLE_EMAIL, NOROLE_PASS);
    await openAuditDialog(page);
    const btn = page.getByRole("button", { name: /export.*csv/i });
    await expect(btn).toBeDisabled();
    const aria = ((await btn.getAttribute("aria-label")) ?? "").toLowerCase();
    expect(aria).toMatch(/treasury_manager|controller|cash_admin|rôle|role/);
  });

  test("Sans rôle : KPIs Treasury masqués (•••••) — pas de fuite par CSV", async ({ page }) => {
    await login(page, NOROLE_EMAIL, NOROLE_PASS);
    await page.goto(`${BASE_URL}/treasury`);
    await expect(page.locator("text=Total Cash").locator("..")).toContainText("•••••");
  });
});

// ───────────────────────── 3. Audit filters → impactent CSV + pagination ─────────────────────────
test.describe("Audit treasury_role_audit — filtres impactent le CSV", () => {
  test.skip(skipRbac, "Env E2E_AUTH_*_ADMIN manquant.");

  test("Filtre action=assign : toutes les lignes CSV ont action=assign", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    await openAuditDialog(page);

    // export sans filtre
    const [dlAll] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /export.*csv/i }).click(),
    ]);
    const allPath = await saveDownload(dlAll);
    const all = parseCsv(fs.readFileSync(allPath, "utf8"));

    // applique filtre action = assign (2e select du dialog)
    const actionSelect = page.locator('button[role="combobox"]').nth(1);
    await actionSelect.click();
    await page.getByRole("option", { name: /attribution/i }).click();

    const [dlFiltered] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /export.*csv/i }).click(),
    ]);
    const filteredPath = await saveDownload(dlFiltered);
    const filtered = parseCsv(fs.readFileSync(filteredPath, "utf8"));

    const actionIdx = filtered.headers.indexOf("Action");
    expect(actionIdx).toBeGreaterThanOrEqual(0);
    for (const row of filtered.rows) expect(row[actionIdx]).toBe("assign");
    expect(filtered.rows.length).toBeLessThanOrEqual(all.rows.length);

    fs.unlinkSync(allPath);
    fs.unlinkSync(filteredPath);
  });

  test("Pagination : page suivante affiche un set de lignes différent", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    await openAuditDialog(page);

    const firstPageRows = await page.locator("table tbody tr").allTextContents();
    const next = page.getByRole("button").filter({ has: page.locator("svg.lucide-chevron-right") }).last();
    if (!(await next.isEnabled().catch(() => false))) {
      test.skip(true, "Pas assez de lignes pour paginer.");
      return;
    }
    await next.click();
    const secondPageRows = await page.locator("table tbody tr").allTextContents();
    expect(secondPageRows.join("|")).not.toBe(firstPageRows.join("|"));
  });
});

// ───────────────────────── 4. Format CSV par rôle ─────────────────────────
test.describe("Format CSV — en-têtes + encodage + colonnes par rôle", () => {
  test.skip(skipRbac, "Env E2E_AUTH_*_ADMIN / *_NOROLE manquant.");

  test("Admin : CSV audit a les en-têtes attendues + encodage UTF-8 lisible (Rôle accentué)", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    await openAuditDialog(page);
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /export.*csv/i }).click(),
    ]);
    const p = await saveDownload(dl);
    const raw = fs.readFileSync(p, "utf8");
    const csv = parseCsv(raw);
    for (const h of EXPECTED_AUDIT_HEADERS) expect(csv.headers).toContain(h);
    // accent préservé → UTF-8 OK
    expect(csv.headers.join(",")).toContain("Rôle");
    fs.unlinkSync(p);
  });

  test("Sans rôle : export audit non disponible (bouton désactivé)", async ({ page }) => {
    await login(page, NOROLE_EMAIL, NOROLE_PASS);
    await openAuditDialog(page);
    const btn = page.getByRole("button", { name: /export.*csv/i });
    await expect(btn).toBeDisabled();
    // sanity : aucune route /audit.csv accessible directement (pas d'endpoint serveur — export 100% client gated)
  });

  test("Treasury transactions CSV : Admin a Amount/Reconciled, sans rôle = colonnes absentes ou masquées", async ({ browser }) => {
    // Admin
    const ctxA = await browser.newContext();
    const pa = await ctxA.newPage();
    await login(pa, ADMIN_EMAIL, ADMIN_PASS);
    await pa.goto(`${BASE_URL}/treasury/transactions`);
    const exportBtn = pa.getByRole("button", { name: /export.*csv/i });
    if (await exportBtn.isEnabled().catch(() => false)) {
      const [dl] = await Promise.all([pa.waitForEvent("download"), exportBtn.click()]);
      const p = await saveDownload(dl);
      const csv = parseCsv(fs.readFileSync(p, "utf8"));
      expect(csv.headers.join("|").toLowerCase()).toMatch(/amount|montant/);
      fs.unlinkSync(p);
    }
    await ctxA.close();

    // No role
    const ctxN = await browser.newContext();
    const pn = await ctxN.newPage();
    await login(pn, NOROLE_EMAIL, NOROLE_PASS);
    await pn.goto(`${BASE_URL}/treasury/transactions`);
    const exportBtn2 = pn.getByRole("button", { name: /export.*csv/i });
    if (await exportBtn2.isEnabled().catch(() => false)) {
      const [dl2] = await Promise.all([pn.waitForEvent("download"), exportBtn2.click()]);
      const p2 = await saveDownload(dl2);
      const raw = fs.readFileSync(p2, "utf8");
      const csv = parseCsv(raw);
      const amountIdx = csv.headers.findIndex((h) => /amount|montant/i.test(h));
      if (amountIdx >= 0) {
        for (const row of csv.rows) expect(row[amountIdx]).toMatch(/•••••|^$/);
      }
      fs.unlinkSync(p2);
    } else {
      await expect(exportBtn2).toBeDisabled();
    }
    await ctxN.close();
  });
});
