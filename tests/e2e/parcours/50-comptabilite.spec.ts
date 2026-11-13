import { test, expect } from "@playwright/test";
import { identifiants, surveiller } from "./outils";

/*
 * Comptabilité générale, après les parcours précédents : journal des écritures et états (balance,
 * compte de résultat, bilan) lisibles et exportables, avec les mêmes données que l'écran.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("journal des écritures et états comptables : affichage et exports", async ({ page }, testInfo) => {
  const obs = surveiller(page);

  obs.etape("journal des écritures");
  await page.goto("/journal");
  await expect(page.getByText(/BQ-\d{4}-\d{6}/).first(), "encaissements et paiements au journal de banque, avec leur numéro de pièce").toBeVisible();
  let telechargement = page.waitForEvent("download");
  await page.getByTestId("btn-export-csv").click();
  expect((await telechargement).suggestedFilename()).toMatch(/^ecritures-comptables.*\.csv$/);

  obs.etape("numéros de pièce par journal (V38)");
  await page.getByPlaceholder(/Rechercher|Search/i).first().fill("AC-");
  await expect(page.getByText(/AC-\d{4}-\d{6}/).first(), "factures fournisseurs au journal des achats").toBeVisible();
  await page.getByPlaceholder(/Rechercher|Search/i).first().fill("");

  obs.etape("lots du grand livre alimentés par les livres auxiliaires (V38)");
  await page.goto("/payables/transactions");
  await expect(page.getByText(/LOT-AC-\d{4}-\d{2}/).first(), "lot du journal des achats").toBeVisible();
  await page.goto("/receivables/transactions");
  await expect(page.getByText(/LOT-VT-\d{4}-\d{2}/).first(), "lot du journal des ventes").toBeVisible();
  await expect(page.getByText(/LOT-BQ-\d{4}-\d{2}/).first(), "lot du journal de banque").toBeVisible();

  obs.etape("balance de vérification");
  await page.goto("/journal/reporting");
  await expect(page.getByRole("heading", { name: "Balance de Vérification" })).toBeVisible();
  await expect(page.getByText("411").first()).toBeVisible();
  telechargement = page.waitForEvent("download");
  await page.getByTestId("btn-export-gl-0").click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toMatch(/^balance-de-verification.*\.csv$/);
  testInfo.annotations.push({ type: "export", description: fichier.suggestedFilename() });

  await obs.joindre(testInfo);
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});
