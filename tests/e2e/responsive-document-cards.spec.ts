import { readFile } from "node:fs/promises";
import { test, expect, ALL_PERMISSIONS, type Page } from "./fixtures/test";
import { E2E_USER_ID } from "./fixtures/session";

const today = () => new Date().toISOString().slice(0, 10);
const longParty = "Société cliente et fournisseur avec une dénomination particulièrement longue";

test.beforeEach(async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", r => r.fulfill({ json: {
    roles: ["admin"], permissions: [...ALL_PERMISSIONS, "sales.export", "procurement.requisition", "procurement.order", "procurement.receive"],
  } }));
  await page.route("**/rest/v1/tenants?*", r => r.fulfill({ json: { name: "Société cartes", currency: "XOF" } }));
  await page.route("**/rest/v1/customers?*", r => r.fulfill({ json: [{ id: "customer-1", name: longParty }] }));
  await page.route("**/rest/v1/purchase_requisitions?*", r => r.fulfill({ json: [1, 2].map(i => ({
    id: `pr-${i}`, pr_number: `PR-CARD-00${i}`, description: "Équipement et maintenance du service comptable avec une description détaillée à lire intégralement",
    estimated_total: i * 10000, request_date: today(), requested_by: E2E_USER_ID,
    status: i === 1 ? "approved" : "draft", po_id: null, lines: [],
  })) }));
  await page.route("**/rest/v1/purchase_orders?*", r => r.fulfill({ json: [{
    id: "po-1", po_number: "PO-CARD-001", supplier_id: "supplier-1", supplier: { name: longParty },
    order_date: today(), total: 25000, status: "approved", created_by: E2E_USER_ID, lines: [],
  }] }));
  await page.route("**/rest/v1/goods_receipts?*", r => r.fulfill({ json: [{
    id: "gr-1", gr_number: "GR-CARD-001", receipt_date: today(), status: "completed", lines: [],
    po: { po_number: "PO-CARD-001", supplier: { name: longParty } },
  }] }));
  await page.route("**/rest/v1/quotations?*", r => r.fulfill({ json: Array.from({ length: 12 }, (_, index) => ({
    id: `quote-${index + 1}`, quote_number: `QT-CARD-${String(index + 1).padStart(3, "0")}`,
    quote_date: today(), customer_id: "customer-1", customer: { name: longParty },
    total: (index + 1) * 100, total_ttc: (index + 1) * 100, status: "draft", valid_until: today(),
    created_at: `${today()}T10:00:00Z`, created_by: E2E_USER_ID,
  })) }));
  await page.route("**/rest/v1/sales_orders?*", r => r.fulfill({ json: [{
    id: "so-1", so_number: "SO-CARD-001", order_date: today(), customer_id: "customer-1",
    customer: { name: longParty }, total: 75000, total_ttc: 75000, status: "draft", quotation_id: null,
    created_at: `${today()}T10:00:00Z`, created_by: E2E_USER_ID,
  }] }));
  await page.route("**/rest/v1/delivery_notes?*", r => r.fulfill({ json: [{
    id: "dn-1", dn_number: "DN-CARD-001", delivery_date: today(), customer_id: "customer-1",
    customer: { name: longParty }, sales_order: { so_number: "SO-CARD-001" }, status: "completed", ar_invoice_id: null,
    created_at: `${today()}T10:00:00Z`,
  }] }));
});

const list = (page: Page) => page.getByRole("tabpanel").locator("table").first();
async function expectNoPageOverflow(page: Page) {
  expect(await page.locator("main").evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
}

test("les six listes deviennent des cartes sous 768 px sans perdre leurs lignes", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  for (const [path, tabs] of [
    ["/procurement/transactions", ["Demandes d'achat", "Commandes fournisseurs", "Réceptions"]],
    ["/sales/transactions", ["Quotations", "Sales Orders", "Deliveries"]],
  ] as const) {
    await page.goto(path);
    for (const tab of tabs) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      await expect(list(page).locator("tbody tr").first()).toBeVisible();
      const count = await list(page).locator("tbody tr").count();
      for (const width of [360, 390, 767, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(() => list(page).locator("tbody tr").first().evaluate(e => getComputedStyle(e).display))
          .toBe(width < 768 ? "grid" : "table-row");
        await expect(list(page).locator("tbody tr")).toHaveCount(count);
        await expectNoPageOverflow(page);
        if (width === 390 || width === 1440) {
          const module = path.startsWith("/procurement") ? "achats" : "ventes";
          await list(page).locator("tbody tr").first().screenshot({ path: testInfo.outputPath(`${module}-${tabs.indexOf(tab)}-${width}.png`) });
        }
      }
    }
  }
});

