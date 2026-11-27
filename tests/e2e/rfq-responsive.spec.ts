import { readFile } from "node:fs/promises";
import { test, expect, ALL_PERMISSIONS, type Page, type Locator } from "./fixtures/test";

const date = (days = 0) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const article = "Équipement de maintenance et de contrôle avec une désignation particulièrement longue";
const party = (key: string) => `Fournisseur ${key} de matériels professionnels et de services de maintenance internationale`;
const longCode = `DP-${"0123456789".repeat(7)}`;
const suppliers = ["A", "B", "C", "D", "INACTIF"].map(key => ({ id: `s-${key.toLowerCase()}`, name: party(key), status: key === "INACTIF" ? "inactive" : "active" }));
const lines = [{ id: "l1", line_no: 1, description: article, quantity: 2 }, { id: "l2", line_no: 2, description: "Accessoires pour le service comptable", quantity: 3 }];
const offers = [
  { rfq_line_id: "l1", line_no: 1, supplier_id: "s-a", supplier_name: party("A"), unit_price: 10000, currency: "XOF", unit_price_base: 10000, amount_base: 20000, lead_time_days: 20, expired: false, price_rank: 1 },
  { rfq_line_id: "l1", line_no: 1, supplier_id: "s-b", supplier_name: party("B"), unit_price: 20, currency: "EUR", unit_price_base: 13200, amount_base: 26400, lead_time_days: 2, expired: false, price_rank: 2 },
  { rfq_line_id: "l1", line_no: 1, supplier_id: "s-c", supplier_name: party("C"), unit_price: 5, currency: "USD", unit_price_base: 3000, amount_base: 6000, lead_time_days: 1, expired: true, price_rank: 0 },
  { rfq_line_id: "l2", line_no: 2, supplier_id: "s-a", supplier_name: party("A"), unit_price: 1500, currency: "XOF", unit_price_base: 1500, amount_base: 4500, lead_time_days: 10, expired: false, price_rank: 2 },
  { rfq_line_id: "l2", line_no: 2, supplier_id: "s-b", supplier_name: party("B"), unit_price: 2, currency: "EUR", unit_price_base: 1320, amount_base: 3960, lead_time_days: 20, expired: false, price_rank: 1 },
  { rfq_line_id: "l2", line_no: 2, supplier_id: "s-c", supplier_name: party("C"), unit_price: 1, currency: "USD", unit_price_base: 600, amount_base: 1800, lead_time_days: 1, expired: true, price_rank: 0 },
];
const records = (status = "sent") => [
  { id: "rfq-1", rfq_number: "DP-MOBILE-001", title: article, status, response_due: date(10), requisition: { pr_number: "PR-APP-001" }, lines: [{ id: "l1" }, { id: "l2" }], suppliers: [{ status: "responded" }, { status: "responded" }, { status: "responded" }] },
  { id: "rfq-2", rfq_number: "DP-MOBILE-002", title: "Autre consultation", status: "draft", response_due: null, lines: [{ id: "other-line" }], suppliers: [{ status: "consulted" }] },
  { id: "rfq-3", rfq_number: longCode, title: "Consultation clôturée", status: "cancelled", response_due: date(), lines: [], suppliers: [] },
];
const consulted = (other = false) => (other ? ["D"] : ["A", "B", "C"]).map(key => ({ id: `consulted-${key}`, supplier_id: `s-${key.toLowerCase()}`, supplier: { name: party(key) }, status: other ? "consulted" : "responded", currency: key === "B" ? "EUR" : "XOF", valid_until: date(key === "C" ? -1 : 10) }));

