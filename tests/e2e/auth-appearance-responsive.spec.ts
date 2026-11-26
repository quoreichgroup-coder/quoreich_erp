import { test, expect, type Page } from "./fixtures/test";

async function contained(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  for (const input of await page.locator("main input").all()) {
    const box = await input.boundingBox();
    expect(box!.width).toBeGreaterThan(150);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
}

for (const layout of ["essential", "enterprise"]) {
  test(`${layout} : connexion, inscription et récupération restent lisibles du téléphone au bureau`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.addInitScript(value => localStorage.setItem("qerp-auth-layout", value), layout);
    await page.goto("/login");
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 740 : 900 });
      await expect(page.getByRole("heading", { name: "Connexion", exact: true })).toBeVisible();
      await contained(page);
      if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`${layout}-login-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Créer un compte", exact: true }).click();
      await expect(page.getByLabel("Nom complet")).toBeVisible();
      await contained(page);
      if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`${layout}-signup-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Se connecter", exact: true }).click();
      await page.getByRole("button", { name: "Mot de passe oublié ?", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Mot de passe oublié", exact: true })).toBeVisible();
      await contained(page);
      await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    }
  });
}

test("les préférences restent accessibles au clavier et se retrouvent dans l’application", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await page.goto("/login");
  await page.getByLabel("Email professionnel").fill("aicha@example.test");
  await page.getByLabel("Mot de passe", { exact: true }).fill("password-123");
  const trigger = page.getByRole("button", { name: "Apparence", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Sombre", exact: true }).click();
  await dialog.getByRole("radio", { name: /Entreprise/ }).click();
  await page.screenshot({ path: info.outputPath("appearance-dark-mobile.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByLabel("Mot de passe", { exact: true })).toHaveValue("password-123");
  await page.goto("/procurement/transactions");
  const account = page.getByRole("button", { name: "Compte utilisateur", exact: true });
  await account.click();
  await page.getByRole("menuitem", { name: "Apparence", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Sombre", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: /Entreprise/ })).toBeChecked();
  await dialog.getByRole("radio", { name: "Clair", exact: true }).click();
  await dialog.getByRole("button", { name: "Terminer", exact: true }).click();
  await expect(account).toBeFocused();
  await expect(page.locator("html")).toHaveClass(/light/);
  await account.click();
  await expect(page.getByRole("menuitem", { name: "Déconnexion", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
});

test("le thème appareil réagit à un changement du système et le formulaire reste utilisable en paysage", async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.getByRole("button", { name: "Créer un compte", exact: true }).click();
  await page.getByLabel("Nom complet").fill("Aïcha Diallo");
  await page.getByLabel("Mot de passe", { exact: true }).fill("password-123");
  await page.getByRole("button", { name: "Afficher le mot de passe", exact: true }).click();
  await expect(page.getByLabel("Mot de passe", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Créer le compte", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Créer le compte", exact: true })).toBeInViewport();
  await contained(page);
  await page.screenshot({ path: info.outputPath("signup-dark-landscape.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/light/);
});

test("la réinitialisation utilise la même identité et reste contenue à 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "Lien de récupération indisponible" })).toBeVisible();
  await expect(page.getByRole("img", { name: "QERP", exact: true })).toBeVisible();
  await contained(page);
  await page.goto("/reset-password#type=recovery");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Nouveau mot de passe", exact: true })).toBeVisible();
  await expect(page.getByLabel("Confirmer le mot de passe", { exact: true })).toBeVisible();
  await contained(page);
});

test("les erreurs et boutons principaux gardent un contraste lisible dans les deux thèmes", async ({ page }, info) => {
  await page.route("**/auth/v1/token?*", route => route.fulfill({ status: 400, json: { code: "invalid_credentials", message: "Invalid login credentials" } }));
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
    await page.goto("/login");
    await page.getByLabel("Email professionnel").fill("aicha@example.test");
    await page.getByLabel("Mot de passe", { exact: true }).fill("wrong-password");
    const submit = page.getByRole("button", { name: "Se connecter", exact: true });
    await submit.hover();
    for (const target of [submit]) expect(await contrast(target)).toBeGreaterThanOrEqual(4.5);
    await submit.click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Email ou mot de passe incorrect");
    expect(await contrast(alert)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: info.outputPath(`login-error-${theme}.png`), fullPage: true });
  }
});

async function contrast(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate(element => {
    const ctx = new OffscreenCanvas(1, 1).getContext("2d")!;
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const over = (front: number[], back: number[]) => front.slice(0, 3).map((v, i) => v * front[3] / 255 + back[i] * (1 - front[3] / 255));
    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
    let background = [255, 255, 255];
    for (const ancestor of ancestors) background = over(rgba(getComputedStyle(ancestor).backgroundColor), background);
    const foreground = over(rgba(getComputedStyle(element).color), background);
    const luminance = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const values = [luminance(background), luminance(foreground)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  });
}
