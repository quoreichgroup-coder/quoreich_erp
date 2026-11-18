import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller } from "./outils";
import { pageApprobateur } from "./actions";

/*
 * RH et paie (V80–V102) : règles de paie de la société saisies puis confirmées ; référentiels (contrat, service)
 * gérés dans Paramètres RH ; salarié créé avec des valeurs du référentiel (libellés affichés, devise des règles
 * de paie) ; cycle de paie créé, lignes générées, approuvé par le second membre (le préparateur ne peut pas
 * approuver son propre cycle), puis comptabilisé. Une période lointaine unique par passage.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

async function assurerReference(page: Page, kind: string, code: string, libelle: string) {
  await page.goto("/hr/settings");
  await page.getByRole("tab", { name: "Référentiels et mouvements" }).click();
  await page.waitForLoadState("networkidle");
  if (await page.getByText(`(${code}) ·`, { exact: false }).count()) return;
  await page.getByLabel("Référentiel").selectOption(kind);
  await page.getByLabel("Code").fill(code);
  await page.getByLabel("Libellé").fill(libelle);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Référentiel RH enregistré" }).first()).toBeVisible();
}

/** Le second membre approuve la paie : rôle « Approbateur RH » attribué s'il manque. */
async function assurerApprobateurPaie(browser: import("@playwright/test").Browser, baseURL: string | undefined, page: Page) {
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
  const detenu = rangee.getByRole("button", { name: /^Retirer Approbateur RH à / });
  if ((await detenu.count()) === 0) {
    const choix = rangee.getByRole("combobox");
    await choix.selectOption(await choix.locator("option", { hasText: /^Approbateur RH$/ }).getAttribute("value") ?? "");
    await expect(detenu).toHaveCount(1);
  }
}

test("RH et paie : règles confirmées, référentiels, salarié, cycle approuvé par un tiers et comptabilisé", async ({ page, browser, baseURL }, testInfo) => {
  const obs = surveiller(page);
  const annee = 6000 + (Math.floor(Date.now() / 1000) % 900);
  const periode = `${annee}-03`;
  const nom = `Paie${RUN.replace(/[^A-Za-z0-9]/g, "")}`;

  obs.etape("règles de paie de la société, puis confirmation");
  await page.goto("/hr/settings");
  const regles = page.getByRole("region", { name: "Barèmes de paie par pays" });
  await expect(regles).toBeVisible();
  await page.waitForLoadState("networkidle");
  await regles.getByLabel("Code pays (ISO 3166-1 alpha-2)").fill("BF");
  await regles.getByLabel("Devise (ISO 4217)").fill("XOF");
  await regles.getByLabel("Cotisation salariale (%)").fill("5.5");
  await regles.getByLabel("Cotisation employeur (%)").fill("16");
  await regles.getByLabel("Date d’effet").fill("2026-01-01");
  await regles.getByLabel("Source officielle / référence juridique").fill(`Barème de recette E2E ${RUN} (non officiel)`);
  await regles.getByLabel("Limite supérieure 1 (vide = sans limite)").fill("");
  await regles.getByLabel("Taux marginal (%)").first().fill("10");
  for (let n = await regles.getByRole("button", { name: /^Supprimer la tranche/ }).count(); n > 0; n--) {
    await regles.getByRole("button", { name: /^Supprimer la tranche/ }).last().click();
  }
  await regles.getByRole("button", { name: "Enregistrer les règles" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Barèmes enregistrés" }).first()).toBeVisible();
  await regles.getByRole("button", { name: "Confirmer les barèmes" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Barèmes confirmés" }).first()).toBeVisible();

  obs.etape("référentiels : contrat et service");
  await assurerReference(page, "contract_type", "cdi", "CDI");
  await assurerReference(page, "department", "finance-e2e", "Finance E2E");

  obs.etape("salarié créé depuis les référentiels");
  await page.goto("/hr/employees");
  await page.getByRole("button", { name: /Nouvel employé|Créer un employé/ }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Contrat *").selectOption({ label: "CDI" });
  await d.getByLabel("Prénom *").fill("Awa");
  await d.getByLabel("Nom *", { exact: true }).fill(nom);
  await d.getByLabel("Service").selectOption({ label: "Finance E2E" });
  await d.getByLabel(/Salaire de base \(XOF\)/).fill("300000");
  await d.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Employé enregistré" }).first()).toBeVisible();
  const ligne = page.locator("tr").filter({ hasText: nom });
  await expect(ligne).toContainText("Finance E2E");
  await expect(ligne).toContainText("CDI");

  obs.etape("second membre : approbateur RH");
  await assurerApprobateurPaie(browser, baseURL, page);

  obs.etape("cycle de paie : création et génération des lignes");
  await page.goto("/hr/payroll");
  await page.getByRole("button", { name: "Nouveau cycle" }).click();
  const c = page.getByRole("dialog");
  await c.getByLabel("Période (AAAA-MM)").fill(periode);
  await c.getByLabel("Date de paie").fill(`${periode}-28`);
  await c.getByRole("button", { name: "Créer" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Cycle de paie créé" }).first()).toBeVisible();
  const cycle = page.locator("tr").filter({ hasText: periode });
  await cycle.getByRole("button", { name: "Ouvrir" }).click();
  const r = page.getByRole("dialog");
  await r.getByRole("button", { name: "Générer les lignes" }).click();
  await expect(r.getByRole("tab", { name: /^Lignes \([1-9]/ })).toBeVisible();
  await expect(r.getByRole("button", { name: "Approuver" }), "le préparateur n'approuve pas son propre cycle").toBeDisabled();
  await r.getByRole("tab", { name: /^Lignes/ }).click();
  await expect(r.locator("tr").filter({ hasText: nom }), "brut 300 000, cotisation 5,5 %, impôt 10 % : net 255 150").toContainText("255 150");
  await page.keyboard.press("Escape");

  obs.etape("approbation par le second membre");
  {
    const { ctx, page: pa } = await pageApprobateur(browser, baseURL);
    await pa.goto("/hr/payroll");
    await pa.locator("tr").filter({ hasText: periode }).getByRole("button", { name: "Ouvrir" }).click();
    const ra = pa.getByRole("dialog");
    await ra.getByRole("button", { name: "Approuver" }).click();
    await pa.getByRole("alertdialog").getByRole("button", { name: /Approuver|Confirmer/ }).click();
    await expect(pa.locator("[data-sonner-toast]").filter({ hasText: "Cycle approuvé" }).first()).toBeVisible();
    await ctx.close();
  }

  obs.etape("comptabilisation");
  await page.goto("/hr/payroll");
  await page.locator("tr").filter({ hasText: periode }).getByRole("button", { name: "Ouvrir" }).click();
  const rc = page.getByRole("dialog");
  await rc.getByRole("button", { name: "Comptabiliser" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Comptabiliser|Confirmer/ }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Cycle comptabilisé" }).first()).toBeVisible();

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
