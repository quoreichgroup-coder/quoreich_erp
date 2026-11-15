import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller } from "./outils";

/*
 * Budget (V73, lot B1) : budget réel créé, ligne saisie, soumis ; l'auteur ne peut pas l'approuver
 * (séparation des tâches) ; suivi engagé / disponible affiché ; paramètre du contrôle enregistré puis
 * rétabli. Exercice 2099 : les budgets du parcours n'interfèrent pas avec les autres parcours.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("budget : création, ligne, soumission, séparation des tâches, suivi, paramètre", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const nom = `${RUN} Budget`;

  obs.etape("création et ligne");
  await page.goto("/budget/transactions");
  await page.getByRole("button", { name: "Nouveau budget" }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Nom du budget").fill(nom);
  await d.getByLabel("Exercice").fill("2099");
  await d.getByRole("button", { name: "Créer le budget" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Budget créé" }).first()).toBeVisible();
  await page.getByTestId("budget-row").filter({ hasText: nom }).click();
  await page.getByRole("button", { name: "Ajouter une ligne" }).click();
  d = page.getByRole("dialog");
  await expect.poll(async () => d.getByLabel("Compte").locator("option").count()).toBeGreaterThan(1);
  const comptes = await d.getByLabel("Compte").locator("option").allTextContents();
  await d.getByLabel("Compte").selectOption({ label: comptes.find((o) => /^6/.test(o))! });
  await d.getByLabel("Montant").fill("1500000");
  await d.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("budget-line")).toHaveCount(1);
  await expect(page.getByTestId("budget-summary")).toContainText("1 500 000");

  obs.etape("soumission : l'auteur n'approuve pas");
  await page.getByRole("button", { name: "Soumettre" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Budget soumis à approbation" }).first()).toBeVisible();
  await expect(page.getByTestId("budget-summary")).toContainText("Soumis");
  await expect(page.getByText("une autre personne doit l'approuver")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approuver" })).toHaveCount(0);

  obs.etape("suivi engagé / disponible");
  await page.getByRole("tab", { name: "Engagé et disponible" }).click();
  await page.getByLabel("Exercice").fill("2099");
  await expect(page.getByTestId("budget-availability")).toContainText("Aucun budget de contrôle approuvé pour 2099");

  obs.etape("paramètre du contrôle enregistré puis rétabli");
  await page.goto("/budget/settings");
  const mode = page.getByLabel("Mode");
  const avant = await mode.inputValue();
  await mode.selectOption(avant === "warn" ? "off" : "warn");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Paramètres du contrôle budgétaire enregistrés" }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Mode")).toHaveValue(avant === "warn" ? "off" : "warn");
  await page.getByLabel("Mode").selectOption(avant);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Paramètres du contrôle budgétaire enregistrés" }).first()).toBeVisible();

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
