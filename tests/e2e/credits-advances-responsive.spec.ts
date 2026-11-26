import { readFile } from "node:fs/promises";
import { test, expect, ALL_PERMISSIONS, type Page, type Locator } from "./fixtures/test";

const party = "Société internationale de maintenance et de distribution des équipements professionnels";
const reason = "Régularisation commerciale après contrôle des équipements livrés et des conditions du contrat";
const date = () => new Date().toISOString().slice(0, 10);
const permissions = [...ALL_PERMISSIONS, "ar.invoice", "ar.receipt", "ar.credit_note", "ar.refund", "ap.invoice", "ap.pay", "ap.credit_note"];

test.beforeEach(async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", r => r.fulfill({ json: { roles: ["admin"], permissions } }));
  await page.route("**/rest/v1/customers?*", r => r.fulfill({ json: [{ id: "customer-1", name: party }] }));
  await page.route("**/rest/v1/suppliers?*", r => r.fulfill({ json: [{ id: "supplier-1", name: party, currency: "EUR" }] }));
  await page.route("**/rest/v1/exchange_rates?*", r => r.fulfill({ json: [{ id: "eur", currency: "EUR", rate: 655.957, rate_date: date() }] }));
  for (const kind of ["ar", "ap"]) {
    await page.route(`**/rest/v1/${kind}_invoices?*`, r => r.fulfill({ json: [{
      id: `${kind}-1`, invoice_number: `${kind.toUpperCase()}-CREDIT-001`, invoice_date: date(), due_date: date(),
      customer_id: "customer-1", supplier_id: "supplier-1", customer: { name: party }, supplier: { name: party },
      subtotal: 100000, tax_amount: 18000, total: 118000, amount_paid: 10000, status: "open", approval_status: "approved",
    }] }));
    await page.route(`**/rest/v1/${kind}_credit_notes?*`, r => r.fulfill({ json: [{
      id: `${kind}-note-1`, credit_note_number: `${kind.toUpperCase()}-AV-001`, invoice_id: `${kind}-1`,
      invoice: { invoice_number: `${kind.toUpperCase()}-CREDIT-001` }, customer_id: "customer-1", supplier_id: "supplier-1",
      customer: { name: party }, supplier: { name: party }, credit_date: date(), reason,
      subtotal: 10000, tax_amount: 1800, total: 11800, amount_allocated: 1800, amount_refunded: 0,
      supplier_reference: "FOURNISSEUR-AV-001", lines: [{ line_no: 1, description: reason, quantity: 1, unit_price: 10000, discount_pct: 0, net_amount: 10000, tax_amount: 1800 }],
    }] }));
  }
  await page.route("**/rest/v1/ar_customer_advances?*", r => r.fulfill({ json: [{
    id: "ar-advance-1", advance_number: "AC-001", customer_id: "customer-1", customer: { name: party }, received_date: date(),
    amount: 50000, amount_applied: 10000, amount_refunded: 5000, reference: reason,
  }] }));
  await page.route("**/rest/v1/ap_supplier_advances?*", r => r.fulfill({ json: [{
    id: "ap-advance-1", advance_number: "AF-001", supplier_id: "supplier-1", supplier: { name: party }, paid_date: date(),
    amount: 50000, amount_applied: 10000, currency: "EUR", fx_amount: 76.22,
  }] }));
  await page.route("**/rest/v1/ar_invoice_lines?*", r => r.fulfill({ json: [{
    id: "line-1", line_no: 1, description: reason, quantity: 3, unit_price: 10000, discount_pct: 0, net_amount: 30000, tax_amount: 5400,
  }] }));
});

