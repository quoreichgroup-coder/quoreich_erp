import { expect, type Page } from "@playwright/test";

/** Prérequis communs, créés par les écrans eux-mêmes (pas d'écriture directe en base). */

export async function creerFournisseur(page: Page, nom: string) {
  await page.goto("/suppliers");
  await page.getByRole("button", { name: "Ajouter un fournisseur" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Nom du fournisseur *").fill(nom);
  await d.getByRole("button", { name: "Créer" }).click();
  await expect(d).toBeHidden();
}

export async function creerClient(page: Page, nom: string) {
  await page.goto("/customers");
  await page.getByRole("button", { name: /Add Customer/i }).click();
  const d = page.getByRole("dialog");
  await d.getByPlaceholder("Company or individual name").fill(nom);
  await d.getByRole("button", { name: "Create" }).click();
  await expect(d).toBeHidden();
}

/**
 * Plan comptable : une société neuve n'en a pas ; sans lui, paiements et encaissements sont
 * refusés (QG001). Appliqué par l'écran Paramètres → Comptabilisation, s'il ne l'est pas déjà.
 */
export async function assurerPlanComptable(page: Page): Promise<string> {
  await page.goto("/settings?tab=posting");
  const bouton = page.getByTestId("btn-apply-framework");
  try {
    await bouton.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    return "référentiel déjà appliqué (bouton absent)";
  }
  await bouton.click();
  const t = page.locator("[data-sonner-toast]").last();
  await t.waitFor({ state: "visible", timeout: 30_000 });
  return (await t.innerText()).replace(/\s+/g, " ").trim();
}

/** Paramètre des achats « demande obligatoire avant commande », réglé par l'écran des paramètres. */
export async function demandeObligatoire(page: Page, actif: boolean) {
  await page.goto("/procurement/settings");
  await page.waitForLoadState("networkidle");
  const interrupteur = page.getByRole("switch", { name: "Exiger une PR approuvée avant PO" });
  await expect(interrupteur).toBeVisible();
  if ((await interrupteur.getAttribute("aria-checked")) !== String(actif)) await interrupteur.click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).first().click();
  await expect(page.locator("[data-sonner-toast]").last()).toBeVisible();
}

/** Page de l'approbateur (second membre de la société de test, session enregistrée par 01-approbateur). */
export async function pageApprobateur(browser: import("@playwright/test").Browser, baseURL: string | undefined) {
  const ctx = await browser.newContext({ baseURL, locale: "fr-FR", storageState: "test-results-parcours/.auth/approbateur.json" });
  return { ctx, page: await ctx.newPage() };
}

/** Paramètres fournisseurs « bon de commande requis » et « rapprochement à 3 voies », par l'écran. */
export async function parametresFournisseurs(page: Page, poRequis: "mandatory" | "optional" | "none", troisVoies: boolean) {
  await page.goto("/payables/settings");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Bon de commande requis").selectOption(poRequis);
  await page.getByLabel("Rapprochement à 3 voies").selectOption(troisVoies ? "true" : "false");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).first().click();
  await expect(page.locator("[data-sonner-toast]").last()).toBeVisible();
}

/** Approbation d'une facture fournisseur par l'approbateur (second membre, rôle Comptable). */
export async function approuverFactureFournisseur(browser: import("@playwright/test").Browser, baseURL: string | undefined,
                                                   numero: string) {
  const { ctx, page } = await pageApprobateur(browser, baseURL);
  await page.goto("/payables/transactions");
  const l = page.locator("tr").filter({ hasText: numero }).first();
  await l.getByRole("button", { name: "Approuver" }).click();
  await expect(l).toContainText("Approuvée");
  await ctx.close();
}