test.beforeEach(async ({ page }) => {
  await page.route("**/rest/v1/rpc/my_access", route => route.fulfill({ json: { roles: ["admin"], permissions: [...ALL_PERMISSIONS, "procurement.view", "procurement.rfq", "procurement.rfq_award"] } }));
  await page.route("**/rest/v1/suppliers?*", route => route.fulfill({ json: suppliers }));
  await page.route("**/rest/v1/purchase_requisitions?*", route => route.fulfill({ json: [
    { id: "pr-approved", pr_number: "PR-APP-001", description: "Demande approuvée", status: "approved", po_id: null, request_date: date(), estimated_total: 20000, lines: [] },
    { id: "pr-converted", pr_number: "PR-CONVERTIE", description: "Déjà convertie", status: "approved", po_id: "po-existing", request_date: date(), estimated_total: 20000, lines: [] },
    { id: "pr-draft", pr_number: "PR-BROUILLON-HORS-EXPORT", description: "Brouillon", status: "draft", po_id: null, request_date: date(), estimated_total: 20000, lines: [] },
  ] }));
  await page.route("**/rest/v1/rfqs?*", route => route.fulfill({ json: records() }));
  await page.route("**/rest/v1/rfq_lines?*", route => route.fulfill({ json: new URL(route.request().url()).searchParams.get("rfq_id") === "eq.rfq-2" ? [{ id: "other-line", line_no: 1, description: "Autre équipement", quantity: 7 }] : lines }));
  await page.route("**/rest/v1/rfq_suppliers?*", route => route.fulfill({ json: consulted(new URL(route.request().url()).searchParams.get("rfq_id") === "eq.rfq-2") }));
  await page.route("**/rest/v1/rfq_comparison?*", route => route.fulfill({ json: new URL(route.request().url()).searchParams.get("rfq_id") === "eq.rfq-2" ? [] : offers }));
});

async function openPanel(page: Page) { await page.goto("/procurement/transactions"); await page.getByRole("tab", { name: "Demandes de prix", exact: true }).click(); }
async function openDetail(page: Page) { await openPanel(page); await page.getByRole("button", { name: "DP-MOBILE-001", exact: true }).click(); await expect(page.getByTestId("rfq-detail")).toBeVisible(); }
async function contained(page: Page, root?: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(await page.locator("main").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  if (root) expect(await root.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}
async function touchFields(dialog: Locator, fields: Locator[]) {
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))); });
  const boxes = await Promise.all(fields.map(field => field.evaluate(element => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height, left: box.left, top: box.top, size: parseFloat(getComputedStyle(element).fontSize) }; })));
  for (const box of boxes) { expect(box.width).toBeGreaterThan(180); expect(box.height).toBeGreaterThanOrEqual(44); expect(box.size).toBeGreaterThanOrEqual(16); expect(Math.abs(box.left - boxes[0].left)).toBeLessThan(1); }
  for (let index = 1; index < boxes.length; index++) expect(boxes[index].top).toBeGreaterThan(boxes[index - 1].top);
}

