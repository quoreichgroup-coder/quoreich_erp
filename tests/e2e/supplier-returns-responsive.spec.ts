import { readFile } from "node:fs/promises";
import { test, expect, ALL_PERMISSIONS, type Page, type Locator } from "./fixtures/test";

const today = () => new Date().toISOString().slice(0, 10);
const supplier = "Société internationale de maintenance et de distribution des équipements professionnels";
const reason = "Articles défectueux constatés pendant le contrôle des équipements et des accessoires livrés au dépôt central";
const article = "Équipement de maintenance industrielle avec une désignation complète et particulièrement longue";
const permissions = [...ALL_PERMISSIONS, "procurement.requisition", "procurement.order", "procurement.receive", "procurement.return", "ap.read", "ap.credit_note"];
const longCode = `RF-${"0123456789".repeat(7)}`;

function returns(credited = false) {
  return [
    { id: "ret-1", return_number: "RF-MOBILE-001", gr_id: "gr-1", po_id: "po-1", supplier_id: "supplier-1", return_date: today(),
      reason, replacement_expected: true, total_value: 14000, supplier: { name: supplier }, gr: { gr_number: "GR-MOBILE-001" }, po: { po_number: "PO-MOBILE-001" },
      credit_note: credited ? { credit_note_number: "AF-RETOUR-001" } : null,
      lines: [{ id: "ret-line-1", gr_line_id: "gr-line-1", po_line_id: "po-line-1", quantity: 1, unit_cost: 10000, description: article, replacement_expected: true },
        { id: "ret-line-2", gr_line_id: "gr-line-2", po_line_id: "po-line-2", quantity: 2, unit_cost: 2000, description: "Accessoire déjà retourné en totalité", replacement_expected: true }] },
    { id: "ret-2", return_number: "RF-MOBILE-002", gr_id: "gr-2", po_id: "po-1", supplier_id: "supplier-1", return_date: today(),
      reason: "Retour déjà crédité", replacement_expected: false, total_value: 4000, supplier: { name: supplier }, gr: { gr_number: "GR-MOBILE-002" }, po: { po_number: "PO-MOBILE-001" },
      credit_note: { credit_note_number: "AF-EXISTANT-002" }, lines: [] },
    { id: "ret-3", return_number: longCode, gr_id: "gr-3", po_id: "po-1", supplier_id: "supplier-1", return_date: today(),
      reason: "Retour sans valeur à créditer", replacement_expected: false, total_value: 0, supplier: { name: supplier }, gr: { gr_number: "GR-MOBILE-003" }, po: { po_number: "PO-MOBILE-001" },
      credit_note: null, lines: [] },
  ];
}

test.beforeEach(async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", r => r.fulfill({ json: { roles: ["admin"], permissions } }));
  await page.route("**/rest/v1/purchase_requisitions?*", r => r.fulfill({ json: [{ id: "pr-1", pr_number: "PR-HORS-EXPORT-RETOURS", description: "Demande indépendante", estimated_total: 5000, request_date: today(), status: "draft", lines: [] }] }));
  await page.route("**/rest/v1/purchase_orders?*", r => r.fulfill({ json: [{
    id: "po-1", po_number: "PO-MOBILE-001", supplier_id: "supplier-1", supplier: { name: supplier }, order_date: today(), total: 104000, status: "approved",
    lines: [{ id: "po-line-1", description: article, quantity: 10, unit_cost: 10000 }, { id: "po-line-2", description: "Accessoire déjà retourné en totalité", quantity: 2, unit_cost: 2000 }],
  }] }));
  await page.route("**/rest/v1/goods_receipts?*", r => r.fulfill({ json: [{
    id: "gr-1", gr_number: "GR-MOBILE-001", po_id: "po-1", po: { po_number: "PO-MOBILE-001", supplier: { name: supplier } }, receipt_date: today(), status: "completed",
    lines: [{ id: "gr-line-1", po_line_id: "po-line-1", quantity_received: 5 }, { id: "gr-line-2", po_line_id: "po-line-2", quantity_received: 2 }],
  }] }));
  await page.route("**/rest/v1/supplier_returns?*", r => r.fulfill({ json: returns() }));
  await page.route("**/rest/v1/ap_invoices?*", r => r.fulfill({ json: [
    { id: "ap-1", invoice_number: "AP-APPROUVEE-001", po_id: "po-1", supplier_id: "supplier-1", subtotal: 100000, tax_amount: 18000, total: 118000, approval_status: "approved", status: "open" },
    { id: "ap-2", invoice_number: "AP-AUTRE-COMMANDE", po_id: "po-other", subtotal: 100000, tax_amount: 18000, total: 118000, approval_status: "approved", status: "open" },
    { id: "ap-3", invoice_number: "AP-NON-APPROUVEE", po_id: "po-1", subtotal: 100000, tax_amount: 18000, total: 118000, approval_status: "submitted", status: "open" },
  ] }));
});

