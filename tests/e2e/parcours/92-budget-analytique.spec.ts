import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller } from "./outils";
import { ligne } from "./champs";
import { pageApprobateur } from "./actions";

/*
 * Budget, lot B2 (V77) : budget de contrôle approuvé par un tiers, avec une ligne générale et une ligne sur
 * une section analytique ; demande d'achat imputée à la section, pré-engagée ; une seconde demande au-delà
 * du budget de la section est refusée, puis passe avec une dérogation motivée ; écrans Contrôle et
 * Prévisions alimentés par la base. Un exercice lointain unique par passage : un seul budget de contrôle
 * par exercice, et le mode « blocage » ne touche que cet exercice. Le mode est rétabli à la fin.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

const AXE = "E2EBUD";
const SECTION = "PROD";

async function assurerSection(page: Page) {
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
  if (!(await detail.getByTestId(`value-row-${SECTION}`).count())) {
    await detail.locator("#new-value-code").fill(SECTION);
    await detail.locator("#new-value-name").fill("Production");
    await detail.getByTestId("btn-create-value").click();
    await expect(detail.getByTestId(`value-row-${SECTION}`)).toBeVisible();
  }
}

/** Le second membre approuve les budgets : rôle « Approbateur budgétaire » attribué s'il manque. */
async function assurerApprobateurBudget(browser: import("@playwright/test").Browser, baseURL: string | undefined, page: Page) {
  const { ctx, page: pa } = await pageApprobateur(browser, baseURL);
  await pa.goto("/");
  const id = await pa.evaluate(() => {
    const k = Object.keys(localStorage).find((n) => /^sb-.*-auth-token$/.test(n));
    return k ? JSON.parse(localStorage.getItem(k)!)?.user?.id : undefined;
  });
  await ctx.close();
  expect(id, "identifiant de l'approbateur").toBeTruthy();
  await page.goto("/settings?tab=roles");
  await page.getByTestId("authz-tab-users").click();
  const rangee = page.getByTestId(`user-row-${id}`);
  await expect(rangee).toBeVisible();
  const detenu = rangee.getByRole("button", { name: /^Retirer Approbateur budgétaire à / });
  if ((await detenu.count()) === 0) {
    const choix = rangee.getByRole("combobox");
    await choix.selectOption(await choix.locator("option", { hasText: /^Approbateur budgétaire$/ }).getAttribute("value") ?? "");
    await expect(detenu).toHaveCount(1);
  }
}

async function ajouterLigne(page: Page, montant: string, section?: string) {
  await page.getByRole("button", { name: "Ajouter une ligne" }).click();
  const d = page.getByRole("dialog");
  await expect.poll(async () => d.getByLabel("Compte").locator("option").count()).toBeGreaterThan(1);
  const comptes = await d.getByLabel("Compte").locator("option").allTextContents();
  await d.getByLabel("Compte").selectOption({ label: comptes.find((o) => /^601 — /.test(o)) ?? comptes.find((o) => /^60 — /.test(o))! });
  if (section) {
    const s = d.getByLabel("Section analytique");
    await expect(s.locator("option", { hasText: new RegExp(`^${section} — `) })).toHaveCount(1);
    await s.selectOption({ label: (await s.locator("option", { hasText: new RegExp(`^${section} — `) }).textContent())! });
    await expect(s).not.toHaveValue("");
  }
  await d.getByLabel("Montant").fill(montant);
  await d.getByRole("button", { name: "Enregistrer" }).click();
  await expect(d).toBeHidden();
}

