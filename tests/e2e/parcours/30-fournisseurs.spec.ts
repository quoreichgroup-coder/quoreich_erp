import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast, aujourdhui } from "./outils";
import { champ, ligne } from "./champs";
import { creerFournisseur, assurerPlanComptable } from "./actions";

/*
 * Comptabilité fournisseurs : facture → refus de payer avant approbation → approbation →
 * paiement partiel → solde.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("facture fournisseur → approbation → paiement partiel puis solde", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const fournisseur = `${RUN} Fournisseur AP`;
  const numero = `FF-${RUN}`;

  obs.etape("prérequis : plan comptable");
  testInfo.annotations.push({ type: "plan comptable", description: await assurerPlanComptable(page) });
  obs.etape("prérequis : fournisseur");
  await creerFournisseur(page, fournisseur);

  obs.etape("saisie de la facture");
  await page.goto("/payables/transactions");
  await page.getByRole("button", { name: /New Supplier Invoice/i }).click();
  const d = page.getByRole("dialog");
  await d.locator("select").first().selectOption({ label: fournisseur });
  await champ(d, "N° Facture").fill(numero);
  await champ(d, "Date").fill(aujourdhui());
  await champ(d, "Échéance").fill(aujourdhui());
  await champ(d, "Montant HT").fill("100000");
  await champ(d, "TVA (XOF)").fill("18000");
  await d.getByRole("button", { name: "Créer" }).click();
  await expect(d).toBeHidden();
  const f = ligne(page, numero);
  await expect(f).toBeVisible();
  await expect(f).toContainText("118");
  await expect(f.getByRole("button", { name: /Pay/ }), "pas de paiement avant approbation").toHaveCount(0);

  obs.etape("approbation");
  await f.getByRole("button", { name: /Approve/ }).click();
  testInfo.annotations.push({ type: "message", description: await dernierToast(page) });
  await expect(f.getByRole("button", { name: /Pay/ })).toBeVisible();

  obs.etape("paiement partiel");
  await f.getByRole("button", { name: /Pay/ }).click();
  let p = page.getByRole("dialog");
  await champ(p, "Montant (XOF)").fill("50000");
  await champ(p, "Référence").fill(`VIR-${RUN}-1`);
  await p.getByRole("button", { name: /Payer/ }).click();
  const msg1 = await dernierToast(page);
  testInfo.annotations.push({ type: "paiement 1", description: msg1 });
  await expect(p, `paiement partiel : ${msg1}`).toBeHidden();
  await expect(f).toContainText("68");

  obs.etape("solde");
  await f.getByRole("button", { name: /Pay/ }).click();
  p = page.getByRole("dialog");
  await p.getByRole("button", { name: "Totalité" }).click();
  await champ(p, "Référence").fill(`VIR-${RUN}-2`);
  await p.getByRole("button", { name: /Payer/ }).click();
  const msg2 = await dernierToast(page);
  testInfo.annotations.push({ type: "paiement 2", description: msg2 });
  await expect(p, `solde : ${msg2}`).toBeHidden();
  await expect(f.getByRole("button", { name: /Pay/ })).toHaveCount(0);

  await obs.joindre(testInfo);
  expect(obs.incidents.filter((i) => i.type !== "erreur-console"), JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});
