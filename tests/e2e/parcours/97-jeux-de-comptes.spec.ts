import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast } from "./outils";
import { ligne } from "./champs";
import { assurerPlanComptable } from "./actions";

/*
 * V105 — comptabilisation paramétrable par jeu de comptes (SAP : compte collectif du groupe de tiers ;
 * Sage 300 : jeu de comptes du client) : un compte « clients du groupe » créé au plan, un jeu client qui
 * le porte, un client rattaché au jeu ; sa facture se comptabilise sur ce compte et non sur 411 ;
 * tant qu'elle est ouverte, le jeu du client ne change pas (verrou des comptes de bilan).
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("jeu de comptes client : facture sur le compte du jeu, changement refusé tant qu'elle est ouverte", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const obs = surveiller(page);
  const n = String(Date.now() % 100000).padStart(5, "0");
  const compte = `4118${n}`;
  const code = `G${n}`;
  const client = `${RUN} Client groupe ${n}`;

  obs.etape("prérequis : plan comptable, compte « clients du groupe »");
  testInfo.annotations.push({ type: "plan comptable", description: await assurerPlanComptable(page) });
  await page.goto("/journal/master-data");
  await page.getByRole("button", { name: "Ajouter un compte" }).click();
  const f = page.getByRole("dialog");
  await f.getByLabel("Code *").fill(compte);
  await f.getByLabel("Intitulé *").fill(`Clients du groupe ${n}`);
  await f.getByLabel("Type").selectOption("asset");
  await f.getByRole("button", { name: "Créer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Compte créé" })).toBeVisible();

  obs.etape("jeu de comptes client : compte clients du jeu");
  await page.goto("/settings?tab=posting");
  const panneau = page.getByTestId("account-sets-customer");
  await panneau.getByLabel("Code du jeu").fill(code);
  await panneau.getByLabel("Libellé du jeu").fill(`Clients du groupe ${n}`);
  await panneau.getByRole("button", { name: "Créer le jeu" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Jeu de comptes créé" })).toBeVisible();
  const jeu = panneau.getByTestId("account-set").filter({ hasText: code });
  const choix = jeu.getByRole("combobox", { name: new RegExp(`^Compte « Compte clients » du jeu ${code}$`) });
  await expect(choix.locator("option", { hasText: compte })).toHaveCount(1);
  await choix.selectOption({ label: `${compte} — Clients du groupe ${n}` });
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Compte du jeu enregistré" })).toBeVisible();

  obs.etape("client rattaché au jeu");
  await page.goto("/customers");
  await page.getByRole("button", { name: /Add Customer/i }).click();
  const d = page.getByRole("dialog");
  await d.getByPlaceholder("Company or individual name").fill(client);
  const select = d.getByLabel("Jeu de comptes");
  await expect(select.locator("option", { hasText: code })).toHaveCount(1);
  await select.selectOption({ label: `${code} — Clients du groupe ${n}` });
  await d.getByRole("button", { name: "Create" }).click();
  await expect(d).toBeHidden();

  obs.etape("facture émise : créance sur le compte du jeu");
  await page.goto("/receivables/transactions");
  await page.getByRole("button", { name: /Créer facture/ }).click();
  const fd = page.getByRole("dialog");
  await fd.locator("select").first().selectOption({ label: client });
  await fd.getByLabel("Libellé ligne 1").fill("Prestation groupe");
  await fd.getByLabel("Quantité ligne 1").fill("1");
  await fd.getByLabel("Prix unitaire ligne 1").fill("40000");
  await fd.getByRole("button", { name: "Créer" }).click();
  testInfo.annotations.push({ type: "émission", description: await dernierToast(page) });
  await expect(fd).toBeHidden();
  const l = ligne(page, client);
  const numero = (await l.locator("td").nth(1).innerText()).trim();
  await l.locator("td").nth(1).click();
  const detail = page.getByRole("dialog", { name: `Facture ${numero}` });
  const ecriture = detail.getByTestId("journal-entry-preview");
  await expect(ecriture, "créance au compte du jeu").toContainText(compte);
  await expect(ecriture).not.toContainText(/\b411\b/);
  await detail.getByRole("button", { name: "Fermer" }).click();

  obs.etape("jeu du client verrouillé tant que la facture est ouverte");
  obs.refusAttendu(/postes ouverts/);
  await page.goto("/customers");
  await page.getByPlaceholder("Search customers...").fill(client);
  await page.getByRole("button", { name: `Modifier ${client}` }).click();
  const e = page.getByRole("dialog");
  await e.getByLabel("Jeu de comptes").selectOption({ label: "Comptes par défaut de la société" });
  await e.getByRole("button", { name: "Update" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "postes ouverts" })).toBeVisible();

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
