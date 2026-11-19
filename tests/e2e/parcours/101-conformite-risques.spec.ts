import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller, verifierSocieteE2E } from "./outils";
import { assurerRoleApprobateur, pageApprobateur } from "./actions";

/*
 * Conformité et risques (V113) : catégorie, risque créé puis évalué (inhérent et résiduel), traité avec une action,
 * rattaché à un contrôle ; référentiel et contrôle, test non conforme qui ouvre un constat, refus de clôture par
 * l'auteur, clôture par le second membre (« Auditeur conformité »), test conforme ; tableaux de bord et exports.
 */
test.skip(!identifiants() || !identifiants("approbateur"), "identifiants des comptes de test absents");

test("risque évalué et traité ; contrôle testé, constat clôturé par une autre personne", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const obs = surveiller(page);
  const n = String(Date.now() % 100000).padStart(5, "0");
  const toast = (t: string) => page.locator("[data-sonner-toast]").filter({ hasText: t }).last();

  obs.etape("catégorie et paramètres des risques");
  await page.goto("/risk/master-data");
  await verifierSocieteE2E(page);
  const cats = page.getByTestId("risk-categories");
  await cats.getByLabel("Code").fill(`C${n}`);
  await cats.getByLabel("Libellé").fill(`Opérationnel ${n}`);
  await cats.getByRole("button", { name: "Ajouter la catégorie" }).click();
  await expect(cats.getByTestId("risk-category-row").filter({ hasText: `C${n}` })).toBeVisible();
  await page.goto("/risk/settings");
  const rs = page.getByTestId("risk-settings");
  await expect(rs.getByLabel("Échelle (probabilité et impact de 1 à)")).toHaveValue(/\d/);
  await rs.getByLabel("Échelle (probabilité et impact de 1 à)").fill("5");
  await rs.getByLabel("Modéré à partir du score").fill("5");
  await rs.getByLabel("Élevé à partir du score").fill("10");
  await rs.getByLabel("Critique à partir du score").fill("15");
  await rs.getByLabel("Appétence (score maximal toléré)").fill("8");
  await rs.getByRole("button", { name: "Enregistrer" }).click();
  await expect(toast("Paramètres enregistrés")).toBeVisible();

  obs.etape("risque créé, évalué, traité, action");
  await page.goto("/risk/transactions");
  await page.getByRole("button", { name: "Nouveau risque" }).click();
  const d = page.getByRole("dialog");
  const code = (await d.getByLabel("Code *").inputValue()).trim();
  await d.getByLabel("Catégorie").selectOption({ label: `C${n} — Opérationnel ${n}` });
  await d.getByLabel("Intitulé *").fill(`${RUN} Rupture fournisseur ${n}`);
  await d.getByLabel("Responsable").fill("Directeur des achats");
  await d.getByRole("button", { name: "Enregistrer" }).click();
  const ligne = page.getByTestId("risk-row").filter({ hasText: `Rupture fournisseur ${n}` });
  await expect(ligne).toContainText("Identifié");
  await ligne.click();
  const v = page.getByRole("dialog");
  await v.getByLabel("Probabilité *").selectOption("4");
  await v.getByLabel("Impact *").selectOption("5");
  await v.getByRole("button", { name: "Évaluer" }).click();
  await expect(toast("Évaluation enregistrée")).toBeVisible();
  await expect(v.getByTestId("risk-scores")).toContainText("Inhérent : 20");
  await v.getByLabel("Décision").selectOption("treating");
  await v.getByLabel("Traitement").selectOption("reduce");
  await v.getByRole("button", { name: "Appliquer" }).click();
  await expect(toast("Statut du risque modifié")).toBeVisible();
  await v.getByLabel("Nouvelle action").fill("Référencer un second fournisseur");
  await v.getByRole("button", { name: "Ajouter l'action" }).click();
  await expect(v.getByTestId("risk-action-row")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.goto("/risk");
  await expect(page.getByTestId("heatmap-inherent")).toBeVisible();
  await page.goto("/risk/control");
  await expect(page.getByTestId("risk-control-uncovered")).toContainText(code);

  obs.etape("référentiel, contrôle, test non conforme avec constat");
  await page.goto("/compliance/master-data");
  await page.getByLabel("Nom du référentiel").fill(`Contrôle interne ${n}`);
  await page.getByLabel("Version").fill("2026");
  await page.getByRole("button", { name: "Ajouter le référentiel" }).click();
  await page.getByTestId("framework-tab").filter({ hasText: `Contrôle interne ${n}` }).click();
  await page.getByRole("button", { name: "Nouveau contrôle" }).click();
  const c = page.getByRole("dialog");
  await c.getByLabel("Code *").fill(`CI-${n}`);
  await c.getByLabel("Intitulé *").fill("Double approbation des commandes");
  await c.getByLabel("Fréquence de test").selectOption("quarterly");
  await c.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("master-control-row").filter({ hasText: `CI-${n}` })).toContainText("Non testé");

  await page.goto("/risk/transactions");
  await page.getByTestId("risk-row").filter({ hasText: `Rupture fournisseur ${n}` }).click();
  await page.getByRole("dialog").getByLabel("Contrôle à rattacher").selectOption({ label: `CI-${n} — Double approbation des commandes` });
  await page.getByRole("dialog").getByRole("button", { name: "Rattacher" }).click();
  await expect(page.getByRole("dialog").getByRole("region", { name: "Contrôles" })).toContainText(`CI-${n}`);
  await page.keyboard.press("Escape");

  await page.goto("/compliance/transactions");
  await page.getByTestId("control-row").filter({ hasText: `CI-${n}` }).getByRole("button", { name: "Enregistrer un test" }).click();
  const t = page.getByRole("dialog");
  await t.getByLabel("Résultat").selectOption("fail");
  await t.getByLabel("Anomalies relevées").fill("2");
  await t.getByLabel("Constatations *").fill("Deux commandes approuvées par leur auteur");
  await t.getByLabel("Intitulé du constat *").fill(`Approbations par l'auteur ${n}`);
  await t.getByLabel("Gravité").selectOption("high");
  await t.getByRole("button", { name: "Enregistrer le test" }).click();
  await expect(toast("Test enregistré")).toBeVisible();
  await expect(page.getByTestId("control-row").filter({ hasText: `CI-${n}` })).toContainText("Déficient");

  obs.etape("clôture du constat : refusée à l'auteur, faite par le second membre");
  await page.goto("/compliance/transactions?tab=issues");
  await page.getByTestId("issue-row").filter({ hasText: `Approbations par l'auteur ${n}` }).click();
  await page.getByRole("dialog").getByLabel("Remédiation (mesures prises)").fill("Contrôle bloquant de l'auteur ajouté");
  obs.refusAttendu(/autre personne/);
  await page.getByRole("dialog").getByRole("button", { name: "Clôturer le constat" }).click();
  await expect(toast("autre personne")).toBeVisible();
  await page.keyboard.press("Escape");
  await assurerRoleApprobateur(browser, baseURL, page, "Auditeur conformité");
  const { ctx, page: pa } = await pageApprobateur(browser, baseURL);
  await pa.goto("/compliance/transactions?tab=issues");
  await pa.getByTestId("issue-row").filter({ hasText: `Approbations par l'auteur ${n}` }).click();
  await pa.getByRole("dialog").getByLabel("Remédiation (mesures prises)").fill("Contrôle bloquant de l'auteur ajouté");
  await pa.getByRole("dialog").getByRole("button", { name: "Clôturer le constat" }).click();
  await expect(pa.locator("[data-sonner-toast]").filter({ hasText: "Constat clôturé" })).toBeVisible();
  await ctx.close();

  obs.etape("test conforme, tableau de bord, export");
  await page.goto("/compliance/transactions");
  await page.getByTestId("control-row").filter({ hasText: `CI-${n}` }).getByRole("button", { name: "Enregistrer un test" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer le test" }).click();
  await expect(page.getByTestId("control-row").filter({ hasText: `CI-${n}` })).toContainText("Efficace");
  await page.goto("/compliance");
  await expect(page.getByTestId("compliance-frameworks-summary")).toContainText(`Contrôle interne ${n}`);
  await page.goto("/compliance/reporting");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Matrice des contrôles (Excel)" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/matrice-des-controles/);
  await page.goto("/risk/reporting");
  await expect(page.getByTestId("risk-report")).toContainText(`Opérationnel ${n}`);

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