test("la sélection et le motif d'une action survivent au redimensionnement", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/procurement/transactions");
  const row = list(page).locator("tbody tr").filter({ hasText: "PR-CARD-001" });
  await row.getByRole("checkbox").check();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await row.getByRole("button", { name: "Annuler", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motif (obligatoire)").fill("Motif conservé pendant le changement de largeur");
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Motif (obligatoire)")).toHaveValue("Motif conservé pendant le changement de largeur");
  await dialog.getByRole("button", { name: "Retour", exact: true }).click();
  await expect(row.getByRole("checkbox")).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row.getByRole("checkbox")).toBeChecked();
});

test("le tri, la pagination et l'export filtré restent disponibles dans les cartes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sales/transactions");
  await expect(list(page).locator("tbody tr")).toHaveCount(10);
  const sort = list(page).getByRole("button", { name: "Total TTC (XOF)", exact: true });
  await sort.click();
  await sort.click();
  await expect(list(page).locator("tbody tr").first()).toContainText("QT-CARD-012");
  await page.getByRole("checkbox", { name: "Sélectionner tous les devis", exact: true }).check();
  await expect(list(page).locator("tbody input:checked")).toHaveCount(10);
  await page.getByRole("button", { name: "Page suivante", exact: true }).click();
  await expect(list(page).locator("tbody tr")).toHaveCount(2);
  await page.getByPlaceholder("Search quotes…").fill("QT-CARD-012");
  await expect(list(page).locator("tbody tr")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter l'onglet quotations en CSV", exact: true }).click();
  const file = await download;
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain("QT-CARD-012");
  expect(csv).not.toContain("QT-CARD-011");
  await expectNoPageOverflow(page);
});

test("le lecteur retrouve les mêmes restrictions dans les cartes", async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", r => r.fulfill({ json: { roles: ["viewer"], permissions: ["sales.view"] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sales/transactions");
  await expect(list(page).locator("tbody tr")).toHaveCount(10);
  await expect(list(page).getByRole("button", { name: "Modifier", exact: true })).toHaveCount(0);
  await expect(list(page).getByRole("button", { name: "Convertir → SO", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Export CSV désactivé/ })).toBeDisabled();
});

test("les boutons de tri ne se chevauchent pas dans l'en-tête des cartes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sales/transactions");
  await expect(list(page).locator("thead button")).toHaveCount(6);
  const boxes = await list(page).locator("thead button").evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const overlapX = Math.min(boxes[i].right, boxes[j].right) - Math.max(boxes[i].left, boxes[j].left);
    const overlapY = Math.min(boxes[i].bottom, boxes[j].bottom) - Math.max(boxes[i].top, boxes[j].top);
    expect(overlapX > 1 && overlapY > 1, `boutons ${i + 1} et ${j + 1}`).toBe(false);
  }
});

test("la référence ouvrable au clavier rétablit le focus après fermeture", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sales/transactions");
  const trigger = list(page).getByRole("button", { name: "QT-CARD-001", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("les cartes d'achat respectent la devise de la société sans inventer XOF", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/rest/v1/tenants?*", r => r.fulfill({ json: { name: "Société cartes", currency: "USD" } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/procurement/transactions");
  const row = list(page).locator("tbody tr").first();
  await expect(row).toContainText("PR-CARD-001", { timeout: 30_000 });
  await expect(row).not.toContainText("XOF");
  await page.getByRole("tab", { name: /^Commandes fournisseurs/ }).click();
  await expect(list(page).locator("tbody tr").first()).not.toContainText("XOF");
});
