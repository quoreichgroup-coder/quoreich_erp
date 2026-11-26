import { readFile } from "node:fs/promises";
import { test, expect, ALL_PERMISSIONS, type Page } from "./fixtures/test";

const today = () => new Date().toISOString().slice(0, 10);
const article = "Équipement de maintenance et de contrôle avec une désignation particulièrement longue";
test.beforeEach(async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", r => r.fulfill({ json: { roles: ["admin"], permissions: [
    ...ALL_PERMISSIONS, "assets.manage", "assets.depreciate", "assets.dispose", "assets.view",
  ] } }));
  await page.route("**/rest/v1/stock_movements?*", r => r.fulfill({ json: Array.from({ length: 20 }, (_, i) => ({
    id: `movement-${i + 1}`, movement_date: today(), created_at: `${today()}T08:00:00Z`,
    movement_type: i < 17 ? "receipt" : i === 17 ? "transfer_out" : i === 18 ? "transfer_in" : "adjustment",
    quantity: i < 17 ? i + 1 : i === 18 ? 2 : -1, unit_cost: 100, total_value: 100 * (i + 1),
    item: { code: `ART-${String(i + 1).padStart(3, "0")}`, name: `${article} ${i + 1}` },
    warehouse: { code: "DP-01", name: "Dépôt central de stockage des pièces et équipements" },
    entry: { piece_number: `ST-${i + 1}` }, reason: "Mouvement documenté après contrôle des quantités disponibles au dépôt central.",
  })) }));
  await page.route("**/rest/v1/items?*", r => r.fulfill({ json: [{ id: "item-1", code: "ART-001", name: article, quantity_on_hand: 20, average_cost: 100, item_type: "stock" }] }));
  await page.route("**/rest/v1/warehouses?*", r => r.fulfill({ json: [1, 2].map(i => ({ id: `wh-${i}`, code: `DP-0${i}`, name: `Dépôt ${i}` })) }));
  await page.route("**/rest/v1/assets?*", r => r.fulfill({ json: Array.from({ length: 17 }, (_, i) => ({
    id: `asset-${i + 1}`, asset_code: `FA-MOBILE-${String(i + 1).padStart(3, "0")}`, name: `${article} ${i + 1}`,
    acquisition_date: today(), acquisition_cost: 987654 + i,
  })) }));
  await page.route("**/rest/v1/depreciation_entries?*", r => r.fulfill({ json: [{ id: "DEP00001-1", period_date: today(), amount: 12345, journal_entry_id: "entry-1", asset: { name: article } }] }));
  await page.route("**/rest/v1/asset_disposals?*", r => r.fulfill({ json: [{ id: "DIS00001-1", asset_id: "asset-1", disposal_date: today(), sale_price: 100000, journal_entry_id: "entry-2" }] }));
});

