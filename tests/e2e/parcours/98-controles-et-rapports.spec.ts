import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller, verifierSocieteE2E } from "./outils";

/*
 * Lot 3 (V106–V108) : écrans de contrôle et de rapports sans données de démonstration, sur les données que
 * les parcours précédents ont laissées dans la société de test.
 *   • Grand livre → Contrôle : anomalies, concordance des livres, intégrité, piste d'audit, simulateur ;
 *   • paramètres des contrôles : seuil fixé, anomalie signalée, seuil retiré ;
 *   • Trésorerie → Contrôle : limites des comptes et piste d'audit réelles ;
 *   • Approvisionnement : rapports calculés, niveau d'approbation ajouté puis supprimé.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("contrôles du grand livre, limites de trésorerie, rapports et seuils d'approbation réels", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const obs = surveiller(page);

  obs.etape("grand livre : concordance, intégrité, piste d'audit");
  await page.goto("/journal/control");
  await verifierSocieteE2E(page);
  await expect(page.getByTestId("gl-control-kpis")).toBeVisible();
  await page.getByRole("tab", { name: "Concordance des livres" }).click();
  await expect(page.getByTestId("gl-recon-row").filter({ hasText: /^Clients : factures/ })).toBeVisible();
  testInfo.annotations.push({ type: "concordance clients", description: await page.getByTestId("gl-recon-row").filter({ hasText: /^Clients : factures/ }).innerText() });
  await page.getByRole("tab", { name: "Intégrité" }).click();
  await expect(page.getByTestId("gl-integrity-check").filter({ hasText: "équilibrées" })).toContainText("Réussi");
  // V120 : chaîne SHA-256 de la piste d'audit vérifiée à chaque contrôle.
  await expect(page.getByTestId("gl-integrity-check").filter({ hasText: "Chaîne de la piste d'audit intacte" })).toContainText("Réussi");
  await page.getByRole("tab", { name: "Piste d'audit" }).click();
  await expect(page.getByTestId("gl-audit-trail").locator("tbody tr").first()).toContainText(/Créée|Comptabilisée|Contre-passée|Brouillon supprimé|Modifiée/);
  await page.getByRole("tab", { name: "Simulateur d'écriture" }).click();
  await page.getByLabel("Débit ligne 1").fill("1000");
  await expect(page.getByTestId("simulation-result")).toContainText("Écart débit − crédit");

  obs.etape("paramètres : seuil d'anomalie fixé, écritures signalées, seuil retiré");
  await page.goto("/journal/settings?tab=controls");
  const reglages = page.getByTestId("gl-control-settings");
  await reglages.getByLabel("Signaler les écritures à partir de (montant)").fill("1");
  await reglages.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Paramètres des contrôles enregistrés" })).toBeVisible();
  await page.goto("/journal/control");
  const debut = page.getByLabel("Du");
  await debut.fill("2000-01-01");
  await expect(page.getByTestId("gl-finding").filter({ hasText: "Montant au-delà du seuil" }).first()).toBeVisible();
  await page.goto("/journal/settings?tab=controls");
  await reglages.getByLabel("Signaler les écritures à partir de (montant)").fill("");
  await reglages.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Paramètres des contrôles enregistrés" }).last()).toBeVisible();

  obs.etape("trésorerie : limites et piste d'audit réelles");
  // V121 : aperçu de la clôture de l'exercice en cours et état des à-nouveaux (sans clôturer : irréversible).
  await page.goto("/settings?tab=fiscal");
  const annee = page.locator('[data-testid^="fiscal-preview-"]').first();
  if (await annee.count()) {
    await annee.click();
    await expect(page.locator('[data-testid^="fiscal-close-preview-"]').first()).toContainText(/Produits/);
    await expect(page.locator('[data-testid^="fiscal-preview-result-"]').first()).toHaveText(/\d/);
  }
  await expect(page.getByTestId("fiscal-close-setting")).toBeVisible();
  // Une société sans exercice défini (régime des seules clôtures de période) n'a ni aperçu ni à-nouveaux.
  const ouverture = page.locator('[data-testid^="fiscal-opening-"]').first();
  if (await page.locator('[data-testid^="fiscal-year-"]').count()) {
    await ouverture.click();
    await expect(page.locator('[data-testid^="fiscal-opening-print-"]').first()).toBeVisible();
  }

  await page.goto("/treasury/control");
  await page.getByRole("button", { name: "Limites des comptes" }).click();
  await expect(page.getByTestId("treasury-limits")).toBeVisible();
  await expect(page.getByTestId("treasury-limit-row").first()).toBeVisible();
  await page.getByRole("button", { name: "Piste d'audit" }).click();
  await expect(page.getByTestId("treasury-audit-row").first()).toBeVisible();

  obs.etape("approvisionnement : rapports calculés");
  await page.goto("/procurement/reporting");
  await expect(page.getByTestId("procurement-report-kpis")).toContainText("Dépenses engagées");
  await expect(page.getByTestId("procurement-spend-supplier").locator("tbody tr").first()).not.toContainText("Aucune commande");

  obs.etape("approvisionnement : niveau d'approbation ajouté puis supprimé");
  await page.goto("/procurement/settings");
  await page.getByRole("button", { name: "Niveaux d'approbation" }).click();
  const seuils = page.getByTestId("approval-thresholds-procurement");
  const niveau = `L9 — ${RUN}`;
  await seuils.getByLabel("Niveau", { exact: true }).fill(niveau);
  await seuils.getByLabel("Approbateur", { exact: true }).fill("Contrôle E2E");
  await seuils.getByLabel("Plafond (vide = sans)").fill("999999999999");
  await seuils.getByRole("button", { name: "Ajouter le niveau" }).click();
  await expect(seuils.getByTestId("approval-threshold-row").filter({ hasText: niveau })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await seuils.getByRole("button", { name: `Supprimer le niveau ${niveau}` }).click();
  await expect(seuils.getByTestId("approval-threshold-row").filter({ hasText: niveau })).toHaveCount(0);

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
