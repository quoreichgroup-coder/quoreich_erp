import { test, expect } from "@playwright/test";
import { identifiants, surveiller } from "./outils";

/*
 * Comptabilité générale, après les parcours précédents : journal des écritures et états (balance,
 * compte de résultat, bilan) lisibles et exportables, avec les mêmes données que l'écran.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("journal des écritures et états comptables : affichage et exports", async ({ page }, testInfo) => {
  const obs = surveiller(page);

  obs.etape("journal des écritures");
  await page.goto("/journal");
  await page.getByPlaceholder(/Rechercher|Search/i).first().fill("BQ-");
  await expect(page.getByText(/BQ-\d{4}-\d{6}/).first(), "encaissements et paiements au journal de banque, avec leur numéro de pièce").toBeVisible();
  await page.getByPlaceholder(/Rechercher|Search/i).first().fill("");
  let telechargement = page.waitForEvent("download");
  await page.getByTestId("btn-export-csv").click();
  expect((await telechargement).suggestedFilename()).toMatch(/^ecritures-comptables.*\.csv$/);

  obs.etape("numéros de pièce par journal (V38)");
  await page.getByPlaceholder(/Rechercher|Search/i).first().fill("AC-");
  await expect(page.getByText(/AC-\d{4}-\d{6}/).first(), "factures fournisseurs au journal des achats").toBeVisible();
  await page.getByPlaceholder(/Rechercher|Search/i).first().fill("");

  obs.etape("lots du grand livre alimentés par les livres auxiliaires (V38)");
  await page.goto("/payables/transactions?tab=posting");
  await expect(page.getByText(/LOT-AC-\d{4}-\d{2}/).first(), "lot du journal des achats").toBeVisible();
  // Standard de présentation : la comptabilisation est un onglet de Transactions.
  await page.goto("/receivables/transactions?tab=posting");
  await expect(page.getByText(/LOT-VT-\d{4}-\d{2}/).first(), "lot du journal des ventes").toBeVisible();
  await expect(page.getByText(/LOT-BQ-\d{4}-\d{2}/).first(), "lot du journal de banque").toBeVisible();

  obs.etape("balance de vérification");
  await page.goto("/journal/reporting");
  await expect(page.getByRole("heading", { name: "Balance de Vérification" })).toBeVisible();
  await expect(page.getByText("411").first()).toBeVisible();
  telechargement = page.waitForEvent("download");
  await page.getByTestId("btn-export-gl-0").click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toMatch(/^balance-de-verification.*\.csv$/);
  testInfo.annotations.push({ type: "export", description: fichier.suggestedFilename() });

  await obs.joindre(testInfo);
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});

// V60 : contrôle SYSCOHADA du plan comptable, comptes de regroupement et rattachement des sous-comptes.
test("plan comptable : contrôle SYSCOHADA, regroupements, rattachement", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  obs.etape("contrôle affiché");
  await page.goto("/journal/master-data");
  const resume = page.getByTestId("chart-issues-summary");
  await expect(resume).not.toHaveText("Analyse…");
  testInfo.annotations.push({ type: "contrôle avant", description: await resume.innerText() });

  obs.etape("regroupements puis rattachement");
  await page.getByRole("button", { name: "Créer les comptes de regroupement" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Comptes de regroupement créés" })).toBeVisible();
  await page.getByRole("button", { name: "Rattacher les sous-comptes" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Sous-comptes rattachés" })).toBeVisible();
  await expect(page.getByTestId("chart-issue-row").filter({ hasText: "Sous-compte non rattaché" })).toHaveCount(0);
  await expect(page.getByTestId("chart-issue-row").filter({ hasText: "Erreur" })).toHaveCount(0);
  testInfo.annotations.push({ type: "contrôle après", description: await resume.innerText() });

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});

// V62–V63 (PC-1, PC-2) : fiche compte paramétrable (attribut personnalisé, historique) ; états par rubriques.
test("plan comptable : attributs de compte, historique ; bilan SYSCOHADA équilibré", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const suffixe = String(Date.now()).slice(-5);
  const cle = `axe_${suffixe}`;

  obs.etape("attribut personnalisé (liste, facultatif)");
  await page.goto("/journal/master-data");
  await page.getByRole("button", { name: "Attributs personnalisés" }).click();
  const at = page.getByRole("dialog");
  await at.getByLabel("Clé (minuscules)").fill(cle);
  await at.getByLabel("Libellé").fill(`Axe ${suffixe}`);
  await at.getByLabel("Type").selectOption("list");
  await at.getByLabel("Valeurs (liste, séparées par des virgules)").fill("siege, usine");
  await at.getByRole("button", { name: "Ajouter l'attribut" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Attribut enregistré" })).toBeVisible();
  await at.getByRole("button", { name: "Fermer" }).click();

  obs.etape("compte avec attributs, puis modification historisée");
  await page.getByRole("button", { name: "Ajouter un compte" }).click();
  const f = page.getByRole("dialog");
  await f.getByLabel("Code *").fill(`6389${suffixe}`);
  await f.getByLabel("Intitulé *").fill(`Frais divers ${suffixe}`);
  await f.getByLabel("Type").selectOption("expense");
  await expect(f.getByLabel("Sens normal")).toHaveValue("debit");
  await f.getByLabel(`Axe ${suffixe}`).selectOption("usine");
  await f.getByRole("button", { name: "Créer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Compte créé" })).toBeVisible();

  obs.etape("états par rubriques : bilan équilibré");
  await page.goto("/journal/reporting");
  await page.getByRole("button", { name: "États SYSCOHADA (rubriques)" }).click();
  await page.getByLabel("État", { exact: true }).selectOption("BILAN_SYSCOHADA");
  const montant = async (ref: string) => (await page.getByTestId("statement-line").filter({ hasText: new RegExp(`^${ref}`) }).locator("td").nth(2).innerText()).trim();
  await expect(page.getByTestId("statement-line").filter({ hasText: /^BZ/ })).toBeVisible();
  const actif = await montant("BZ"), passif = await montant("DZ");
  testInfo.annotations.push({ type: "bilan", description: `actif ${actif} / passif ${passif}` });
  expect(actif, "total actif = total passif").toBe(passif);
  await page.getByLabel("État", { exact: true }).selectOption("CR_SYSCOHADA");
  await expect(page.getByTestId("statement-line").filter({ hasText: /^XI/ })).toBeVisible();

  // Nettoyage : l'attribut de test est désactivé pour ne pas peser sur les autres parcours.
  await page.goto("/journal/master-data");
  await page.getByRole("button", { name: "Attributs personnalisés" }).click();
  await page.getByRole("dialog").getByLabel(`Actif ${cle}`).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Attribut enregistré" }).last()).toBeVisible();

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});

// V64 (PC-3) : référentiels versionnés, règles de qualité réglables par société.
test("plans et référentiels : référentiel appliqué, règle désactivée puis rétablie", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  obs.etape("référentiels");
  await page.goto("/journal/charts");
  await expect(page.getByTestId("framework-row").filter({ hasText: "appliqué" })).toContainText("SYSCOHADA");
  await expect(page.getByTestId("framework-row").filter({ hasText: "PCG" })).toContainText("2025");

  obs.etape("règle de qualité");
  await page.getByRole("tab", { name: "Règles de qualité" }).click();
  const interrupteur = page.getByRole("switch", { name: "Activer la règle Doublon d'intitulé" });
  await expect(interrupteur).toBeChecked();
  await interrupteur.click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Règle de qualité enregistrée" }).first()).toBeVisible();
  await expect(interrupteur).not.toBeChecked();
  await page.goto("/journal/master-data");
  await expect(page.getByTestId("chart-issues-summary")).not.toHaveText("Analyse…");
  await expect(page.getByTestId("chart-issue-row").filter({ hasText: "Doublon d'intitulé" })).toHaveCount(0);

  obs.etape("rétablir");
  await page.goto("/journal/charts?tab=rules");
  await page.getByTestId("quality-rule-row").filter({ hasText: "Doublon d'intitulé" }).getByRole("button", { name: "Rétablir" }).click();
  await expect(page.getByRole("switch", { name: "Activer la règle Doublon d'intitulé" })).toBeChecked();

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});

// V65 (PC-4) : import guidé du plan comptable — préparation, correction, validation (séparation des
// tâches paramétrable), plan exporté au même format.
test("plan comptable : import guidé, correction, validation, export", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const base = `6059${String(Date.now()).slice(-4)}`;
  const csv = `Code,Intitulé,Type,Parent,Regroupement\n${base},Petit matériel E2E,Charges,,oui\n${base}1,Petit outillage E2E,,${base},non\n${base}1,Doublon E2E,,,non\n`;

  obs.etape("préparation");
  await page.goto("/journal/charts?tab=import");
  await page.getByLabel("Profil").selectOption({ label: "Modèle QUOREICH (export / import)" });
  await page.getByLabel("Fichier CSV").setInputFiles({ name: `plan-${base}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
  await expect(page.getByTestId("import-file-summary")).toContainText("3 ligne(s) lue(s)");
  await page.getByRole("button", { name: "Préparer l'import" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Import préparé" }).first()).toBeVisible();
  const lignes = page.getByTestId("import-row");
  await expect(lignes).toHaveCount(3);
  await expect(page.getByTestId("import-run-summary")).toContainText("2 erreur(s)");

  obs.etape("correction");
  await lignes.nth(2).getByRole("button", { name: "Corriger" }).click();
  await page.getByRole("button", { name: "Ignorer la ligne" }).click();
  await expect(page.getByTestId("import-run-summary")).toContainText("0 erreur(s)");

  obs.etape("validation");
  const valider = page.getByRole("button", { name: "Valider l'import" });
  await expect(valider).toBeDisabled();
  await expect(page.getByText("une autre personne doit le valider")).toBeVisible();
  await page.getByRole("switch", { name: "Validation par une autre personne" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Paramètres d'import enregistrés" }).first()).toBeVisible();
  await valider.click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Import validé : 2 compte(s) créé(s)" })).toBeVisible();
  await page.getByRole("switch", { name: "Validation par une autre personne" }).click();
  await expect(page.getByRole("switch", { name: "Validation par une autre personne" })).toBeChecked();

  obs.etape("export du plan");
  await page.goto("/journal/master-data");
  const [telechargement] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exporter le plan" }).click()]);
  const contenu = await (await import("node:fs/promises")).readFile(await telechargement.path(), "utf-8");
  expect(contenu).toContain(`${base}1,Petit outillage E2E,Charges,${base},non`);

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
