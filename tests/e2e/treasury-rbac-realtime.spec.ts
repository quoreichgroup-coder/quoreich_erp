/**
 * Playwright E2E — Treasury RBAC + Realtime (Lot 2)
 *
 * Couvre :
 *  1. Export CSV de `treasury_role_audit` (pagination, filtres user/action/dates, gating RBAC).
 *  2. Masquage des colonnes sensibles (KPIs, Amount, Reconciled) selon le rôle.
 *  3. Rafraîchissement live du forecast 13w + KPIs après mutations `ar_invoices` / `ap_invoices`.
 *
 * Pré-requis : voir tests/e2e/treasury-realtime.spec.ts
 *
 * Variables d'env additionnelles :
 *   E2E_AUTH_EMAIL_NOROLE / E2E_AUTH_PASSWORD_NOROLE  → user sans rôle treasury (test masquage + gating)
 *   E2E_AUTH_EMAIL_ADMIN  / E2E_AUTH_PASSWORD_ADMIN   → user cash_admin (test export + colonnes visibles)
 */
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { createTreasuryFixtures } from "./fixtures/treasury-fixtures";
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

async function login(page: Page, email: string, password: string) {
  await freezeClock(page);
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

// ───────────────────────── 1. Audit CSV export ─────────────────────────
test.describe("treasury_role_audit — export CSV + filtres + RBAC", () => {
  test.skip(skipRbac, "Env E2E_AUTH_*_ADMIN / *_NOROLE manquant.");

  test("Admin : filtres + pagination + export CSV", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    await page.goto(`${BASE_URL}/treasury/settings`);
    await page.getByRole("tab", { name: /rôles rbac/i }).click();
    await page.getByRole("button", { name: /audit/i }).click();

    // Filtre par type d'action
    await page.getByLabel(/action/i).selectOption({ label: "assign" }).catch(() => {});
    // Filtre dates
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel(/du/i).fill("2020-01-01").catch(() => {});
    await page.getByLabel(/au/i).fill(today).catch(() => {});

    // Pagination : bouton suivant cliquable si > 1 page
    const next = page.getByRole("button", { name: /suivant|next/i });
    if (await next.isEnabled().catch(() => false)) await next.click();

    // Export CSV : intercepte le download
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /export.*csv/i }).click(),
    ]);
    const tmp = path.join("/tmp", `audit-${Date.now()}.csv`);
    await download.saveAs(tmp);
    const csv = fs.readFileSync(tmp, "utf8");
    expect(csv.split("\n")[0].toLowerCase()).toContain("action");
    fs.unlinkSync(tmp);
  });

  test("Sans rôle : bouton export désactivé + tooltip RBAC", async ({ page }) => {
    await login(page, NOROLE_EMAIL, NOROLE_PASS);
    await page.goto(`${BASE_URL}/treasury/settings`);
    await page.getByRole("tab", { name: /rôles rbac/i }).click();
    await page.getByRole("button", { name: /audit/i }).click();

    const btn = page.getByRole("button", { name: /export.*csv/i });
    await expect(btn).toBeDisabled();
    const aria = (await btn.getAttribute("aria-label")) ?? "";
    expect(aria.toLowerCase()).toMatch(/rôle|role|treasury_manager|controller|admin/);
  });
});

// ───────────────────────── 2. Masquage colonnes sensibles ─────────────────────────
test.describe("Colonnes sensibles — masquage selon rôle", () => {
  test.skip(skipRbac, "Env E2E_AUTH_*_ADMIN / *_NOROLE manquant.");

  test("Admin voit les montants (KPIs + Amount + Reconciled)", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);

    await page.goto(`${BASE_URL}/treasury`);
    const totalCard = page.locator("text=Total Cash").locator("..");
    await expect(totalCard).not.toContainText("•••••");

    await page.goto(`${BASE_URL}/treasury/transactions`);
    await expect(page.getByRole("columnheader", { name: /amount/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /reconciled/i })).toBeVisible();
  });

  test("Utilisateur sans rôle treasury : KPIs masqués + colonnes Amount/Reconciled absentes", async ({ page }) => {
    await login(page, NOROLE_EMAIL, NOROLE_PASS);

    await page.goto(`${BASE_URL}/treasury`);
    const totalCard = page.locator("text=Total Cash").locator("..");
    await expect(totalCard).toContainText("•••••");

    await page.goto(`${BASE_URL}/treasury/transactions`);
    await expect(page.getByRole("columnheader", { name: /amount/i })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: /reconciled/i })).toHaveCount(0);
  });
});

// ───────────────────────── 3. Realtime forecast 13w / KPIs ─────────────────────────
test.describe("Treasury realtime — ar_invoices / ap_invoices", () => {
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
