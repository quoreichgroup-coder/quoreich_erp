import { test, expect } from "@playwright/test";
import { identifiants, surveiller } from "../parcours/outils";

/*
 * PoC i18n (V155) sur site, par l'API Java et la base locale : bascule en anglais depuis la barre du haut,
 * préférence enregistrée par le serveur (PUT /api/v1/me/language) puis RELUE après rechargement complet,
 * coquille et onglet « Langues et formats » en anglais, écran non traduit annoncé, retour au français.
 * Aucune requête vers Supabase (surveiller).
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("langue : anglais enregistré par l'API, conservé au rechargement, puis retour au français", async ({ page }) => {
  const obs = surveiller(page);
  const api = process.env.E2E_API_URL!;

  await page.goto("/sales");
  await expect(page.getByRole("heading", { name: "Tableau de bord des ventes", exact: true })).toBeVisible({ timeout: 60_000 });

  const enregistrement = page.waitForResponse((r) => r.url().startsWith(api) && r.url().includes("/api/v1/me/language")
    && r.request().method() === "PUT");
  await page.getByTestId("language-en").first().click();
  expect((await enregistrement).status(), "préférence enregistrée par l'API sur site").toBe(200);
  await expect(page.getByRole("heading", { name: "Sales dashboard", exact: true })).toBeVisible();

  // Rechargement complet : la langue vient du serveur (my_language_context), pas de l'état de la page.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sales dashboard", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.goto("/settings?tab=languages");
  await expect(page.getByText("My preferences", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("company-language-form")).toBeVisible();

  await page.goto("/sales/transactions");
  await expect(page.getByTestId("untranslated-notice")).toContainText("is not available in English yet");

  // Retour au français : préférence remise à zéro, la société (français) s'applique de nouveau.
  await page.goto("/settings?tab=languages");
  const formulaire = page.getByTestId("my-language-form");
  await formulaire.getByLabel("Language", { exact: true }).selectOption({ value: "" });
  await formulaire.getByLabel("Date and number format", { exact: true }).selectOption({ value: "" });
  const remise = page.waitForResponse((r) => r.url().includes("/api/v1/me/language") && r.request().method() === "PUT");
  await formulaire.getByRole("button", { name: "Save my preferences" }).click();
  expect((await remise).status()).toBe(200);
  await page.reload();
  await expect(page.getByText("Mes préférences", { exact: true })).toBeVisible({ timeout: 60_000 });
  // Aucun refus serveur, aucune erreur de page ou de console, aucune requête vers Supabase.
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});