async function openReturns(page: Page) {
  await page.goto("/procurement/transactions");
  await page.getByRole("tab", { name: /^Retours/ }).click();
}

async function contained(page: Page, root?: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const layout = await page.locator("main").evaluate(main => {
    const rect = main.getBoundingClientRect(), edge = rect.right - parseFloat(getComputedStyle(main).paddingRight);
    const offenders = [...main.querySelectorAll<HTMLElement>("*")].filter(element => {
      for (let parent = element.parentElement; parent && parent !== main; parent = parent.parentElement)
        if (getComputedStyle(parent).overflowX !== "visible") return false;
      return element.getBoundingClientRect().right > edge + 1 || (getComputedStyle(element).overflowX === "visible" && element.scrollWidth > element.clientWidth + 1);
    }).map(element => ({ tag: element.tagName, text: element.textContent?.slice(0, 70), classes: element.className, width: element.clientWidth, scroll: element.scrollWidth, right: element.getBoundingClientRect().right, edge }));
    return { overflow: main.scrollWidth - main.clientWidth, offenders: offenders.slice(0, 14) };
  });
  expect(layout.overflow, JSON.stringify(layout)).toBeLessThanOrEqual(1);
  if (root) expect(await root.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
}

async function touchFields(dialog: Locator, ids: string[]) {
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))); });
  const boxes = await dialog.locator(ids.map(id => `#${id}`).join(",")).evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, left: rect.left, top: rect.top, size: parseFloat(getComputedStyle(element).fontSize) };
  }));
  expect(boxes).toHaveLength(ids.length);
  for (const box of boxes) {
    expect(box.width).toBeGreaterThan(180); expect(box.height).toBeGreaterThanOrEqual(44); expect(box.size).toBeGreaterThanOrEqual(16);
    expect(Math.abs(box.left - boxes[0].left)).toBeLessThan(1);
  }
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].top).toBeGreaterThan(boxes[i - 1].top);
}

