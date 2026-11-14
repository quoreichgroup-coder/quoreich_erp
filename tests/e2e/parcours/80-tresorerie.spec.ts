import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller } from "./outils";

/*
 * Trésorerie (V70, lot T1) : comptes de trésorerie réels reliés à leur compte comptable, solde
 * calculé, mouvement manuel et virement interne comptabilisés au journal de banque. Les comptes du
 * parcours sont créés au premier passage puis réutilisés (données conservées, un compte comptable
 * ne sert qu'à un compte de trésorerie).
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

const BANQUE = "E2E Banque principale";
const CAISSE = "E2E Caisse siège";
const nombre = (s: string) => Number(s.replace(/[^\d,-]/g, "").replace(",", "."));

async function assurerCompte(page: Page, nom: string, type: "Banque" | "Caisse", compte: RegExp) {
  await expect(page.getByTestId("treasury-accounts")).toBeVisible();
  const rangee = page.getByTestId("treasury-account-row").filter({ hasText: nom });
  if (await rangee.count()) return;
  await page.getByRole("button", { name: "Ajouter un compte de trésorerie" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Nom du compte *").fill(nom);
  await d.getByLabel("Type *").selectOption({ label: type });
  await expect.poll(async () => d.getByLabel(/Compte comptable \*/).locator("option").count()).toBeGreaterThan(1);
  const options = await d.getByLabel(/Compte comptable \*/).locator("option").allTextContents();
  const choix = options.find((o) => compte.test(o));
  expect(choix, `compte comptable ${compte} disponible`).toBeTruthy();
  await d.getByLabel(/Compte comptable \*/).selectOption({ label: choix! });
  await d.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Compte de trésorerie créé" }).first()).toBeVisible();
  await expect(rangee).toHaveCount(1);
}

async function solde(page: Page, nom: string) {
  return nombre(await page.getByTestId("treasury-account-row").filter({ hasText: nom }).getByTestId("treasury-account-balance").innerText());
}

test("trésorerie : comptes reliés au plan, frais bancaires et virement comptabilisés, soldes calculés", async ({ page }, testInfo) => {
  const obs = surveiller(page);

  obs.etape("comptes de trésorerie");
  await page.goto("/treasury/master-data");
  await expect(page.getByRole("heading", { name: "Comptes de trésorerie" })).toBeVisible();
  await assurerCompte(page, BANQUE, "Banque", /^521\b/);
  await assurerCompte(page, CAISSE, "Caisse", /^571\b/);
  const avant = { banque: await solde(page, BANQUE), caisse: await solde(page, CAISSE) };

  obs.etape("frais bancaires");
  await page.goto("/treasury/transactions");
  await page.getByRole("button", { name: "Mouvement de trésorerie" }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Compte de trésorerie").selectOption({ label: `${BANQUE} (Banque)` });
  await d.getByLabel("Sens").selectOption("out");
  await d.getByLabel("Montant").fill("1500");
  await expect.poll(async () => d.getByLabel("Contrepartie").locator("option").count()).toBeGreaterThan(1);
  const contreparties = await d.getByLabel("Contrepartie").locator("option").allTextContents();
  await d.getByLabel("Contrepartie").selectOption({ label: contreparties.find((o) => /^6/.test(o))! });
  await d.getByLabel("Libellé").fill(`Frais de tenue de compte ${RUN}`);
  await d.getByLabel("Référence").fill(`AGIOS-${RUN}`);
  await d.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Mouvement enregistré et comptabilisé" }).first()).toBeVisible();
  const frais = page.getByTestId("treasury-movement-row").filter({ hasText: `AGIOS-${RUN}` });
  await expect(frais).toHaveCount(1);
  await expect(frais).toContainText("BQ-");

  obs.etape("virement banque → caisse");
  await page.getByRole("button", { name: "Virement entre comptes" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Compte débité").selectOption({ label: BANQUE });
  await d.getByLabel("Compte crédité").selectOption({ label: CAISSE });
  await d.getByLabel("Montant").fill("1000");
  await d.getByLabel("Référence").fill(`VIR-${RUN}`);
  await d.getByRole("button", { name: "Enregistrer le virement" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Virement enregistré et comptabilisé" }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Virements internes" }).click();
  await expect(page.getByTestId("treasury-movement-row").filter({ hasText: `VIR-${RUN}` })).toHaveCount(2);

  obs.etape("soldes calculés");
  await page.goto("/treasury/master-data");
  await expect.poll(async () => solde(page, BANQUE)).toBe(avant.banque - 2500);
  expect(await solde(page, CAISSE)).toBe(avant.caisse + 1000);

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
