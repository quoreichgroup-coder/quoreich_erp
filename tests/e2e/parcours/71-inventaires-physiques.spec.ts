import { expect, test, type Locator, type Page } from "@playwright/test";
import { identifiants, verifierSocieteE2E } from "./outils";

test.skip(!identifiants(), "identifiants du compte de test absents");

async function ouvrir(page: Page, url: string) {
  await page.goto(url);
  await verifierSocieteE2E(page, 60_000);
}

async function choisirDepot(depot: Locator) {
  const firstDepot = depot.locator('option[value]:not([value=""])').first();
  await expect(firstDepot).toBeAttached();
  await depot.selectOption((await firstDepot.getAttribute("value"))!);
}

test("S3 connecté : catalogue des campagnes", async ({ page }) => {
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/rpc/inventory_campaign_catalog"), { timeout: 75_000 }),
    ouvrir(page, "/inventory/transactions?tab=campaign-catalog"),
  ]);
  await expect(page.getByRole("heading", { name: "Catalogue des campagnes" })).toBeVisible();
  expect(response.ok(), `Catalogue des campagnes (HTTP ${response.status()})`).toBe(true);
  await expect(page.getByRole("table", { name: "Campagnes d’inventaire" })
    .or(page.getByText("Aucune campagne ne correspond aux filtres."))).toBeVisible();
});

test("S3 connecté : aperçu du dépôt", async ({ page }) => {
  await ouvrir(page, "/inventory/transactions?tab=campaigns");
  await choisirDepot(page.getByLabel("Dépôt à inventorier", { exact: true }));
  await expect(page.getByText(/:\s*\d+ article\(s\)\./)
    .or(page.getByText(/Comptage en cours|Comptage soumis · dépôt gelé/)).first()).toBeVisible();
});

test("S3 connecté : analyse ABC", async ({ page }) => {
  await ouvrir(page, "/inventory/reporting?tab=abc");
  await expect(page.getByRole("heading", { name: "Analyse ABC par dépôt" })).toBeVisible();
  await choisirDepot(page.getByLabel("Dépôt de l’analyse"));
  await expect(page.getByText(/article\(s\) analysé\(s\)/)
    .or(page.getByText(/Le classement utilise la règle du tournant/))).toBeVisible();
});
