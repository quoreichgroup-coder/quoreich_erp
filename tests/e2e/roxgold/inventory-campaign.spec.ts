import { expect, test, type Page } from "@playwright/test";

const company = "ROXGOLD SANGO";
const interactive = process.env.E2E_ROXGOLD_INTERACTIVE === "1";

async function assertCompany(page: Page, timeout = 15_000) {
  await expect(page.locator("header").getByText(company, { exact: true }),
    "Arrêt : la société active doit être ROXGOLD SANGO.").toBeVisible({ timeout });
}

test("ROXGOLD SANGO : articles, catalogue S3, aperçu de dépôt et rapport ABC réels", async ({ page }) => {
  test.skip(!interactive && !process.env.E2E_ROXGOLD_STATE,
    "Une session explicitement dédiée à ROXGOLD SANGO est requise.");
  await page.goto("/inventory/master-data");
  if (interactive) {
    console.log("Dans la fenêtre Google Chrome for Testing, connectez-vous et sélectionnez ROXGOLD SANGO. Délai : 10 minutes.");
  }
  await assertCompany(page, interactive ? 600_000 : 15_000);
  console.log("Société ROXGOLD SANGO identifiée ; début des contrôles en lecture seule.");
  await page.goto("/inventory/master-data?tab=items");
  await assertCompany(page);
  await expect(page.getByTestId("item-row").first(), "Le catalogue doit contenir un article réel.").toBeVisible();

  await page.goto("/inventory/transactions?tab=campaign-catalog");
  await assertCompany(page);
  await expect(page.getByRole("heading", { name: "Catalogue des campagnes" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Campagnes d’inventaire" })
    .or(page.getByText("Aucune campagne ne correspond aux filtres."))).toBeVisible();

  await page.getByRole("tab", { name: "Inventaires physiques" }).click();
  const depot = page.getByLabel("Dépôt à inventorier");
  await expect(depot.locator('option[value]:not([value=""])').first(), "Un dépôt réel doit être disponible.").toBeAttached();
  const id = await depot.locator('option[value]:not([value=""])').first().getAttribute("value");
  await depot.selectOption(id!);
  await expect(page.getByText(/:\s*\d+ article\(s\)\./).or(page.getByText(/Comptage en cours|Comptage soumis · dépôt gelé/))
    .first()).toBeVisible();

  await page.goto("/inventory/reporting?tab=abc");
  await assertCompany(page);
  await expect(page.getByRole("heading", { name: "Analyse ABC par dépôt" })).toBeVisible();
  await page.getByLabel("Dépôt de l’analyse").selectOption(id!);
  await expect(page.getByText(/article\(s\) analysé\(s\)/)
    .or(page.getByText(/Le classement utilise la règle du tournant/))).toBeVisible();
});
