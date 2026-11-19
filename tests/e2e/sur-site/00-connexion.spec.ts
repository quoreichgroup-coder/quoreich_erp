import { mkdirSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { identifiants } from "../parcours/outils";

/* Connexion réelle par l'identité sur site (l'API Java, V114 : compte repris du nuage avec son mot de passe), puis
 * contrôle que l'API répond pour ce compte. Aucune requête ne doit partir vers Supabase. */
const ids = identifiants();

test("connexion et API sur site joignable", async ({ page }) => {
  test.skip(!ids, "identifiants du compte de test absents");
  const api = process.env.E2E_API_URL!;
  const sante = await page.request.get(`${api}/actuator/health`);
  expect(sante.ok(), `API sur site injoignable (${api})`).toBeTruthy();

  const nuage: string[] = [];
  page.on("request", (r) => { if (/supabase\.co\//.test(r.url())) nuage.push(r.url()); });
  await page.goto("/login");
  await page.getByPlaceholder("vous@entreprise.com").fill(ids!.email);
  await page.getByPlaceholder("••••••••").fill(ids!.password);
  const jeton = page.waitForResponse((r) => r.url().startsWith(api) && r.url().includes("/auth/v1/token"));
  await page.locator("button[type=submit]").click();
  expect((await jeton).status(), "connexion par l'identité sur site").toBe(200);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await expect(page.getByText("Chargement…")).toHaveCount(0, { timeout: 60_000 });
  await expect(page).not.toHaveURL(/\/(login|onboarding)/);

  // L'API résout la société du porteur dans la base LOCALE.
  const moi = page.waitForResponse((r) => r.url().startsWith(api) && r.url().includes("/api/v1/ar/invoices"));
  await page.goto("/receivables/transactions");
  const r = await moi;
  expect(r.status(), "l'API sur site reconnaît le compte de test").toBe(200);

  expect(nuage, "aucune requête vers Supabase sur site").toEqual([]);
  mkdirSync("test-results-sur-site/.auth", { recursive: true });
  await page.context().storageState({ path: "test-results-sur-site/.auth/session.json" });
});
