import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller } from "./outils";
import { creerFournisseur } from "./actions";

/*
 * Pièces jointes (V138) : catégories de la société dans Paramètres, contrat joint à une fiche fournisseur (stockage du
 * nuage ou de l'API sur site), ouverture, suppression avec motif — la pièce jointe reste dans l'historique.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("pièces jointes : contrat joint au fournisseur, ouvert, supprimé avec motif et gardé en archive", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const fournisseur = `${RUN} Fournisseur pièces jointes`;

  obs.etape("paramètres : catégories créées au premier usage");
  await page.goto("/settings?tab=attachments");
  const reglages = page.getByTestId("attachment-settings");
  await expect(reglages.getByTestId("attachment-category-row").filter({ hasText: "Contrat" })).toBeVisible();
  await expect(reglages.getByLabel("Taille maximale d'un fichier (Mo)")).toBeVisible();

  obs.etape("contrat joint à la fiche fournisseur");
  await creerFournisseur(page, fournisseur);
  await page.goto("/suppliers");
  await page.getByPlaceholder("Rechercher un fournisseur").fill(RUN);
  await page.getByRole("button", { name: `Modifier ${fournisseur}` }).click();
  const fiche = page.getByRole("dialog");
  const pj = fiche.getByTestId("attachments");
  await pj.getByTestId("attachment-file").setInputFiles({ name: `contrat-${RUN}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% contrat cadre E2E\n") });
  await pj.getByTestId("attachment-category").selectOption({ label: "Contrat" });
  await pj.getByLabel("Commentaire").fill("Contrat cadre 2026");
  await pj.getByTestId("attachment-upload").click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Pièce jointe ajoutée" }).first()).toBeVisible();
  const ligne = pj.getByTestId("attachment-row").filter({ hasText: `contrat-${RUN}.pdf` });
  await expect(ligne).toContainText("Contrat");

  obs.etape("ouverture du fichier");
  const onglet = page.waitForEvent("popup");
  await ligne.getByRole("button", { name: `contrat-${RUN}.pdf` }).click();
  await (await onglet).close();

  obs.etape("suppression avec motif, archive visible");
  page.once("dialog", (d) => d.accept("Contrat remplacé (parcours E2E)"));
  await ligne.getByTestId("attachment-delete").click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "gardée en archive" }).first()).toBeVisible();
  await expect(pj.getByTestId("attachment-row")).toHaveCount(0);
  await pj.getByRole("button", { name: /Afficher les pièces jointes supprimées \(1\)/ }).click();
  await expect(pj.getByText("Contrat remplacé (parcours E2E)")).toBeVisible();

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
