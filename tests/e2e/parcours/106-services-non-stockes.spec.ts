import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller, verifierSocieteE2E } from "./outils";
import { creerFournisseur, demandeObligatoire, pageApprobateur } from "./actions";

test.skip(!identifiants() || !identifiants("approbateur"), "identifiants des comptes de test absents");

test("service : commande liée au catalogue, modification, réception à 30 % puis 100 % sans stock", async ({ page, browser }, testInfo) => {
  const obs = surveiller(page);
  const code = `SVC-${RUN}`, name = `Maintenance ${RUN}`, supplier = `Prestataire ${RUN}`;
  obs.etape("service au catalogue");
  await page.goto("/inventory/master-data");
  await verifierSocieteE2E(page);
  await page.getByRole("button", { name: "Nouvel article" }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Code article").fill(code);
  await d.getByLabel("Libellé").fill(name);
  await d.getByLabel("Type d'article").selectOption("service");
  await expect(d.getByLabel("Seuil de réapprovisionnement")).toHaveCount(0);
  await d.getByRole("button", { name: "Enregistrer" }).click();
  await expect(d).toBeHidden();
  await page.getByPlaceholder("Code, libellé, catégorie…").fill(code);
  await expect(page.getByTestId("item-row").filter({ hasText: code })).toContainText("Service");

  obs.etape("commande et référence conservée après modification");
  await creerFournisseur(page, supplier);
  await demandeObligatoire(page, false);
  await page.goto("/procurement/transactions");
  await page.getByRole("button", { name: /Nouvelle commande/i }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Fournisseur").selectOption({ label: supplier });
  const item = await d.getByLabel("Article ligne 1").locator("option").filter({ hasText: code }).getAttribute("value");
  await d.getByLabel("Article ligne 1").selectOption(item!);
  await expect(d.getByLabel("Libellé ligne 1")).toHaveValue(name);
  await d.getByLabel("Prix unitaire ligne 1").fill("1200000");
  await d.getByRole("button", { name: "Créer la commande" }).click();
  await expect(d).toBeHidden();
  await page.getByRole("tab", { name: /Commandes fournisseurs/ }).click();
  const po = page.locator("tr").filter({ hasText: supplier }).first();
  await po.getByRole("button", { name: "Modifier" }).click();
  d = page.getByRole("dialog");
  await expect(d.getByLabel("Article ligne 1")).toHaveValue(item!);
  await d.getByLabel("Libellé ligne 1").fill(`${name} annuelle`);
  await d.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(d).toBeHidden();
  await po.getByRole("button", { name: "Soumettre" }).click();
  await expect(po).toContainText("En approbation");

  const { ctx, page: other } = await pageApprobateur(browser, testInfo.project.use.baseURL);
  const obsOther = surveiller(other);
  let previousSecond = false;
  try {
    await other.goto("/procurement/transactions");
    await other.getByRole("tab", { name: /Commandes fournisseurs/ }).click();
    const otherPo = other.locator("tr").filter({ hasText: supplier }).first();
    await otherPo.getByRole("button", { name: "Approuver" }).click();
    await expect(otherPo).toContainText("Approuvée");

    obs.etape("service fait par un tiers");
    await page.goto("/procurement/settings");
    await page.getByRole("button", { name: "Contrôles et suivi" }).click();
    const setting = page.getByRole("switch", { name: "Service fait attesté par une autre personne" });
    await expect(setting).toBeVisible();
    previousSecond = (await setting.getAttribute("aria-checked")) === "true";
    if (!previousSecond) await setting.click();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).last().click();
    await expect(page.locator("[data-sonner-toast]").last()).toBeVisible();

    for (const quantity of ["0,3", "0,7"]) {
      await other.goto("/procurement/transactions");
      await other.getByRole("button", { name: /Nouvelle réception/ }).click();
      const receipt = other.getByRole("dialog");
      await receipt.getByLabel("Fournisseur", { exact: true }).selectOption({ label: supplier });
      const options = receipt.getByLabel("Commande", { exact: true }).locator("option");
      await receipt.getByLabel("Commande", { exact: true }).selectOption((await options.nth(1).getAttribute("value"))!);
      await receipt.getByLabel("Quantité reçue ligne 1").fill(quantity);
      await receipt.getByRole("button", { name: "Enregistrer et valider" }).click();
      await expect(receipt).toBeHidden();
    }
    await other.getByRole("tab", { name: /Commandes fournisseurs/ }).click();
    await expect(other.locator("tr").filter({ hasText: supplier }).first()).toContainText("Reçue");

    obs.etape("aucun mouvement ni ajustement possible pour le service");
    await page.goto("/inventory/transactions");
    await expect(page.locator("table")).not.toContainText(code);
    await page.getByRole("button", { name: "Ajustement de stock" }).click();
    await expect(page.getByRole("dialog").getByLabel("Article").locator("option").filter({ hasText: code })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await obsOther.joindre(testInfo);
    expect(obsOther.inattendus(), JSON.stringify(obsOther.inattendus())).toEqual([]);
  } finally {
    await ctx.close();
    await page.goto("/procurement/settings");
    await page.getByRole("button", { name: "Contrôles et suivi" }).click();
    const setting = page.getByRole("switch", { name: "Service fait attesté par une autre personne" });
    if ((await setting.getAttribute("aria-checked")) !== String(previousSecond)) await setting.click();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).last().click();
    await demandeObligatoire(page, true);
  }
  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus())).toEqual([]);
});
