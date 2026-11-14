import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast } from "./outils";
import { ligne } from "./champs";
import { creerClient, assurerPlanComptable } from "./actions";

/*
 * Comptabilité clients : facture à lignes (en-tête, lignes, pied calculé) → émission avec numéro
 * définitif → encaissement partiel depuis la facture → encaissement par client (seules SES
 * factures proposées) → soldée, plus d'encaissement proposé.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

async function facturer(page: Page, client: string, lignes: [string, string, string, string?][]) {
  await page.goto("/receivables/transactions");
  await page.getByRole("button", { name: /Créer facture/ }).click();
  const d = page.getByRole("dialog");
  await d.locator("select").first().selectOption({ label: client });
  for (let i = 0; i < lignes.length; i++) {
    if (i > 0) await d.getByTestId("btn-add-line").click();
    const [lib, qte, pu, remise] = lignes[i];
    await d.getByLabel(`Libellé ligne ${i + 1}`).fill(lib);
    await d.getByLabel(`Quantité ligne ${i + 1}`).fill(qte);
    await d.getByLabel(`Prix unitaire ligne ${i + 1}`).fill(pu);
    if (remise) await d.getByLabel(`Remise ligne ${i + 1}`).fill(remise);
  }
  return d;
}

async function fermerPanneau(page: Page) {
  const panneau = page.getByRole("dialog", { name: /^Facture / });
  if (await panneau.count()) await panneau.getByRole("button", { name: "Fermer" }).click();
  await expect(panneau).toHaveCount(0);
}

test("facture client à lignes → émission → encaissements par client", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const client = `${RUN} Client AR`;
  const autre = `${RUN} Autre client AR`;

  obs.etape("prérequis : plan comptable et clients");
  testInfo.annotations.push({ type: "plan comptable", description: await assurerPlanComptable(page) });
  await creerClient(page, client);
  await creerClient(page, autre);

  obs.etape("fiches clients : sélection groupée et export de la sélection");
  await page.goto("/customers");
  await page.getByPlaceholder("Search customers...").fill(RUN);
  await page.getByLabel(`Sélectionner ${client}`).check();
  await page.getByLabel(`Sélectionner ${autre}`).check();
  const barre = page.getByTestId("customers-bulk-bar");
  await expect(barre).toContainText("2 fiche(s)");
  const selection = page.waitForEvent("download");
  await barre.getByRole("button", { name: "Exporter la sélection" }).click();
  expect((await selection).suggestedFilename()).toMatch(/^clients-selection.*\.csv$/);
  await barre.getByRole("button", { name: "Effacer la sélection" }).click();

  obs.etape("facture à deux lignes : pied calculé");
  let d = await facturer(page, client, [["Prestation de conseil", "2", "75000"], ["Frais de déplacement", "1", "20000", "10"]]);
  await expect(d, "pied de facture : 150 000 + 18 000 = 168 000 HT").toContainText("168");
  await d.getByRole("button", { name: "Créer" }).click();
  const msg = await dernierToast(page);
  testInfo.annotations.push({ type: "émission", description: msg });
  await expect(d, `émission : ${msg}`).toBeHidden();
  const f = ligne(page, client);
  await expect(f).toContainText("168");
  const numero = (await f.locator("td").nth(1).innerText()).trim();
  testInfo.annotations.push({ type: "numéro", description: numero });
  expect.soft(numero, "numéro définitif attribué à l'émission").not.toMatch(/BROUILLON/);

  obs.etape("détail de la facture : lignes, pied et écriture comptable");
  await f.click();
  const detail = page.getByRole("dialog", { name: `Facture ${numero}` });
  await expect(detail.getByRole("region", { name: "Lignes" })).toContainText("Frais de déplacement");
  await expect(detail.getByRole("region", { name: "Lignes" })).toContainText("10 %");
  await expect(detail.getByRole("region", { name: "Pied" })).toContainText("168 000");
  const ecriture = detail.getByTestId("journal-entry-preview");
  await expect(ecriture).toContainText("411");
  await expect(ecriture).toContainText("701");
  await expect(ecriture.locator("tfoot"), "écriture équilibrée").toContainText(/168\s000\s*168\s000/);
  await fermerPanneau(page);

  obs.etape("export des factures clients");
  const telechargement = page.waitForEvent("download");
  await page.getByTestId("btn-export-csv").click();
  testInfo.annotations.push({ type: "export", description: (await telechargement).suggestedFilename() });

  obs.etape("facture d'un autre client");
  d = await facturer(page, autre, [["Formation", "1", "40000"]]);
  await d.getByRole("button", { name: "Créer" }).click();
  await expect(d).toBeHidden();
  const numeroAutre = (await ligne(page, autre).locator("td").nth(1).innerText()).trim();

  obs.etape("encaissement partiel depuis la facture (client et facture présélectionnés)");
  await ligne(page, numero).click();
  await page.getByRole("dialog", { name: /^Facture / }).getByRole("button", { name: /Enregistrer paiement/ }).click();
  let p = page.getByRole("dialog", { name: "Encaissement client" });
  await expect(p.getByLabel(`Montant imputé ${numero}`)).toHaveValue("168000");
  await expect(p.getByText(numeroAutre), "facture d'un autre client absente").toHaveCount(0);
  await p.getByLabel("Montant du règlement (XOF)").fill("100000");
  await p.getByLabel(`Montant imputé ${numero}`).fill("100000");
  await p.getByLabel("Référence").fill(`ENC-${RUN}-1`);
  await p.getByRole("button", { name: "Enregistrer le règlement" }).click();
  const m1 = await dernierToast(page);
  testInfo.annotations.push({ type: "encaissement 1", description: m1 });
  await expect(p, `encaissement : ${m1}`).toBeHidden();
  await fermerPanneau(page);
  await expect(ligne(page, numero)).toContainText("68");

  obs.etape("encaissement par client depuis la barre d'outils");
  await page.getByRole("button", { name: "Encaissement client" }).click();
  p = page.getByRole("dialog", { name: "Encaissement client" });
  await expect(p.getByLabel("Client *"), "aucun client présélectionné").toHaveValue("");
  await p.getByLabel("Client *").selectOption({ label: client });
  await expect(p.getByLabel(`Montant imputé ${numero}`)).toBeVisible();
  await expect(p.getByText(numeroAutre)).toHaveCount(0);
  await p.getByLabel("Montant du règlement (XOF)").fill("68000");
  await p.getByRole("button", { name: "Répartir" }).click();
  await expect(p.getByTestId("settlement-remaining")).toHaveText("0");
  await p.getByLabel("Référence").fill(`ENC-${RUN}-2`);
  await p.getByRole("button", { name: "Enregistrer le règlement" }).click();
  const m2 = await dernierToast(page);
  testInfo.annotations.push({ type: "encaissement 2", description: m2 });
  await expect(p, `solde : ${m2}`).toBeHidden();

  obs.etape("facture soldée : plus d'encaissement proposé");
  await ligne(page, numero).click();
  await expect(page.getByRole("dialog", { name: /^Facture / }).getByRole("button", { name: /Enregistrer paiement/ })).toHaveCount(0);

  // V42 : un encaissement ne se supprime pas ; il s'annule par contre-passation, avec un motif.
  obs.etape("annulation du second encaissement : contre-passation, facture de nouveau due");
  let panneau = page.getByRole("dialog", { name: `Facture ${numero}` });
  const reglements = panneau.getByRole("region", { name: "Règlements" });
  await expect(reglements.getByTestId("ar-payment-row")).toHaveCount(2);
  await reglements.getByTestId("ar-payment-row").filter({ hasText: `ENC-${RUN}-2` }).getByRole("button", { name: "Annuler" }).click();
  const a = page.getByRole("dialog", { name: /Annuler l'encaissement/ });
  await expect(a.getByRole("button", { name: "Annuler l'encaissement" }), "motif obligatoire").toBeDisabled();
  await a.getByLabel("Motif (obligatoire)").fill("Chèque impayé");
  await a.getByRole("button", { name: "Annuler l'encaissement" }).click();
  const m3 = await dernierToast(page);
  testInfo.annotations.push({ type: "annulation", description: m3 });
  await expect(a, `annulation : ${m3}`).toBeHidden();
  await fermerPanneau(page);
  await expect(ligne(page, numero)).toContainText("Partiellement réglée");
  await ligne(page, numero).click();
  panneau = page.getByRole("dialog", { name: `Facture ${numero}` });
  await expect(panneau.getByRole("region", { name: "Règlements" }).getByTestId("ar-payment-row")).toHaveCount(3);
  await expect(panneau.getByRole("region", { name: "Règlements" })).toContainText("Chèque impayé");
  await expect(panneau.getByRole("region", { name: "Pied" })).toContainText("68 000");
  await expect(panneau.getByRole("button", { name: /Enregistrer paiement/ }), "de nouveau encaissable").toBeVisible();

  // V45 : la facture émise se corrige par un avoir lié, motivé, numéroté, imputé sur le reste dû.
  obs.etape("avoir partiel sur la ligne « Frais de déplacement »");
  await panneau.getByRole("button", { name: "Créer un avoir" }).click();
  const av = page.getByRole("dialog", { name: `Avoir sur la facture ${numero}` });
  await expect(av.getByRole("button", { name: "Émettre l'avoir" }), "motif et ligne requis").toBeDisabled();
  await av.getByLabel("Motif (obligatoire)").fill("Déplacement non effectué");
  await av.getByLabel("Quantité à créditer ligne 2").fill("1");
  await expect(av.getByTestId("credit-preview")).toContainText("18 000");
  await av.getByRole("button", { name: "Émettre l'avoir" }).click();
  testInfo.annotations.push({ type: "avoir", description: await dernierToast(page) });
  await expect(av).toBeHidden();
  await fermerPanneau(page);
  await ligne(page, numero).click();
  panneau = page.getByRole("dialog", { name: `Facture ${numero}` });
  await expect(panneau.getByRole("region", { name: "Pied" }), "68 000 − 18 000").toContainText("50 000");
  const avoirs = panneau.getByRole("region", { name: "Avoirs" });
  await expect(avoirs.getByTestId("credit-note-row")).toHaveCount(1);
  await expect(avoirs).toContainText("Déplacement non effectué");
  await avoirs.getByTestId("credit-note-row").click();
  const vueAvoir = page.getByRole("dialog", { name: /^Avoir / });
  await expect(vueAvoir.getByRole("region", { name: "Lignes" })).toContainText("Frais de déplacement");
  await expect(vueAvoir.getByRole("region", { name: "Pied" })).toContainText("18 000");
  const avoirPdf = page.waitForEvent("download");
  await vueAvoir.getByTestId("btn-document-pdf").click();
  expect((await avoirPdf).suggestedFilename()).toMatch(/^avoir-.*\.pdf$/);
  await page.keyboard.press("Escape");
  await expect(vueAvoir).toBeHidden();
  await fermerPanneau(page);

  // Le livre auxiliaire clients : relevé du compte du client.
  obs.etape("relevé de compte client : facture, encaissements, annulation, avoir, solde");
  await page.getByRole("button", { name: "Relevé de compte" }).click();
  const releve = page.getByRole("dialog", { name: "Relevé de compte client" });
  await releve.getByLabel("Client").selectOption({ label: client });
  await expect(releve.getByRole("region", { name: "Lignes" })).toContainText(numero);
  await expect(releve.getByRole("region", { name: "Lignes" })).toContainText("Annulation d'encaissement");
  await expect(releve.getByRole("region", { name: "Lignes" })).toContainText("Avoir sur");
  await expect(releve.getByRole("region", { name: "Pied" }), "168 000 − 100 000 − 68 000 + 68 000 − 18 000").toContainText("50 000");
  const relevePdf = page.waitForEvent("download");
  await releve.getByTestId("btn-document-pdf").click();
  expect((await relevePdf).suggestedFilename()).toMatch(/^releve-.*\.pdf$/);
  await page.keyboard.press("Escape");

  // Ces pièces se retrouvent au grand livre, avec journal, numéro de pièce et lot (V38).
  obs.etape("grand livre → transactions : écritures de la facture, des encaissements et de l'avoir");
  await page.goto("/journal/transactions");
  await page.getByLabel("Rechercher une écriture").fill(numero);
  const ecritures = page.getByTestId("gl-entry-row");
  await expect(ecritures.filter({ hasText: "Facture client" })).toHaveCount(1);
  await expect(ecritures.filter({ hasText: "Avoir client" })).toHaveCount(1);
  await ecritures.filter({ hasText: "Facture client" }).click();
  const detailEcriture = page.getByRole("dialog", { name: /^Écriture VT-/ });
  await expect(detailEcriture.getByRole("region", { name: "Lignes" })).toContainText("411");
  await expect(detailEcriture.getByRole("region", { name: "Pied" })).toContainText("168 000");
  await page.keyboard.press("Escape");

  await obs.joindre(testInfo);
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});
