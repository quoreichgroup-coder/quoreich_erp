import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller } from "./outils";
import { pageApprobateur } from "./actions";
import { buildXlsx } from "../../../src/lib/xlsx";

/*
 * Budget, données de base, paramètres et rapports (V79) : méthode d'atterrissage, répartition des lignes
 * annuelles et types budgétables enregistrés puis rétablis ; scénario créé dans les données de base et porté
 * par un budget ; comptes budgétables suivant les paramètres ; rapports budget / réalisé, par section, mensuel
 * et comparaison de deux budgets, exportés (Excel et PDF). Exercice lointain unique, distinct des parcours 92-93.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

async function budgetImporte(page: Page, nom: string, annee: string, scenario: string | null, montant: string) {
  await page.goto("/budget/transactions");
  await page.getByRole("button", { name: "Nouveau budget" }).click();
  const nb = page.getByRole("dialog");
  await nb.getByLabel("Nom du budget").fill(nom);
  await nb.getByLabel("Exercice").fill(annee);
  if (scenario) {
    const sel = nb.getByLabel("Scénario");
    await expect(sel.locator("option", { hasText: scenario })).toHaveCount(1);
    await sel.selectOption({ label: scenario });
  }
  await nb.getByRole("button", { name: "Créer le budget" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Budget créé" }).first()).toBeVisible();
  await page.getByTestId("budget-row").filter({ hasText: nom }).click();
  const fichier = Buffer.from(buildXlsx([
    { compte: "601", section: "", periode: annee, montant },
    { compte: "601", section: "PROD", periode: annee, montant: "30000" },
  ], [{ key: "compte", header: "Compte" }, { key: "section", header: "Section" }, { key: "periode", header: "Période" }, { key: "montant", header: "Montant" }], "Budget"));
  await page.getByLabel("Importer le budget (Excel ou CSV)").setInputFiles({ name: "budget.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fichier });
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Budget importé : 2 ligne(s)" }).first()).toBeVisible();
}

test("budget : paramètres, scénario, comptes budgétables, rapports et exports", async ({ page, browser, baseURL }, testInfo) => {
  const obs = surveiller(page);
  const annee = String(5000 + (Math.floor(Date.now() / 60000) % 900));
  const code = `e2e_${RUN.toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 30);
  const scenario = `Hypothèse haute ${RUN}`;

  obs.etape("paramètres : méthode, répartition, types budgétables");
  await page.goto("/budget/settings");
  await expect(page.getByTestId("budget-control-settings")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const avant = { methode: await page.getByLabel("Méthode d'atterrissage (prévisions)").inputValue(), repartition: await page.getByLabel("Répartition mensuelle des lignes annuelles").inputValue(),
    actif: await page.getByLabel("Actif (immobilisations…)").isChecked() };
  await page.getByLabel("Méthode d'atterrissage (prévisions)").selectOption("run_rate");
  await page.getByLabel("Répartition mensuelle des lignes annuelles").selectOption("prior_year");
  if (!avant.actif) await page.getByLabel("Actif (immobilisations…)").check();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Paramètres du contrôle budgétaire enregistrés" }).first()).toBeVisible();

  try {
    obs.etape("données de base : scénario créé");
    await page.goto("/budget/master-data?tab=scenarios");
    await page.getByRole("button", { name: "Nouveau scénario" }).click();
    const sd = page.getByRole("dialog");
    await sd.getByLabel("Code").fill(code);
    await sd.getByLabel("Libellé").fill(scenario);
    await sd.getByLabel("Ordre").fill("90");
    await sd.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Scénario enregistré" }).first()).toBeVisible();
    await expect(page.getByTestId("md-scenario-row").filter({ hasText: scenario })).toContainText("Actif");

    obs.etape("comptes budgétables : l'actif est proposé");
    await page.goto("/budget/master-data?tab=accounts");
    await page.getByLabel("Rechercher", { exact: true }).fill("52");
    await expect(page.getByTestId("md-account-row").filter({ hasText: "Actif" }).first()).toBeVisible();

    obs.etape("deux budgets : référence (approuvé) et hypothèse haute");
    await budgetImporte(page, `${RUN} Budget référence`, annee, null, "100000");
    await page.getByRole("button", { name: "Soumettre" }).click();
    await expect(page.getByTestId("budget-summary")).toContainText("Soumis");
    {
      const { ctx, page: pa } = await pageApprobateur(browser, baseURL);
      await pa.goto("/budget/transactions");
      await pa.getByTestId("budget-row").filter({ hasText: `${RUN} Budget référence` }).click();
      await pa.getByRole("button", { name: "Approuver" }).click();
      await expect(pa.locator("[data-sonner-toast]").filter({ hasText: "Budget approuvé" }).first()).toBeVisible();
      await ctx.close();
    }
    await budgetImporte(page, `${RUN} Budget haut`, annee, scenario, "130000");
    await page.goto("/budget/master-data");
    await expect(page.getByTestId("md-budget-row").filter({ hasText: `${RUN} Budget haut` })).toContainText(scenario);

    obs.etape("rapports : budget / réalisé, section, mensuel");
    await page.goto("/budget/reporting");
    await page.getByLabel("Exercice").fill(annee);
    await expect(page.getByTestId("report-line")).toHaveCount(2);
    await expect(page.getByTestId("report-line").filter({ hasText: "Toutes" })).toContainText("100 000");
    const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF" }).click()]);
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
    await page.getByRole("tab", { name: "Par section" }).click();
    await expect(page.getByTestId("report-section").filter({ hasText: "Production" })).toContainText("30 000");
    await page.getByRole("tab", { name: "Mensuel" }).click();
    await expect(page.getByTestId("report-month")).toHaveCount(12);
    await expect(page.getByText("au profil du réalisé de l'exercice précédent", { exact: false }).first()).toBeVisible();

    obs.etape("comparaison de deux budgets, export Excel");
    await page.getByRole("tab", { name: "Comparaison" }).click();
    await page.getByLabel("Source A (référence)").selectOption({ label: `Budget « ${RUN} Budget référence » (${annee})` });
    await page.getByLabel("Source B (comparée)").selectOption({ label: `Budget « ${RUN} Budget haut » (${annee})` });
    const generale = page.getByTestId("report-compare-line").filter({ hasText: "Toutes" });
    await expect(generale).toContainText("30 000");
    await expect(generale).toContainText("30 %");
    const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exporter (Excel)" }).click()]);
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  } finally {
    obs.etape("paramètres et scénario rétablis");
    await page.goto("/budget/settings");
    await expect(page.getByTestId("budget-control-settings")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Méthode d'atterrissage (prévisions)").selectOption(avant.methode);
    await page.getByLabel("Répartition mensuelle des lignes annuelles").selectOption(avant.repartition);
    if (!avant.actif) await page.getByLabel("Actif (immobilisations…)").uncheck();
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Paramètres du contrôle budgétaire enregistrés" }).first()).toBeVisible();
    await page.goto("/budget/master-data?tab=scenarios");
    const ligne = page.getByTestId("md-scenario-row").filter({ hasText: scenario });
    if (await ligne.count()) {
      await ligne.getByRole("button", { name: "Désactiver" }).click();
      await expect(ligne).toContainText("Inactif");
    }
  }

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