async function contained(page: Page, root?: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  if (root) expect(await root.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
}

async function touchForm(dialog: Locator, ids: string[]) {
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))); });
  const fields = dialog.locator(ids.map(id => `#${id}`).join(","));
  const boxes = await fields.evaluateAll(elements => elements.map(e => {
    const box = e.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height, size: parseFloat(getComputedStyle(e).fontSize) };
  }));
  expect(boxes).toHaveLength(ids.length);
  for (const box of boxes) {
    expect(box.width).toBeGreaterThan(180);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.size).toBeGreaterThanOrEqual(16);
    expect(Math.abs(box.left - boxes[0].left)).toBeLessThan(1);
  }
  for (let index = 1; index < boxes.length; index++) expect(boxes[index].top).toBeGreaterThan(boxes[index - 1].top);
}

test("les quatre registres associent les mêmes valeurs aux cartes mobiles et aux tableaux", async ({ page }, info) => {
  test.setTimeout(90_000);
  for (const [path, tab, label, code, count] of [
    ["/receivables/transactions", "Avoirs", "Avoirs clients", "AR-AV-001", 1],
    ["/receivables/transactions", "Acomptes et crédits", "Acomptes et crédits clients", "AC-001", 2],
    ["/payables/transactions", "Avoirs", "Avoirs fournisseurs", "AP-AV-001", 1],
    ["/payables/transactions", "Règlements", "Avances fournisseurs", "AF-001", 1],
  ] as const) {
    await page.goto(path);
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const list = page.getByRole("table", { name: label, exact: true });
    await expect(list.locator("tbody tr")).toHaveCount(count);
    const row = list.locator("tbody tr").filter({ hasText: code });
    for (const width of [320, 390, 767, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => row.evaluate(e => getComputedStyle(e).display)).toBe(width < 768 ? "grid" : "table-row");
      await expect(list.locator("tbody tr")).toHaveCount(count);
      await expect(row).toContainText(party);
      await contained(page);
      if (width < 768) {
        const cells = row.getByRole("cell");
        await expect(cells.filter({ has: page.getByText(path.startsWith("/receivables") ? "Client" : "Fournisseur", { exact: true }) })).toContainText(party);
        if (tab === "Avoirs") await expect(cells.filter({ hasText: "Motif" })).toContainText(reason);
        await expect(cells.filter({ hasText: tab === "Avoirs" ? "Non imputé" : "Disponible" })).toContainText(tab === "Avoirs" ? /10\s*000/ : code === "AC-001" ? /35\s*000/ : /40\s*000/);
      }
      if (width === 390 || width === 1440) await row.screenshot({ path: info.outputPath(`${code}-${width}.png`) });
    }
  }
});

test("le bandeau blanc couvre la zone du logo et garde le logo centré sans déformation", async ({ page }, info) => {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto("/receivables/transactions");
    if (width < 768) await page.getByRole("button", { name: "Afficher ou masquer le menu", exact: true }).click();
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    const brand = sidebar.locator('[data-sidebar="brand"]');
    const logo = brand.getByRole("img", { name: "QERP", exact: true });
    await expect(logo).toBeVisible();
    await sidebar.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))); });
    const geometry = await brand.evaluate(element => {
      const box = element.getBoundingClientRect(), parent = element.parentElement!.getBoundingClientRect();
      const image = element.querySelector("img")!, img = image.getBoundingClientRect();
      return { background: getComputedStyle(element).backgroundColor, width: box.width, parentWidth: parent.width, top: box.top - parent.top,
        height: box.height, logoWidth: img.width, logoHeight: img.height, ratio: image.naturalWidth / image.naturalHeight,
        center: Math.abs(img.x + img.width / 2 - box.x - box.width / 2), filter: getComputedStyle(image).filter };
    });
    expect(geometry.background).toBe("rgb(255, 255, 255)"); expect(Math.abs(geometry.width - geometry.parentWidth)).toBeLessThanOrEqual(1);
    expect(geometry.top).toBe(0); expect(geometry.height).toBe(56); expect(geometry.center).toBeLessThanOrEqual(1);
    expect(geometry.logoWidth).toBe(128); expect(geometry.logoWidth / geometry.logoHeight).toBeCloseTo(geometry.ratio, 2); expect(geometry.filter).toBe("none");
    await brand.screenshot({ path: info.outputPath(`bandeau-logo-${width}.png`) });
    if (width === 1440) await page.screenshot({ path: info.outputPath("navigation-bureau.png") });
  }
});

