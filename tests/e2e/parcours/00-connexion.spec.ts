import { mkdirSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { identifiants, surveiller } from "./outils";

/*
 * Connexion réelle du compte de test, puis — s'il n'a pas encore de société — création de sa
 * société par l'écran d'accueil, comme un premier utilisateur. La session est enregistrée pour
 * les parcours suivants.
 */
const ids = identifiants();
const SOCIETE = "E2E QUOREICH (société de test)";

test("connexion et société de test", async ({ page }, testInfo) => {
  test.skip(!ids, "identifiants du compte de test absents");
  const obs = surveiller(page);

  obs.etape("connexion");
  await page.goto("/login");
  await page.getByPlaceholder("vous@entreprise.com").fill(ids!.email);
  await page.getByPlaceholder("••••••••").fill(ids!.password);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  // La garde de route lit d'abord le profil (« Chargement… ») puis redirige vers l'accueil si
  // aucune société n'est rattachée : attendre que la page se stabilise avant de décider.
  await expect(page.getByText("Chargement…")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");

  if (page.url().includes("/onboarding")) {
    obs.etape("création de la société (accueil)");
    await page.getByText("Créer une entreprise", { exact: true }).click();
    await page.getByPlaceholder("Ex: QUOREICH CI").fill(SOCIETE);
    await page.getByRole("button", { name: "Créer", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/onboarding"), { timeout: 60_000 });
  }

  obs.etape("tableau de bord");
  await expect(page.getByText("Chargement…")).toHaveCount(0, { timeout: 60_000 });
  await expect(page).not.toHaveURL(/\/(login|onboarding)/);
  await expect(page.getByText("Créer une entreprise")).toHaveCount(0);
  mkdirSync("test-results-parcours/.auth", { recursive: true });
  await page.context().storageState({ path: "test-results-parcours/.auth/session.json" });
  await obs.joindre(testInfo);
});
