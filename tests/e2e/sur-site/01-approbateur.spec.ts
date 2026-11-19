import { mkdirSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { identifiants } from "../parcours/outils";

/*
 * Second membre de la société sur site (scripts/e2e/approbateur-sur-site.sql) : connexion, profil lu dans la
 * base LOCALE par l'API (/api/v1/me), session enregistrée pour les approbations par un tiers.
 */
const ids = identifiants("approbateur");

test("connexion de l'approbateur sur site", async ({ page }) => {
  test.skip(!ids, "identifiants de l'approbateur absents");
  const api = process.env.E2E_API_URL!;
  await page.goto("/login");
  await page.getByPlaceholder("vous@entreprise.com").fill(ids!.email);
  await page.getByPlaceholder("••••••••").fill(ids!.password);
  const moi = page.waitForResponse((r) => r.url().startsWith(api) && r.url().endsWith("/api/v1/me"));
  await page.locator("button[type=submit]").click();
  const r = await moi;
  expect(r.status()).toBe(200);
  expect((await r.json()).tenant?.name, "profil rattaché à la société sur site").toBe("E2E QUOREICH (sur site)");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await expect(page).not.toHaveURL(/\/(login|onboarding)/);
  mkdirSync("test-results-sur-site/.auth", { recursive: true });
  await page.context().storageState({ path: "test-results-sur-site/.auth/approbateur.json" });
});