test("les détails d'avoir s'ouvrent au clavier, s'exportent et rendent le focus", async ({ page }, info) => {
  for (const [path, label, code] of [
    ["/receivables/transactions", "Avoirs clients", "AR-AV-001"],
    ["/payables/transactions", "Avoirs fournisseurs", "AP-AV-001"],
  ]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path); await page.getByRole("tab", { name: "Avoirs", exact: true }).click();
    const reference = page.getByRole("table", { name: label, exact: true }).getByRole("button", { name: code, exact: true });
    await reference.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading")).toContainText(code);
    await expect(dialog.getByRole("region", { name: "En-tête", exact: true })).toContainText(party);
    await contained(page, dialog);
    await page.setViewportSize({ width: 320, height: 844 });
    const identity = dialog.getByRole("region", { name: "En-tête", exact: true }).getByText(path.startsWith("/receivables") ? "Client" : "Fournisseur", { exact: true }).locator("..");
    expect((await identity.boundingBox())!.width).toBeGreaterThan(180);
    await contained(page, dialog);
    if (path.startsWith("/receivables")) {
      const lines = dialog.getByRole("region", { name: "Lignes", exact: true });
      expect(await lines.evaluate(e => getComputedStyle(e).overflowX)).toBe("auto");
      await lines.evaluate(e => { e.scrollLeft = e.scrollWidth; });
      const last = lines.locator("tbody td").last();
      expect((await last.boundingBox())!.x + (await last.boundingBox())!.width).toBeLessThanOrEqual((await lines.boundingBox())!.x + (await lines.boundingBox())!.width + 1);
    }
    const pending = page.waitForEvent("download"); await dialog.getByTestId("btn-document-csv").click();
    const csv = await readFile((await (await pending).path())!, "utf8");
    expect(csv).toContain(reason); expect(csv.replace(/\s/g, "")).toContain("11800");
    await dialog.screenshot({ path: info.outputPath(`${path.startsWith("/receivables") ? "ar" : "ap"}-credit-detail-320.png`) });
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.keyboard.press("Escape"); await expect(reference).toBeFocused();
  }
});

test("le clic sur une valeur d'avoir rend le focus à la référence de la même ligne", async ({ page }) => {
  for (const kind of ["ar", "ap"]) {
    for (const embedded of [false, true]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(kind === "ar" ? "/receivables/transactions" : "/payables/transactions");
      if (embedded) await page.getByRole("button", { name: `${kind.toUpperCase()}-CREDIT-001`, exact: true }).click();
      else await page.getByRole("tab", { name: "Avoirs", exact: true }).click();
      const list = embedded
        ? page.getByRole("dialog").getByRole("table", { name: kind === "ar" ? "Avoirs" : "Avoirs sur cette facture", exact: true })
        : page.getByRole("table", { name: kind === "ar" ? "Avoirs clients" : "Avoirs fournisseurs", exact: true });
      const row = list.locator("tbody tr").first();
      const reference = row.getByRole("button", { name: `${kind.toUpperCase()}-AV-001`, exact: true });
      await row.getByRole("cell").filter({ has: page.getByText("TTC", { exact: true }) }).click();
      await expect(page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: new RegExp(`^Avoir${kind === "ap" ? " fournisseur" : ""} ${kind.toUpperCase()}-AV-001$`) }) })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(reference).toBeFocused();
    }
  }
});

