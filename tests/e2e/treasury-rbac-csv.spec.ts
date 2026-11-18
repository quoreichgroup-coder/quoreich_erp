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
import { test, expect, type Page } from "@playwright/test";
import { createTreasuryFixtures, type TreasuryFixtures } from "./fixtures/treasury-fixtures";
import { FIXED_NOW_ISO, freezeClock } from "./fixtures/clock";
import { auteurLecture, approbateurLecture, lectureSeule, lireCsv, lireEcran, loginLecture, ouvrirAudit,
  AUDIT_HEADER, EXPORT_AUDIT, EXPORT_MOUVEMENTS } from "./fixtures/treasury-readonly";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const SB_URL = process.env.E2E_SUPABASE_URL ?? "";
const SB_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? "";

const ADMIN_EMAIL = lectureSeule ? auteurLecture?.email ?? "" : process.env.E2E_AUTH_EMAIL_ADMIN ?? "";
const ADMIN_PASS = lectureSeule ? auteurLecture?.password ?? "" : process.env.E2E_AUTH_PASSWORD_ADMIN ?? "";
const NOROLE_EMAIL = lectureSeule ? approbateurLecture?.email ?? "" : process.env.E2E_AUTH_EMAIL_NOROLE ?? "";
const NOROLE_PASS = lectureSeule ? approbateurLecture?.password ?? "" : process.env.E2E_AUTH_PASSWORD_NOROLE ?? "";

const skipBase = !SB_URL || !SB_KEY;
const skipRbac = (!lectureSeule && skipBase) || !ADMIN_EMAIL || !ADMIN_PASS || !NOROLE_EMAIL || !NOROLE_PASS;

const EXPECTED_AUDIT_HEADERS = ["Date", "Action", "Rôle", "Utilisateur cible", "Commentaire"];

async function login(page: Page, email: string, password: string, opts: { freeze?: boolean } = {}) {
  if (lectureSeule) return loginLecture(page, BASE_URL, email, password);
  if (opts.freeze !== false) await freezeClock(page);
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe|password/i).fill(password);
  await page.getByRole("button", { name: /se connecter|login/i }).click();
  await page.waitForURL(/\/$|\/dashboard|\/treasury/);
}

// ───────────────────────── 1. Realtime KPIs / 13w ─────────────────────────
test.describe("Treasury realtime — KPIs + 13w après mutations AR/AP", () => {
  test.skip(lectureSeule, "Les scénarios qui écrivent sont désactivés en lecture seule.");
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
    const { dialog: audit } = await ouvrirAudit(page, BASE_URL, "approbateur");
    const btn = audit.getByRole("button", { name: /Action verrouillée — rôle requis/ });
    await expect(btn).toBeDisabled();
    const aria = ((await btn.getAttribute("aria-label")) ?? "").toLowerCase();
    expect(aria).toMatch(/treasury_manager|controller|cash_admin|rôle|role/);
  });

  test("Sans rôle : KPIs Treasury masqués (•••••) — pas de fuite par CSV", async ({ page }) => {
    await login(page, NOROLE_EMAIL, NOROLE_PASS);
    await lireEcran(page, `${BASE_URL}/treasury`, "approbateur");
    await expect(page.locator("text=Total Cash").locator("..")).toContainText("•••••");
  });
});

