import { mkdirSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { identifiants } from "../parcours/outils";

/* Connexion réelle (identité Supabase), puis contrôle que l'API sur site répond pour ce compte. */
const ids = identifiants();

test("connexion et API sur site joignable", async ({ page }) => {
  test.skip(!ids, "identifiants du compte de test absents");
  const api = process.env.E2E_API_URL!;
  const sante = await page.request.get(`${api}/actuator/health`);
  expect(sante.ok(), `API sur site injoignable (${api})`).toBeTruthy();

  await page.goto("/login");
  await page.getByPlaceholder("vous@entreprise.com").fill(ids!.email);
  await page.getByPlaceholder("••••••••").fill(ids!.password);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await expect(page.getByText("Chargement…")).toHaveCount(0, { timeout: 60_000 });
  await expect(page).not.toHaveURL(/\/(login|onboarding)/);

  // L'API résout la société du porteur dans la base LOCALE.
  const moi = page.waitForResponse((r) => r.url().startsWith(api) && r.url().includes("/api/v1/ar/invoices"));
  await page.goto("/receivables/transactions");
  const r = await moi;
  expect(r.status(), "l'API sur site reconnaît le compte de test").toBe(200);

  mkdirSync("test-results-sur-site/.auth", { recursive: true });
  await page.context().storageState({ path: "test-results-sur-site/.auth/session.json" });
});
