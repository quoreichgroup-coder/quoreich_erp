/**
 * Playwright E2E — Treasury realtime invalidation
 *
 * Vérifie que les écrans Treasury (Dashboard + Master Data) se rafraîchissent
 * automatiquement après mutations sur `bank_statements` et `cashflow_forecasts`
 * via Supabase Realtime (hook `useRealtimeInvalidation`).
 *
 * Pré-requis :
 *   npm i -D @playwright/test
 *   npx playwright install chromium
 *
 * Variables d'environnement :
 *   E2E_BASE_URL      → URL du preview (ex. http://localhost:8080)
 *   E2E_SUPABASE_URL  → URL Supabase (anon key déjà dans le client)
 *   E2E_AUTH_EMAIL    → utilisateur ayant rôle treasury_manager
 *   E2E_AUTH_PASSWORD → mot de passe associé
 *
 * Lancer : npx playwright test tests/e2e/treasury-realtime.spec.ts
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const SB_URL = process.env.E2E_SUPABASE_URL ?? "";
const SB_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? "";
const EMAIL = process.env.E2E_AUTH_EMAIL ?? "";
const PASSWORD = process.env.E2E_AUTH_PASSWORD ?? "";

const skipIfNoEnv = !SB_URL || !SB_KEY || !EMAIL || !PASSWORD;

test.describe("Treasury realtime", () => {
  test.skip(skipIfNoEnv, "Variables E2E_* manquantes — voir en-tête du fichier.");

  test("Dashboard se met à jour après insert sur cashflow_forecasts", async ({ page }) => {
    // 1. Login UI
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/mot de passe|password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /se connecter|login/i }).click();
    await page.waitForURL(/\/$|\/dashboard|\/treasury/);

    // 2. Va sur Treasury
    await page.goto(`${BASE_URL}/treasury`);
    await expect(page.getByText("Treasury Overview")).toBeVisible();

    // 3. Mutation directe via Supabase (simule import/écriture côté DB)
    const sb = createClient(SB_URL, SB_KEY);
    await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const iso = weekStart.toISOString().slice(0, 10);

    const before = await page.locator("text=Prévision flux nets").textContent();

    const { error } = await sb.from("cashflow_forecasts").insert({
      week_start: iso,
      category: "test_e2e",
      direction: "inflow",
      amount_forecast: 1_234_567,
      source: "manual",
    });
    expect(error).toBeNull();

    // 4. Le widget doit refléter la nouvelle donnée sous 5s (realtime)
    await expect
      .poll(async () => (await page.locator("text=Prévision flux nets").textContent()) ?? "", { timeout: 5000 })
      .not.toBe(before);

    // cleanup
    await sb.from("cashflow_forecasts").delete().eq("category", "test_e2e");
  });

  test("Master Data se met à jour après insert sur bank_statements", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/mot de passe|password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /se connecter|login/i }).click();

    await page.goto(`${BASE_URL}/treasury/master-data`);

    const sb = createClient(SB_URL, SB_KEY);
    await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });

    const { data: accounts } = await sb.from("bank_accounts").select("id").limit(1);
    const acctId = accounts?.[0]?.id;
    test.skip(!acctId, "Aucun compte bancaire pour le test.");

    const { data: inserted, error } = await sb
      .from("bank_statements")
      .insert({
        bank_account_id: acctId!,
        statement_date: new Date().toISOString().slice(0, 10),
        period_start: new Date().toISOString().slice(0, 10),
        period_end: new Date().toISOString().slice(0, 10),
        opening_balance: 0,
        closing_balance: 0,
        file_name: "e2e-test.csv",
        status: "pending",
      })
      .select()
      .single();
    expect(error).toBeNull();

    await expect(page.getByText("e2e-test.csv")).toBeVisible({ timeout: 5000 });

    if (inserted?.id) await sb.from("bank_statements").delete().eq("id", inserted.id);
  });
});
