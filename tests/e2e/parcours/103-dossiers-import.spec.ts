import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller, verifierSocieteE2E } from "./outils";

/*
 * Achats internationaux, lot I2 (V129) : dossier d'importation ouvert pour le fournisseur d'une commande reçue (créée par
 * le parcours 20 à chaque passage), commande rattachée, fret ajouté, droits UEMOA estimés et ajoutés, frais répartis dans
 * le coût du stock (dossier figé, détail de la répartition). Sans commande reçue disponible, le parcours s'arrête à
 * l'ouverture du dossier.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("dossier d'importation : commande, frais, droits estimés, répartition dans le coût du stock", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const obs = surveiller(page);
  const toast = (t: string) => page.locator("[data-sonner-toast]").filter({ hasText: t }).last();

  obs.etape("commande reçue disponible");
  await page.goto("/procurement/transactions");
  await verifierSocieteE2E(page);
  await page.getByRole("tab", { name: /Commandes fournisseurs/ }).click();
  const recue = page.locator("tr").filter({ hasText: "Reçue" }).filter({ hasNotText: "partiellement" }).first();
  const disponible = await recue.count();
  const fournisseur = disponible ? (await recue.locator("td").nth(2).innerText()).trim() : "";
  testInfo.annotations.push({ type: "commande", description: disponible ? `${(await recue.locator("td").nth(1).innerText()).trim()} — ${fournisseur}` : "aucune" });

  obs.etape("dossier d'importation ouvert");
  await page.getByRole("tab", { name: "Dossiers d'import" }).click();
  const form = page.getByTestId("import-file-form");
  const options = await form.getByLabel("Fournisseur *").locator("option").allTextContents();
  await form.getByLabel("Fournisseur *").selectOption({ label: disponible && options.includes(fournisseur) ? fournisseur : options[1] });
  await form.getByLabel("Connaissement / LTA").fill(`BL-${RUN}`);
  await form.getByLabel("Catégorie TEC").selectOption("10");
  await page.getByTestId("import-file-create").click();
  await expect(toast("Dossier d'importation ouvert")).toBeVisible();
  await page.getByTestId("import-file-row").first().click();
  const detail = page.getByTestId("import-file-detail");
  await expect(detail).toBeVisible();

  if (!disponible || !options.includes(fournisseur)) { expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]); return; }

  obs.etape("commande rattachée, fret, droits estimés");
  const rattacher = detail.getByLabel("Rattacher une commande");
  if (await rattacher.count() === 0) { expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]); return; }
  await rattacher.selectOption({ index: 1 });
  await expect(toast("Commande rattachée au dossier")).toBeVisible();
  await expect(detail.getByTestId("import-file-lines").locator("tbody tr").first()).not.toContainText("Aucune réception");
  const frais = detail.getByTestId("import-cost-form");
  await frais.getByLabel("Type de frais").selectOption({ label: "Fret international" });
  await frais.getByLabel("Montant HT (XOF)").fill("15000");
  await frais.getByLabel("Libellé / facture").fill(`Fret ${RUN}`);
  await detail.getByTestId("import-cost-add").click();
  await expect(detail.getByTestId("import-cost-row").filter({ hasText: "Fret international" })).toBeVisible();
  await expect(detail.getByTestId("customs-estimate")).toContainText("Redevance statistique");
  await detail.getByRole("button", { name: "Ajouter les droits estimés au dossier" }).click();
  await expect(detail.getByTestId("import-cost-row").filter({ hasText: "Droit de douane" })).toBeVisible();

  obs.etape("répartition dans le coût du stock");
  page.once("dialog", (d) => d.accept());
  await detail.getByTestId("import-allocate").click();
  await expect(toast("Frais répartis dans le coût du stock")).toBeVisible();
  await expect(detail.getByTestId("import-file-allocations")).toBeVisible();
  await expect(detail.getByTestId("import-cost-form"), "dossier figé").toHaveCount(0);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
