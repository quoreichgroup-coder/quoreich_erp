import { readFile } from "node:fs/promises";
import { test, expect, ALL_PERMISSIONS, type Page } from "./fixtures/test";

const party = "Société internationale de services et équipements avec un nom particulièrement long";
const date = () => new Date().toISOString().slice(0, 10);
test.beforeEach(async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", r => r.fulfill({ json: { roles: ["admin"], permissions: [
    ...ALL_PERMISSIONS, "ar.invoice", "ar.receipt", "ar.credit_note", "ap.pay", "ap.invoice", "ap.reverse_payment", "ap.approve_l1",
  ] } }));
  await page.route("**/rest/v1/customers?*", r => r.fulfill({ json: [{ id: "customer-1", name: party }] }));
  await page.route("**/rest/v1/suppliers?*", r => r.fulfill({ json: [{ id: "supplier-1", name: party }] }));
  await page.route("**/rest/v1/exchange_rates?*", r => r.fulfill({ json: [{ id: "rate-1", currency: "EUR", rate: 655.957, rate_date: date() }] }));
  for (const kind of ["ar", "ap"]) await page.route(`**/rest/v1/${kind}_invoices?*`, r => r.fulfill({ json: [1, 2, ...(kind === "ap" ? [3] : [])].map(i => ({
    id: `${kind}-${i}`, invoice_number: `${kind.toUpperCase()}-MOBILE-00${i}`, invoice_date: date(), due_date: date(),
    subtotal: 10000 * i, tax_amount: 0, total: 10000 * i, amount_paid: 0, status: i === 3 ? "draft" : "open",
    customer_id: "customer-1", supplier_id: "supplier-1", customer: { id: "customer-1", name: party }, supplier: { id: "supplier-1", name: party },
    approval_status: i === 3 ? "draft" : i === 1 ? "approved" : "submitted", created_at: `${date()}T08:00:00Z`,
  })) }));
  await page.route("**/rest/v1/payments?*", r => {
    const kind = r.request().url().includes("ar_receipt") ? "ar" : "ap";
    return r.fulfill({ json: [{ id: `${kind}-payment-1`, payment_date: date(), amount: 5000, payment_method: "bank_transfer",
      reference: `${kind.toUpperCase()}-PAY-MOBILE-001`, [`${kind}_invoice_id`]: `${kind}-1`, reversal_of: null,
      invoice: { invoice_number: `${kind.toUpperCase()}-MOBILE-001`, customer: { name: party }, supplier: { name: party } },
    }] });
  });
  await page.route("**/rest/v1/ap_invoice_approvals?*", r => r.fulfill({ json: [{
    id: "decision-1", invoice_id: "ap-1", level_order: 1, level_label: "Direction financière", status: "approved",
    decided_at: `${date()}T09:00:00Z`, comment: "Validation après contrôle des justificatifs et des conditions de règlement fournisseur.",
  }, { id: "pending-2", invoice_id: "ap-2", level_order: 1, level_label: "Direction financière", status: "pending", amount: 20000 }] }));
});