async function demande(page: Page, objet: string, date: string, montant: string) {
  await page.goto("/procurement/transactions");
  await page.getByRole("button", { name: /New Requisition/i }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Objet de la demande").fill(objet);
  await d.getByLabel("Date de la demande").fill(date);
  await d.getByLabel("Libellé ligne 1").fill("Pièces de rechange");
  await d.getByLabel("Quantité ligne 1").fill("1");
  await d.getByLabel("Coût estimé ligne 1").fill(montant);
  const axe = d.getByLabel("E2E Centre budgétaire");
  await expect(axe.locator("option", { hasText: new RegExp(`^${SECTION} `) })).toHaveCount(1);
  await axe.selectOption({ label: (await axe.locator("option", { hasText: new RegExp(`^${SECTION} `) }).textContent())! });
  await expect(axe, "section choisie").not.toHaveValue("");
  await d.getByRole("button", { name: "Créer la demande" }).click();
  await expect(d).toBeHidden();
  await page.getByRole("tab", { name: /Requisitions/ }).click();
  return ligne(page, objet);
}

test("budget par section : approbation par un tiers, demandes pré-engagées, refus puis dérogation, contrôle et prévisions", async ({ page, browser, baseURL }, testInfo) => {
  const obs = surveiller(page);
  const annee = String(3000 + (Math.floor(Date.now() / 1000) % 900));
  const nom = `${RUN} Budget par section`;

  obs.etape("prérequis : section analytique, approbateur budgétaire");
  await assurerSection(page);
  await assurerApprobateurBudget(browser, baseURL, page);

  obs.etape("budget : ligne générale 100 000, ligne de la section 30 000, soumission");
  await page.goto("/budget/transactions");
  await page.getByRole("button", { name: "Nouveau budget" }).click();
  const nb = page.getByRole("dialog");
  await nb.getByLabel("Nom du budget").fill(nom);
  await nb.getByLabel("Exercice").fill(annee);
  await nb.getByRole("button", { name: "Créer le budget" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Budget créé" }).first()).toBeVisible();
  await page.getByTestId("budget-row").filter({ hasText: nom }).click();
  await ajouterLigne(page, "100000");
  await ajouterLigne(page, "30000", SECTION);
  await expect(page.getByTestId("budget-line")).toHaveCount(2);
  await expect(page.getByTestId("budget-line").filter({ hasText: "Production" })).toHaveCount(1);
  await page.getByRole("button", { name: "Soumettre" }).click();
  await expect(page.getByTestId("budget-summary")).toContainText("Soumis");

  obs.etape("approbation par le second membre");
  const { ctx, page: pa } = await pageApprobateur(browser, baseURL);
  await pa.goto("/budget/transactions");
  await pa.getByTestId("budget-row").filter({ hasText: nom }).click();
  await pa.getByRole("button", { name: "Approuver" }).click();
  await expect(pa.locator("[data-sonner-toast]").filter({ hasText: "Budget approuvé" }).first()).toBeVisible();
  await ctx.close();

  obs.etape("contrôle en mode blocage, demandes pré-engagées");
  await page.goto("/budget/settings");
  await expect(page.getByTestId("budget-control-settings")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const modeAvant = await page.getByLabel("Mode").inputValue();
  const preAvant = await page.getByRole("switch", { name: "Pré-engager les demandes d'achat" }).isChecked();
  const ctlAvant = await page.getByRole("switch", { name: "Contrôler les demandes d'achat à la soumission" }).isChecked();
  await page.getByLabel("Mode").selectOption("block");
  if (!preAvant) await page.getByRole("switch", { name: "Pré-engager les demandes d'achat" }).click();
  if (!ctlAvant) await page.getByRole("switch", { name: "Contrôler les demandes d'achat à la soumission" }).click();
  if (modeAvant !== "block" || !preAvant || !ctlAvant) {
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Paramètres du contrôle budgétaire enregistrés" }).first()).toBeVisible();
  }

  try {
    obs.etape("demande 20 000 sur la section : soumise, pré-engagée");
    const d1 = await demande(page, `${RUN} Demande section 1`, `${annee}-03-02`, "20000");
    await d1.getByRole("button", { name: "Soumettre" }).click();
    await expect(d1).toContainText("pending_approval");

    obs.etape("demande 15 000 : au-delà des 10 000 disponibles de la section, refusée");
    const d2 = await demande(page, `${RUN} Demande section 2`, `${annee}-03-05`, "15000");
    obs.refusAttendu(/Budget dépassé/);
    await d2.getByRole("button", { name: "Soumettre" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Budget dépassé" }).first()).toBeVisible();
    await expect(d2).toContainText("draft");

    obs.etape("dérogation motivée, puis soumission");
    page.once("dialog", (dl) => dl.accept("Panne de la ligne de production"));
    await d2.getByRole("button", { name: "Autoriser le dépassement" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Dépassement de budget autorisé" }).first()).toBeVisible();
    await d2.getByRole("button", { name: "Soumettre" }).click();
    await expect(d2).toContainText("pending_approval");
    await expect(d2.getByTestId("budget-warning")).toContainText("Budget dépassé (autorisé)");

    obs.etape("engagé et disponible : pré-engagé par section");
    await page.goto("/budget/transactions");
    await page.getByRole("tab", { name: "Engagé et disponible" }).click();
    await page.getByLabel("Exercice").fill(annee);
    const section = page.getByTestId("budget-availability-row").filter({ hasText: "Production" });
    await expect(section).toContainText("35 000");
    await expect(section).toContainText("117 %");

    obs.etape("contrôle : ligne en dépassement, pièce passée avec dérogation");
    await page.goto("/budget/control");
    await page.getByLabel("Exercice").fill(annee);
    await expect(page.getByTestId("budget-alert-row").filter({ hasText: "Production" })).toContainText("Dépassement");
    await expect(page.getByTestId("budget-alert-document").filter({ hasText: "Panne de la ligne de production" }).first()).toContainText("Demande");

    obs.etape("prévisions : budget, consommé, atterrissage");
    await page.goto("/budget");
    await page.getByLabel("Exercice").fill(annee);
    await expect(page.getByTestId("budget-kpi-planned")).toContainText("100 000");
    await expect(page.getByTestId("budget-kpi-consumed")).toContainText("35 000");
    await expect(page.getByTestId("forecast-row")).toHaveCount(1);
  } finally {
    obs.etape("paramètres rétablis");
    await page.goto("/budget/settings");
    await expect(page.getByTestId("budget-control-settings")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Mode").selectOption(modeAvant);
    const pre = page.getByRole("switch", { name: "Pré-engager les demandes d'achat" });
    if ((await pre.isChecked()) !== preAvant) await pre.click();
    const ctl = page.getByRole("switch", { name: "Contrôler les demandes d'achat à la soumission" });
    if (preAvant && (await ctl.isChecked()) !== ctlAvant) await ctl.click();
    if (modeAvant !== "block" || !preAvant || !ctlAvant) {
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Paramètres du contrôle budgétaire enregistrés" }).first()).toBeVisible();
    }
  }

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