test("le registre garde ses valeurs en cartes et en tableau dans les deux thèmes", async ({ page }, info) => {
  test.setTimeout(90_000);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme }); await openReturns(page);
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    const list = page.getByRole("table", { name: "Retours fournisseurs", exact: true });
    await expect(list.locator("tbody tr")).toHaveCount(3);
    const row = list.locator("tbody tr").filter({ hasText: "RF-MOBILE-001" });
    for (const width of [320, 390, 767, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => row.evaluate(e => getComputedStyle(e).display)).toBe(width < 768 ? "grid" : "table-row");
      await expect(list.locator("tbody tr")).toHaveCount(3); await expect(list).toContainText(longCode); await contained(page);
      if (width < 768) {
        for (const [label, value] of [["Fournisseur", supplier], ["Motif", reason], ["Réception", "GR-MOBILE-001"], ["Commande", "PO-MOBILE-001"]])
          await expect(row.getByRole("cell").filter({ has: page.getByText(label, { exact: true }) })).toContainText(value);
        await expect(row.getByRole("cell").filter({ has: page.getByText("Valeur HT", { exact: true }) })).toContainText(/14\s*000/);
        expect((await row.getByRole("button", { name: "Établir l'avoir", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      if (width === 390 || width === 1440) await row.screenshot({ path: info.outputPath(`retour-${theme}-${width}.png`) });
    }
  }
});

test("l'export de l'onglet Retours suit les lignes visibles", async ({ page }) => {
  await openReturns(page);
  await expect(page.getByTestId("supplier-return-row")).toHaveCount(3);
  const pending = page.waitForEvent("download"); await page.getByTestId("btn-export-csv").click();
  const csv = await readFile((await (await pending).path())!, "utf8");
  for (const code of ["RF-MOBILE-001", "RF-MOBILE-002", longCode]) expect(csv).toContain(code);
  expect(csv).toContain(supplier); expect(csv).toContain(reason); expect(csv).toContain("14000"); expect(csv).toContain("AF-EXISTANT-002");
  expect(csv).not.toContain("PR-HORS-EXPORT-RETOURS");
});

test("changer de retour réinitialise la facture et les champs de l'avoir", async ({ page }) => {
  const data = returns();
  data[1] = { ...data[1], po_id: "po-other", po: { po_number: "PO-AUTRE-COMMANDE" }, credit_note: null };
  await page.route("**/rest/v1/supplier_returns?*", route => route.fulfill({ json: data }));
  const calls: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/rpc/credit_supplier_return", route => { calls.push(route.request().postDataJSON()); return route.fulfill({ json: null }); });
  await openReturns(page);
  await page.getByTestId("supplier-return-row").filter({ hasText: "RF-MOBILE-001" }).getByRole("button", { name: "Établir l'avoir", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.locator("#credit-return-invoice").selectOption("ap-1"); await dialog.locator("#credit-return-reference").fill("AV-PRECEDENT");
  await page.keyboard.press("Escape");
  await page.getByTestId("supplier-return-row").filter({ hasText: "RF-MOBILE-002" }).getByRole("button", { name: "Établir l'avoir", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Comptabiliser l'avoir", exact: true })).toBeDisabled();
  await expect(dialog.locator("#credit-return-reference")).toHaveValue(""); await expect(dialog.locator("#credit-return-invoice")).toHaveValue("");
  await expect(dialog.locator('#credit-return-invoice option[value="ap-1"]')).toHaveCount(0);
  await dialog.locator("#credit-return-invoice").selectOption("ap-2"); await dialog.getByRole("button", { name: "Comptabiliser l'avoir", exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ _return_id: "ret-2", _invoice_id: "ap-2", _supplier_reference: null });
});

test("le détail s'ouvre au clavier et par une valeur, s'exporte et rend le focus", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 844 }); await openReturns(page);
  const row = page.getByTestId("supplier-return-row").filter({ hasText: "RF-MOBILE-001" });
  const reference = row.getByRole("button", { name: "RF-MOBILE-001", exact: true });
  for (const source of ["reference", "value"]) {
    if (source === "reference") { await reference.focus(); await page.keyboard.press("Enter"); }
    else await row.getByRole("cell").filter({ has: page.getByText("Valeur HT", { exact: true }) }).click();
    const dialog = page.getByRole("dialog", { name: "Retour fournisseur RF-MOBILE-001", exact: true });
    await expect(dialog).toBeVisible(); await expect(dialog.getByRole("region", { name: "En-tête", exact: true })).toContainText(supplier); await contained(page, dialog);
    if (source === "reference") {
      const pending = page.waitForEvent("download"); await dialog.getByTestId("btn-document-csv").click();
      const csv = await readFile((await (await pending).path())!, "utf8");
      expect(csv).toContain(article); expect(csv.replace(/\s/g, "")).toContain("14000XOF");
      await dialog.screenshot({ path: info.outputPath("retour-detail-320.png") });
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await page.keyboard.press("Escape"); await expect(reference).toBeFocused();
    await page.setViewportSize({ width: 320, height: 844 });
  }
});

test("le formulaire de retour garde les règles, la saisie et le focus après erreur puis succès", async ({ page }, info) => {
  const calls: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/rpc/create_supplier_return", route => {
    calls.push(route.request().postDataJSON());
    return calls.length === 1 ? route.fulfill({ status: 400, json: { message: "Retour indisponible, réessayez" } }) : route.fulfill({ json: "ret-created" });
  });
  await page.setViewportSize({ width: 320, height: 640 }); await page.goto("/procurement/transactions"); await page.getByRole("tab", { name: /^Réceptions/ }).click();
  const trigger = page.getByRole("button", { name: "Retour", exact: true }); await trigger.click();
  const dialog = page.getByRole("dialog"); await touchFields(dialog, ["return-reason", "return-date", "return-invoice", "return-reference"]); await contained(page, dialog);
  const lines = dialog.getByRole("region", { name: "Lignes à retourner", exact: true });
  expect(await lines.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true); await lines.evaluate(e => { e.scrollLeft = e.scrollWidth; });
  const quantity = dialog.getByLabel("Quantité à retourner ligne 1", { exact: true });
  await expect(dialog.getByLabel("Quantité à retourner ligne 2", { exact: true })).toBeDisabled();
  await dialog.locator("#return-reason").fill(` ${reason} `); await quantity.fill("5");
  await expect(dialog.getByRole("alert")).toContainText("4 retournable"); await expect(dialog.getByRole("button", { name: "Enregistrer le retour", exact: true })).toBeDisabled();
  await quantity.fill("2"); await expect(dialog.getByTestId("return-value")).toContainText(/20\s*000/);
  const checkbox = dialog.getByRole("checkbox", { name: /Remplacement attendu/ });
  const label = checkbox.locator(".."); expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44); await label.click(); await expect(checkbox).toBeChecked();
  await dialog.locator("#return-invoice").selectOption("ap-1"); await expect(dialog.locator('#return-invoice option[value="ap-2"], #return-invoice option[value="ap-3"]')).toHaveCount(0);
  await dialog.locator("#return-reference").fill(" AV-RETOUR-003 ");
  await page.setViewportSize({ width: 1440, height: 900 }); await expect(quantity).toHaveValue("2"); await page.setViewportSize({ width: 390, height: 720 });
  await expect(dialog.locator("#return-reference")).toHaveValue(" AV-RETOUR-003 "); await dialog.screenshot({ path: info.outputPath("creation-retour-390.png") });
  await dialog.getByRole("button", { name: "Enregistrer le retour", exact: true }).click();
  await expect(page.getByText("Retour indisponible, réessayez", { exact: true })).toBeVisible(); await expect(quantity).toHaveValue("2"); await expect(checkbox).toBeChecked();
  await dialog.getByRole("button", { name: "Enregistrer le retour", exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
  expect(calls[1]).toMatchObject({ _gr_id: "gr-1", _reason: reason, _lines: [{ gr_line_id: "gr-line-1", quantity: 2 }], _replacement_expected: true, _ap_invoice_id: "ap-1", _supplier_reference: "AV-RETOUR-003" });
});

test("l'avoir du retour conserve la saisie et revient à la référence quand son bouton disparaît", async ({ page }, info) => {
  let credited = false;
  const calls: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/supplier_returns?*", route => route.fulfill({ json: returns(credited) }));
  await page.route("**/rest/v1/rpc/credit_supplier_return", route => {
    calls.push(route.request().postDataJSON());
    if (calls.length === 1) return route.fulfill({ status: 400, json: { message: "Avoir indisponible, réessayez" } });
    credited = true; return route.fulfill({ json: null });
  });
  await page.setViewportSize({ width: 320, height: 700 }); await openReturns(page);
  const row = page.getByTestId("supplier-return-row").filter({ hasText: "RF-MOBILE-001" });
  const trigger = row.getByRole("button", { name: "Établir l'avoir", exact: true }); await trigger.click();
  let dialog = page.getByRole("dialog"); await touchFields(dialog, ["credit-return-invoice", "credit-return-reference", "credit-return-date"]); await contained(page, dialog);
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); await trigger.click(); dialog = page.getByRole("dialog");
  await dialog.locator("#credit-return-invoice").selectOption("ap-1"); await expect(dialog.locator('#credit-return-invoice option[value="ap-2"], #credit-return-invoice option[value="ap-3"]')).toHaveCount(0);
  await dialog.locator("#credit-return-reference").fill(" AV-RETOUR-004 "); await expect(dialog).toContainText(/16\s*520/);
  await page.setViewportSize({ width: 1440, height: 900 }); await expect(dialog.locator("#credit-return-reference")).toHaveValue(" AV-RETOUR-004 "); await page.setViewportSize({ width: 390, height: 720 });
  await dialog.screenshot({ path: info.outputPath("avoir-retour-390.png") });
  await dialog.getByRole("button", { name: "Comptabiliser l'avoir", exact: true }).click(); await expect(page.getByText("Avoir indisponible, réessayez", { exact: true })).toBeVisible();
  await expect(dialog.locator("#credit-return-reference")).toHaveValue(" AV-RETOUR-004 ");
  await dialog.getByRole("button", { name: "Comptabiliser l'avoir", exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(trigger).toHaveCount(0);
  await expect(row).toContainText("AF-RETOUR-001"); await expect(row.getByRole("button", { name: "RF-MOBILE-001", exact: true })).toBeFocused();
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]); expect(calls[1]).toMatchObject({ _return_id: "ret-1", _invoice_id: "ap-1", _supplier_reference: "AV-RETOUR-004", _credit_date: today() });
});

test("la lecture seule conserve le détail sans création de retour ni d'avoir", async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", r => r.fulfill({ json: { roles: ["viewer"], permissions: ["procurement.view", "ap.read"] } }));
  await page.setViewportSize({ width: 390, height: 844 }); await openReturns(page);
  await expect(page.getByRole("button", { name: "Établir l'avoir", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "RF-MOBILE-001", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText(reason); await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /^Réceptions/ }).click(); await expect(page.getByRole("button", { name: "Retour", exact: true })).toHaveCount(0);
});

test("les états vides restent lisibles et une réception sans ligne ne se valide pas", async ({ page }) => {
  await page.route("**/rest/v1/supplier_returns?*", r => r.fulfill({ json: [] }));
  await page.route("**/rest/v1/goods_receipts?*", r => r.fulfill({ json: [{ id: "gr-1", gr_number: "GR-MOBILE-001", po_id: "po-1", receipt_date: today(), status: "completed", lines: [] }] }));
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width: 320, height: 700 }); await openReturns(page);
    await expect(page.getByRole("tabpanel")).toContainText("Aucun retour fournisseur."); await contained(page);
    await page.getByRole("tab", { name: /^Réceptions/ }).click(); const trigger = page.getByRole("button", { name: "Retour", exact: true }); await trigger.click();
    const dialog = page.getByRole("dialog"); await expect(dialog).toContainText("Aucune ligne reçue."); await expect(dialog.getByRole("button", { name: "Enregistrer le retour", exact: true })).toBeDisabled(); await contained(page, dialog);
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  }
});
