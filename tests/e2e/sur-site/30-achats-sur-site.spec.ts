import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast } from "../parcours/outils";
import { ligne } from "../parcours/champs";
import { creerFournisseur, demandeObligatoire } from "../parcours/actions";

/*
 * Approvisionnement sur site (lot 3), de bout en bout par l'API Java et la base locale : demande à lignes →
 * soumise (l'auteur ne peut pas approuver) → approuvée par le second membre → convertie → commande approuvée
 * par un tiers → accusé de réception → réception (sur-réception refusée, puis partielle validée).
 * AUCUN accès de ce périmètre — lecture comprise — ne doit partir vers Supabase.
 */
test.skip(!identifiants() || !identifiants("approbateur"), "identifiants des comptes de test absents");

const PERIMETRE = /\/rest\/v1\/(purchase_requisitions|requisition_lines|purchase_orders|po_lines|goods_receipts|gr_lines|procurement_[a-z_]+|three_way_match_view|purchase_order_followup_view|supplier_items|item_replenishment_rules|replenishment_proposals|stock_projection_view|suppliers|profiles)\b|\/rest\/v1\/rpc\/(procurement_[a-z_]+|approve_procurement_step|reject_procurement_step|convert_pr_to_po|acknowledge_purchase_order|reschedule_purchase_order|record_match_decision)\b/;

function routage(page: Page) {
  const versNuage: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (r.method() !== "OPTIONS" && /supabase\.co/.test(u) && PERIMETRE.test(u)) versNuage.push(`${r.method()} ${new URL(u).pathname}`);
  });
  return versNuage;
}

async function saisirLignes(page: Page, prix: string, lignes: [string, string, string][]) {
  const d = page.getByRole("dialog");
  for (let i = 0; i < lignes.length; i++) {
    if (i > 0) await d.getByTestId("btn-add-doc-line").click();
    await d.getByLabel(`Libellé ligne ${i + 1}`).fill(lignes[i][0]);
    await d.getByLabel(`Quantité ligne ${i + 1}`).fill(lignes[i][1]);
    await d.getByLabel(`${prix} ligne ${i + 1}`).fill(lignes[i][2]);
  }
  return d;
}

async function soumettre(page: Page, onglet: RegExp, texte: string) {
  await page.getByRole("tab", { name: onglet }).click();
  const l = ligne(page, texte);
  await l.getByRole("button", { name: "Soumettre" }).click();
  await expect(l).toContainText("En approbation");
  await expect(l.getByTestId("approval-level")).toContainText("vous êtes l'auteur");
  await expect(l.getByRole("button", { name: "Approuver" })).toHaveCount(0);
}

async function approuver(browser: import("@playwright/test").Browser, baseURL: string | undefined, onglet: RegExp, texte: string) {
  const ctx = await browser.newContext({ baseURL, locale: "fr-FR", storageState: "test-results-sur-site/.auth/approbateur.json" });
  const page = await ctx.newPage();
  const nuage = routage(page);
  await page.goto("/procurement/transactions");
  await page.getByRole("tab", { name: onglet }).click();
  const l = ligne(page, texte);
  await l.getByRole("button", { name: "Approuver" }).click();
  await expect(l).toContainText(/Approuvée/);
  await ctx.close();
  expect(nuage, `approbateur : accès partis vers Supabase ${nuage.join(", ")}`).toEqual([]);
}

