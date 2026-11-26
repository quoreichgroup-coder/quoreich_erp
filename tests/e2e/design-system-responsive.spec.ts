import { test, expect, ALL_PERMISSIONS, type Page } from "./fixtures/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", route => route.fulfill({ json: {
    roles: ["admin"],
    permissions: [...ALL_PERMISSIONS, "procurement.requisition", "procurement.order", "procurement.receive"],
  } }));
  await page.route("**/rest/v1/tenants?*", route => route.fulfill({ json: {
    name: "Société de démonstration QUOREICH", currency: "XOF",
  } }));
});

async function expectContainedMain(page: Page) {
  const geometry = await page.locator("main").evaluate(element => ({
    width: element.clientWidth, content: element.scrollWidth,
    document: document.documentElement.scrollWidth, viewport: window.innerWidth,
  }));
  expect(geometry.document, "la page reste dans le viewport").toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.content, "les actions et onglets ne font pas défiler tout le contenu").toBeLessThanOrEqual(geometry.width + 1);
}

for (const [path, title] of [
  ["/procurement/transactions", "Transactions d'achat"],
  ["/sales/transactions", "Transactions de vente"],
]) {
  test(`${title} : actions et onglets contenus du téléphone au bureau`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await expect.poll(async () => page.locator("main").evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
      await expectContainedMain(page);
    }
  });
}

test("une demande de six lignes reste dans l'écran et restitue le focus à son bouton", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/procurement/transactions");
  const trigger = page.getByRole("button", { name: "Nouvelle demande", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let line = 0; line < 5; line++) await dialog.getByTestId("btn-add-doc-line").click();
  await expect.poll(async () => (await dialog.boundingBox())?.height ?? Infinity).toBeLessThanOrEqual(828);
  const box = await dialog.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(382);
  await dialog.getByRole("button", { name: "Créer la demande", exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Créer la demande", exact: true })).toBeInViewport();
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("le panneau de notifications tient dans un écran de 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/procurement/transactions");
  await page.getByTestId("notification-bell").click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect.poll(async () => {
    const geometry = await menu.boundingBox();
    return !!geometry && geometry.x >= 7.5 && geometry.x + geometry.width <= 352.5;
  }).toBe(true);
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(352);
});

test("les onglets restent utilisables au clavier dans leur zone de défilement", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/procurement/transactions");
  const tabs = page.getByRole("tablist").first();
  await tabs.getByRole("tab").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(tabs.getByRole("tab", { name: "Demandes de prix", exact: true })).toHaveAttribute("aria-selected", "true");
  await tabs.getByRole("tab", { name: "Circuit d'approbation", exact: true }).click();
  await expectContainedMain(page);
});

test("les listes d'onglets repliables gardent leur hauteur intrinsèque sur tablette", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/payables/transactions");
  const tabs = page.getByRole("tablist").first();
  await expect(tabs).toBeVisible();
  const geometry = await tabs.evaluate(element => ({
    height: element.clientHeight, contentHeight: element.scrollHeight,
  }));
  expect(geometry.height).toBeGreaterThan(40);
  expect(geometry.contentHeight).toBeLessThanOrEqual(geometry.height + 1);
});

test("la densité compacte des lignes reste stable entre téléphone et bureau", async ({ page }) => {
  await page.goto("/procurement/transactions");
  await page.getByRole("button", { name: "Nouvelle demande", exact: true }).click();
  const button = page.getByTestId("btn-add-doc-line");
  const heights: number[] = [];
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    // La hauteur de mise en page n'est pas affectée par le zoom d'entrée du dialogue.
    heights.push(await button.evaluate(element => (element as HTMLElement).offsetHeight));
  }
  expect(heights[0]).toBeGreaterThanOrEqual(24);
  expect(heights[0]).toBeLessThanOrEqual(32);
  expect(heights[1]).toBe(heights[0]);
});

test("le menu réduit retire ses commandes invisibles de la tabulation au bureau", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/procurement/transactions");
  const trigger = page.getByRole("button", { name: "Afficher ou masquer le menu", exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.press("Shift+Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest('[data-sidebar="sidebar"]'))).toBe(false);
});

test("la commande en devise étrangère conserve une seule colonne sur téléphone", async ({ page }) => {
  await page.route("**/rest/v1/exchange_rates?*", route => route.fulfill({ json: [{
    id: "fx-usd", currency: "USD", base_currency: "XOF", rate: 600, rate_date: "2026-11-21", source: "Test",
  }] }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/procurement/transactions");
  await page.getByRole("button", { name: "Nouvelle commande", exact: true }).click();
  const currency = page.locator("#po-currency-select");
  await currency.selectOption("USD");
  const rate = page.locator("#po-rate");
  await expect(rate).toBeVisible();
  const currencyBox = await currency.boundingBox();
  const rateBox = await rate.boundingBox();
  expect(rateBox!.y).toBeGreaterThan(currencyBox!.y + currencyBox!.height);
});
