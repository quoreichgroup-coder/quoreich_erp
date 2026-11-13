import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast, aujourdhui } from "./outils";
import { champ, ligne } from "./champs";
import { creerFournisseur, assurerPlanComptable } from "./actions";

/*
 * Comptabilité fournisseurs : facture → pas de paiement avant approbation → approbation →
 * règlement partiel depuis la ligne → règlement par fournisseur (seules SES factures proposées,
 * répartition sur plusieurs factures) → soldé.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

async function saisirFacture(page: Page, fournisseur: string, numero: string, ht: string, tva: string) {
  await page.goto("/payables/transactions");
  await page.getByRole("button", { name: /New Supplier Invoice/i }).click();
  const d = page.getByRole("dialog");
  await d.locator("select").first().selectOption({ label: fournisseur });
  await expect(d.getByLabel("Commande d'origine"), "commandes du fournisseur seulement").toBeEnabled();
  await champ(d, "N° Facture").fill(numero);
  await champ(d, "Date").fill(aujourdhui());
  await champ(d, "Échéance").fill(aujourdhui());
  await champ(d, "Montant HT").fill(ht);
  await champ(d, "TVA (XOF)").fill(tva);
  await d.getByRole("button", { name: "Créer" }).click();
  await expect(d).toBeHidden();
  const f = ligne(page, numero);
  await expect(f).toBeVisible();
  await f.getByRole("button", { name: /Approve/ }).click();
  await expect(f.getByRole("button", { name: /Pay/ })).toBeVisible();
  return f;
}

test("facture fournisseur → approbation → règlements par fournisseur", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const fournisseur = `${RUN} Fournisseur AP`;
  const autre = `${RUN} Autre fournisseur AP`;
  const ff1 = `FF-${RUN}-1`, ff2 = `FF-${RUN}-2`, ffAutre = `FF-${RUN}-X`;

  obs.etape("prérequis : plan comptable et fournisseurs");
  testInfo.annotations.push({ type: "plan comptable", description: await assurerPlanComptable(page) });
  await creerFournisseur(page, fournisseur);
  await creerFournisseur(page, autre);

  obs.etape("contrôle : pas de paiement avant approbation");
  await page.goto("/payables/transactions");
  await page.getByRole("button", { name: /New Supplier Invoice/i }).click();
  let d = page.getByRole("dialog");
  await d.locator("select").first().selectOption({ label: fournisseur });
  await champ(d, "N° Facture").fill(ff1);
  await champ(d, "Montant HT").fill("100000");
  await champ(d, "TVA (XOF)").fill("18000");
  await d.getByRole("button", { name: "Créer" }).click();
  await expect(d).toBeHidden();
  const f1 = ligne(page, ff1);
  await expect(f1).toContainText("118");
  await expect(f1.getByRole("button", { name: /Pay/ })).toHaveCount(0);

  obs.etape("approbation");
  await f1.getByRole("button", { name: /Approve/ }).click();
  testInfo.annotations.push({ type: "message", description: await dernierToast(page) });
  await expect(f1.getByRole("button", { name: /Pay/ })).toBeVisible();

  obs.etape("règlement partiel depuis la ligne (fournisseur et facture présélectionnés)");
  await f1.getByRole("button", { name: /Pay/ }).click();
  d = page.getByRole("dialog");
  await expect(d.getByLabel("Fournisseur *")).toHaveValue(/.+/);
  await expect(d.getByLabel(`Montant imputé ${ff1}`)).toHaveValue("118000");
  await d.getByLabel("Montant du règlement (XOF)").fill("50000");
  await d.getByLabel(`Montant imputé ${ff1}`).fill("50000");
  await d.getByLabel("Référence").fill(`VIR-${RUN}-1`);
  await d.getByRole("button", { name: "Enregistrer le règlement" }).click();
  const m1 = await dernierToast(page);
  testInfo.annotations.push({ type: "règlement 1", description: m1 });
  await expect(d, `règlement partiel : ${m1}`).toBeHidden();
  await expect(f1).toContainText("68");

  obs.etape("deux autres factures : une du même fournisseur, une d'un autre");
  await saisirFacture(page, fournisseur, ff2, "20000", "0");
  await saisirFacture(page, autre, ffAutre, "30000", "0");

  obs.etape("règlement par fournisseur : seules SES factures, répartition");
  await page.getByRole("button", { name: "Règlement fournisseur" }).click();
  d = page.getByRole("dialog");
  await expect(d.getByRole("table")).toHaveCount(0);
  await d.getByLabel("Fournisseur *").selectOption({ label: fournisseur });
  await expect(d.getByLabel(`Montant imputé ${ff1}`)).toBeVisible();
  await expect(d.getByLabel(`Montant imputé ${ff2}`)).toBeVisible();
  await expect(d.getByText(ffAutre), "la facture d'un autre fournisseur n'est pas proposée").toHaveCount(0);
  await d.getByLabel("Montant du règlement (XOF)").fill("88000");
  await d.getByRole("button", { name: "Répartir" }).click();
  await expect(d.getByTestId("settlement-remaining")).toHaveText("0");
  await d.getByLabel("Référence").fill(`VIR-${RUN}-2`);
  await d.getByRole("button", { name: "Enregistrer le règlement" }).click();
  const m2 = await dernierToast(page);
  testInfo.annotations.push({ type: "règlement 2", description: m2 });
  await expect(d, `règlement réparti : ${m2}`).toBeHidden();
  await expect(ligne(page, ff1).getByRole("button", { name: /Pay/ })).toHaveCount(0);
  await expect(ligne(page, ff2).getByRole("button", { name: /Pay/ })).toHaveCount(0);
  await expect(ligne(page, ffAutre).getByRole("button", { name: /Pay/ }), "la facture de l'autre fournisseur reste due").toBeVisible();

  obs.etape("détail de la facture : en-tête, lignes, pied");
  await ligne(page, ff1).locator("td").first().click();
  const panneau = page.getByRole("dialog", { name: `Facture ${ff1}` });
  await expect(panneau.getByRole("region", { name: "En-tête" })).toContainText(fournisseur);
  await expect(panneau.getByRole("region", { name: "Pied" })).toContainText("118 000");
  await expect(panneau.getByRole("region", { name: "Pied" })).toContainText("Reste à payer");
  await panneau.getByRole("button", { name: "Fermer" }).click();

  obs.etape("export des factures fournisseurs");
  const telechargement = page.waitForEvent("download");
  await page.getByTestId("btn-export-csv").click();
  expect((await telechargement).suggestedFilename()).toMatch(/^factures-fournisseurs.*\.csv$/);

  await obs.joindre(testInfo);
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});

/*
 * V37 (Lot 3, étape 3) : l'approbation comptabilise la facture fournisseur par rôles — 601 achats
 * et 4452 TVA déductible au débit, 401 fournisseurs au crédit — au lieu de l'approuver sans
 * écriture (défaut révélé par ce parcours, marqué « échec attendu » jusqu'à la correction).
 */
test("la facture fournisseur approuvée porte son écriture comptable", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const fournisseur = `${RUN} Fournisseur écriture`;
  const numero = `FF-${RUN}-GL`;
  await assurerPlanComptable(page);
  await creerFournisseur(page, fournisseur);
  const f = await saisirFacture(page, fournisseur, numero, "50000", "9000");
  await f.locator("td").first().click();
  const panneau = page.getByRole("dialog", { name: `Facture ${numero}` });
  const ecriture = panneau.getByTestId("journal-entry-preview");
  await expect(ecriture).toBeVisible();
  await expect(ecriture.locator("tbody tr").filter({ hasText: /^601/ })).toContainText("50 000");
  await expect(ecriture.locator("tbody tr").filter({ hasText: /^4452/ })).toContainText("9 000");
  await expect(ecriture.locator("tbody tr").filter({ hasText: /^401/ })).toContainText("59 000");
  await expect(ecriture.locator("tfoot"), "équilibrée").toContainText(/59\s000\s*59\s000/);
  await obs.joindre(testInfo);
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});