test("les acomptes et avances restent sur une colonne avec leurs valeurs et le focus", async ({ page }, info) => {
  for (const [path, name, amountId, referenceId, ids] of [
    ["/receivables/transactions", "Acompte client", "advance-amount", "advance-reference", ["advance-customer", "advance-amount", "advance-date", "advance-method", "advance-reference"]],
    ["/payables/transactions", "Avance fournisseur", "adv-amount", "adv-ref", ["adv-supplier", "adv-date", "adv-method", "adv-ref", "adv-currency", "adv-amount", "adv-rate"]],
  ] as const) {
    await page.setViewportSize({ width: 320, height: 640 }); await page.goto(path);
    const trigger = page.getByRole("button", { name, exact: true }); await trigger.click();
    const dialog = page.getByRole("dialog");
    if (name === "Avance fournisseur") await dialog.locator("#adv-supplier").selectOption("supplier-1");
    await touchForm(dialog, [...ids]); await contained(page, dialog);
    await dialog.locator(`#${amountId}`).fill("12345"); await dialog.locator(`#${referenceId}`).fill("ACOMPTE-MOBILE");
    await page.setViewportSize({ width: 1440, height: 900 }); await expect(dialog.locator(`#${amountId}`)).toHaveValue("12345");
    await page.setViewportSize({ width: 390, height: 700 }); await expect(dialog.locator(`#${referenceId}`)).toHaveValue("ACOMPTE-MOBILE");
    await dialog.screenshot({ path: info.outputPath(`${amountId}-390.png`) });
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  }
});

test("les avoirs intégrés conservent leurs légendes et leur formulaire dans le panneau de facture", async ({ page }, info) => {
  for (const kind of ["ar", "ap"]) {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(kind === "ar" ? "/receivables/transactions" : "/payables/transactions");
    const reference = page.getByRole("button", { name: `${kind.toUpperCase()}-CREDIT-001`, exact: true }); await reference.click();
    const panel = page.getByRole("dialog", { name: `Facture ${kind.toUpperCase()}-CREDIT-001`, exact: true });
    const list = panel.getByRole("table", { name: kind === "ar" ? "Avoirs" : "Avoirs sur cette facture", exact: true });
    await expect(list.locator("tbody tr")).toHaveCount(1);
    await expect(list.getByRole("cell").filter({ hasText: "Motif" })).toContainText(reason);
    await expect(list.getByRole("cell").filter({ hasText: "Non imputé" })).toContainText(/10\s*000/);
    const trigger = panel.getByRole("button", { name: "Créer un avoir", exact: true }); await trigger.click();
    const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: new RegExp(`^Avoir${kind === "ap" ? " fournisseur" : ""} sur la facture`) }) });
    const reasonId = kind === "ar" ? "credit-reason" : "ap-credit-reason";
    await touchForm(form, kind === "ar" ? ["credit-reason", "credit-date"] : ["ap-credit-reason", "ap-credit-subtotal", "ap-credit-tax", "ap-credit-reference", "ap-credit-date"]);
    await contained(page, form); await form.locator(`#${reasonId}`).fill("Motif conservé pendant le redimensionnement");
    if (kind === "ar") {
      const grid = form.getByRole("region", { name: "Lignes à créditer", exact: true });
      expect(await grid.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true);
      await grid.evaluate(e => { e.scrollLeft = e.scrollWidth; });
      await form.getByLabel("Quantité à créditer ligne 1", { exact: true }).fill("1");
    }
    await page.setViewportSize({ width: 1024, height: 900 }); await expect(form.locator(`#${reasonId}`)).toHaveValue("Motif conservé pendant le redimensionnement");
    await page.setViewportSize({ width: 390, height: 800 }); await form.screenshot({ path: info.outputPath(`${kind}-credit-form.png`) });
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); await expect(panel).toBeVisible();
    await page.keyboard.press("Escape"); await expect(reference).toBeFocused();
  }
});

