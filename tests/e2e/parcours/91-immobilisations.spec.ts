import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller } from "./outils";

/*
 * Immobilisations (V75, lot F1) : catégorie aux comptes 2x / 28x / 68x, fiche, amortissements du mois
 * comptabilisés, cession au mois suivant (dotation du mois, sortie, prix). Un mois unique par passage
 * (année lointaine) : un mois ne s'amortit qu'une fois, et la société de test n'a pas d'exercice défini.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

const CATEGORIE = "E2E Matériel de bureau";
const COMPTES: [string, string, string][] = [["2441", "Matériel de bureau", "asset"], ["2844", "Amortissements du matériel de bureau", "asset"],
  ["6813", "Dotations aux amortissements des immobilisations corporelles", "expense"]];

async function assurerComptes(page: Page) {
  await page.goto("/assets/settings");
  await page.getByRole("button", { name: "Nouvelle catégorie" }).click();
  await expect.poll(async () => page.locator("#cat-gl_asset_account_id option").count()).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  const presents = await page.locator("#cat-gl_asset_account_id option, #cat-gl_depreciation_account_id option, #cat-gl_expense_account_id option").allTextContents();
  const manquants = COMPTES.filter(([code]) => !presents.some((o) => o.startsWith(`${code} `)));
  if (!manquants.length) return;
  await page.goto("/journal/master-data");
  for (const [code, nom, type] of manquants) {
    await page.getByRole("button", { name: "Ajouter un compte" }).click();
    const f = page.getByRole("dialog");
    await f.getByLabel("Code *").fill(code);
    await f.getByLabel("Intitulé *").fill(nom);
    await f.getByLabel("Type").selectOption(type);
    await f.getByRole("button", { name: "Créer" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Compte créé" }).first()).toBeVisible();
    await expect(f).toBeHidden();
  }
}

test("immobilisations : catégorie, fiche, amortissement du mois, cession comptabilisée", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const annee = 2100 + (Math.floor(Date.now() / 1000) % 800);
  const mois = 1 + (Math.floor(Date.now() / 60000) % 11);
  const periode = `${annee}-${String(mois).padStart(2, "0")}`;
  const suivant = `${annee}-${String(mois + 1).padStart(2, "0")}`;
  const code = `IMM-${RUN}`;

  obs.etape("comptes et catégorie");
  await assurerComptes(page);
  await page.goto("/assets/settings");
  await expect(page.getByTestId("asset-categories")).toBeVisible();
  await page.waitForLoadState("networkidle");
  if (!(await page.getByTestId("asset-category-row").filter({ hasText: CATEGORIE }).count())) {
    await page.getByRole("button", { name: "Nouvelle catégorie" }).click();
    await page.getByLabel("Nom de la catégorie").fill(CATEGORIE);
    for (const [id, c] of [["#cat-gl_asset_account_id", "2441"], ["#cat-gl_depreciation_account_id", "2844"], ["#cat-gl_expense_account_id", "6813"]]) {
      const libelle = (await page.locator(`${id} option`).allTextContents()).find((o) => o.startsWith(`${c} `))!;
      await page.locator(id).selectOption({ label: libelle });
    }
    await page.getByRole("button", { name: "Enregistrer la catégorie" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Catégorie créée" }).first()).toBeVisible();
  }

  obs.etape("fiche mise en service le 1er du mois");
  await page.goto("/assets/master-data");
  await page.getByRole("button", { name: /Créer une fiche immobilisation|Nouvelle immobilisation/ }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Code *").fill(code);
  await d.getByLabel("Nom *").fill(`Ordinateurs ${RUN}`);
  await d.getByLabel("Catégorie").click();
  await page.getByRole("option", { name: CATEGORIE }).click();
  await d.getByLabel("Date acquisition").fill(`${periode}-01`);
  await d.getByLabel("Mise en service").fill(`${periode}-01`);
  await d.getByLabel("Coût (XOF) *").fill("1200000");
  await d.getByLabel("Durée (mois)").fill("60");
  await d.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Immobilisation créée" }).first()).toBeVisible();

  obs.etape("amortissements du mois");
  await page.goto("/assets/transactions");
  await page.locator('input[type="month"]').fill(periode);
  await page.getByRole("button", { name: "Calculer les amortissements" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: new RegExp(`Amortissements ${periode} comptabilisés`) }).first()).toBeVisible();

  obs.etape("cession au mois suivant");
  await page.goto("/assets/master-data");
  await page.getByPlaceholder("Rechercher un actif…").fill(code);
  await page.getByTestId("asset-row").filter({ hasText: code }).click();
  await page.getByLabel("Date de sortie").fill(`${suivant}-10`);
  await page.getByLabel("Prix de cession").fill("1000000");
  await page.getByRole("button", { name: "Comptabiliser la cession" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Sortie comptabilisée : moins-value" }).first()).toBeVisible();

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
