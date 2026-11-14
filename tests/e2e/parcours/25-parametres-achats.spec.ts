import { test, expect } from "@playwright/test";
import { identifiants, surveiller, dernierToast } from "./outils";

/*
 * V57 : les règles des achats se paramètrent à l'écran (aucune n'est figée dans le code). Le parcours
 * modifie la tolérance de retard et un interrupteur, vérifie qu'ils sont conservés, puis rétablit les
 * valeurs par défaut pour ne pas influencer les autres parcours.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("paramètres des achats : contrôles et suivi modifiables, conservés, rétablis", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const onglet = async () => {
    await page.goto("/procurement/settings");
    await page.getByRole("button", { name: "Contrôles et suivi" }).click();
  };

  obs.etape("modification");
  await onglet();
  await expect(page.getByLabel("Double contrôle des coordonnées bancaires")).toBeChecked();
  await page.getByLabel("Tolérance avant « en retard » (jours)").fill("400");
  await expect(page.getByRole("alert")).toContainText("365");
  await page.getByLabel("Tolérance avant « en retard » (jours)").fill("3");
  await page.getByLabel("Chèque").check();
  await page.getByLabel("Stock prévisionnel : déduire les commandes clients non livrées").click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  testInfo.annotations.push({ type: "enregistrement", description: await dernierToast(page) });

  obs.etape("valeurs conservées après rechargement");
  await onglet();
  await expect(page.getByLabel("Tolérance avant « en retard » (jours)")).toHaveValue("3");
  await expect(page.getByLabel("Chèque")).toBeChecked();
  await expect(page.getByLabel("Stock prévisionnel : déduire les commandes clients non livrées")).not.toBeChecked();

  obs.etape("valeurs par défaut rétablies");
  await page.getByLabel("Tolérance avant « en retard » (jours)").fill("0");
  await page.getByLabel("Chèque").uncheck();
  await page.getByLabel("Stock prévisionnel : déduire les commandes clients non livrées").click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await dernierToast(page);
  await onglet();
  await expect(page.getByLabel("Tolérance avant « en retard » (jours)")).toHaveValue("0");
  await expect(page.getByLabel("Stock prévisionnel : déduire les commandes clients non livrées")).toBeChecked();

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
