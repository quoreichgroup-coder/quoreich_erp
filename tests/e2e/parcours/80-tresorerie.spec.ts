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

/** Relevé du jour laissé par un passage interrompu : rapprochements annulés puis relevé annulé. */
async function annulerReleveDuJour(page: Page, jour: string) {
  const resume = page.getByTestId("statement-summary");
  if (!(await resume.count()) || !(await page.locator("#rec-statement").inputValue())) return;
  const libelle = await page.locator("#rec-statement").locator("option:checked").innerText();
  if (!libelle.includes(`au ${jour}`)) return;
  const annuler = page.getByTestId("statement-line").getByRole("button", { name: "Annuler" });
  for (let reste = await annuler.count(); reste > 0; reste--) {
    await expect(annuler).toHaveCount(reste);
    await annuler.first().click();
  }
  await expect(annuler).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler le relevé" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Relevé annulé" }).first()).toBeVisible();
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

// V71 (lot T2) : relevé de la banque importé (CSV « ; », Débit / Crédit), contrôle d'équilibre,
// rapprochement automatique, ligne inconnue de l'ERP comptabilisée, état de rapprochement ; le relevé
// est ensuite annulé pour que le parcours se rejoue (périodes non chevauchantes).
test("rapprochement bancaire : relevé importé, rapproché, frais comptabilisés, état calculé", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const jour = new Date().toLocaleDateString("fr-FR");
  const csv = `Date;Libellé;Débit;Crédit;Référence\r\n${jour};FRAIS TENUE AGIOS-${RUN};1 500,00;;AGIOS-${RUN}\r\n${jour};VIREMENT VERS CAISSE;1 000,00;;VIR-${RUN}\r\n${jour};FRAIS SMS ${RUN};300,00;;\r\n`;

  obs.etape("import du relevé");
  await page.goto("/treasury/control");
  await page.getByLabel("Compte", { exact: true }).selectOption({ label: `${BANQUE} (Banque)` });
  await page.waitForLoadState("networkidle");
  await annulerReleveDuJour(page, jour);
  await page.getByRole("button", { name: "Importer un relevé" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Fichier du relevé").setInputFiles({ name: `releve-${RUN}.csv`, mimeType: "text/csv", buffer: Buffer.from("﻿" + csv, "utf-8") });
  await expect(d.getByTestId("statement-file-summary")).toContainText("3 ligne(s) lue(s)");
  if (!(await d.getByLabel("Solde initial").inputValue())) await d.getByLabel("Solde initial").fill("100000");
  const ouverture = nombre(await d.getByLabel("Solde initial").inputValue());
  await d.getByLabel("Solde final du relevé").fill(String(ouverture - 2801));
  await expect(d.getByTestId("statement-balance-check")).toContainText("écart");
  await d.getByLabel("Solde final du relevé").fill(String(ouverture - 2800));
  await expect(d.getByTestId("statement-balance-check")).toContainText("relevé équilibré");
  await d.getByRole("button", { name: "Importer et rapprocher" }).click();
  // 2 rapprochements sûrs (références) ; la ligne SMS sans référence peut trouver le mouvement d'un passage précédent.
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: /3 ligne\(s\), [23] rapprochée\(s\) automatiquement/ }).first()).toBeVisible();

  obs.etape("ligne inconnue de l'ERP");
  const sms = page.getByTestId("statement-line").filter({ hasText: `FRAIS SMS ${RUN}` });
  await expect(sms).toHaveCount(1);
  if (await sms.getByRole("button", { name: "Comptabiliser" }).count()) {
  await sms.getByRole("button", { name: "Comptabiliser" }).click();
  const p = page.getByRole("dialog");
  await expect.poll(async () => p.getByLabel("Contrepartie").locator("option").count()).toBeGreaterThan(1);
  const options = await p.getByLabel("Contrepartie").locator("option").allTextContents();
  await p.getByLabel("Contrepartie").selectOption({ label: options.find((o) => /^6/.test(o))! });
  await p.getByRole("button", { name: "Comptabiliser et rapprocher" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Ligne comptabilisée et rapprochée" }).first()).toBeVisible();
  }
  await expect(page.getByTestId("statement-summary")).toContainText("0 à rapprocher");

  obs.etape("état de rapprochement");
  await page.getByRole("button", { name: /^Calculer l'état au/ }).click();
  await expect(page.getByTestId("reconciliation-draft")).toBeVisible();

  obs.etape("annulation pour rejouer le parcours");
  const annuler = page.getByTestId("statement-line").getByRole("button", { name: "Annuler" });
  for (let reste = 3; reste > 0; reste--) {
    await expect(annuler).toHaveCount(reste);
    await annuler.first().click();
  }
  await expect(annuler).toHaveCount(0);
  await expect(page.getByTestId("statement-summary")).toContainText("3 à rapprocher");
  await page.getByRole("button", { name: "Annuler le relevé" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Relevé annulé" }).first()).toBeVisible();

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
