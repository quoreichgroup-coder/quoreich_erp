import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller, verifierSocieteE2E } from "./outils";
import { assurerRoleApprobateur, pageApprobateur } from "./actions";

/*
 * Projets (V111) et notes de frais (V112) : axe des projets choisi, projet créé (sa section naît avec lui),
 * budget par compte ; une note de frais imputée au projet, avec une indemnité kilométrique au barème et une
 * dépense en devise, approuvée par le second membre, comptabilisée puis remboursée en imputant une avance ;
 * le réalisé du projet et son grand livre montrent la dépense.
 */
test.skip(!identifiants() || !identifiants("approbateur"), "identifiants des comptes de test absents");

const AXE = "E2EPRJ";

async function assurerAxeProjets(page: Page) {
  await page.goto("/settings?tab=analytics");
  await expect(page.getByTestId("analytics-panel")).toBeVisible();
  await page.waitForLoadState("networkidle");
  if (!(await page.getByTestId(`axis-tab-${AXE}`).count())) {
    await page.locator("#new-axis-code").fill(AXE);
    await page.locator("#new-axis-name").fill("E2E Projets");
    await page.getByTestId("btn-create-axis").click();
    await expect(page.getByTestId(`axis-tab-${AXE}`)).toBeVisible();
  }
  await page.goto("/projects/settings");
  const axe = page.getByLabel("Axe analytique des projets *");
  await expect(axe.locator("option", { hasText: `${AXE} — E2E Projets` })).toHaveCount(1);
  if ((await axe.inputValue()) === "" || !(await axe.locator("option:checked").innerText()).startsWith(AXE)) {
    await axe.selectOption({ label: `${AXE} — E2E Projets` });
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Paramètres enregistrés" })).toBeVisible();
  }
}

