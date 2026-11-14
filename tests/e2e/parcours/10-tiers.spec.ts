import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast } from "./outils";
import { ligne } from "./champs";
import { pageApprobateur } from "./actions";

/* Fiches tiers : création, modification et recherche d'un fournisseur et d'un client. */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("fournisseur : fiche complète, recherche, modification, RIB validé par une autre personne", async ({ page, browser, baseURL }, testInfo) => {
  const obs = surveiller(page);
  const nom = `${RUN} Fournisseur Alpha`;

  obs.etape("création : identification, conditions, banque");
  await page.goto("/suppliers");
  await page.getByRole("button", { name: "Ajouter un fournisseur" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Nom du fournisseur *").fill(nom);
  await d.getByLabel("E-mail").fill("fournisseur.alpha@exemple.invalid");
  await d.getByLabel("Téléphone").fill("+226 70 00 00 01");
  await d.getByLabel("IFU / NIF").fill(`IFU-${RUN}`);
  await d.getByLabel("RCCM").fill("BF-OUA-2026-B-0001");
  await d.getByLabel("Pays (code ISO, ex. BF, CI, FR)").fill("FRA");
  await expect(d.getByRole("alert")).toContainText("ISO");
  await d.getByLabel("Pays (code ISO, ex. BF, CI, FR)").fill("FR");
  await d.getByLabel("Devise").fill("EUR");
  await d.getByLabel("Incoterm par défaut").selectOption("FOB");
  await d.getByLabel("Délai de livraison (jours)").fill("21");
  await d.getByLabel("Banque").fill("Banque Exemple");
  await d.getByLabel("Compte / RIB / IBAN").fill(`FR76 0000 0000 0000 ${RUN.slice(-4)}`);
  await d.getByLabel("BIC / SWIFT").fill("BEXAFRPP");
  await d.getByRole("button", { name: "Créer" }).click();
  await expect(d).toBeHidden();
  testInfo.annotations.push({ type: "message", description: await dernierToast(page) });

  obs.etape("recherche ; coordonnées bancaires à valider");
  await page.getByLabel("Rechercher un fournisseur").fill(RUN);
  const fiche = page.getByTestId("supplier-row").filter({ hasText: nom });
  await expect(fiche).toContainText("EUR · FOB · livré en 21 j");
  await expect(fiche).toContainText("À valider");

  obs.etape("modification ; l'auteur du RIB ne peut pas le valider");
  await fiche.getByRole("button", { name: `Modifier ${nom}` }).click();
  await page.getByRole("dialog").getByLabel("Ville").fill("Ouagadougou");
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("autre personne");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Valider les coordonnées bancaires" })).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  obs.etape("double contrôle : le second membre (comptable) valide le RIB");
  const { ctx, page: pa } = await pageApprobateur(browser, baseURL);
  await pa.goto("/suppliers");
  await pa.getByLabel("Rechercher un fournisseur").fill(RUN);
  await pa.getByTestId("supplier-row").filter({ hasText: nom }).getByRole("button", { name: `Modifier ${nom}` }).click();
  await pa.getByRole("dialog").getByRole("button", { name: "Valider les coordonnées bancaires" }).click();
  await expect(pa.locator("[data-sonner-toast]").filter({ hasText: "validées" })).toBeVisible();
  await ctx.close();
  await page.reload();
  await page.getByLabel("Rechercher un fournisseur").fill(RUN);
  await expect(page.getByTestId("supplier-row").filter({ hasText: nom })).toContainText("Validées");

  await obs.joindre(testInfo);
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});

test("client : créer, retrouver, modifier", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const nom = `${RUN} Client Beta`;

  obs.etape("création");
  await page.goto("/customers");
  await page.getByRole("button", { name: /Add Customer/i }).click();
  const d = page.getByRole("dialog");
  await d.getByPlaceholder("Company or individual name").fill(nom);
  await d.getByPlaceholder("email@example.com").fill("client.beta@exemple.invalid");
  await d.getByPlaceholder("XX-2024-000").fill(`IFU-C-${RUN}`);
  await d.getByRole("button", { name: "Create" }).click();
  await expect(d).toBeHidden();
  testInfo.annotations.push({ type: "message", description: await dernierToast(page) });

  obs.etape("recherche");
  await page.getByPlaceholder("Search customers...").fill(RUN);
  await expect(ligne(page, nom)).toBeVisible();

  obs.etape("modification");
  await ligne(page, nom).getByRole("button").first().click();
  await page.getByRole("dialog").getByPlaceholder("City, Country").fill("Bobo-Dioulasso, Burkina Faso");
  await page.getByRole("dialog").getByRole("button", { name: "Update" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await obs.joindre(testInfo);
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});
