import { E2E_TENANT_ID, expect, test } from "./fixtures/test";
import { AUDIT_HEADER, EXPORT_AUDIT, EXPORT_MOUVEMENTS, lireCsv, ouvrirAudit } from "./fixtures/treasury-readonly";

test("Audit Trésorerie : le CSV reprend toutes les pages de l'action filtrée", async ({ page, baseURL }) => {
  const actions = Array.from({ length: 18 }, (_, index) => ({
    id: `audit-${index}`,
    created_at: "2026-11-16T12:00:00Z",
    actor_id: "actor",
    target_user_id: "target",
    role: "treasury_manager",
    action: index === 0 ? "revoke" : "assign",
    comment: `Action ${index}; "recette"`,
  }));
  await page.route(/\/rest\/v1\/treasury_role_audit\?/, (route) => route.fulfill({ json: actions }));

  const { dialog } = await ouvrirAudit(page, baseURL!, "auteur");
  await dialog.getByRole("combobox").filter({ hasText: /^Toutes$/ }).click();
  await page.getByRole("option", { name: "Attribution", exact: true }).click();
  await expect(dialog.getByRole("cell", { name: "assign", exact: true })).toHaveCount(15);
  await expect(dialog.getByText("1–15 sur 17", { exact: true })).toBeVisible();
  await dialog.getByRole("button").filter({ has: page.locator("svg.lucide-chevron-right") }).click();
  await expect(dialog.getByText("16–17 sur 17", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("cell", { name: "assign", exact: true })).toHaveCount(2);

  const [download] = await Promise.all([
    page.waitForEvent("download"), dialog.getByRole("button", { name: EXPORT_AUDIT }).click(),
  ]);
  const csv = await lireCsv(download);
  expect(csv.raw.split(/\r?\n/, 1)[0]).toBe(AUDIT_HEADER);
  expect(csv.rows.map((row) => row[1])).toEqual(Array(17).fill("assign"));
  expect(csv.rows.map((row) => row[4])).toEqual(actions.slice(1).map((action) => action.comment));
});

test("Trésorerie : le CSV contient seulement le mouvement affiché par le filtre", async ({ page }) => {
  const movements = [
    { id: "m1", description: "Frais; virement", amount: -1250, reference: "REC-01", is_reconciled: true },
    { id: "m2", description: "Intérêts", amount: 300, reference: "REC-02", is_reconciled: false },
  ].map((movement) => ({
    ...movement, bank_account_id: "b-1", transaction_date: "2026-11-16", created_at: "2026-11-16T12:00:00Z",
    source: "manual", journal_entry_id: null, journal_entry: null,
  }));
  const tenantScopes: (string | null)[] = [];
  await page.route(/\/rest\/v1\/bank_transactions\?/, (route) => {
    tenantScopes.push(new URL(route.request().url()).searchParams.get("tenant_id"));
    return route.fulfill({ json: movements });
  });

  await page.goto("/treasury/transactions");
  const table = page.getByTestId("treasury-movements");
  await expect(table.getByTestId("treasury-movement-row")).toHaveCount(2);
  expect(tenantScopes).toEqual([`eq.${E2E_TENANT_ID}`]);
  await page.getByRole("textbox", { name: "Rechercher un mouvement" }).fill("REC-01");
  await expect(table.getByTestId("treasury-movement-row")).toHaveCount(1);
  const [download] = await Promise.all([
    page.waitForEvent("download"), page.getByRole("button", { name: EXPORT_MOUVEMENTS }).click(),
  ]);
  const csv = await lireCsv(download);
  expect(csv.headers).toEqual(["Date", "Compte", "Origine", "Libellé", "Référence", "Pièce", "Entrée", "Sortie", "Rapproché"]);
  expect(csv.rows.map((row) => [row[3], row[4], row[6], row[7], row[8]])).toEqual([
    ["Frais; virement", "REC-01", "", "1250", "oui"],
  ]);
});
