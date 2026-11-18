import { test, expect, E2E_TENANT_ID, type Route } from "./fixtures/test";
import { buildXlsx } from "../../src/lib/xlsx";

const depot = "10000000-0000-4000-8000-000000000001";
const campaign = "20000000-0000-4000-8000-000000000001";
const item = "30000000-0000-4000-8000-000000000001";
const send = (route: Route, value: unknown) => route.fulfill({ json: value });

test("S3 : import Excel à l’aveugle, validation et suivi dans le catalogue", async ({ page }) => {
  let state: "counting" | "submitted" | "validated" | null = null;
  let counted: number | null = null;
  let imports = 0;
  let validations = 0;
  let exports = 0;
  const article = { item_id: item, code: "A-01", name: "Pièce de rechange", unit: "pièce" };
  const snapshot = () => ({
    id: campaign, reference: "INV-0001", warehouse_id: depot, item_scope: "warehouse", state, can_cancel: true,
    lines: [{ ...article, counted, is_counted: counted !== null, can_edit: state === "counting" }],
  });
  await page.route("**/rest/v1/rpc/my_access", (r) => send(r, {
    roles: ["admin"], permissions: ["inventory.count", "inventory.post_count", "inventory.export"],
  }));
  await page.route("**/rest/v1/warehouses?*", (r) => send(r, [{ id: depot, code: "D01", name: "Principal" }]));
  await page.route("**/rest/v1/rpc/inventory_campaign_preview", (r) => send(r, { item_scope: "warehouse", articles: 1 }));
  await page.route("**/rest/v1/rpc/inventory_campaign", (r) => {
    const { _action, _id } = r.request().postDataJSON();
    if (_action === "active") return send(r, state && state !== "validated" ? snapshot() : null);
    if (_action === "open") { expect(_id).toBe(depot); state = "counting"; }
    else if (_action === "submit") { expect(counted).toBe(0); state = "submitted"; }
    else throw new Error(`Action inattendue : ${_action}`);
    return send(r, snapshot());
  });
  await page.route("**/rest/v1/rpc/inventory_campaign_save_counts", (r) => {
    expect(r.request().postDataJSON()).toEqual({
      _campaign: campaign, _stage: "first", _entries: [{ item_id: item, quantity: 0 }],
    });
    imports++;
    counted = 0;
    return send(r, snapshot());
  });
  await page.route("**/rest/v1/rpc/inventory_campaign_control", (r) => {
    const { _action, _id } = r.request().postDataJSON();
    expect(_id).toBe(campaign);
    if (_action === "recount_tasks") return send(r, { id: campaign, state, lines: [] });
    if (_action === "validate") { expect(state).toBe("submitted"); state = "validated"; validations++; }
    else expect(_action).toBe("review");
    return send(r, { id: campaign, reference: "INV-0001", state, percent: 100, value: null,
      lines: [{ ...article, expected: 0, first_count: 0, second_count: null, effective_count: 0, variance: 0,
        requires_recount: false, recount_requested: false, opening_unit_cost: null }] });
  });
  await page.route("**/rest/v1/rpc/inventory_campaign_catalog", (r) => {
    const input = r.request().postDataJSON();
    expect(input._expected_tenant).toBe(E2E_TENANT_ID);
    if (input._export) { expect(input._state).toBe("validated"); exports++; }
    return send(r, {
      campaigns: state && (!input._state || input._state === state) ? [{
        id: campaign, reference: "INV-0001", warehouse_id: depot, warehouse_code: "D01", warehouse_name: "Principal",
        item_scope: "warehouse", state, opened_at: "2026-11-16T07:00:00Z", updated_at: "2026-11-16T08:00:00Z",
        total_lines: 1, counted_lines: counted === null ? 0 : 1, recount_lines: 0, recounted_lines: 0,
      }] : [], next: null,
    });
  });

  await page.goto("/inventory/transactions?tab=campaigns");
  await page.getByLabel("Dépôt à inventorier").selectOption(depot);
  await page.getByRole("button", { name: "Ouvrir et geler le dépôt" }).click();
  await expect(page.getByText("INV-0001", { exact: true })).toBeVisible();
  const sheet = buildXlsx([{ id: campaign, stage: "Comptage initial", item, code: article.code, unit: article.unit, qty: 0 }], [
    { key: "id", header: "Identifiant campagne" }, { key: "stage", header: "Étape" },
    { key: "item", header: "Identifiant article" }, { key: "code", header: "Code article" },
    { key: "unit", header: "Unité" }, { key: "qty", header: "Quantité comptée" },
  ]);
  await page.getByLabel("Importer la feuille remplie (.xlsx)").setInputFiles({
    name: "comptage.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(sheet),
  });
  const confirm = page.getByRole("button", { name: "Confirmer l’import" });
  await expect(confirm).toBeVisible();
  expect(imports).toBe(0);
  await confirm.click();
  await page.getByRole("button", { name: "Soumettre le comptage" }).click();
  await expect(page.getByText("Comptage soumis · dépôt gelé")).toBeVisible();
  await page.getByRole("tab", { name: "Catalogue des campagnes" }).click();
  await page.getByRole("link", { name: "Contrôler" }).click();
  await page.getByRole("button", { name: "Consulter les écarts" }).click();
  await page.getByRole("button", { name: "Valider et ajuster le stock" }).click();
  await page.getByRole("button", { name: "Confirmer la validation" }).click();
  await expect(page.getByText("Campagne validée · dépôt libéré")).toBeVisible();
  expect(validations).toBe(1);
  await page.getByRole("link", { name: "Retour au catalogue" }).click();
  await page.getByLabel("État", { exact: true }).selectOption("validated");
  const applied = page.waitForResponse((response) => {
    if (!response.url().endsWith("/rpc/inventory_campaign_catalog")) return false;
    const input = response.request().postDataJSON();
    return !input._export && input._state === "validated" && response.ok();
  });
  await page.getByRole("button", { name: "Filtrer" }).click();
  await applied;
  await expect(page.getByRole("link", { name: "Voir les écarts" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter le catalogue (Excel)" }).click();
  expect((await download).suggestedFilename()).toBe("catalogue-inventaires.xlsx");
  expect(exports).toBe(1);
});

test("S3 : un plan ABC obsolète ne gèle pas le dépôt", async ({ page }) => {
  let previews = 0;
  let opened = false;
  await page.route("**/rest/v1/warehouses?*", (r) => send(r, [{ id: depot, code: "D01", name: "Principal" }]));
  await page.route("**/rest/v1/rpc/inventory_campaign", (r) => {
    expect(r.request().postDataJSON()).toMatchObject({ _action: "active", _id: depot });
    return send(r, opened ? {
      id: campaign, reference: "INV-ABC", warehouse_id: depot, item_scope: "cycle", state: "counting", can_cancel: true,
      lines: [{ item_id: item, code: "A-01", name: "Pièce de rechange", unit: "pièce", counted: null, is_counted: false, can_edit: true }],
    } : null);
  });
  await page.route("**/rest/v1/rpc/inventory_cycle_prepare", (r) => {
    const input = r.request().postDataJSON();
    expect(input).toMatchObject({ _warehouse: depot, _expected_tenant: E2E_TENANT_ID });
    if (input._action === "preview") {
      previews++;
      return send(r, { active_campaign: null, due_total: 1, basis: "stock_value", batch_size: 1,
        signature: `plan-${previews}`,
        lines: [{ item_id: item, code: "A-01", name: "Pièce de rechange", unit: "pièce", class: "A",
          last_validated: null, due_date: null }] });
    }
    expect(input._action).toBe("open");
    if (input._signature === "plan-1") return r.fulfill({
      status: 400, json: { code: "55000", message: "La proposition a changé. Actualisez le plan avant d’ouvrir la campagne" },
    });
    expect(input._signature).toBe("plan-2");
    opened = true;
    return send(r, { id: campaign });
  });
  await page.goto("/inventory/transactions?tab=inventory-cycle");
  await page.getByLabel("Dépôt du tournant").selectOption(depot);
  await expect(page.getByText("A-01 — Pièce de rechange")).toBeVisible();
  expect(opened).toBe(false);
  const open = page.getByRole("button", { name: "Ouvrir la campagne tournante" });
  await open.click();
  await page.getByRole("button", { name: "Confirmer le gel du dépôt" }).click();
  await expect(page.getByRole("alert")).toContainText("La proposition a changé");
  expect(opened).toBe(false);
  await page.getByRole("button", { name: "Actualiser la proposition" }).click();
  await open.click();
  await page.getByRole("button", { name: "Confirmer le gel du dépôt" }).click();
  await expect(page).toHaveURL(new RegExp(`tab=campaigns.*campaign=${campaign}`));
  await expect(page.getByText("INV-ABC", { exact: true })).toBeVisible();
  expect(opened).toBe(true);
});

test("S3 : le rapport Stock ouvre le tournant pour le même dépôt et le même classement ABC", async ({ page }) => {
  const spare = { item_id: item, code: "A-01", name: "Pièce de rechange" };
  const secondary = "10000000-0000-4000-8000-000000000002";
  await page.route("**/rest/v1/warehouses?*", (r) => send(r, [
    { id: depot, code: "D01", name: "Principal" }, { id: secondary, code: "D02", name: "Atelier" },
  ]));
  await page.route("**/rest/v1/rpc/inventory_cycle_analysis", (r) => {
    expect(r.request().postDataJSON()).toEqual({ _warehouse: secondary, _expected_tenant: E2E_TENANT_ID });
    return send(r, { configured: true, basis: "outflow_value", lookback_months: 3, total_articles: 4,
      due_total: 2, total_weight: 1600, classes: [{ class: "B", articles: 1, due: 1, weight: 500 }],
      top: [{ ...spare, class: "B", weight: 500, cumulative_percent: 87, is_due: true }] });
  });
  await page.route("**/rest/v1/rpc/inventory_cycle_prepare", (r) => {
    expect(r.request().postDataJSON()).toEqual({
      _action: "preview", _warehouse: secondary, _expected_tenant: E2E_TENANT_ID,
    });
    return send(r, { active_campaign: null, due_total: 2, basis: "outflow_value", batch_size: 1, signature: "abc-atelier",
      lines: [{ ...spare, unit: "pièce", class: "B", last_validated: null, due_date: null }] });
  });

  await page.goto("/inventory/reporting");
  await page.getByRole("tab", { name: "Analyse ABC" }).click();
  await page.getByLabel("Dépôt de l’analyse").selectOption(secondary);
  await expect(page.getByText("Sorties valorisées du dépôt · 3 mois · 4 article(s) analysé(s), 2 à échéance.")).toBeVisible();
  await expect(page.getByRole("row", { name: /A-01.*Pièce de rechange/ })
    .getByRole("cell", { name: "Classe B", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Préparer le tournant" }).click();
  await expect(page).toHaveURL(new RegExp(`tab=inventory-cycle&depot=${secondary}$`));
  await expect(page.getByLabel("Dépôt du tournant")).toHaveValue(secondary);
  await expect(page.getByText("2 article(s) à échéance, 1 dans la proposition. Base : Sorties valorisées du dépôt.")).toBeVisible();
  await expect(page.getByRole("row", { name: /A-01.*Pièce de rechange/ })
    .getByRole("cell", { name: "B", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Dépôt du tournant")).toHaveValue(secondary);
  await expect(page.getByText("2 article(s) à échéance, 1 dans la proposition. Base : Sorties valorisées du dépôt.")).toBeVisible();
});