test("projet : section, budget, note de frais imputée (barème, devise, avance), réalisé du projet", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const obs = surveiller(page);
  const n = String(Date.now() % 100000).padStart(5, "0");
  const code = `P${n}`;

  obs.etape("axe des projets et projet");
  await page.goto("/projects");
  await verifierSocieteE2E(page);
  await assurerAxeProjets(page);
  await page.goto("/projects/master-data");
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Code *").fill(code);
  await d.getByLabel("Intitulé *").fill(`Chantier ${RUN}`);
  await d.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("project-row").filter({ hasText: code })).toContainText("Actif");

  obs.etape("budget du projet");
  await page.goto("/projects/transactions");
  await page.getByLabel("Projet", { exact: true }).selectOption({ label: `${code} — Chantier ${RUN}` });
  const budget = page.getByTestId("project-budget");
  const compte = budget.getByLabel("Compte");
  await expect(compte.locator("option").nth(1)).toBeAttached();
  await compte.selectOption({ index: 1 });
  await budget.getByLabel("Montant").fill("500000");
  await budget.getByRole("button", { name: "Ajouter au budget" }).click();
  await expect(budget.getByTestId("project-budget-line")).toHaveCount(1);

  obs.etape("barème kilométrique (catégorie imputable créée au besoin)");
  await page.goto("/expenses/master-data");
  await page.getByRole("button", { name: "Nouvelle catégorie" }).click();
  const c = page.getByRole("dialog");
  await c.getByLabel("Code *").fill(`K${n}`);
  await c.getByLabel("Libellé *").fill(`Déplacements ${n}`);
  await expect(c.getByLabel("Compte de charge *").locator("option").nth(1)).toBeAttached();
  await c.getByLabel("Compte de charge *").selectOption({ index: 1 });
  await c.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("expense-category-row").filter({ hasText: `K${n}` })).toBeVisible();
  const bareme = page.getByTestId("expense-rates");
  await bareme.getByLabel("Code").fill(`KM${n}`);
  await bareme.getByLabel("Libellé").fill("Indemnité kilométrique");
  await bareme.getByLabel("Taux par unité").fill("150");
  await bareme.getByLabel("Catégorie (compte)").selectOption({ label: `K${n} — Déplacements ${n}` });
  await bareme.getByRole("button", { name: "Ajouter le barème" }).click();
  await expect(bareme.getByTestId("expense-rate-row").filter({ hasText: `KM${n}` })).toBeVisible();

  obs.etape("avance versée au salarié");
  await page.goto("/expenses/transactions?tab=advances");
  const av = page.getByTestId("expense-advances");
  const salarie = av.getByLabel("Salarié");
  await expect(salarie.locator("option").nth(1)).toBeAttached();
  await salarie.selectOption({ index: 1 });
  const nomSalarie = (await salarie.locator("option:checked").innerText()).split(" — ")[1];
  await av.getByLabel("Montant de l'avance").fill("20000");
  await av.getByLabel("Objet").fill(`Avance ${RUN}`);
  await av.getByRole("button", { name: "Verser l'avance" }).click();
  await expect(av.getByTestId("expense-advance-row").filter({ hasText: `Avance ${RUN}` })).toContainText("20 000");

  obs.etape("note imputée au projet : 100 km au barème, hôtel en euros");
  await page.goto("/expenses/transactions");
  await page.getByRole("button", { name: "Nouvelle note de frais" }).click();
  const f = page.getByRole("dialog");
  await f.getByLabel("Salarié *").selectOption({ label: (await f.getByLabel("Salarié *").locator("option", { hasText: nomSalarie }).first().innerText()) });
  await f.getByLabel("Objet (mission, déplacement…)").fill(`${RUN} Mission ${code}`);
  await f.getByLabel("Type ligne 1").selectOption("rate");
  await f.getByLabel("Barème ligne 1").selectOption({ label: `KM${n} — Indemnité kilométrique (150 / km)` });
  await f.getByLabel("Quantité ligne 1").fill("100");
  await f.getByLabel("Libellé ligne 1").fill("Trajet chantier");
  await f.getByLabel("Projet ligne 1").selectOption({ label: `${code} — Chantier ${RUN}` });
  await f.getByRole("button", { name: "Ajouter une ligne" }).click();
  await f.getByLabel("Catégorie ligne 2").selectOption({ label: `K${n} — Déplacements ${n}` });
  await f.getByLabel("Devise ligne 2").fill("EUR");
  await f.getByLabel("Montant TTC ligne 2").fill("50");
  await f.getByLabel("Cours ligne 2").fill("655.957");
  await f.getByLabel("Libellé ligne 2").fill("Hôtel");
  await f.getByLabel("Justificatif ligne 2").fill(`H-${n}`);
  await f.getByLabel("Projet ligne 2").selectOption({ label: `${code} — Chantier ${RUN}` });
  await expect(f.getByTestId("expense-total"), "15 000 + 50 × 655,957").toHaveText("47 797,85");
  await f.getByRole("button", { name: "Enregistrer et soumettre" }).click();
  const ligne = page.getByTestId("expense-row").filter({ hasText: `Mission ${code}` });
  await expect(ligne).toContainText("En approbation");
  const numero = (await ligne.locator("td").nth(1).innerText()).trim();

  obs.etape("approbation par le second membre, comptabilisation, remboursement avec avance");
  await assurerRoleApprobateur(browser, baseURL, page, "Approbateur notes de frais");
  const { ctx, page: pa } = await pageApprobateur(browser, baseURL);
  await pa.goto("/expenses/transactions?tab=approvals");
  await pa.getByTestId("expense-row").filter({ hasText: numero }).click();
  await pa.getByRole("dialog").getByRole("button", { name: "Approuver" }).click();
  await expect(pa.locator("[data-sonner-toast]").filter({ hasText: "Décision enregistrée" })).toBeVisible();
  await ctx.close();
  await page.goto("/expenses/transactions?tab=posting");
  const aTraiter = page.getByTestId("expense-row").filter({ hasText: numero });
  await aTraiter.click();
  await page.getByRole("dialog").getByRole("button", { name: "Comptabiliser" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Note comptabilisée" })).toBeVisible();
  // La liste se rafraîchit après la comptabilisation : rouvrir la note avant risque d'afficher l'ancien état.
  await page.keyboard.press("Escape");
  await expect(aTraiter).toContainText(/Comptabilis/, { timeout: 30_000 });
  await aTraiter.click();
  const v = page.getByRole("dialog");
  // Avances ouvertes du salarié : au moins celle versée par ce passage (un passage interrompu peut en laisser d'autres).
  await expect(v.getByTestId("expense-advances-available")).toContainText(/disponibles/);
  await v.getByLabel("Mode").selectOption("cash");
  await v.getByRole("button", { name: "Rembourser" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Note remboursée" })).toBeVisible();
  await page.goto("/expenses/transactions");
  await page.getByTestId("expense-row").filter({ hasText: numero }).click();
  await expect(page.getByRole("dialog").getByRole("region", { name: "Pied" })).toContainText("Avances imputées");
  await page.keyboard.press("Escape");

  obs.etape("le projet montre la dépense");
  await page.goto("/projects/transactions");
  await page.getByLabel("Projet", { exact: true }).selectOption({ label: `${code} — Chantier ${RUN}` });
  await expect(page.getByTestId("project-ledger-row").filter({ hasText: "Note de frais" }).first()).toBeVisible();
  await expect(page.getByTestId("project-figures")).toContainText("47 797,85");

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
