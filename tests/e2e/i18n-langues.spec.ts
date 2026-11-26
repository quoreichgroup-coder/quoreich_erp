/**
 * PoC i18n (V155) — parcours pilote en anglais, backend simulé (aucune donnée réelle, rien vers Supabase).
 * Bascule sans rechargement ni perte de saisie (AC02), préférence appliquée après connexion (AC03),
 * écrans pilotes sans clé brute (AC01), avertissement explicite sur un écran non traduit (C-07),
 * captures téléphone / bureau, clair / sombre (AC11).
 */
import { test, expect, type Page, type Route } from "./fixtures/test";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const LANGUAGES = [
  { code: "fr", label: "Français", direction: "ltr", default_locale: "fr-FR", is_source: true },
  { code: "en", label: "English", direction: "ltr", default_locale: "en-GB", is_source: false },
];
const LOCALES = [
  { code: "fr-BF", language: "fr", label: "Français (Burkina Faso)" }, { code: "fr-FR", language: "fr", label: "Français (France)" },
  { code: "en-GB", language: "en", label: "English (United Kingdom)" }, { code: "en-US", language: "en", label: "English (United States)" },
];
const context = (language: string, locale: string) => ({
  language, locale, timezone: "Africa/Ouagadougou", source_language: "fr", user_language: language, user_locale: locale,
  tenant_language: "fr", tenant_locale: "fr-BF", allowed_languages: ["fr", "en"], tenant_languages: [],
});

/** Préférence simulée côté serveur : la bascule l'enregistre, la lecture suivante la renvoie. */
async function stubLanguage(page: Page, initial: { language: string; locale: string }) {
  let current = initial;
  const saved: unknown[] = [];
  await page.route(/\/rest\/v1\/rpc\/my_language_context/, (r) => json(r, context(current.language, current.locale)));
  await page.route(/\/rest\/v1\/rpc\/set_my_language_preferences/, (r) => {
    const body = r.request().postDataJSON() as { _language: string; _locale: string | null };
    saved.push(body);
    current = { language: body._language, locale: body._locale ?? current.locale };
    return json(r, context(current.language, current.locale));
  });
  await page.route(/\/rest\/v1\/languages/, (r) => json(r, LANGUAGES));
  await page.route(/\/rest\/v1\/supported_locales/, (r) => json(r, LOCALES));
  await page.route(/\/rest\/v1\/tenants/, (r) => json(r, { name: "Demo Company", currency: "XOF" }));
  return saved;
}

/** Marqueur posé dans la page : s'il disparaît, la page a été rechargée. */
const markPage = (page: Page) => page.evaluate(() => { (window as unknown as { __marker: string }).__marker = "same-page"; });
const samePage = (page: Page) => page.evaluate(() => (window as unknown as { __marker?: string }).__marker);
const noRawKeys = async (page: Page) =>
  expect(await page.locator("body").innerText()).not.toMatch(/\b(item|module|section|dashboard|languages|lines|editions|search|notifications)\.[a-z_]+\b/);
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

test.describe("PoC langues (V155)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("connexion : bascule FR → EN → FR sans rechargement, saisie conservée", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Connexion", exact: true })).toBeVisible();
    await page.getByLabel("Email professionnel").fill("ana@example.test");
    await markPage(page);

    await page.getByTestId("language-en").click();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByLabel("Work email")).toHaveValue("ana@example.test");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(await samePage(page)).toBe("same-page");
    await noRawKeys(page);

    await page.getByTestId("language-fr").click();
    await expect(page.getByRole("heading", { name: "Connexion", exact: true })).toBeVisible();
    await expect(page.getByLabel("Email professionnel")).toHaveValue("ana@example.test");
    expect(await samePage(page)).toBe("same-page");
  });
});

test("connecté en anglais : coquille, ventes et réglages traduits ; écran non traduit annoncé ; bascule FR à chaud", async ({ page }, info) => {
  test.setTimeout(120_000);
  const saved = await stubLanguage(page, { language: "en", locale: "en-GB" });

  await page.goto("/sales");
  await expect(page.getByRole("heading", { name: "Sales dashboard", exact: true })).toBeVisible();
  await expect(page.getByTestId("nav-section-ventes")).toContainText("Sales and customers");
  await expect(page.getByTestId("untranslated-notice")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await noRawKeys(page);

  await page.goto("/sales/transactions");
  await expect(page.getByTestId("untranslated-notice")).toHaveText("This screen is not available in English yet: it is shown in French.");

  await page.goto("/settings?tab=languages");
  await expect(page.getByText("My preferences", { exact: true })).toBeVisible();
  await expect(page.getByTestId("my-language-form").getByTestId("preview-amount")).toHaveText(/^XOF\s1,250,300$/);
  await expect(page.getByTestId("company-language-form")).toBeVisible();
  await noRawKeys(page);

  // Captures : téléphone et bureau, clair et sombre (AC11).
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => { document.documentElement.classList.toggle("dark", t === "dark"); }, theme);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      await noHorizontalScroll(page);
      await page.screenshot({ path: info.outputPath(`langues-en-${theme}-${width}.png`), fullPage: true });
    }
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.setViewportSize({ width: 1440, height: 900 });

  // Bascule à chaud vers le français depuis la barre du haut : préférence enregistrée, pas de rechargement.
  await page.goto("/sales");
  await expect(page.getByRole("heading", { name: "Sales dashboard", exact: true })).toBeVisible();
  await markPage(page);
  await page.getByTestId("language-fr").first().click();
  await expect(page.getByRole("heading", { name: "Tableau de bord des ventes", exact: true })).toBeVisible();
  await expect(page.getByTestId("nav-section-ventes")).toContainText("Ventes et clients");
  expect(await samePage(page)).toBe("same-page");
  expect(saved).toContainEqual({ _language: "fr", _locale: "en-GB" });
  await page.screenshot({ path: info.outputPath("langues-fr-apres-bascule-1440.png"), fullPage: true });
});