test("demande → approuvée par un tiers → commande → réception, tout par l'API sur site", async ({ page, browser }, testInfo) => {
  const base = testInfo.project.use.baseURL;
  const obs = surveiller(page);
  const nuage = routage(page);
  const fournisseur = `${RUN} Fournisseur achats sur site`;
  const objet = `${RUN} Fournitures sur site`;

  obs.etape("prérequis : fournisseur, demande facultative avant commande");
  await creerFournisseur(page, fournisseur);
  await demandeObligatoire(page, false);

  obs.etape("demande à deux lignes, pied calculé");
  await page.goto("/procurement/transactions");
  await page.getByRole("button", { name: /Nouvelle demande/i }).click();
  const d = await saisirLignes(page, "Coût estimé", [["Ramettes", "10", "3500"], ["Cartouches", "4", "25000"]]);
  await d.getByLabel("Objet de la demande").fill(objet);
  await expect(d.getByTestId("doc-footer-total")).toHaveText("135 000");
  await d.getByRole("button", { name: "Créer la demande" }).click();
  await expect(d).toBeHidden();
  await expect(ligne(page, objet)).toContainText("135 000");

  obs.etape("soumission, approbation par le second membre, conversion");
  await soumettre(page, /Demandes d'achat/, objet);
  await approuver(browser, base, /Demandes d'achat/, objet);
  await page.reload();
  const da = ligne(page, objet);
  await expect(da).toContainText("Approuvée");
  await da.getByRole("button", { name: /Convertir/ }).click();
  const c = page.getByRole("dialog");
  await c.getByRole("combobox").click();
  await page.getByRole("option", { name: fournisseur }).click();
  await c.getByRole("button", { name: "Convertir" }).click();
  await expect(c).toBeHidden();
  await expect(da).toContainText(/Convertie/);

  obs.etape("commande : soumise, approuvée par un tiers, accusé de réception");
  await page.getByRole("tab", { name: /Commandes fournisseurs/ }).click();
  const bc = ligne(page, fournisseur);
  await expect(bc).toContainText("135 000");
  await soumettre(page, /Commandes fournisseurs/, fournisseur);
  await approuver(browser, base, /Commandes fournisseurs/, fournisseur);
  await page.reload();
  await page.getByRole("tab", { name: /Commandes fournisseurs/ }).click();
  await expect(bc).toContainText(/Approuvée/);
  const poNumero = (await bc.locator("td").nth(1).innerText()).trim();
  await page.getByRole("tab", { name: "Suivi des livraisons" }).click();
  const suivi = page.getByTestId("po-followup-row").filter({ hasText: poNumero });
  await suivi.getByRole("button", { name: "Accusé de réception" }).click();
  const ar = page.getByRole("dialog");
  await ar.getByLabel("Date confirmée").fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  await ar.getByLabel("Référence du fournisseur").fill(`AR-${RUN}`);
  await ar.getByRole("button", { name: "Enregistrer" }).click();
  await expect(ar).toBeHidden();
  await expect(suivi).toContainText(`AR-${RUN}`);

  obs.etape("réception : sur-réception refusée, puis partielle validée");
  await page.getByRole("tab", { name: /Commandes fournisseurs/ }).click();
  await page.getByRole("button", { name: "Nouvelle réception" }).click();
  const r = page.getByRole("dialog");
  await r.getByLabel("Fournisseur").selectOption({ label: fournisseur });
  await r.getByLabel("Commande").selectOption(await r.getByLabel("Commande").locator("option").filter({ hasText: poNumero }).getAttribute("value") ?? "");
  await r.getByLabel("Quantité reçue ligne 1").fill("11");
  await r.getByRole("button", { name: "Enregistrer et valider" }).click();
  await expect(r.getByRole("alert")).toContainText("Sur-réception");
  await r.getByLabel("Quantité reçue ligne 1").fill("6");
  await r.getByLabel("Quantité reçue ligne 2").fill("4");
  await r.getByRole("button", { name: "Enregistrer et valider" }).click();
  const m = await dernierToast(page);
  await expect(r, `réception : ${m}`).toBeHidden();
  await page.getByRole("tab", { name: /Commandes fournisseurs/ }).click();
  await expect(ligne(page, fournisseur).locator("td").nth(4)).toHaveText("Reçue partiellement");

  expect(nuage, `accès du périmètre partis vers Supabase : ${nuage.join(", ")}`).toEqual([]);
  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
