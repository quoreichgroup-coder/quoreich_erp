import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { identifiants, verifierIdentiteE2E, verifierSocieteE2E } from "./outils";

const auteur = identifiants("auteur");
const approbateur = identifiants("approbateur");

async function seConnecter(page: Page, ids: NonNullable<typeof auteur>) {
  verifierIdentiteE2E(ids.email);
  await page.goto("/login");
  await page.getByPlaceholder("vous@entreprise.com").fill(ids.email);
  await page.getByPlaceholder("••••••••").fill(ids.password);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await verifierSocieteE2E(page, 75_000);
}

async function droits(page: Page, route: string) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => /\/rpc\/my_access$|\/authorizations\/me$/.test(new URL(r.url()).pathname), { timeout: 70_000 }),
    page.goto(route),
  ]);
  await verifierSocieteE2E(page, 60_000);
  expect(response.ok(), "La lecture des droits doit réussir dans le navigateur").toBe(true);
  const data = await response.json() as { permissions: string[] };
  return new Set(data.permissions);
}

test("Trésorerie : l’auteur voit les montants et peut exporter les mouvements existants", async ({ page }, testInfo) => {
  test.skip(!auteur, "compte auteur de recette absent");
  await seConnecter(page, auteur!);
  const permissions = await droits(page, "/treasury/transactions");
  expect(permissions.has("treasury.view_sensitive")).toBe(true);
  expect(permissions.has("treasury.export")).toBe(true);

  const table = page.getByTestId("treasury-movements");
  await expect(table.getByRole("columnheader", { name: "Entrée", exact: true })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Sortie", exact: true })).toBeVisible();
  const csv = page.getByRole("button", { name: "Exporter les mouvements (CSV)" });
  if (await table.getByTestId("treasury-movement-row").count() === 0) {
    await expect(csv).toBeDisabled();
    await testInfo.attach("validation-mouvements", { body: "Droits validés ; aucun mouvement à exporter.", contentType: "text/plain" });
    return;
  }
  const [download] = await Promise.all([page.waitForEvent("download"), csv.click()]);
  expect(download.suggestedFilename()).toMatch(/^mouvements-tresorerie-.*\.csv$/);
  const content = await readFile(await download.path(), "utf8");
  expect(content.split(/\r?\n/, 1)[0]).toBe("\uFEFFDate;Compte;Origine;Libellé;Référence;Pièce;Entrée;Sortie;Rapproché");
  await testInfo.attach("validation-mouvements", { body: "Droits et téléchargement CSV validés.", contentType: "text/plain" });
});

test("Trésorerie : montants et export masqués pour l’approbateur sans droit", async ({ page }) => {
  test.skip(!approbateur, "compte approbateur de recette absent");
  await seConnecter(page, approbateur!);
  const permissions = await droits(page, "/treasury");
  expect(permissions.has("treasury.view_sensitive")).toBe(false);
  expect(permissions.has("treasury.export")).toBe(false);
  await expect(page.getByText("Total Cash", { exact: true }).locator("..")).toContainText("•••••");

  await droits(page, "/treasury/transactions");
  const table = page.getByTestId("treasury-movements");
  await expect(table.getByRole("columnheader", { name: "Rapproché", exact: true })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Entrée", exact: true })).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: "Sortie", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Exporter les mouvements (CSV)" })).toBeDisabled();
});

test("Trésorerie : audit en lecture seule, filtre Attribution et export", async ({ page }, testInfo) => {
  test.skip(!auteur, "compte auteur de recette absent");
  await seConnecter(page, auteur!);
  const permissions = await droits(page, "/treasury/settings");
  expect(permissions.has("treasury.export")).toBe(true);
  const [response] = await Promise.all([
    page.waitForResponse((r) => /\/rest\/v1\/treasury_role_audit$|\/treasury\/role-audit$/.test(new URL(r.url()).pathname)),
    page.getByRole("button", { name: "Rôles", exact: true }).click(),
  ]);
  expect(response.ok(), "La lecture du journal d’audit doit réussir").toBe(true);
  const rows = await response.json() as Array<{ action: string }>;
  const assignments = rows.filter((row) => row.action === "assign").length;

  await page.getByRole("button", { name: /^Audit \(/ }).click();
  const audit = page.getByRole("dialog", { name: "Audit — Rôles Trésorerie" });
  await audit.getByRole("combobox").filter({ hasText: /^Toutes$/ }).click();
  await page.getByRole("option", { name: "Attribution", exact: true }).click();
  const csv = audit.getByRole("button", { name: "Exporter l'audit CSV" });
  if (assignments === 0) {
    await expect(audit.getByText(/Aucune action (enregistrée|ne correspond aux filtres)/)).toBeVisible();
    await expect(csv).toBeDisabled();
    await testInfo.attach("validation-audit", { body: "Filtre validé ; aucune attribution à exporter.", contentType: "text/plain" });
    return;
  }

  await expect(audit.getByRole("cell", { name: "assign", exact: true })).toHaveCount(Math.min(assignments, 15));
  await expect(audit.getByRole("cell", { name: "revoke", exact: true })).toHaveCount(0);
  if (assignments > 15) {
    await audit.getByRole("button").filter({ has: page.locator("svg.lucide-chevron-right") }).click();
    await expect(audit.getByText(new RegExp(`^16–.* sur ${assignments}$`))).toBeVisible();
  }
  const [download] = await Promise.all([page.waitForEvent("download"), csv.click()]);
  expect(download.suggestedFilename()).toMatch(/^treasury-role-audit-.*\.csv$/);
  const content = await readFile(await download.path(), "utf8");
  expect(content.split(/\r?\n/, 1)[0]).toBe("\uFEFFDate;Action;Rôle;Utilisateur cible;Commentaire");
  await testInfo.attach("validation-audit", { body: "Filtre et téléchargement CSV validés.", contentType: "text/plain" });
});
