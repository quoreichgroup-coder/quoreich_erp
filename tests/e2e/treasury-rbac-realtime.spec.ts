/**
 * Playwright E2E — Treasury RBAC + Realtime (Lot 2)
 *
 * Couvre :
 *  1. Export CSV de `treasury_role_audit` (filtre action et droits d'export).
 *  2. Masquage des indicateurs et des montants selon le rôle.
 *  3. Rafraîchissement live du forecast 13w + KPIs après mutations `ar_invoices` / `ap_invoices`.
 *
 * Pré-requis : voir tests/e2e/treasury-realtime.spec.ts
 *
 * Variables d'env additionnelles :
 *   E2E_AUTH_EMAIL_NOROLE / E2E_AUTH_PASSWORD_NOROLE  → user sans rôle treasury (test masquage + gating)
 *   E2E_AUTH_EMAIL_ADMIN  / E2E_AUTH_PASSWORD_ADMIN   → user cash_admin (test export + colonnes visibles)
 */
import { test, expect, type Page } from "@playwright/test";
import { createTreasuryFixtures } from "./fixtures/treasury-fixtures";
import { FIXED_NOW_ISO, freezeClock } from "./fixtures/clock";
import {
  approbateurLecture, auteurLecture, EXPORT_AUDIT, lectureSeule, lireCsv, lireEcran, loginLecture, ouvrirAudit,
} from "./fixtures/treasury-readonly";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const SB_URL = process.env.E2E_SUPABASE_URL ?? "";
const SB_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? "";

const ADMIN_EMAIL = (lectureSeule ? auteurLecture?.email : process.env.E2E_AUTH_EMAIL_ADMIN) ?? "";
const ADMIN_PASS = (lectureSeule ? auteurLecture?.password : process.env.E2E_AUTH_PASSWORD_ADMIN) ?? "";
const NOROLE_EMAIL = (lectureSeule ? approbateurLecture?.email : process.env.E2E_AUTH_EMAIL_NOROLE) ?? "";
const NOROLE_PASS = (lectureSeule ? approbateurLecture?.password : process.env.E2E_AUTH_PASSWORD_NOROLE) ?? "";

const skipBase = !SB_URL || !SB_KEY;
const skipRbac = (!lectureSeule && skipBase) || !ADMIN_EMAIL || !ADMIN_PASS || !NOROLE_EMAIL || !NOROLE_PASS;

async function login(page: Page, email: string, password: string) {
  if (lectureSeule) return loginLecture(page, BASE_URL, email, password);
  await freezeClock(page);
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe|password/i).fill(password);
  await page.getByRole("button", { name: /se connecter|login/i }).click();
  await page.waitForURL(/\/$|\/dashboard|\/treasury/);
}

// ───────────────────────── 1. Audit CSV export ─────────────────────────
test.describe("treasury_role_audit — export CSV + filtres + RBAC", () => {
  test.skip(skipRbac, "Env E2E_AUTH_*_ADMIN / *_NOROLE manquant.");

  test("Admin : le filtre Attribution limite aussi l'export CSV", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    const { dialog: audit } = await ouvrirAudit(page, BASE_URL, "auteur");
    await audit.getByRole("combobox").filter({ hasText: /^Toutes$/ }).click();
    await page.getByRole("option", { name: "Attribution", exact: true }).click();
    const exporter = audit.getByRole("button", { name: EXPORT_AUDIT });
    if (!(await exporter.isEnabled())) {
      await expect(audit.getByText(/Aucune action (enregistrée|ne correspond aux filtres)/)).toBeVisible();
      test.skip(true, "Aucune attribution à exporter dans cette société.");
    }
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      exporter.click(),
    ]);
    const csv = await lireCsv(download);
    expect(csv.headers[1]).toBe("Action");
    expect(csv.rows.length).toBeGreaterThan(0);
    expect(csv.rows.every((row) => row[1] === "assign")).toBe(true);
  });

  test("Sans rôle : bouton export désactivé + tooltip RBAC", async ({ page }) => {
    await login(page, NOROLE_EMAIL, NOROLE_PASS);
    const { dialog: audit } = await ouvrirAudit(page, BASE_URL, "approbateur");
    const btn = audit.getByRole("button", { name: /Action verrouillée — rôle requis/ });
    await expect(btn).toBeDisabled();
    const aria = (await btn.getAttribute("aria-label")) ?? "";
    expect(aria.toLowerCase()).toMatch(/rôle|role|treasury_manager|controller|admin/);
  });
});

