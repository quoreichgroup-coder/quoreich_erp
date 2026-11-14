import { mkdirSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { identifiants, surveiller } from "./outils";

/*
 * Second membre de la société de test : l'approbateur (séparation des tâches, V39 — l'auteur
 * n'approuve jamais ses propres pièces). Il entre dans la société comme un vrai salarié :
 * l'administrateur émet une invitation au rôle « Approbateur achats N3 », l'approbateur se connecte
 * et saisit le code sur l'écran d'accueil. Déjà membre : on enregistre seulement sa session.
 */
const auteur = identifiants("auteur");
const approbateur = identifiants("approbateur");

test("l'approbateur rejoint la société de test par invitation", async ({ browser }, testInfo) => {
  test.skip(!auteur || !approbateur, "identifiants des comptes de test absents");
  mkdirSync("test-results-parcours/.auth", { recursive: true });

  const ctx = await browser.newContext({ baseURL: testInfo.project.use.baseURL, locale: "fr-FR" });
  const page = await ctx.newPage();
  const obs = surveiller(page);

  obs.etape("connexion de l'approbateur");
  await page.goto("/login");
  await page.getByPlaceholder("vous@entreprise.com").fill(approbateur!.email);
  await page.getByPlaceholder("••••••••").fill(approbateur!.password);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await expect(page.getByText("Chargement…")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");

  if (page.url().includes("/onboarding")) {
    obs.etape("invitation émise par l'administrateur");
    const admin = await browser.newContext({
      baseURL: testInfo.project.use.baseURL, locale: "fr-FR", storageState: "test-results-parcours/.auth/session.json",
    });
    const pa = await admin.newPage();
    await pa.goto("/settings?tab=roles");
    await pa.getByTestId("authz-tab-invitations").click();
    const roles = pa.getByTestId("invitation-role");
    const valeur = await roles.locator("option", { hasText: "Approbateur achats N3" }).getAttribute("value");
    await roles.selectOption(valeur ?? "");
    await pa.getByTestId("invitation-note").fill("Approbateur des parcours de bout en bout");
    await pa.getByTestId("invitation-create").click();
    const code = (await pa.getByTestId("invitation-last-code").locator("code").innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    await admin.close();

    obs.etape("l'approbateur saisit le code");
    await page.getByText("Rejoindre une entreprise", { exact: true }).click();
    await page.getByLabel("Code d'invitation *").fill(code);
    await page.getByRole("button", { name: /Rejoindre/ }).last().click();
    await page.waitForURL((u) => !u.pathname.startsWith("/onboarding"), { timeout: 60_000 });
  }

  await expect(page.getByText("Chargement…")).toHaveCount(0, { timeout: 60_000 });
  await expect(page).not.toHaveURL(/\/(login|onboarding)/);
  await expect(page.getByText("E2E QUOREICH (société de test)").first(), "même société que l'auteur").toBeVisible();
  const etat = await ctx.storageState({ path: "test-results-parcours/.auth/approbateur.json" });

  // Factures fournisseurs (V41) : le niveau 1 demande ap.approve_l1, porté par le rôle « Comptable ».
  // L'administrateur l'ajoute par l'écran des autorisations s'il manque (ligne repérée par
  // l'identifiant : les deux comptes de test portent le même nom).
  obs.etape("rôle Comptable de l'approbateur");
  const jeton = etat.origins.flatMap((o) => o.localStorage).find((i) => /^sb-.*-auth-token$/.test(i.name));
  const approbateurId = jeton ? JSON.parse(jeton.value)?.user?.id : undefined;
  expect(approbateurId, "identifiant de l'approbateur dans sa session").toBeTruthy();
  const admin = await browser.newContext({
    baseURL: testInfo.project.use.baseURL, locale: "fr-FR", storageState: "test-results-parcours/.auth/session.json",
  });
  const pa = await admin.newPage();
  await pa.goto("/settings?tab=roles");
  await pa.getByTestId("authz-tab-users").click();
  const rangee = pa.getByTestId(`user-row-${approbateurId}`);
  await expect(rangee).toBeVisible();
  // Rôle détenu = bouton « Retirer Comptable à … » présent (la liste déroulante, elle, contient tous
  // les rôles attribuables : lire le texte de la ligne ne dit rien).
  const detenu = rangee.getByRole("button", { name: /^Retirer Comptable à / });
  if ((await detenu.count()) === 0) {
    const choix = rangee.getByRole("combobox");
    await choix.selectOption(await choix.locator("option", { hasText: /^Comptable$/ }).getAttribute("value") ?? "");
    await expect(detenu).toHaveCount(1);
  }
  await admin.close();
  await obs.joindre(testInfo);
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
  await ctx.close();
});
