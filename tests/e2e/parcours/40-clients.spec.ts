import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast } from "./outils";
import { champ, ligne } from "./champs";
import { creerClient, assurerPlanComptable } from "./actions";

/*
 * Comptabilité clients : facture à deux lignes (en-tête, lignes, total calculé) → émission avec
 * numéro définitif → encaissement partiel → solde.
 */
/** Ferme le panneau de détail s'il est encore ouvert (Échap). */
async function fermerPanneau(page: import("@playwright/test").Page) {
  const panneau = page.getByRole("dialog", { name: /^Facture / });
  if (await panneau.count()) await panneau.getByRole("button", { name: "Fermer" }).click();
  await expect(panneau).toHaveCount(0);
}

test.skip(!identifiants(), "identifiants du compte de test absents");

test("facture client à lignes → émission → encaissements", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const client = `${RUN} Client AR`;

  obs.etape("prérequis : plan comptable");
  testInfo.annotations.push({ type: "plan comptable", description: await assurerPlanComptable(page) });
  obs.etape("prérequis : client");
  await creerClient(page, client);

  obs.etape("saisie de la facture");
  await page.goto("/receivables/transactions");
  await page.getByRole("button", { name: /Créer facture/ }).click();
  const d = page.getByRole("dialog");
  await d.locator("select").first().selectOption({ label: client });
  await d.getByLabel("Libellé ligne 1").fill("Prestation de conseil");
  await d.getByLabel("Quantité ligne 1").fill("2");
  await d.getByLabel("Prix unitaire ligne 1").fill("75000");
  await d.getByTestId("btn-add-line").click();
  await d.getByLabel("Libellé ligne 2").fill("Frais de déplacement");
  await d.getByLabel("Quantité ligne 2").fill("1");
  await d.getByLabel("Prix unitaire ligne 2").fill("20000");
  await d.getByLabel("Remise ligne 2").fill("10");
  await expect(d, "pied de facture : 150 000 + 18 000 = 168 000 HT").toContainText("168");
  await d.getByRole("button", { name: "Créer" }).click();
  const msg = await dernierToast(page);
  testInfo.annotations.push({ type: "émission", description: msg });
  await expect(d, `émission : ${msg}`).toBeHidden();

  const f = ligne(page, client);
  await expect(f).toBeVisible();
  await expect(f).toContainText("168");
  const numero = (await f.locator("td").nth(1).innerText()).trim();
  testInfo.annotations.push({ type: "numéro", description: numero });
  expect.soft(numero, "numéro définitif attribué à l'émission").not.toMatch(/BROUILLON/);

  obs.etape("encaissement partiel");
  await f.click();
  await page.getByRole("dialog", { name: /^Facture / }).getByRole("button", { name: /Enregistrer paiement/ }).click();
  let p = page.getByRole("dialog").filter({ hasText: "Montant (XOF)" });
  await champ(p, "Montant (XOF)").fill("100000");
  await champ(p, "Référence").fill(`ENC-${RUN}-1`);
  await p.getByRole("button", { name: /Enregistrer$/ }).click();
  const m1 = await dernierToast(page);
  testInfo.annotations.push({ type: "encaissement 1", description: m1 });
  await expect(p, `encaissement : ${m1}`).toBeHidden();
  await fermerPanneau(page);
  await expect(ligne(page, client)).toContainText("68");

  obs.etape("solde");
  await ligne(page, client).click();
  await page.getByRole("dialog", { name: /^Facture / }).getByRole("button", { name: /Enregistrer paiement/ }).click();
  p = page.getByRole("dialog").filter({ hasText: "Montant (XOF)" });
  await champ(p, "Montant (XOF)").fill("68000");
  await champ(p, "Référence").fill(`ENC-${RUN}-2`);
  await p.getByRole("button", { name: /Enregistrer$/ }).click();
  const m2 = await dernierToast(page);
  testInfo.annotations.push({ type: "encaissement 2", description: m2 });
  await expect(p, `solde : ${m2}`).toBeHidden();

  obs.etape("refus d'un trop-perçu");
  await fermerPanneau(page);
  await ligne(page, client).click();
  const encore = page.getByRole("dialog", { name: /^Facture / }).getByRole("button", { name: /Enregistrer paiement/ });
  expect.soft(await encore.count(), "plus d'encaissement proposé sur une facture soldée").toBe(0);

  await obs.joindre(testInfo);
  expect(obs.incidents.filter((i) => i.type !== "erreur-console"), JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});
