import { test, expect, type Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { identifiants, RUN, surveiller, dernierToast } from "./outils";
import { creerClient, assurerPlanComptable } from "./actions";
import { ligne } from "./champs";

test.skip(!identifiants(), "identifiants du compte de test absents");

async function verifierPdf(download: Download, pattern: RegExp) {
  expect(download.suggestedFilename()).toMatch(pattern);
  const path = await download.path();
  expect(path).not.toBeNull();
  const content = await readFile(path!);
  expect(content.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(content.byteLength).toBeGreaterThan(1000);
}

async function verifierCsv(download: Download, pattern: RegExp, value: string) {
  expect(download.suggestedFilename()).toMatch(pattern);
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path!, "utf8")).toContain(value);
}

test("CRM et ventes : opportunité, devis, commande, références et exports", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const client = `${RUN} Client CRM ventes`;
  const crmClient = `${RUN} Client CRM conversion`;
  const opportunity = `${RUN} Opportunité CRM ventes`;

  obs.etape("créer le client de la vente");
  await creerClient(page, client);
  await creerClient(page, crmClient);

  obs.etape("créer une opportunité CRM et vérifier les exports");
  await page.goto("/crm/opportunities");
  page.once("dialog", (dialog) => dialog.accept(opportunity));
  await page.getByRole("button", { name: "Nouvelle", exact: true }).click();
  await expect(page.getByText(opportunity, { exact: true })).toBeVisible();
  const crmCsv = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  await verifierCsv(await crmCsv, /crm-opportunities-.*\.csv/, opportunity);
  const crmPdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await verifierPdf(await crmPdf, /crm-opportunities-.*\.pdf/);

  obs.etape("convertir l'opportunité en devis puis en commande");
  await page.getByText(opportunity, { exact: true }).click();
  const crmDialog = page.getByRole("dialog");
  await crmDialog.getByRole("tab", { name: "Détails" }).click();
  await crmDialog.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "Gagné" }).click();
  await crmDialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(crmDialog.getByText("Gagné", { exact: true })).toBeVisible();
  await crmDialog.getByRole("tab", { name: "Conversion" }).click();
  await crmDialog.getByRole("combobox").click();
  await page.getByRole("option", { name: crmClient }).click();
  await crmDialog.getByRole("button", { name: "Convertir en devis" }).click();
  await expect(crmDialog.getByText(/Devis créé/)).toBeVisible();
  const convertQuoteResponse = page.waitForResponse((response) => response.url().includes("/rpc/convert_quote_to_so"));
  await crmDialog.getByRole("button", { name: "Convertir en bon de commande" }).click();
  const convertedOrder = await convertQuoteResponse;
  expect(convertedOrder.ok(), await convertedOrder.text()).toBeTruthy();
  await expect(crmDialog.getByText(/Bon de commande SO-/)).toBeVisible();

  obs.etape("créer un devis numéroté par la base");
  await page.goto("/sales/transactions");
  await page.getByRole("button", { name: "New Quote" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.locator("select").first().selectOption({ label: client });
  // V43 : devis à lignes, remise par ligne, pied HT / TVA / TTC calculé.
  await dialog.getByLabel("Libellé ligne 1").fill("Prestation de conseil");
  await dialog.getByLabel("Quantité ligne 1").fill("2");
  await dialog.getByLabel("Prix unitaire ligne 1").fill("50000");
  await dialog.getByLabel("Remise ligne 1").fill("10");
  await dialog.getByTestId("btn-add-line").click();
  await dialog.getByLabel("Libellé ligne 2").fill("Frais de dossier");
  await dialog.getByLabel("Quantité ligne 2").fill("1");
  await dialog.getByLabel("Prix unitaire ligne 2").fill("35000");
  await expect(dialog.getByTestId("sales-totals"), "2 × 50 000 − 10 % + 35 000 = 125 000 HT").toContainText("125");
  await dialog.getByRole("button", { name: "Créer" }).click();
  await expect(dialog).toBeHidden();
  const quoteRow = page.getByRole("row").filter({ hasText: client });
  await expect(quoteRow).toContainText(/(?:QT-\d{4}-\d{4,}|QUO-\d{5})/);
  const quoteCsv = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exporter l'onglet quotations en CSV/ }).click();
  await verifierCsv(await quoteCsv, /quotations-.*\.csv/, client);
  const quotePdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter l'onglet actif en PDF" }).click();
  await verifierPdf(await quotePdf, /quotations-.*\.pdf/);

  obs.etape("créer une commande numérotée par la base");
  await page.getByRole("button", { name: "New Order" }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator("select").first().selectOption({ label: client });
  await dialog.getByLabel("Libellé ligne 1").fill("Prestation de conseil");
  await dialog.getByLabel("Quantité ligne 1").fill("1");
  await dialog.getByLabel("Prix unitaire ligne 1").fill("125000");
  await dialog.getByRole("button", { name: "Créer" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("tab", { name: /Sales Orders/ }).click();
  const orderRow = page.getByRole("row").filter({ hasText: client });
  await expect(orderRow).toContainText(/SO-(?:\d{4}-)?\d{4,5}/);
  obs.etape("confirmer la commande de vente");
  const confirmResponse = page.waitForResponse((response) => response.url().includes("/rpc/confirm_so"));
  await orderRow.getByRole("button", { name: "Confirmer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirmer", exact: true }).click();
  const confirmResult = await confirmResponse;
  expect(confirmResult.ok(), await confirmResult.text()).toBeTruthy();
  await expect(orderRow, JSON.stringify(obs.incidents, null, 1)).toContainText("confirmed");
  const orderCsv = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exporter l'onglet orders en CSV/ }).click();
  await verifierCsv(await orderCsv, /orders-.*\.csv/, client);
  const orderPdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter l'onglet actif en PDF" }).click();
  await verifierPdf(await orderPdf, /orders-.*\.pdf/);
  await orderRow.getByRole("button", { name: "Livrer" }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator('input[type="number"]').fill("1");
  await dialog.getByRole("button", { name: "Livrer" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("tab", { name: /Deliveries/ }).click();
  const deliveryRow = page.getByRole("row").filter({ hasText: client });
  await expect(deliveryRow).toContainText(client);
  await expect(deliveryRow).toContainText("completed");
  await expect(deliveryRow).toContainText("Facturé");
  const deliveryCsv = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exporter l'onglet deliveries en CSV/ }).click();
  await verifierCsv(await deliveryCsv, /deliveries-.*\.csv/, client);
  const deliveryPdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter l'onglet actif en PDF" }).click();
  await verifierPdf(await deliveryPdf, /deliveries-.*\.pdf/);

  // V42 : la livraison prépare une facture BROUILLON reprenant ses lignes (avant : facture émise
  // d'office, sans lignes, TVA à 0). Le comptable choisit les codes TVA puis l'émet.
  obs.etape("facture préparée en brouillon depuis la livraison, puis émise");
  await assurerPlanComptable(page);
  await page.goto("/receivables/transactions");
  const brouillon = ligne(page, client);
  await expect(brouillon).toContainText("Brouillon");
  await expect(brouillon).toContainText("125");
  await brouillon.click();
  const panneau = page.getByRole("dialog", { name: /^Facture BROUILLON-/ });
  const zone = panneau.getByRole("region", { name: "Brouillon" });
  await expect(zone.getByLabel("Code TVA ligne 1")).toBeVisible();
  await expect(panneau.getByRole("region", { name: "Lignes" })).toContainText("125");
  page.once("dialog", (d) => d.accept());
  await zone.getByRole("button", { name: "Émettre" }).click();
  testInfo.annotations.push({ type: "émission", description: await dernierToast(page) });
  await expect(panneau).toBeHidden();
  await expect(ligne(page, client)).toContainText("Émise");
  const numero = (await ligne(page, client).locator("td").nth(1).innerText()).trim();
  testInfo.annotations.push({ type: "numéro", description: numero });
  expect(numero, "numéro légal attribué à l'émission").not.toMatch(/BROUILLON/);

  await obs.joindre(testInfo);
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});