const table = (page: Page) => page.getByRole("tabpanel").locator("table").first();
async function contained(page: Page) {
  expect(await page.locator("main").evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

test("les quatre listes passent en cartes sans déborder ni perdre leurs lignes", async ({ page }, info) => {
  test.setTimeout(90_000);
  for (const [path, tabs] of [
    ["/inventory/transactions", ["Mouvements", "Transferts", "Ajustements et inventaires"]],
    ["/assets/transactions", ["Mouvements d'immobilisations"]],
  ] as const) {
    await page.goto(path);
    for (const tab of tabs) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      await expect(table(page).locator("tbody tr").first()).toBeVisible();
      const count = await table(page).locator("tbody tr").count();
      for (const width of [320, 390, 767, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(() => table(page).locator("tbody tr").first().evaluate(e => getComputedStyle(e).display)).toBe(width < 768 ? "grid" : "table-row");
        await expect(table(page).locator("tbody tr")).toHaveCount(count);
        await contained(page);
        if (width === 390 || width === 1440) await table(page).locator("tbody tr").first().screenshot({ path: info.outputPath(`${path.startsWith("/inventory") ? "stock" : "actifs"}-${tabs.indexOf(tab)}-${width}.png`) });
      }
    }
  }
});

test("le stock conserve tri, pagination, sélection et portée de ses CSV", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inventory/transactions");
  await expect(table(page).locator("tbody tr")).toHaveCount(15);
  await page.getByRole("button", { name: "Page suivante", exact: true }).click();
  await expect(table(page).locator("tbody tr")).toHaveCount(5);
  await page.getByRole("button", { name: "Page précédente", exact: true }).click();
  await table(page).getByRole("button", { name: "Quantité", exact: true }).click();
  await table(page).getByRole("button", { name: "Quantité", exact: true }).click();
  const row = table(page).locator("tbody tr").first();
  await expect(row).toContainText("ART-017");
  await row.getByRole("checkbox").check();
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(row.getByRole("checkbox")).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  const selectedDownload = page.waitForEvent("download");
  await page.getByTestId("bulk-bar-stock").getByRole("button", { name: "Exporter", exact: true }).click();
  const selected = await selectedDownload;
  const selectedCsv = await readFile((await selected.path())!, "utf8");
  expect(selectedCsv).toContain("ART-017"); expect(selectedCsv).not.toContain("ART-016");
  await page.getByRole("tab", { name: "Transferts", exact: true }).click();
  const tabDownload = page.waitForEvent("download");
  await page.getByTestId("btn-export-csv").click();
  const tabCsv = await readFile((await (await tabDownload).path())!, "utf8");
  expect(tabCsv).toContain("ART-018"); expect(tabCsv).not.toContain("ART-001");
});

test("les formulaires de stock restent sur une colonne et gardent la saisie au redimensionnement", async ({ page }) => {
  for (const [name, field] of [["Ajustement de stock", "Quantité (±)"], ["Transfert", "Quantité"]]) {
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto("/inventory/transactions");
    const trigger = page.getByRole("button", { name, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(field, { exact: true }).fill("3");
    const fields = name === "Ajustement de stock" ? ["#adj-warehouse", "#adj-date"] : ["#tr-from", "#tr-to"];
    // Mesurer les deux champs dans la même image de l'animation d'ouverture.
    const boxes = await dialog.evaluate((element, selectors) => selectors.map(selector => {
      const box = element.querySelector(selector)!.getBoundingClientRect();
      return { width: box.width, left: box.left, top: box.top };
    }), fields);
    expect(boxes[0].width).toBeGreaterThan(250);
    expect(Math.abs(boxes[1].left - boxes[0].left)).toBeLessThan(1);
    expect(boxes[1].top).toBeGreaterThan(boxes[0].top + 30);
    expect(await dialog.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(dialog.getByLabel(field, { exact: true })).toHaveValue("3");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
});

test("les filtres d’immobilisations et leur CSV conservent le type choisi", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assets/transactions");
  await page.getByRole("combobox", { name: "Type de mouvement", exact: true }).click();
  await page.getByRole("option", { name: "Cession", exact: true }).click();
  await expect(table(page).locator("tbody tr")).toHaveCount(1);
  await expect(table(page).locator("tbody tr").first()).toContainText("DIS00001");
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByRole("combobox", { name: "Type de mouvement", exact: true })).toContainText("Cession");
  const pending = page.waitForEvent("download");
  await page.getByText("Export CSV", { exact: true }).click();
  const csv = await readFile((await (await pending).path())!, "utf8");
  expect(csv).toContain("DIS00001"); expect(csv).not.toContain("FA-MOBILE");
});

test("le lecteur ne récupère aucun montant masqué dans les cartes ou leurs attributs", async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", r => r.fulfill({ json: { roles: ["viewer"], permissions: ["assets.view", "inventory.view"] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assets/transactions");
  const row = table(page).locator("tbody tr").filter({ hasText: "FA-MOBILE-001" });
  await expect(row).toContainText("•••••");
  expect(await row.evaluate(e => e.outerHTML)).not.toContain("987654");
  await expect(page.getByText("Export CSV", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Calculer les amortissements", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Contre-passer le dernier calcul", exact: true })).toHaveCount(0);
  await page.goto("/inventory/transactions");
  await expect(table(page).locator("tbody tr")).toHaveCount(15);
  await expect(page.getByRole("button", { name: "Ajustement de stock", exact: true })).toHaveCount(0);
});

test("la contre-passation demande un motif, permet de corriger une erreur et restitue le focus", async ({ page }, info) => {
  const reasons: string[] = [];
  await page.route("**/rest/v1/rpc/reverse_last_depreciation", r => {
    reasons.push(r.request().postDataJSON()._reason);
    return reasons.length === 1
      ? r.fulfill({ status: 400, json: { message: "Contrôle temporairement indisponible", code: "P0001" } })
      : r.fulfill({ json: "2026-10" });
  });
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto("/assets/transactions");
  const trigger = page.getByRole("button", { name: "Contre-passer le dernier calcul", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Contre-passer", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Motif (obligatoire)").fill("  Correction du calcul validée  ");
  await page.screenshot({ path: info.outputPath("contre-passation-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(dialog.getByLabel("Motif (obligatoire)")).toHaveValue("  Correction du calcul validée  ");
  await confirm.click();
  await expect(page.getByText("Contrôle temporairement indisponible", { exact: true })).toBeVisible();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(reasons).toEqual(["Correction du calcul validée", "Correction du calcul validée"]);
});

test("les listes vides n’affichent aucune fausse sélection de ligne", async ({ page }) => {
  await page.route(/\/rest\/v1\/(stock_movements|assets|depreciation_entries|asset_disposals)\?/, r => r.fulfill({ json: [] }));
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ["/inventory/transactions", "/assets/transactions"]) {
    await page.goto(path);
    await expect(table(page).locator("tbody")).toContainText(/Aucun/);
    await expect(table(page).locator("tbody").getByRole("cell")).toHaveCount(1);
    await expect(table(page).locator("tbody").getByRole("checkbox")).toHaveCount(0);
    await contained(page);
  }
});