const table = (page: Page, index = 0) => page.getByRole("tabpanel").locator("table").nth(index);
async function contained(page: Page) {
  expect(await page.locator("main").evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

test("les six listes financières deviennent des cartes et conservent toutes leurs lignes", async ({ page }, info) => {
  test.fixme(true, "Instable en CI (26/11/2026) : nombre de lignes mesuré pendant le chargement (3 puis 1). À fiabiliser (backlog B-32) avant de le réactiver.");
  test.setTimeout(90_000);
  for (const [path, tabs] of [
    ["/receivables/transactions", [["Factures", 1], ["Encaissements", 1]]],
    ["/payables/transactions", [["Factures", 1], ["Règlements", 1], ["Approbations", 2]]],
  ] as const) {
    await page.goto(path);
    for (const [tab, count] of tabs) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      for (let index = 0; index < count; index++) {
        const list = table(page, index);
        await expect(list.locator("tbody tr").first()).toBeVisible();
        const rows = await list.locator("tbody tr").count();
        for (const width of [320, 390, 767, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await expect.poll(() => list.locator("tbody tr").first().evaluate(e => getComputedStyle(e).display)).toBe(width < 768 ? "grid" : "table-row");
          await expect(list.locator("tbody tr")).toHaveCount(rows);
          const reference = list.locator("tbody tr").first().getByRole("button").first();
          if (await reference.count()) {
            const geometry = await reference.evaluate(element => {
              const text = document.createRange();
              text.selectNodeContents(element);
              return { height: (element as HTMLElement).offsetHeight, textHeight: text.getBoundingClientRect().height };
            });
            if (width < 768) expect(geometry.height).toBeGreaterThanOrEqual(44);
            // Une référence peut occuper plusieurs lignes dans un tableau étroit.
            else expect(geometry.height).toBeLessThanOrEqual(Math.max(32, Math.ceil(geometry.textHeight) + 8));
          }
          await contained(page);
          if (width === 390 || width === 1440) await list.locator("tbody tr").first().screenshot({ path: info.outputPath(`${path.startsWith("/receivables") ? "clients" : "fournisseurs"}-${tab}-${index}-${width}.png`) });
        }
      }
    }
  }
});

test("la sélection survit au redimensionnement et le CSV suit la recherche affichée", async ({ page }) => {
  for (const [path, code] of [["/receivables/transactions", "AR"], ["/payables/transactions", "AP"]]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const row = table(page).locator("tbody tr").filter({ hasText: `${code}-MOBILE-001` });
    await row.getByRole("checkbox").check();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(row.getByRole("checkbox")).toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(row.getByRole("checkbox")).toBeChecked();
    await page.getByRole("textbox", { name: code === "AR" ? "Rechercher une facture client" : "Rechercher une facture fournisseur", exact: true }).fill(`${code}-MOBILE-001`);
    await expect(table(page).locator("tbody tr")).toHaveCount(1);
    const pending = page.waitForEvent("download");
    await page.getByTestId("btn-export-csv").click();
    const file = await pending;
    const csv = await readFile((await file.path())!, "utf8");
    expect(csv).toContain(`${code}-MOBILE-001`);
    expect(csv).not.toContain(`${code}-MOBILE-002`);
  }
});

test("les panneaux de facture contiennent le focus et passent correctement au règlement", async ({ page }) => {
  for (const [path, code, action] of [["/receivables/transactions", "AR", "Enregistrer paiement"], ["/payables/transactions", "AP", "Payer"]]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const reference = page.getByRole("button", { name: `${code}-MOBILE-001`, exact: true });
    await reference.focus(); await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: `Facture ${code}-MOBILE-001`, exact: true });
    await expect(drawer).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await drawer.evaluate(e => e.contains(document.activeElement))).toBe(true);
    }
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.keyboard.press("Escape");
    await expect(reference).toBeFocused();
    await reference.click();
    await drawer.getByRole("button", { name: action, exact: true }).click();
    const settlement = page.getByRole("dialog");
    await expect(settlement).toBeVisible();
    await expect(drawer).toHaveCount(0);
    expect(await settlement.evaluate(e => e.contains(document.activeElement))).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    const positions = await settlement.locator("#st-date, #st-method").evaluateAll(elements => elements.map(e => {
      const box = e.getBoundingClientRect(); return { left: box.left, top: box.top, width: box.width };
    }));
    expect(positions[0].width).toBeGreaterThan(250);
    expect(positions[1].top).toBeGreaterThan(positions[0].top + 20);
    expect(Math.abs(positions[1].left - positions[0].left)).toBeLessThan(1);
    await page.keyboard.press("Escape");
    await expect(reference).toBeFocused();
  }
});

