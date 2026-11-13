import type { Locator, Page } from "@playwright/test";

/** Champ (input / select natif) qui suit un libellé dans un conteneur — les formulaires n'ont pas tous de htmlFor. */
export function champ(zone: Locator, libelle: string, balise: "input" | "select" = "input"): Locator {
  return zone.locator(`xpath=.//label[normalize-space()="${libelle}"]/following::${balise}[1]`);
}

/** Choisit une option d'un Select Radix (shadcn) ouvert par son déclencheur. */
export async function choisir(page: Page, declencheur: Locator, option: string | RegExp) {
  await declencheur.click();
  await page.getByRole("option", { name: option }).first().click();
}

/** Ligne de tableau contenant le texte. */
export function ligne(page: Page, texte: string | RegExp): Locator {
  return page.locator("tr").filter({ hasText: texte }).first();
}