test("le remboursement garde la saisie après erreur et le même crédit au succès", async ({ page }, info) => {
  const calls: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/rpc/refund_customer_credit", route => {
    calls.push(route.request().postDataJSON());
    return calls.length === 1 ? route.fulfill({ status: 400, json: { message: "Remboursement indisponible, réessayez" } }) : route.fulfill({ json: null });
  });
  await page.setViewportSize({ width: 320, height: 640 }); await page.goto("/receivables/transactions");
  await page.getByRole("tab", { name: "Acomptes et crédits", exact: true }).click();
  const trigger = page.locator('[data-testid="customer-credit-row"]').filter({ hasText: "AC-001" }).getByRole("button", { name: "Rembourser", exact: true }); await trigger.click();
  const dialog = page.getByRole("dialog");
  await touchForm(dialog, ["refund-amount", "refund-date", "refund-method", "refund-reference"]); await contained(page, dialog);
  await dialog.locator("#refund-amount").fill("1234"); await dialog.locator("#refund-reference").fill("REF-MOBILE");
  await dialog.getByRole("button", { name: /Rembourser 1/ }).click();
  await expect(page.getByText("Remboursement indisponible, réessayez", { exact: true })).toBeVisible();
  await expect(dialog.locator("#refund-amount")).toHaveValue("1234"); await expect(dialog.locator("#refund-reference")).toHaveValue("REF-MOBILE");
  await dialog.screenshot({ path: info.outputPath("remboursement-320.png") });
  await dialog.getByRole("button", { name: /Rembourser 1/ }).click(); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
  expect(calls[1]).toMatchObject({ _source_id: "ar-advance-1", _amount: 1234, _reference: "REF-MOBILE" });
});

test("les droits de lecture ne donnent pas les actions de crédit et de remboursement", async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", r => r.fulfill({ json: { roles: ["viewer"], permissions: ["ar.read", "ap.read"] } }));
  for (const path of ["/receivables/transactions", "/payables/transactions"]) {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(path);
    await expect(page.getByRole("button", { name: /^(Acompte client|Avance fournisseur)$/ })).toHaveCount(0);
    await page.getByRole("tab", { name: "Avoirs", exact: true }).click(); await expect(page.getByRole("tabpanel")).toContainText("AV-001");
    if (path.startsWith("/receivables")) {
      await page.getByRole("tab", { name: "Acomptes et crédits", exact: true }).click();
      await expect(page.getByRole("button", { name: "Rembourser", exact: true })).toHaveCount(0);
    }
  }
});

test("le remboursement total rend le focus au titre quand le crédit disparaît", async ({ page }) => {
  let refunded = false;
  await page.route("**/rest/v1/ar_customer_advances?*", route => route.fulfill({ json: refunded ? [] : [{
    id: "ar-advance-1", advance_number: "AC-001", customer_id: "customer-1", customer: { name: party }, received_date: date(),
    amount: 50000, amount_applied: 10000, amount_refunded: 5000, reference: reason,
  }] }));
  await page.route("**/rest/v1/rpc/refund_customer_credit", route => {
    expect(route.request().postDataJSON()).toMatchObject({ _source_id: "ar-advance-1", _amount: 35000 });
    refunded = true;
    return route.fulfill({ json: null });
  });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/receivables/transactions");
  await page.getByRole("tab", { name: "Acomptes et crédits", exact: true }).click();
  const row = page.getByTestId("customer-credit-row").filter({ hasText: "AC-001" });
  await row.getByRole("button", { name: "Rembourser", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Rembourser 35/ }).click();
  await expect(row).toHaveCount(0); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Acomptes et crédits clients non imputés", exact: true })).toBeFocused();
});

test("les registres vides restent lisibles dans les deux thèmes", async ({ page }) => {
  for (const resource of ["ar_credit_notes", "ar_customer_advances", "ap_credit_notes", "ap_supplier_advances"]) await page.route(`**/rest/v1/${resource}?*`, r => r.fulfill({ json: [] }));
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [path, tab, empty] of [
      ["/receivables/transactions", "Avoirs", "Aucun avoir."],
      ["/receivables/transactions", "Acomptes et crédits", "Aucun crédit client en attente."],
      ["/payables/transactions", "Avoirs", "Aucun avoir fournisseur."],
      ["/payables/transactions", "Règlements", "Aucune avance fournisseur."],
    ]) {
      await page.setViewportSize({ width: 320, height: 700 }); await page.goto(path); await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page.getByRole("tabpanel")).toContainText(empty); await expect(page.getByRole("tabpanel").getByRole("checkbox")).toHaveCount(0); await contained(page);
    }
  }
});