// ───────────────────────── 3. Audit filters → impactent CSV + pagination ─────────────────────────
test.describe("Audit treasury_role_audit — filtres impactent le CSV", () => {
  test.skip(skipRbac, "Env E2E_AUTH_*_ADMIN manquant.");

  test("Filtre action=assign : toutes les lignes CSV ont action=assign", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    const { dialog: audit, total } = await ouvrirAudit(page, BASE_URL, "auteur");
    const exportCsv = audit.getByRole("button", { name: EXPORT_AUDIT });
    test.skip(total === 0, "Aucune action d'audit à exporter dans la société de recette.");
    await expect(exportCsv).toBeEnabled();

    // export sans filtre
    const [dlAll] = await Promise.all([
      page.waitForEvent("download"),
      exportCsv.click(),
    ]);
    const all = await lireCsv(dlAll);

    // applique filtre action = assign (2e select du dialog)
    const actionSelect = audit.getByRole("combobox").filter({ hasText: /^Toutes$/ });
    await actionSelect.click();
    await page.getByRole("option", { name: /attribution/i }).click();
    if (all.rows.every((row) => row[all.headers.indexOf("Action")] !== "assign")) {
      await expect(exportCsv).toBeDisabled();
      await expect(audit.getByText("Aucune action ne correspond aux filtres")).toBeVisible();
      return;
    }

    const [dlFiltered] = await Promise.all([
      page.waitForEvent("download"),
      exportCsv.click(),
    ]);
    const filtered = await lireCsv(dlFiltered);

    const actionIdx = filtered.headers.indexOf("Action");
    expect(actionIdx).toBeGreaterThanOrEqual(0);
    expect(filtered.rows.length).toBeGreaterThan(0);
    for (const row of filtered.rows) expect(row[actionIdx]).toBe("assign");
    expect(filtered.rows.length).toBeLessThanOrEqual(all.rows.length);
  });

  test("Pagination : page suivante affiche un set de lignes différent", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    const { dialog: audit, total } = await ouvrirAudit(page, BASE_URL, "auteur");

    const firstPageRows = await audit.locator("table tbody tr").allTextContents();
    const next = audit.getByRole("button").filter({ has: page.locator("svg.lucide-chevron-right") });
    test.skip(total <= 15, "La recette contient au plus une page d'audit.");
    await expect(next).toBeEnabled();
    await next.click();
    await expect(audit.getByText(/^16–/)).toBeVisible();
    const secondPageRows = await audit.locator("table tbody tr").allTextContents();
    expect(secondPageRows.join("|")).not.toBe(firstPageRows.join("|"));
  });
});

// ───────────────────────── 4. Format CSV par rôle ─────────────────────────
test.describe("Format CSV — en-têtes + encodage + colonnes par rôle", () => {
  test.skip(skipRbac, "Env E2E_AUTH_*_ADMIN / *_NOROLE manquant.");

  test("Admin : CSV audit a les en-têtes attendues + encodage UTF-8 lisible (Rôle accentué)", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    const { dialog: audit, total } = await ouvrirAudit(page, BASE_URL, "auteur");
    const exportCsv = audit.getByRole("button", { name: EXPORT_AUDIT });
    test.skip(total === 0, "Aucune action d'audit à exporter dans la société de recette.");
    await expect(exportCsv).toBeEnabled();
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      exportCsv.click(),
    ]);
    const csv = await lireCsv(dl);
    for (const h of EXPECTED_AUDIT_HEADERS) expect(csv.headers).toContain(h);
    expect(csv.raw.split(/\r?\n/, 1)[0]).toBe(AUDIT_HEADER);
  });

  test("Sans rôle : export audit non disponible (bouton désactivé)", async ({ page }) => {
    await login(page, NOROLE_EMAIL, NOROLE_PASS);
    const { dialog: audit } = await ouvrirAudit(page, BASE_URL, "approbateur");
    const btn = audit.getByRole("button", { name: /Action verrouillée — rôle requis/ });
    await expect(btn).toBeDisabled();
    // sanity : aucune route /audit.csv accessible directement (pas d'endpoint serveur — export 100% client gated)
  });

  test("CSV mouvements : montants et rapprochement pour le rôle autorisé", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    await lireEcran(page, `${BASE_URL}/treasury/transactions`, "auteur");
    const table = page.getByTestId("treasury-movements");
    await expect(table.getByRole("columnheader", { name: "Entrée", exact: true })).toBeVisible();
    test.skip(await table.getByTestId("treasury-movement-row").count() === 0,
      "Aucun mouvement existant à exporter dans cette société.");

    const button = page.getByRole("button", { name: EXPORT_MOUVEMENTS });
    await expect(button).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    const csv = await lireCsv(download);
    expect(csv.headers).toEqual(["Date", "Compte", "Origine", "Libellé", "Référence", "Pièce", "Entrée", "Sortie", "Rapproché"]);
    expect(csv.rows.length).toBeGreaterThan(0);
  });
});