test("les nouvelles factures et l’annulation d’un paiement conservent la saisie et rendent le focus", async ({ page }) => {
  for (const [path, name] of [["/receivables/transactions", "Créer facture"], ["/payables/transactions", "Nouvelle facture fournisseur"]]) {
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto(path);
    const trigger = page.getByRole("button", { name, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const dates = dialog.locator('input[type="date"]');
    await dates.first().fill("2026-10-05");
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(dates.first()).toHaveValue("2026-10-05");
    await page.setViewportSize({ width: 390, height: 600 });
    expect(await dialog.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
  await page.goto("/payables/transactions?tab=payments");
  const trigger = table(page).getByRole("button", { name: "Annuler", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motif (obligatoire)").fill("Motif conservé au changement de largeur");
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(dialog.getByLabel("Motif (obligatoire)")).toHaveValue("Motif conservé au changement de largeur");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("le lecteur garde la consultation et ne reçoit pas les actions de paiement", async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", r => r.fulfill({ json: { roles: ["viewer"], permissions: ["ar.view", "ap.view"] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/receivables/transactions");
  await expect(table(page).locator("tbody tr")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Créer facture", exact: true })).toHaveCount(0);
  await page.goto("/payables/transactions?tab=payments");
  await expect(table(page).locator("tbody tr")).toHaveCount(1);
  await expect(table(page).getByRole("button", { name: "Annuler", exact: true })).toHaveCount(0);
});

test("les états vides restent lisibles sans faux champs ni sélection de ligne", async ({ page }) => {
  await page.route(/\/rest\/v1\/(ar_invoices|ap_invoices|payments|ap_invoice_approvals)\?/, r => r.fulfill({ json: [] }));
  await page.setViewportSize({ width: 320, height: 640 });
  for (const [path, tabs] of [
    ["/receivables/transactions", ["Factures", "Encaissements"]],
    ["/payables/transactions", ["Factures", "Règlements", "Approbations"]],
  ] as const) {
    await page.goto(path);
    for (const tab of tabs) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      for (const body of await page.getByRole("tabpanel").locator("table tbody").all()) {
        await expect(body.getByRole("cell")).toHaveCount(1);
        await expect(body).toContainText(/Aucun/);
        await expect(body.getByRole("checkbox")).toHaveCount(0);
      }
      await contained(page);
    }
  }
});

test("la modification et le rejet rendent le focus à leur action sur la carte", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/payables/transactions");
  const edit = table(page).locator("tbody tr").filter({ hasText: "AP-MOBILE-003" }).getByRole("button", { name: "Modifier", exact: true });
  await edit.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(edit).toBeFocused();
  await page.getByRole("tab", { name: /^Approbations/ }).click();
  const reject = table(page).getByRole("button", { name: "Rejeter", exact: true });
  await reject.click();
  await page.getByRole("dialog").getByLabel("Motif (obligatoire)").fill("Pièce à compléter");
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByRole("dialog").getByLabel("Motif (obligatoire)")).toHaveValue("Pièce à compléter");
  await page.keyboard.press("Escape");
  await expect(reject).toBeFocused();
});

test("les champs de devise restent empilés et conservent leur cours sur téléphone", async ({ page }, info) => {
  for (const [path, kind, name] of [["/receivables/transactions", "ar", "Créer facture"], ["/payables/transactions", "ap", "Nouvelle facture fournisseur"]]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await page.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog");
    const currency = dialog.locator(`#${kind}-currency`);
    await currency.selectOption("EUR");
    const rate = dialog.locator(`#${kind}-rate`);
    await rate.fill("655.957");
    const boxes = await Promise.all([currency.boundingBox(), rate.boundingBox()]);
    expect(boxes[0]!.width).toBeGreaterThan(250);
    expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + 20);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(rate).toHaveValue("655.957");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await dialog.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`${kind}-facture-devise-mobile.png`), fullPage: true });
    await page.keyboard.press("Escape");
  }
});
