import { expect, type Page } from "@playwright/test";

/** Prérequis communs, créés par les écrans eux-mêmes (pas d'écriture directe en base). */

export async function creerFournisseur(page: Page, nom: string) {
  await page.goto("/suppliers");
  await page.getByRole("button", { name: /Add Supplier/i }).click();
  const d = page.getByRole("dialog");
  await d.getByPlaceholder("Company name").fill(nom);
  await d.getByRole("button", { name: "Create" }).click();
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