// ───────────────────────── 2. Masquage colonnes sensibles ─────────────────────────
test.describe("Colonnes sensibles — masquage selon rôle", () => {
  test.skip(skipRbac, "Env E2E_AUTH_*_ADMIN / *_NOROLE manquant.");

  test("Admin : le total et les colonnes Entrée et Sortie sont visibles", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);

    await lireEcran(page, `${BASE_URL}/treasury`, "auteur");
    const totalCard = page.getByText("Trésorerie totale", { exact: true }).locator("..");
    await expect(totalCard).toBeVisible();
    await expect(totalCard).not.toContainText("•••••");

    await lireEcran(page, `${BASE_URL}/treasury/transactions`, "auteur");
    const table = page.getByTestId("treasury-movements");
    await expect(table.getByRole("columnheader", { name: "Entrée", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Sortie", exact: true })).toBeVisible();
  });

  test("Sans droit : indicateurs masqués et colonnes de montant absentes", async ({ page }) => {
    await login(page, NOROLE_EMAIL, NOROLE_PASS);

    await lireEcran(page, `${BASE_URL}/treasury`, "approbateur");
    const totalCard = page.getByText("Trésorerie totale", { exact: true }).locator("..");
    await expect(totalCard).toContainText("•••••");

    await lireEcran(page, `${BASE_URL}/treasury/transactions`, "approbateur");
    const table = page.getByTestId("treasury-movements");
    await expect(table.getByRole("columnheader", { name: "Rapproché", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Entrée", exact: true })).toHaveCount(0);
    await expect(table.getByRole("columnheader", { name: "Sortie", exact: true })).toHaveCount(0);
  });
});

// ───────────────────────── 3. Realtime forecast 13w / KPIs ─────────────────────────
test.describe("Treasury realtime — ar_invoices / ap_invoices", () => {
  test.skip(lectureSeule, "Les scénarios qui écrivent sont désactivés en lecture seule.");
  test.skip(skipRbac, "Env E2E_AUTH_*_ADMIN manquant.");

  test("Insert ar_invoices (fixtures) → 13w forecast + KPIs rafraîchis", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    await page.goto(`${BASE_URL}/treasury`);
    await expect(page.getByText(/total cash/i)).toBeVisible();

    const before = (await page.locator("text=Prévision flux nets").locator("..").textContent()) ?? "";

    const fx = await createTreasuryFixtures({ email: ADMIN_EMAIL, password: ADMIN_PASS }, { now: FIXED_NOW_ISO });
    try {
      await fx.seedArInvoice({ total: 5_000_000 });
      await expect
        .poll(async () => (await page.locator("text=Prévision flux nets").locator("..").textContent()) ?? "", { timeout: 8000 })
        .not.toBe(before);
    } finally {
      await fx.cleanup();
    }
  });

  test("Insert ap_invoices (fixtures) → 13w forecast rafraîchi", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    await page.goto(`${BASE_URL}/treasury`);

    const before = (await page.locator("text=Prévision flux nets").locator("..").textContent()) ?? "";

    const fx = await createTreasuryFixtures({ email: ADMIN_EMAIL, password: ADMIN_PASS }, { now: FIXED_NOW_ISO });
    try {
      await fx.seedApInvoice({ total: 3_000_000 });
      await expect
        .poll(async () => (await page.locator("text=Prévision flux nets").locator("..").textContent()) ?? "", { timeout: 8000 })
        .not.toBe(before);
    } finally {
      await fx.cleanup();
    }
  });
});
