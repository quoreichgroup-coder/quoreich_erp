import { mkdirSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { identifiants, SOCIETE_E2E, surveiller, verifierIdentiteE2E, verifierSocieteE2E } from "./outils";

/*
 * Connexion réelle du compte de test, puis — s'il n'a pas encore de société — création de sa
 * société par l'écran d'accueil, comme un premier utilisateur. La session est enregistrée pour
 * les parcours suivants.
 */
const ids = identifiants();

test("connexion et société de test", async ({ page }, testInfo) => {
  test.skip(!ids, "identifiants du compte de test absents");
  verifierIdentiteE2E(ids!.email);
  const obs = surveiller(page);

  obs.etape("connexion");
  await page.goto("/login");
  await page.getByPlaceholder("vous@entreprise.com").fill(ids!.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(ids!.password);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  // La garde de route lit d'abord le profil (« Chargement… ») puis redirige vers l'accueil si
  // aucune société n'est rattachée : attendre que la page se stabilise avant de décider.
  await expect(page.getByText("Chargement…")).toHaveCount(0, { timeout: 60_000 });

  if (page.url().includes("/onboarding")) {
    obs.etape("création de la société (accueil)");
    await page.getByText("Créer une entreprise", { exact: true }).click();
    await page.getByPlaceholder("Ex: QUOREICH CI").fill(SOCIETE_E2E);
    await page.getByRole("button", { name: "Créer", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/onboarding"), { timeout: 60_000 });
  }

  obs.etape("tableau de bord");
  await expect(page.getByText("Chargement…")).toHaveCount(0, { timeout: 60_000 });
  await expect(page).not.toHaveURL(/\/(login|onboarding)/);
  await expect(page.getByText("Créer une entreprise")).toHaveCount(0);
  await verifierSocieteE2E(page, 75_000);
  mkdirSync("test-results-parcours/.auth", { recursive: true });
  await page.context().storageState({ path: "test-results-parcours/.auth/session.json" });
  await obs.joindre(testInfo);
});
