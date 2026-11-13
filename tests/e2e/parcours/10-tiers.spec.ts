import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast } from "./outils";
import { ligne } from "./champs";

/* Fiches tiers : création, modification et recherche d'un fournisseur et d'un client. */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("fournisseur : créer, retrouver, modifier", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const nom = `${RUN} Fournisseur Alpha`;

  obs.etape("création");
  await page.goto("/suppliers");
  await page.getByRole("button", { name: /Add Supplier/i }).click();
  const d = page.getByRole("dialog");
  await d.getByPlaceholder("Company name").fill(nom);
  await d.getByPlaceholder("email@example.com").fill("fournisseur.alpha@exemple.invalid");
  await d.getByPlaceholder("+225 07 00 00 00").fill("+226 70 00 00 01");
  await d.getByPlaceholder("XX-SUP-000").fill(`IFU-${RUN}`);
  await d.getByRole("button", { name: "Create" }).click();
  await expect(d).toBeHidden();
  testInfo.annotations.push({ type: "message", description: await dernierToast(page) });

  obs.etape("recherche");
  await page.getByPlaceholder("Search suppliers...").fill(RUN);
  await expect(ligne(page, nom)).toBeVisible();

  obs.etape("modification");
  await ligne(page, nom).getByRole("button").first().click();
  await page.getByRole("dialog").getByPlaceholder("City, Country").fill("Ouagadougou, Burkina Faso");
  await page.getByRole("dialog").getByRole("button", { name: "Update" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(ligne(page, nom)).toBeVisible();

  await obs.joindre(testInfo);
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});

test("client : créer, retrouver, modifier", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const nom = `${RUN} Client Beta`;

  obs.etape("création");
  await page.goto("/customers");
  await page.getByRole("button", { name: /Add Customer/i }).click();
  const d = page.getByRole("dialog");
  await d.getByPlaceholder("Company or individual name").fill(nom);
  await d.getByPlaceholder("email@example.com").fill("client.beta@exemple.invalid");
  await d.getByPlaceholder("XX-2024-000").fill(`IFU-C-${RUN}`);
  await d.getByRole("button", { name: "Create" }).click();
  await expect(d).toBeHidden();
  testInfo.annotations.push({ type: "message", description: await dernierToast(page) });

  obs.etape("recherche");
  await page.getByPlaceholder("Search customers...").fill(RUN);
  await expect(ligne(page, nom)).toBeVisible();

  obs.etape("modification");
  await ligne(page, nom).getByRole("button").first().click();
  await page.getByRole("dialog").getByPlaceholder("City, Country").fill("Bobo-Dioulasso, Burkina Faso");
  await page.getByRole("dialog").getByRole("button", { name: "Update" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await obs.joindre(testInfo);
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});
