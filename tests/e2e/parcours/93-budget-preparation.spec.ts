import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller } from "./outils";
import { ligne } from "./champs";
import { pageApprobateur } from "./actions";
import { buildXlsx } from "../../../src/lib/xlsx";

/*
 * Budget, fin du module (V78) : budget préparé par fichier Excel (modèle téléchargé, fichier importé, ligne
 * sans montant ignorée), approuvé par le second membre ; révision demandée puis validée par une autre personne
 * (paramètre rétabli ensuite) ; demande d'achat ventilée par section ligne à ligne (pré-engagé de la section =
 * sa ligne seulement) ; version de prévision créée depuis l'atterrissage calculé, modifiée, publiée. Exercice
 * lointain unique par passage, distinct de celui du parcours 92.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

const AXE = "E2EBUD";

async function assurerSections(page: Page) {
  await page.goto("/settings?tab=analytics");
  await expect(page.getByTestId("analytics-panel")).toBeVisible();
  await page.waitForLoadState("networkidle");
  if (!(await page.getByTestId(`axis-tab-${AXE}`).count())) {
    await page.locator("#new-axis-code").fill(AXE);
    await page.locator("#new-axis-name").fill("E2E Centre budgétaire");
    await page.getByTestId("btn-create-axis").click();
    await expect(page.getByTestId(`axis-tab-${AXE}`)).toBeVisible();
  }
  await page.getByTestId(`axis-tab-${AXE}`).click();
  const detail = page.getByTestId(`axis-detail-${AXE}`);
  await expect(detail).toBeVisible();
  for (const [code, nom] of [["PROD", "Production"], ["ADM", "Administration"]]) {
    if (!(await detail.getByTestId(`value-row-${code}`).count())) {
      await detail.locator("#new-value-code").fill(code);
      await detail.locator("#new-value-name").fill(nom);
      await detail.getByTestId("btn-create-value").click();
      await expect(detail.getByTestId(`value-row-${code}`)).toBeVisible();
    }
  }
}

async function choisir(sel: import("@playwright/test").Locator, debut: RegExp) {
  await expect(sel.locator("option", { hasText: debut })).toHaveCount(1);
  await sel.selectOption({ label: (await sel.locator("option", { hasText: debut }).textContent())! });
  await expect(sel).not.toHaveValue("");
}

async function reglerRevisions(page: Page, actif: boolean, seuil: string) {
  await page.goto("/budget/settings?tab=approval");
  await expect(page.getByTestId("budget-approval-settings")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const sw = page.getByRole("switch", { name: "Révisions validées par une autre personne" });
  const avant = { actif: await sw.isChecked(), seuil: await page.getByLabel("Seuil de la demande (% d'écart)").inputValue() };
  if (avant.actif !== actif) await sw.click();
  if (actif) await page.getByLabel("Seuil de la demande (% d'écart)").fill(seuil);
  if (avant.actif !== actif || (actif && avant.seuil !== seuil)) {
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Paramètres du contrôle budgétaire enregistrés" }).first()).toBeVisible();
  }
  return avant;
}

test("budget préparé par fichier, révision validée par un tiers, sections par ligne, prévision publiée", async ({ page, browser, baseURL }, testInfo) => {
  const obs = surveiller(page);
  const annee = String(4000 + (Math.floor(Date.now() / 1000) % 900));
  const nom = `${RUN} Budget importé`;

  obs.etape("prérequis : sections Production et Administration");
  await assurerSections(page);

  obs.etape("budget : modèle téléchargé, fichier importé");
  await page.goto("/budget/transactions");
  await page.getByRole("button", { name: "Nouveau budget" }).click();
  const nb = page.getByRole("dialog");
  await nb.getByLabel("Nom du budget").fill(nom);
  await nb.getByLabel("Exercice").fill(annee);
  await nb.getByRole("button", { name: "Créer le budget" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Budget créé" }).first()).toBeVisible();
  await page.getByTestId("budget-row").filter({ hasText: nom }).click();
  const [modele] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Modèle de budget (Excel)" }).click()]);
  expect(modele.suggestedFilename()).toMatch(/^modele-budget-\d{4}\.xlsx$/);
  const fichier = Buffer.from(buildXlsx([
    { compte: "601", intitule: "Achats", section: "", periode: annee, montant: "100 000", commentaire: "" },
    { compte: "601", intitule: "Achats", section: "PROD", periode: `Année ${annee}`, montant: "30 000", commentaire: "Atelier et ligne 2" },
    { compte: "604", intitule: "Études", section: "", periode: annee, montant: "", commentaire: "sans montant : ignorée" },
  ], [{ key: "compte", header: "Compte" }, { key: "intitule", header: "Intitulé" }, { key: "section", header: "Section" }, { key: "periode", header: "Période" },
    { key: "montant", header: "Montant" }, { key: "commentaire", header: "Commentaire" }], "Budget"));
  await page.getByLabel("Importer le budget (Excel ou CSV)").setInputFiles({ name: "budget.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fichier });
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Budget importé : 2 ligne(s)" }).first()).toBeVisible();
  await expect(page.getByTestId("budget-line")).toHaveCount(2);
  await expect(page.getByTestId("budget-line").filter({ hasText: "Production" })).toContainText("30 000");
  await page.getByRole("button", { name: "Soumettre" }).click();
  await expect(page.getByTestId("budget-summary")).toContainText("Soumis");

  obs.etape("approbation par le second membre");
  {
    const { ctx, page: pa } = await pageApprobateur(browser, baseURL);
    await pa.goto("/budget/transactions");
    await pa.getByTestId("budget-row").filter({ hasText: nom }).click();
    await pa.getByRole("button", { name: "Approuver" }).click();
    await expect(pa.locator("[data-sonner-toast]").filter({ hasText: "Budget approuvé" }).first()).toBeVisible();
    await ctx.close();
  }

  const avant = await reglerRevisions(page, true, "0");
  try {
    obs.etape("révision demandée par l'administrateur");
    await page.goto("/budget/transactions");
    await page.getByTestId("budget-row").filter({ hasText: nom }).click();
    const generale = page.getByTestId("budget-line").filter({ hasText: "Toutes" });
    await generale.getByRole("button", { name: "Réviser" }).click();
    const rv = page.getByRole("dialog");
    await rv.getByLabel("Nouveau montant").fill("120000");
    await rv.getByLabel("Motif").fill("Hausse des prix des fournitures");
    await rv.getByRole("button", { name: "Réviser" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Demande de révision enregistrée" }).first()).toBeVisible();
    await expect(generale.getByTestId("budget-revision-pending")).toContainText("une autre personne valide");

    obs.etape("validation par le second membre");
    {
      const { ctx, page: pa } = await pageApprobateur(browser, baseURL);
      await pa.goto("/budget/transactions");
      await pa.getByTestId("budget-row").filter({ hasText: nom }).click();
      await pa.getByTestId("budget-line").filter({ hasText: "Toutes" }).getByRole("button", { name: "Valider" }).click();
      await expect(pa.locator("[data-sonner-toast]").filter({ hasText: "Demande de révision traitée" }).first()).toBeVisible();
      await ctx.close();
    }
    await page.reload();
    await page.getByTestId("budget-row").filter({ hasText: nom }).click();
    await expect(page.getByTestId("budget-line").filter({ hasText: "Toutes" })).toContainText("120 000");
  } finally {
    obs.etape("paramètre des révisions rétabli");
    await reglerRevisions(page, avant.actif, avant.seuil);
  }

  obs.etape("demande d'achat ventilée par ligne");
  await page.goto("/procurement/transactions");
  await page.getByRole("button", { name: /New Requisition/i }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Objet de la demande").fill(`${RUN} Demande ventilée`);
  await d.getByLabel("Date de la demande").fill(`${annee}-02-03`);
  await d.getByLabel("Libellé ligne 1").fill("Gants de protection");
  await d.getByLabel("Quantité ligne 1").fill("1");
  await d.getByLabel("Coût estimé ligne 1").fill("8000");
  await d.getByTestId("btn-add-doc-line").click();
  await d.getByLabel("Libellé ligne 2").fill("Ramettes de papier");
  await d.getByLabel("Quantité ligne 2").fill("1");
  await d.getByLabel("Coût estimé ligne 2").fill("5000");
  await d.getByText("Ventiler les sections analytiques par ligne").click();
  await choisir(d.getByLabel("E2E Centre budgétaire ligne 1"), /^PROD /);
  await choisir(d.getByLabel("E2E Centre budgétaire ligne 2"), /^ADM /);
  await d.getByRole("button", { name: "Créer la demande" }).click();
  await expect(d).toBeHidden();
  await page.getByRole("tab", { name: /Requisitions/ }).click();
  const dem = ligne(page, `${RUN} Demande ventilée`);
  await dem.getByRole("button", { name: "Soumettre" }).click();
  await expect(dem).toContainText("En approbation");

  await page.goto("/budget/transactions");
  await page.getByRole("tab", { name: "Engagé et disponible" }).click();
  await page.getByLabel("Exercice").fill(annee);
  await expect(page.getByTestId("budget-availability-row").filter({ hasText: "Production" }), "pré-engagé de la section : sa ligne seulement")
    .toContainText("8 000");
  await expect(page.getByTestId("budget-availability-row").filter({ hasText: "Toutes" })).toContainText("13 000");

  obs.etape("prévision : version depuis l'atterrissage calculé, modifiée, publiée");
  await page.goto("/budget");
  await page.getByLabel("Exercice").fill(annee);
  await expect(page.getByTestId("budget-forecast-versions")).toBeVisible();
  await page.getByRole("button", { name: "Nouvelle version" }).click();
  const nv = page.getByRole("dialog");
  await nv.getByLabel("Nom de la version").fill(`Révision T1 ${RUN}`);
  await nv.getByLabel("Initialiser avec").selectOption("calculated");
  await nv.getByRole("button", { name: "Créer la version" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Version de prévision créée" }).first()).toBeVisible();
  await expect(page.getByTestId("forecast-version-line").first()).toBeVisible();
  const montant = page.getByTestId("forecast-version-line").filter({ hasText: "Toutes" }).getByRole("textbox");
  await montant.fill("125000");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("budget_forecast_lines") && r.request().method() === "PATCH" && r.ok()),
    montant.press("Tab"),
  ]);
  await expect(page.getByTestId("forecast-version-status")).toContainText("brouillon");
  await page.getByRole("button", { name: "Publier" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Prévision publiée" }).first()).toBeVisible();
  await expect(page.getByTestId("forecast-version-status")).toContainText("publiée");
  await expect(page.getByTestId("forecast-version-line").filter({ hasText: "Toutes" })).toContainText("125 000");

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
