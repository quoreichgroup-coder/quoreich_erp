import { readFile } from "node:fs/promises";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { identifiants, surveiller, verifierSocieteE2E } from "./outils";

/*
 * Impression des pièces et actions groupées, sur les données que les parcours précédents ont laissées
 * dans la société de test : chaque module offre la sélection de lignes, une barre d'actions, et
 * l'impression PDF / Excel d'une pièce ou de la sélection. Les fichiers téléchargés sont vérifiés.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

async function telecharger(page: Page, bouton: Locator, extension: RegExp) {
  const [f] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), bouton.click()]);
  expect(f.suggestedFilename()).toMatch(extension);
  return f;
}

/** Un classeur .xlsx est une archive ZIP (« PK ») ; un PDF commence par « %PDF ». */
async function signature(f: Awaited<ReturnType<typeof telecharger>>) {
  return (await readFile(await f.path())).subarray(0, 4).toString("latin1");
}

test("impression des pièces et actions groupées dans les modules", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const obs = surveiller(page);

  obs.etape("achats : sélection des demandes, barre d'actions, export Excel de la sélection");
  await page.goto("/procurement/transactions");
  await verifierSocieteE2E(page);
  const toutesDA = page.getByRole("checkbox", { name: "Sélectionner toutes les demandes" });
  await expect(toutesDA).toBeEnabled({ timeout: 30_000 });
  await toutesDA.check();
  const barreDA = page.getByTestId("bulk-bar-pr");
  await expect(barreDA).toContainText("sélectionnée(s)");
  expect(await signature(await telecharger(page, barreDA.getByRole("button", { name: "Excel", exact: true }), /\.xlsx$/))).toBe("PK\u0003\u0004");
  await barreDA.getByRole("button", { name: "Effacer la sélection" }).click();
  await expect(barreDA).toBeHidden();

  obs.etape("achats : commande imprimée (PDF) et en Excel depuis « Voir »");
  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  await page.getByRole("button", { name: "Voir" }).first().click();
  const vue = page.getByRole("dialog");
  expect(await signature(await telecharger(page, vue.getByTestId("btn-document-pdf"), /\.pdf$/))).toBe("%PDF");
  expect(await signature(await telecharger(page, vue.getByTestId("btn-document-xlsx"), /\.xlsx$/))).toBe("PK\u0003\u0004");
  await page.keyboard.press("Escape");

  obs.etape("comptes clients : facture imprimée et en Excel");
  await page.goto("/receivables/transactions");
  await page.getByRole("row").filter({ hasText: /FA-|BROUILLON-/ }).first().locator("td").nth(1).click();
  const panneau = page.getByRole("dialog");
  const facture = await telecharger(page, panneau.getByTestId("btn-document-pdf"), /\.pdf$/);
  expect(await signature(facture)).toBe("%PDF");
  await facture.saveAs(testInfo.outputPath("facture-client.pdf"));
  expect(await signature(await telecharger(page, panneau.getByTestId("btn-document-xlsx"), /\.xlsx$/))).toBe("PK\u0003\u0004");
  await page.keyboard.press("Escape");

  obs.etape("comptes fournisseurs : sélection, export de la sélection en PDF");
  await page.goto("/payables/transactions");
  const toutes = page.getByRole("checkbox", { name: "Sélectionner toutes les factures" });
  await expect(toutes).toBeEnabled({ timeout: 30_000 });
  await toutes.check();
  const barreAP = page.getByTestId("bulk-bar-ap");
  await expect(barreAP).toBeVisible();
  expect(await signature(await telecharger(page, barreAP.getByRole("button", { name: "PDF", exact: true }), /\.pdf$/))).toBe("%PDF");

  obs.etape("grand livre : brouillard des écritures sélectionnées");
  await page.goto("/journal/transactions");
  const ecritures = page.getByTestId("gl-entry-row");
  await expect(ecritures.first()).toBeVisible();
  await ecritures.nth(0).getByRole("checkbox").check();
  if (await ecritures.count() > 1) await ecritures.nth(1).getByRole("checkbox").check();
  const brouillard = page.getByTestId("gl-bulk-print");
  expect(await signature(await telecharger(page, brouillard.getByRole("button", { name: "Imprimer" }), /^brouillard-.*\.pdf$/))).toBe("%PDF");
  expect(await signature(await telecharger(page, brouillard.getByRole("button", { name: "Excel" }), /^brouillard-.*\.xlsx$/))).toBe("PK\u0003\u0004");

  obs.etape("stocks : bon de mouvements de la sélection");
  await page.goto("/inventory/transactions");
  const mouvements = page.getByTestId("stock-movement-row");
  await expect(mouvements.first()).toBeVisible();
  await mouvements.first().getByRole("checkbox").check();
  expect(await signature(await telecharger(page, page.getByTestId("stock-slip-print").getByRole("button", { name: "Imprimer" }), /^bon-.*\.pdf$/))).toBe("%PDF");

  obs.etape("trésorerie : bordereau ou ordre de virement de la sélection");
  await page.goto("/treasury/transactions");
  const tresorerie = page.getByTestId("treasury-movement-row");
  await expect(tresorerie.first()).toBeVisible();
  await tresorerie.first().getByRole("checkbox").check();
  expect(await signature(await telecharger(page, page.getByTestId("treasury-slip-print").getByRole("button", { name: "Imprimer" }), /\.pdf$/))).toBe("%PDF");

  obs.etape("listes : export PDF à côté d'Excel et CSV");
  await page.goto("/treasury/transactions");
  expect(await signature(await telecharger(page, page.getByRole("button", { name: "Exporter les mouvements (PDF)" }), /\.pdf$/))).toBe("%PDF");

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
