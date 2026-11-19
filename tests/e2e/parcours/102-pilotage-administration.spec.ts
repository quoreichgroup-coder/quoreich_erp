import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller, verifierSocieteE2E } from "./outils";

/*
 * Pilotage et administration : tableau de bord, cockpit CFO (créances échues et leur détail), cockpit consolidé
 * (sociétés accessibles), centre de rapports, modules, historique des analyses IA, import de clients (une ligne
 * valide insérée, une ligne sans nom ignorée) puis client retrouvé. Sur site, tout passe par l'API Java.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("pilotage et administration : tableaux de bord, cockpits, modules, import de clients, historique IA", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const obs = surveiller(page);
  const nom = `${RUN} Client importé`;

  obs.etape("tableau de bord");
  await page.goto("/");
  await verifierSocieteE2E(page);
  await expect(page.getByRole("heading", { name: "Tableau de bord", exact: true })).toBeVisible();
  // Données réelles seulement : alertes de la base, sociétés accessibles (plus d'entités ni de score inventés).
  await expect(page.getByTestId("dashboard-alerts")).toBeVisible();
  await expect(page.getByTestId("dashboard-entities").getByText(/E2E QUOREICH/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("QUOREICH SN")).toHaveCount(0);
  await expect(page.getByText(/Risk Score/)).toHaveCount(0);

  obs.etape("cockpit CFO et créances échues");
  await page.goto("/cockpit");
  await expect(page.getByRole("heading", { name: "CFO Cockpit" })).toBeVisible();
  await expect(page.getByTestId("aging-ar-card")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("aging-ar-card").click();
  const detail = page.getByRole("dialog");
  await expect(detail.getByText("Créances en retard")).toBeVisible();
  await page.keyboard.press("Escape");

  obs.etape("cockpit consolidé");
  await page.goto("/cockpit/consolidated");
  await expect(page.getByRole("heading", { name: "Cockpit CFO consolidé" })).toBeVisible();
  await expect(page.getByText(/E2E QUOREICH/).first()).toBeVisible({ timeout: 30_000 });

  obs.etape("rapports, modules, historique IA");
  await page.goto("/reports");
  await verifierSocieteE2E(page);
  await expect(page.getByTestId("reports-hub").getByRole("link", { name: /États financiers et grand livre/ })).toBeVisible();
  await page.goto("/settings?tab=audit");
  await expect(page.getByTestId("settings-audit-hub")).toBeVisible();
  await page.goto("/settings?tab=workflow");
  await expect(page.getByTestId("settings-workflow-hub")).toBeVisible();
  await page.goto("/admin/modules");
  await expect(page.getByRole("heading", { name: "Module Management" })).toBeVisible();
  await page.goto("/ai/history");
  await verifierSocieteE2E(page);

  obs.etape("import de clients");
  await page.goto("/admin/import");
  await expect(page.getByRole("heading", { name: "Import de données" })).toBeVisible();
  const csv = `name;email;phone\n${nom};import-${RUN.toLowerCase()}@quoreich-e2e.invalid;+226 70 00 00 00\n;sans-nom@quoreich-e2e.invalid;\n`;
  await page.locator("#file-input").setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  const importer = page.getByRole("button", { name: /^Importer 2 ligne\(s\)$/ });
  await expect(importer).toBeEnabled();
  await importer.click();
  await expect(page.getByText("Étape 3 — Résultat de l'import")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Insérées avec succès").locator("..")).toContainText("1");
  await expect(page.getByText("Ignorées", { exact: true }).locator("..")).toContainText("1");

  obs.etape("client importé retrouvé");
  await page.goto("/customers");
  await page.getByPlaceholder("Search customers...").fill(RUN);
  await expect(page.getByText(nom).first()).toBeVisible({ timeout: 30_000 });

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
