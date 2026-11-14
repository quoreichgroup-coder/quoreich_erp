import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast } from "./outils";
import { ligne } from "./champs";

/*
 * Stocks (V53) : référentiel réel (article, dépôts), ajustement motivé comptabilisé, transfert sans
 * écriture, exports. Les mouvements ne se saisissent pas dans la table : ils passent par les fonctions.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

async function exporter(page: Page, nom: RegExp) {
  const telechargement = page.waitForEvent("download");
  await page.getByTestId("btn-export-csv").click();
  const f = await telechargement;
  expect(f.suggestedFilename()).toMatch(nom);
  return f.suggestedFilename();
}

test("stocks : article, dépôts, ajustement comptabilisé, transfert, exports", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const code = `ART-${RUN}`;
  const depots = [`D1-${RUN}`, `D2-${RUN}`];

  obs.etape("dépôts");
  await page.goto("/inventory/master-data?tab=warehouses");
  for (const d of depots) {
    await page.getByRole("button", { name: "Nouveau dépôt" }).click();
    const w = page.getByRole("dialog");
    await w.getByLabel("Code").fill(d);
    await w.getByLabel("Nom").fill(`Dépôt ${d}`);
    await w.getByRole("button", { name: "Enregistrer" }).click();
    await expect(w).toBeHidden();
    await expect(page.getByTestId("warehouse-row").filter({ hasText: d })).toBeVisible();
  }
  testInfo.annotations.push({ type: "export dépôts", description: await exporter(page, /^depots.*\.csv$/) });

  obs.etape("article : créé sans stock, puis modifié");
  await page.getByRole("tab", { name: /Articles/ }).click();
  await page.getByRole("button", { name: "Nouvel article" }).click();
  let a = page.getByRole("dialog");
  await a.getByLabel("Code article").fill(code);
  await a.getByLabel("Libellé").fill(`Ciment ${RUN}`);
  await a.getByLabel("Catégorie").fill("Matériaux");
  await a.getByLabel("Unité").fill("sac");
  await a.getByRole("button", { name: "Enregistrer" }).click();
  await expect(a).toBeHidden();
  const ligneArticle = page.getByTestId("item-row").filter({ hasText: code });
  await expect(ligneArticle).toContainText("0 sac");
  await ligneArticle.click();
  a = page.getByRole("dialog");
  await a.getByLabel("Seuil de réapprovisionnement").fill("5");
  await a.getByRole("button", { name: "Enregistrer" }).click();
  await expect(a).toBeHidden();
  await expect(ligneArticle).toContainText("À réapprovisionner");

  obs.etape("ajustement : excédent de 10 au coût de 4 000, comptabilisé");
  await page.goto("/inventory/transactions");
  await page.getByRole("button", { name: "Ajustement de stock" }).click();
  const adj = page.getByRole("dialog");
  await adj.getByLabel("Article").selectOption({ label: await adj.getByLabel("Article").locator("option", { hasText: code }).innerText() });
  await adj.getByLabel("Dépôt").selectOption({ label: `${depots[0]} — Dépôt ${depots[0]}` });
  await adj.getByLabel("Quantité (±)").fill("10");
  await adj.getByLabel("Coût unitaire (excédent)").fill("4000");
  await expect(adj.getByRole("alert"), "motif obligatoire").toContainText("motif");
  await expect(adj.getByRole("button", { name: "Enregistrer l'ajustement" })).toBeDisabled();
  await adj.getByLabel("Motif (obligatoire)").fill(`Stock initial ${RUN}`);
  await adj.getByRole("button", { name: "Enregistrer l'ajustement" }).click();
  testInfo.annotations.push({ type: "ajustement", description: await dernierToast(page) });
  await expect(adj).toBeHidden();
  const mvt = page.getByTestId("stock-movement-row").filter({ hasText: code }).filter({ hasText: "Ajustement" });
  await expect(mvt).toContainText("40 000");
  await expect(mvt, "pièce comptable OD (inventaire permanent)").toContainText(/OD-\d{4}-\d{6}/);

  obs.etape("transfert de 3 vers le second dépôt, sans écriture");
  await page.getByRole("button", { name: "Transfert" }).click();
  const tr = page.getByRole("dialog");
  await tr.getByLabel("Article").selectOption({ label: await tr.getByLabel("Article").locator("option", { hasText: code }).innerText() });
  await tr.getByLabel("Dépôt de départ").selectOption({ label: `${depots[0]} — Dépôt ${depots[0]}` });
  await tr.getByLabel("Dépôt d'arrivée").selectOption({ label: `${depots[1]} — Dépôt ${depots[1]}` });
  await tr.getByLabel("Quantité").fill("3");
  await tr.getByRole("button", { name: "Transférer" }).click();
  await expect(tr).toBeHidden();
  await page.getByRole("tab", { name: "Transferts" }).click();
  const transferts = page.getByTestId("stock-movement-row").filter({ hasText: code });
  await expect(transferts).toHaveCount(2);
  await expect(transferts.filter({ hasText: "Transfert (sortie)" })).toContainText("-3");
  testInfo.annotations.push({ type: "export mouvements", description: await exporter(page, /^mouvements-de-stock-transfers.*\.csv$/) });

  obs.etape("stock de l'article : 10, valorisé au coût moyen");
  await page.goto("/inventory/master-data");
  await expect(page.getByTestId("item-row").filter({ hasText: code })).toContainText("10 sac");
  await expect(ligne(page, code)).toContainText("40 000");
  testInfo.annotations.push({ type: "export articles", description: await exporter(page, /^articles.*\.csv$/) });

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
