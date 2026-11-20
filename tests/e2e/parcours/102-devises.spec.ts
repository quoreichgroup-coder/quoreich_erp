import { test, expect } from "@playwright/test";
import { aujourdhui, identifiants, RUN, surveiller, verifierSocieteE2E } from "./outils";
import { champ, ligne } from "./champs";
import { creerFournisseur } from "./actions";

/*
 * Devises sur les achats (V124) : cours USD de la société enregistré dans les paramètres centraux, facture fournisseur
 * saisie en USD (prix en devise, contre-valeur XOF calculée par la base au cours du jour), panneau de la facture en
 * devise et en XOF. Le paiement en devise et l'écart de change sont couverts par DevisesAchatsIT (la société de test
 * exige une commande avant toute facture soumise).
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("cours de change de la société, facture fournisseur en USD convertie en XOF", async ({ page }) => {
  test.setTimeout(240_000);
  const obs = surveiller(page);
  const jour = aujourdhui();
  const jourFr = jour.split("-").reverse().join("/");

  obs.etape("cours USD du jour");
  await page.goto("/settings?tab=currency");
  await verifierSocieteE2E(page);
  const table = page.getByTestId("exchange-rates");
  await expect(table).toBeVisible();
  await expect(table).toContainText("EUR");
  const dejaSaisi = table.locator("tr").filter({ hasText: "USD" }).filter({ hasText: jourFr });
  if (await dejaSaisi.count() === 0) {
    const f = page.getByTestId("exchange-rate-form");
    await f.getByLabel("Devise (code ISO)").fill("USD");
    await f.getByLabel("Date").fill(jour);
    await f.getByLabel(/Cours \(1 unité/).fill("600");
    await f.getByLabel("Source").fill("E2E");
    await page.getByTestId("exchange-rate-save").click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Cours enregistré" })).toBeVisible();
  }
  await expect(dejaSaisi.first()).toBeVisible();
  const cours = Number((await dejaSaisi.first().locator("td").nth(2).innerText()).replace(/\s/g, "").replace(",", "."));

  obs.etape("facture fournisseur en USD");
  const fournisseur = `Fournisseur USD ${RUN}`;
  await creerFournisseur(page, fournisseur);
  await page.goto("/payables/transactions");
  await page.getByRole("button", { name: "Nouvelle facture fournisseur" }).click();
  const d = page.getByRole("dialog");
  await d.locator("select").first().selectOption({ label: fournisseur });
  await d.getByLabel("Devise").selectOption("USD");
  await expect(d.getByLabel(/Cours \(1 USD/)).toBeVisible();
  const numero = `${RUN}-USD`;
  await champ(d, "N° Facture").fill(numero);
  await champ(d, "Date").fill(jour);
  await champ(d, "Échéance").fill(jour);
  await d.getByLabel("Libellé ligne 1").fill("Pièces importées");
  await d.getByLabel("Quantité ligne 1").fill("2");
  await d.getByLabel("Prix unitaire ligne 1").fill("250,25");
  await d.getByRole("button", { name: "Créer" }).click();
  await expect(d).toBeHidden();

  obs.etape("panneau : montants en devise et en XOF");
  await ligne(page, numero).click();
  const attenduXof = Math.round(500.5 * cours * 100) / 100;
  await expect(page.getByText(`USD · 1 USD = `)).toBeVisible();
  await expect(page.getByText("500,5 USD").first()).toBeVisible();
  await expect(page.getByText(`${attenduXof.toLocaleString("fr-FR")} XOF`).first()).toBeVisible();
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
