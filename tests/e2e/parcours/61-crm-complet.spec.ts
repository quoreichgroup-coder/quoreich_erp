import { test, expect, type Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { identifiants, RUN, surveiller } from "./outils";

test.skip(!identifiants(), "identifiants du compte de test absents");

async function verifierCsv(download: Download, pattern: RegExp, content: string) {
  expect(download.suggestedFilename()).toMatch(pattern);
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path!, "utf8")).toContain(content);
}

async function verifierPdf(download: Download, pattern: RegExp) {
  expect(download.suggestedFilename()).toMatch(pattern);
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(bytes.byteLength).toBeGreaterThan(1000);
}

test("CRM contacts : CRUD, import, exports et actions groupées", async ({ page }) => {
  const obs = surveiller(page);
  const original = `${RUN} contact CRM`;
  const edited = `${RUN} contact CRM modifié`;
  const imported = `${RUN} contact importé`;
  await page.goto("/crm/contacts");
  await page.getByRole("button", { name: "Nouveau", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.locator("input").nth(0).fill(original);
  await dialog.locator("input").nth(1).fill(`${RUN.toLowerCase()}@example.com`);
  await dialog.locator("input").nth(3).fill("Quoreich E2E");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("row").filter({ hasText: original })).toBeVisible();

  await page.getByRole("row").filter({ hasText: original }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator("input").nth(0).fill(edited);
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("row").filter({ hasText: edited })).toBeVisible();

  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  await verifierCsv(await csv, /crm-contacts-.*\.csv/, edited);
  const pdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await verifierPdf(await pdf, /crm-contacts-.*\.pdf/);

  await page.getByRole("button", { name: "Importer", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "contacts-crm-e2e.csv", mimeType: "text/csv",
    buffer: Buffer.from(`full_name,email,status\n${imported},${RUN.toLowerCase()}-import@example.com,active`, "utf8"),
  });
  await expect(dialog.getByText(imported)).toBeVisible();
  await dialog.getByRole("button", { name: /Importer 1 contact/ }).click();
  await expect(page.getByRole("row").filter({ hasText: imported })).toBeVisible();

  const editedRow = page.getByRole("row").filter({ hasText: edited });
  const importedRow = page.getByRole("row").filter({ hasText: imported });
  await editedRow.getByRole("checkbox").check();
  await importedRow.getByRole("checkbox").check();
  await page.getByRole("combobox").last().click();
  await page.getByRole("option", { name: "Inactif" }).click();
  await expect(editedRow).toContainText("inactive");
  await expect(importedRow).toContainText("inactive");
  await importedRow.getByRole("checkbox").check();
  page.once("dialog", (confirm) => confirm.accept());
  await page.getByTitle("Supprimer la sélection").click();
  await expect(importedRow).toHaveCount(0);
  page.once("dialog", (confirm) => confirm.accept());
  await editedRow.getByTitle("Supprimer").click();
  await expect(editedRow).toHaveCount(0);
  expect(obs.inattendus(), JSON.stringify(obs.incidents, null, 2)).toEqual([]);
  await obs.joindre(test.info());
});

test("CRM opportunités : changement d'étape groupé et archivage", async ({ page }) => {
  const obs = surveiller(page);
  const opportunity = `${RUN} bulk CRM ${Date.now()}`;
  await page.goto("/crm/opportunities");
  const newButton = page.getByRole("button", { name: "Nouvelle", exact: true });
  await expect(newButton).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await newButton.click();
  const createDialog = page.getByRole("dialog");
  await createDialog.locator("#crm-opportunity-name").fill(opportunity);
  // Mesure après l'animation d'ouverture (zoom) : centrée et contenue dans l'écran de 390 px.
  await expect.poll(async () => {
    const box = await createDialog.boundingBox();
    return box ? Math.abs(box.x + box.width / 2 - 195) : 999;
  }, { message: "fenêtre de création centrée" }).toBeLessThan(2);
  const dialogBox = await createDialog.boundingBox();
  expect(dialogBox!.width).toBeLessThanOrEqual(390);
  await createDialog.getByRole("button", { name: "Créer l’opportunité" }).click();
  await expect(createDialog).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const card = page.locator("[draggable=true]").filter({ hasText: opportunity });
  await expect(card).toBeVisible();
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Sans conversion" }).click();
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  await verifierCsv(await csv, /crm-opportunities-.*\.csv/, opportunity);
  await card.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Effacer" })).toBeVisible();
  await page.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "Qualifié" }).click();
  await expect(card).toContainText("30%");
  await card.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Effacer" })).toBeVisible();
  page.once("dialog", (confirm) => confirm.accept());
  const archiveButton = page.getByRole("button", { name: "Archiver" });
  await expect(archiveButton).toBeEnabled();
  await archiveButton.click();
  await expect(card).toContainText(/Archiv/);

  const reminder = `${opportunity} rappel`;
  await card.click();
  const detail = page.getByRole("dialog");
  await detail.getByRole("tab", { name: /Activités/ }).click();
  await detail.getByPlaceholder("Sujet…").fill(reminder);
  await detail.locator('input[type="datetime-local"]').fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
  await detail.getByRole("button", { name: "Ajouter" }).click();
  await expect(detail.getByText(reminder)).toBeVisible();
  await page.goto("/crm/reminders");
  const reminderRow = page.getByRole("row").filter({ hasText: reminder });
  await expect(reminderRow).toBeVisible();
  await reminderRow.getByRole("button", { name: /Terminé/ }).click();
  await expect(reminderRow).toContainText("Terminé");
  expect(obs.inattendus(), JSON.stringify(obs.incidents, null, 2)).toEqual([]);
  await obs.joindre(test.info());
});
