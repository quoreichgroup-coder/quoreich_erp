import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast, verifierSocieteE2E } from "./outils";
import { pageApprobateur } from "./actions";

/*
 * Notes de frais (V109) : catégorie créée avec son compte de charge, note saisie TTC avec justificatif,
 * soumise (numéro NDF-), refusée à son auteur, approuvée par le second membre (« Approbateur notes de
 * frais »), comptabilisée puis remboursée par le comptable ; l'écriture est visible sur la note.
 */
test.skip(!identifiants() || !identifiants("approbateur"), "identifiants des comptes de test absents");

async function assurerApprobateurNotes(browser: import("@playwright/test").Browser, baseURL: string | undefined, page: Page) {
  const { ctx, page: pa } = await pageApprobateur(browser, baseURL);
  await pa.goto("/");
  const id = await pa.evaluate(() => {
    const k = Object.keys(localStorage).find((n) => /^sb-.*-auth-token$/.test(n));
    return k ? JSON.parse(localStorage.getItem(k)!)?.user?.id : undefined;
  });
  await ctx.close();
  await page.goto("/settings?tab=roles");
  await page.getByTestId("authz-tab-users").click();
  const rangee = page.getByTestId(`user-row-${id}`);
  await expect(rangee).toBeVisible();
  const detenu = rangee.getByRole("button", { name: /^Retirer Approbateur notes de frais à / });
  if ((await detenu.count()) === 0) {
    const choix = rangee.getByRole("combobox");
    await choix.selectOption(await choix.locator("option", { hasText: /^Approbateur notes de frais$/ }).getAttribute("value") ?? "");
    await expect(detenu).toHaveCount(1);
  }
}

test("notes de frais : catégorie, saisie TTC, soumission, approbation par un tiers, comptabilisation, remboursement", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const obs = surveiller(page);
  const n = String(Date.now() % 100000).padStart(5, "0");
  const code = `D${n}`;
  const objet = `${RUN} Mission ${n}`;

  obs.etape("catégorie de frais avec son compte de charge");
  await page.goto("/expenses/master-data");
  await verifierSocieteE2E(page);
  await page.getByRole("button", { name: "Nouvelle catégorie" }).click();
  const c = page.getByRole("dialog");
  await c.getByLabel("Code *").fill(code);
  await c.getByLabel("Libellé *").fill(`Déplacements ${n}`);
  const compte = c.getByLabel("Compte de charge *");
  await expect(compte.locator("option").nth(1)).toBeAttached();
  await compte.selectOption({ index: 1 });
  await c.getByLabel("Justificatif exigé à partir de").fill("10000");
  await c.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("expense-category-row").filter({ hasText: code })).toBeVisible();

  obs.etape("note saisie TTC : justificatif exigé, puis soumise");
  await page.goto("/expenses/transactions");
  await page.getByRole("button", { name: "Nouvelle note de frais" }).click();
  const d = page.getByRole("dialog");
  const salarie = d.getByLabel("Salarié *");
  await expect(salarie.locator("option").nth(1)).toBeAttached();
  await salarie.selectOption({ index: 1 });
  await d.getByLabel("Objet (mission, déplacement…)").fill(objet);
  await d.getByLabel("Catégorie ligne 1").selectOption({ label: `${code} — Déplacements ${n}` });
  await d.getByLabel("Libellé ligne 1").fill("Hôtel");
  await d.getByLabel("Montant TTC ligne 1").fill("25000");
  await expect(d.getByTestId("expense-issues")).toContainText("justificatif exigé");
  await d.getByLabel("Justificatif ligne 1").fill(`FACT-${n}`);
  await expect(d.getByTestId("expense-issues")).toHaveCount(0);
  await expect(d.getByTestId("expense-total")).toHaveText("25 000");
  await d.getByRole("button", { name: "Enregistrer et soumettre" }).click();
  testInfo.annotations.push({ type: "soumission", description: await dernierToast(page) });
  const ligne = page.getByTestId("expense-row").filter({ hasText: objet });
  await expect(ligne).toContainText("En approbation");
  const numero = (await ligne.locator("td").nth(1).innerText()).trim();
  expect(numero).toMatch(/^NDF-/);

  obs.etape("l'auteur ne l'approuve pas");
  await ligne.click();
  await expect(page.getByTestId("expense-level")).toContainText("vous êtes l'auteur");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Approuver" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  obs.etape("approbation par le second membre");
  await assurerApprobateurNotes(browser, baseURL, page);
  const { ctx, page: pa } = await pageApprobateur(browser, baseURL);
  await pa.goto("/expenses/transactions?tab=approvals");
  const aApprouver = pa.getByTestId("expense-row").filter({ hasText: numero });
  await expect(aApprouver).toBeVisible({ timeout: 30_000 });
  await aApprouver.click();
  await pa.getByRole("dialog").getByRole("button", { name: "Approuver" }).click();
  await expect(pa.locator("[data-sonner-toast]").filter({ hasText: "Décision enregistrée" })).toBeVisible();
  await ctx.close();

  obs.etape("comptabilisation puis remboursement en espèces");
  await page.goto("/expenses/transactions?tab=posting");
  const aComptabiliser = page.getByTestId("expense-row").filter({ hasText: numero });
  await expect(aComptabiliser).toContainText("Approuvée");
  await aComptabiliser.click();
  await page.getByRole("dialog").getByRole("button", { name: "Comptabiliser" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Note comptabilisée" })).toBeVisible();
  await expect(aComptabiliser).toContainText("Comptabilisée");
  await aComptabiliser.click();
  const v = page.getByRole("dialog");
  await v.getByLabel("Mode").selectOption("cash");
  await v.getByRole("button", { name: "Rembourser" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Note remboursée" })).toBeVisible();
  await page.goto("/expenses/transactions");
  const finale = page.getByTestId("expense-row").filter({ hasText: numero });
  await expect(finale).toContainText("Remboursée");
  await finale.click();
  await expect(page.getByRole("dialog").getByRole("region", { name: "En-tête" })).toContainText(/OD-\d{4}-\d+/);
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("dialog").getByTestId("btn-document-pdf").click()]);
  expect(pdf.suggestedFilename()).toMatch(/^note-de-frais-.*\.pdf$/);

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
