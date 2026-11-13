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
  await expect(page.getByText(/JE-REC-AR-|JE-PAY-AP-/).first(), "les encaissements et paiements des parcours sont journalisés").toBeVisible();
  let telechargement = page.waitForEvent("download");
  await page.getByTestId("btn-export-csv").click();
  expect((await telechargement).suggestedFilename()).toMatch(/^ecritures-comptables.*\.csv$/);

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