test("les quatre listes gardent leurs lignes et valeurs sur téléphone et bureau", async ({ page }, info) => {
  test.setTimeout(90_000); await openPanel(page);
  const registry = page.getByRole("table", { name: "Demandes de prix", exact: true });
  await expect(registry.locator("tbody tr")).toHaveCount(3);
  const reference = registry.getByRole("button", { name: "DP-MOBILE-001", exact: true }); await reference.focus(); await page.keyboard.press("Enter");
  await expect(reference).toHaveAttribute("aria-expanded", "true");
  for (const [label, count] of [["Demandes de prix", 3], ["Lignes demandées", 2], ["Fournisseurs consultés", 3], ["Comparatif des offres", 6]] as const) {
    const list = page.getByRole("table", { name: label, exact: true }); await expect(list.locator("tbody tr")).toHaveCount(count);
    for (const width of [320, 390, 767, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => list.locator("tbody tr").first().evaluate(element => getComputedStyle(element).display)).toBe(width < 768 ? "grid" : "table-row");
      await expect(list.locator("tbody tr")).toHaveCount(count); await contained(page);
      if (label === "Comparatif des offres" && width < 768) {
        const first = list.locator("tbody tr").first();
        await expect(first.getByRole("cell").filter({ has: page.getByText("Fournisseur", { exact: true }) })).toContainText(party("A"));
        await expect(first.getByRole("cell").filter({ has: page.getByText("Montant XOF", { exact: true }) })).toContainText(/20\s*000/);
        expect((await first.getByRole("radio").locator("..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      if (width === 390 || width === 1440) await list.locator("tbody tr").first().screenshot({ path: info.outputPath(`${label}-${width}.png`) });
    }
  }
});

test("l'export de demandes de prix suit son registre et exclut les demandes d'achat", async ({ page }) => {
  await openPanel(page); await expect(page.getByTestId("rfq-row")).toHaveCount(3);
  const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "Exporter les demandes de prix", exact: true }).click();
  const csv = await readFile((await (await pending).path())!, "utf8");
  expect(csv).toContain("DP-MOBILE-001"); expect(csv).toContain("DP-MOBILE-002"); expect(csv).toContain(longCode); expect(csv).toContain(article); expect(csv).not.toContain("PR-BROUILLON-HORS-EXPORT");
});

test("la création reste tactile, conserve la saisie après erreur et rend le focus", async ({ page }, info) => {
  let created = false; const calls: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/rfqs?*", route => route.fulfill({ json: [...records(), ...(created ? [{ ...records()[1], id: "rfq-created", rfq_number: "DP-NEW-001", title: "Nouvelle consultation" }] : [])] }));
  await page.route("**/rest/v1/rpc/create_rfq", route => { calls.push(route.request().postDataJSON()); if (calls.length === 1) return route.fulfill({ status: 400, json: { message: "Création indisponible, réessayez" } }); created = true; return route.fulfill({ json: "rfq-created" }); });
  await page.setViewportSize({ width: 320, height: 700 }); await openPanel(page); const trigger = page.getByTestId("rfq-new"); await trigger.click();
  const dialog = page.getByRole("dialog");
  await touchFields(dialog, [dialog.getByLabel("Objet", { exact: true }), dialog.getByLabel("Réponse attendue le", { exact: true }), dialog.locator("#rfq-pr"), dialog.getByLabel("Désignation ligne 1", { exact: true }), dialog.getByLabel("Quantité ligne 1", { exact: true })]);
  await contained(page, dialog); await expect(dialog.locator('#rfq-pr option[value="pr-converted"], #rfq-pr option[value="pr-draft"]')).toHaveCount(0); await expect(dialog.getByRole("checkbox", { name: party("INACTIF"), exact: true })).toHaveCount(0);
  const checkbox = dialog.getByRole("checkbox", { name: party("A"), exact: true }); expect((await checkbox.locator("..").boundingBox())!.height).toBeGreaterThanOrEqual(44); await checkbox.check();
  await dialog.getByLabel("Objet", { exact: true }).fill(" Nouvelle consultation "); await dialog.getByLabel("Réponse attendue le", { exact: true }).fill(date(10)); await dialog.getByLabel("Désignation ligne 1", { exact: true }).fill(` ${article} `); await dialog.getByLabel("Quantité ligne 1", { exact: true }).fill("2,5");
  await page.setViewportSize({ width: 1440, height: 900 }); await expect(checkbox).toBeChecked(); await page.setViewportSize({ width: 390, height: 720 }); await dialog.screenshot({ path: info.outputPath("creation-rfq-390.png") });
  await dialog.getByTestId("rfq-create").click(); await expect(page.getByText("Création indisponible, réessayez", { exact: true })).toBeVisible(); await expect(dialog.getByLabel("Quantité ligne 1", { exact: true })).toHaveValue("2,5");
  await dialog.getByTestId("rfq-create").click(); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused(); expect(calls[1]).toEqual(calls[0]);
  expect(calls[1]).toMatchObject({ _title: "Nouvelle consultation", _requisition: null, _response_due: date(10), _lines: [{ description: article, quantity: 2.5 }], _suppliers: ["s-a"] });
});

test("l'offre attend les lignes puis garde ses prix et paramètres après erreur", async ({ page }, info) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/rest/v1/rfq_lines?*", async route => { await gate; await route.fulfill({ json: lines }); });
  const calls: Record<string, unknown>[] = []; await page.route("**/rest/v1/rpc/record_rfq_quote", route => { calls.push(route.request().postDataJSON()); return calls.length === 1 ? route.fulfill({ status: 400, json: { message: "Offre indisponible, réessayez" } }) : route.fulfill({ json: 1 }); });
  await page.setViewportSize({ width: 320, height: 700 }); await openDetail(page);
  const trigger = page.getByTestId("rfq-supplier-row").filter({ hasText: party("A") }).getByTestId("rfq-enter-quote"); await expect(trigger).toBeDisabled(); release(); await expect(trigger).toBeEnabled(); await trigger.click();
  const dialog = page.getByRole("dialog"); await touchFields(dialog, ["q-cur", "q-valid", "q-terms", "q-inco"].map(id => dialog.locator(`#${id}`))); await contained(page, dialog);
  const grid = dialog.getByRole("region", { name: "Prix et délais de l'offre", exact: true }); expect(await grid.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await dialog.locator("#q-cur").fill("EUR"); await dialog.locator("#q-valid").fill(date(10)); await dialog.locator("#q-terms").fill("30"); await dialog.locator("#q-inco").fill(" CIP ");
  await dialog.getByLabel("Prix unitaire ligne 1", { exact: true }).fill("12,5"); await dialog.getByLabel("Délai ligne 1", { exact: true }).fill("4"); await dialog.getByLabel("Prix unitaire ligne 2", { exact: true }).fill("");
  await page.setViewportSize({ width: 1440, height: 900 }); await expect(dialog.locator("#q-cur")).toHaveValue("EUR"); await page.setViewportSize({ width: 390, height: 720 }); await dialog.screenshot({ path: info.outputPath("offre-rfq-390.png") });
  await dialog.getByTestId("rfq-save-quote").click(); await expect(page.getByText("Offre indisponible, réessayez", { exact: true })).toBeVisible(); await expect(dialog.getByLabel("Prix unitaire ligne 1", { exact: true })).toHaveValue("12,5");
  await dialog.getByTestId("rfq-save-quote").click(); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused(); expect(calls[1]).toEqual(calls[0]);
  expect(calls[1]).toMatchObject({ _rfq: "rfq-1", _supplier: "s-a", _quotes: [{ line_id: "l1", unit_price: 12.5, lead_time_days: 4 }], _currency: "EUR", _valid_until: date(10), _payment_terms: 30, _incoterm: "CIP" });
});

test("une ligne déjà chiffrée arrivée pendant la saisie conserve son offre", async ({ page }) => {
  let refreshed = false; const calls: Record<string, unknown>[] = [];
  let releaseOffers!: () => void; const offerGate = new Promise<void>(resolve => { releaseOffers = resolve; });
  const extraLine = { id: "l3", line_no: 3, description: "Ligne reçue pendant la saisie", quantity: 1 };
  const extraOffer = { ...offers[0], rfq_line_id: "l3", line_no: 3, unit_price: 777, unit_price_base: 777, amount_base: 777, lead_time_days: 5 };
  await page.route("**/rest/v1/rfq_lines?*", route => route.fulfill({ json: refreshed ? [...lines, extraLine] : lines }));
  await page.route("**/rest/v1/rfq_comparison?*", async route => { if (refreshed) await offerGate; return route.fulfill({ json: refreshed ? [...offers, extraOffer] : offers }); });
  await page.route("**/rest/v1/rpc/record_rfq_quote", route => { calls.push(route.request().postDataJSON()); return route.fulfill({ json: 3 }); });
  await openDetail(page); await page.getByTestId("rfq-supplier-row").filter({ hasText: party("A") }).getByTestId("rfq-enter-quote").click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("Prix unitaire ligne 1", { exact: true }).fill("12000");
  refreshed = true; await page.clock.setFixedTime(new Date(Date.now() + 31_000));
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect(dialog.getByLabel("Prix unitaire ligne 3", { exact: true })).toBeVisible();
  await expect(dialog.getByTestId("rfq-save-quote")).toBeDisabled(); await expect(dialog.getByLabel("Prix unitaire ligne 3", { exact: true })).toBeDisabled(); releaseOffers();
  await expect(dialog.getByLabel("Prix unitaire ligne 3", { exact: true })).toHaveValue("777");
  await expect(dialog.getByLabel("Délai ligne 3", { exact: true })).toHaveValue("5");
  await expect(dialog.getByLabel("Prix unitaire ligne 1", { exact: true })).toHaveValue("12000");
  await dialog.getByLabel("Délai ligne 3", { exact: true }).fill("6"); await dialog.getByTestId("rfq-save-quote").click(); await expect(dialog).toHaveCount(0);
  expect(calls).toHaveLength(1); expect(calls[0]._quotes).toEqual([
    { line_id: "l1", unit_price: 12000, lead_time_days: 20 }, { line_id: "l2", unit_price: 1500, lead_time_days: 10 }, { line_id: "l3", unit_price: 777, lead_time_days: 6 },
  ]);
});

test("l'attribution garde les choix, exclut les offres expirées et exige le motif", async ({ page }) => {
  let awarded = false; const calls: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/rfqs?*", route => route.fulfill({ json: records(awarded ? "awarded" : "sent") }));
  await page.route("**/rest/v1/rfq_awards?*", route => route.fulfill({ json: awarded ? [{ id: "award-1", rfq_line_id: "l1", supplier_id: "s-b", supplier: { name: party("B") }, po: { po_number: "PO-RFQ-001" }, cheapest: false, reason: "Livraison prioritaire" }] : [] }));
  await page.route("**/rest/v1/rpc/award_rfq", route => { calls.push(route.request().postDataJSON()); awarded = true; return route.fulfill({ json: { purchase_orders: ["po-new"] } }); });
  await page.setViewportSize({ width: 390, height: 844 }); await openDetail(page); const detail = page.getByTestId("rfq-detail");
  await expect(detail.getByRole("radio", { name: `Retenir ${party("A")} pour la ligne 1`, exact: true })).toBeChecked(); await expect(detail.getByRole("radio", { name: `Retenir ${party("B")} pour la ligne 2`, exact: true })).toBeChecked(); await expect(detail.getByRole("radio", { name: `Retenir ${party("C")} pour la ligne 1`, exact: true })).toBeDisabled();
  const alternative = detail.getByRole("radio", { name: `Retenir ${party("B")} pour la ligne 1`, exact: true }); await alternative.check(); await expect(detail.getByTestId("rfq-award")).toBeDisabled(); await detail.locator("#rfq-reason-l1").fill("Livraison prioritaire");
  await page.setViewportSize({ width: 1440, height: 900 }); await expect(alternative).toBeChecked(); await page.setViewportSize({ width: 320, height: 700 }); await contained(page); await detail.getByTestId("rfq-award").click();
  await expect(detail.getByTestId("rfq-awards")).toContainText("PO-RFQ-001"); await expect(detail.getByRole("heading", { level: 3 })).toBeFocused();
  expect(calls).toEqual([{ _rfq: "rfq-1", _awards: [{ line_id: "l1", supplier_id: "s-b", reason: "Livraison prioritaire" }, { line_id: "l2", supplier_id: "s-b", reason: null }] }]);
});

test("l'annulation utilise le dialogue du design system et conserve le motif après erreur", async ({ page }, info) => {
  const native: string[] = []; page.on("dialog", dialog => { native.push(dialog.type()); void dialog.dismiss(); });
  let cancelled = false; const calls: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/rfqs?*", route => route.fulfill({ json: records(cancelled ? "cancelled" : "sent") }));
  await page.route("**/rest/v1/rpc/rfq_cancel", route => { calls.push(route.request().postDataJSON()); if (calls.length === 1) return route.fulfill({ status: 400, json: { message: "Annulation indisponible, réessayez" } }); cancelled = true; return route.fulfill({ json: null }); });
  await page.setViewportSize({ width: 320, height: 700 }); await openDetail(page); const detail = page.getByTestId("rfq-detail"); const trigger = detail.getByRole("button", { name: "Annuler", exact: true }); await trigger.click();
  let dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible(); await expect(dialog.getByRole("button", { name: "Confirmer l'annulation", exact: true })).toBeDisabled(); await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); await trigger.click(); dialog = page.getByRole("dialog");
  await touchFields(dialog, [dialog.getByLabel("Motif (obligatoire)", { exact: true })]); await dialog.getByLabel("Motif (obligatoire)", { exact: true }).fill(" Motif conservé et justifié "); await page.setViewportSize({ width: 1440, height: 900 }); await page.setViewportSize({ width: 390, height: 720 }); await dialog.screenshot({ path: info.outputPath("annulation-rfq-390.png") });
  await dialog.getByRole("button", { name: "Confirmer l'annulation", exact: true }).click(); await expect(page.getByText("Annulation indisponible, réessayez", { exact: true })).toBeVisible(); await expect(dialog.getByLabel("Motif (obligatoire)", { exact: true })).toHaveValue(" Motif conservé et justifié ");
  await dialog.getByRole("button", { name: "Confirmer l'annulation", exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(trigger).toHaveCount(0); await expect(detail.getByRole("heading", { level: 3 })).toBeFocused(); expect(native).toEqual([]); expect(calls).toEqual([{ _rfq: "rfq-1", _reason: "Motif conservé et justifié" }, { _rfq: "rfq-1", _reason: "Motif conservé et justifié" }]);
});

test("changer de demande réinitialise son brouillon et l'envoi rend un focus stable", async ({ page }) => {
  let sent = false; await page.route("**/rest/v1/rfqs?*", route => { const data = records(); data[1].status = sent ? "sent" : "draft"; return route.fulfill({ json: data }); });
  await page.route("**/rest/v1/rpc/rfq_send", route => { expect(route.request().postDataJSON()).toEqual({ _rfq: "rfq-2" }); sent = true; return route.fulfill({ json: null }); });
  await openDetail(page); const detail = page.getByTestId("rfq-detail"); await detail.getByLabel("Ajouter un fournisseur à consulter", { exact: true }).selectOption("s-d");
  await page.getByTestId("rfq-row").filter({ hasText: "DP-MOBILE-002" }).click(); await expect(detail.getByLabel("Ajouter un fournisseur à consulter", { exact: true })).toHaveValue(""); await expect(detail.getByRole("button", { name: "Ajouter", exact: true })).toBeDisabled();
  await detail.getByTestId("rfq-send").click(); await expect(detail.getByTestId("rfq-send")).toHaveCount(0); await expect(detail.getByRole("heading", { level: 3 })).toBeFocused();
});

test("les droits séparent lecture, saisie des offres et attribution", async ({ page }) => {
  for (const mode of ["reader", "writer", "approver"]) {
    const permissions = ["procurement.view", ...(mode === "writer" ? ["procurement.rfq"] : mode === "approver" ? ["procurement.rfq_award"] : [])];
    await page.route("**/rest/v1/rpc/my_access", route => route.fulfill({ json: { roles: ["viewer"], permissions } })); await openDetail(page); const detail = page.getByTestId("rfq-detail");
    await expect(page.getByTestId("rfq-new")).toHaveCount(mode === "writer" ? 1 : 0); await expect(detail.getByTestId("rfq-enter-quote")).toHaveCount(mode === "writer" ? 3 : 0); await expect(detail.getByRole("radio")).toHaveCount(mode === "approver" ? 6 : 0); await expect(detail.getByTestId("rfq-award")).toHaveCount(mode === "approver" ? 1 : 0);
  }
});

test("les états vides et les thèmes restent lisibles", async ({ page }) => {
  await page.route("**/rest/v1/rfqs?*", route => route.fulfill({ json: [] }));
  for (const theme of ["light", "dark"] as const) { await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width: 320, height: 700 }); await openPanel(page); await expect(page.getByTestId("rfq-panel")).toContainText("Aucune demande de prix."); await expect(page.getByRole("button", { name: "Exporter les demandes de prix", exact: true })).toBeDisabled(); await contained(page); }
});

test("une erreur de lecture est visible et sa récupération est explicite", async ({ page }) => {
  let available = false; await page.route("**/rest/v1/rfqs?*", route => available ? route.fulfill({ json: records() }) : route.fulfill({ status: 500, json: { message: "Lecture des demandes indisponible" } }));
  await openPanel(page); await expect(page.getByTestId("rfq-panel").getByRole("alert")).toContainText("Lecture des demandes indisponible", { timeout: 20000 }); await expect(page.getByTestId("rfq-panel")).not.toContainText("Aucune demande de prix."); available = true; await page.getByRole("button", { name: "Réessayer le chargement des demandes de prix", exact: true }).click(); await expect(page.getByTestId("rfq-row")).toHaveCount(3);
});
