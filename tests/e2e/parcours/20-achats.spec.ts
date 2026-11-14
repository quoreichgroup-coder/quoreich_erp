import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast } from "./outils";
import { ligne } from "./champs";
import { creerFournisseur, demandeObligatoire, pageApprobateur } from "./actions";

/*
 * Achats et approvisionnement, pièces en trois zones (en-tête, lignes, pied calculé) :
 * demande à deux lignes → approbation → conversion → commande ; commande directe à deux lignes →
 * approbation → réception (fournisseur d'abord, sur-réception refusée, partielle puis complète) ;
 * détail de chaque pièce ; export de chaque onglet.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

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

/** Soumission par l'auteur : la pièce passe « pending_approval » et l'auteur ne peut pas l'approuver. */
async function soumettre(page: Page, onglet: RegExp, texte: string) {
  await page.getByRole("tab", { name: onglet }).click();
  const l = ligne(page, texte);
  await l.getByRole("button", { name: "Soumettre" }).click();
  await expect(l).toContainText("pending_approval");
  await expect(l.getByTestId("approval-level"), "séparation des tâches signalée à l'auteur").toContainText("vous êtes l'auteur");
  await expect(l.getByRole("button", { name: "Approuver" }), "l'auteur n'approuve pas sa pièce").toHaveCount(0);
}

/** Décision de l'approbateur (second membre), dans sa propre session. */
async function decider(browser: import("@playwright/test").Browser, baseURL: string | undefined, onglet: RegExp,
                       texte: string, decision: "Approuver" | "Rejeter", motif?: string) {
  const { ctx, page } = await pageApprobateur(browser, baseURL);
  await page.goto("/procurement/transactions");
  await page.getByRole("tab", { name: onglet }).click();
  const l = ligne(page, texte);
  await l.getByRole("button", { name: decision }).click();
  if (decision === "Rejeter") {
    const d = page.getByRole("dialog");
    await d.getByLabel("Motif (obligatoire)").fill(motif ?? "Motif");
    await d.getByRole("button", { name: "Rejeter" }).click();
    await expect(d).toBeHidden();
  }
  await expect(l).toContainText(decision === "Approuver" ? /approved/ : /rejected/);
  await ctx.close();
}

async function exporter(page: Page, nom: RegExp) {
  const telechargement = page.waitForEvent("download");
  await page.getByTestId("btn-export-csv").click();
  const f = await telechargement;
  expect(f.suggestedFilename()).toMatch(nom);
  return f.suggestedFilename();
}

test("demande à lignes → soumise → rejetée → modifiée → approuvée par un tiers → commande approuvée", async ({ page, browser }, testInfo) => {
  const base = testInfo.project.use.baseURL;
  const obs = surveiller(page);
  const fournisseur = `${RUN} Fournisseur Achats`;
  const objet = `${RUN} Équipement informatique`;

  obs.etape("prérequis : fournisseur");
  await creerFournisseur(page, fournisseur);

  obs.etape("demande d'achat : en-tête, deux lignes, pied calculé");
  await page.goto("/procurement/transactions");
  await page.getByRole("button", { name: /New Requisition/i }).click();
  const d = await saisirLignes(page, "Coût estimé", [["Ordinateur portable", "3", "450000"], ["Écran 24 pouces", "3", "95000"]]);
  await d.getByLabel("Objet de la demande").fill(objet);
  await expect(d.getByTestId("doc-footer-total"), "pied = 3 × 450 000 + 3 × 95 000").toHaveText("1 635 000");
  await d.getByRole("button", { name: "Créer la demande" }).click();
  await expect(d).toBeHidden();
  const da = ligne(page, objet);
  await expect(da).toContainText("draft");
  await expect(da).toContainText("1 635 000");

  obs.etape("détail de la demande");
  await da.getByRole("button", { name: "Voir" }).click();
  let v = page.getByRole("dialog");
  await expect(v.getByRole("region", { name: "Lignes" })).toContainText("Écran 24 pouces");
  await expect(v.getByRole("region", { name: "Pied" })).toContainText("1 635 000");
  await page.keyboard.press("Escape");

  obs.etape("soumission : l'auteur ne peut pas approuver");
  await soumettre(page, /Requisitions/, objet);

  obs.etape("rejet motivé par l'approbateur");
  await decider(browser, base, /Requisitions/, objet, "Rejeter", "Quantités à revoir");
  await page.reload();
  await expect(da).toContainText("rejected");

  obs.etape("l'auteur corrige la demande rejetée puis la resoumet");
  await da.getByRole("button", { name: "Modifier" }).click();
  const m = page.getByRole("dialog");
  await m.getByLabel("Quantité ligne 2").fill("2");
  await expect(m.getByTestId("doc-footer-total"), "pied recalculé : 3 × 450 000 + 2 × 95 000").toHaveText("1 540 000");
  await m.getByRole("button", { name: "Enregistrer" }).click();
  await expect(m).toBeHidden();
  await expect(da).toContainText("1 540 000");
  await soumettre(page, /Requisitions/, objet);

  obs.etape("approbation par un tiers, puis conversion");
  await decider(browser, base, /Requisitions/, objet, "Approuver");
  await page.reload();
  await expect(da).toContainText("approved");
  await da.getByRole("button", { name: /Convertir/ }).click();
  const c = page.getByRole("dialog");
  await c.getByRole("combobox").click();
  await page.getByRole("option", { name: fournisseur }).click();
  await c.getByRole("button", { name: "Convertir" }).click();
  await expect(c).toBeHidden();
  testInfo.annotations.push({ type: "conversion", description: await dernierToast(page) });
  await expect(da).toContainText(/converted/);

  obs.etape("commande issue de la demande : lignes reprises");
  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  const bc = ligne(page, fournisseur);
  await expect(bc).toContainText("1 540 000");
  await expect(bc).toContainText("2 items");
  await bc.getByRole("button", { name: "Voir" }).click();
  v = page.getByRole("dialog");
  await expect(v.getByRole("region", { name: "Lignes" })).toContainText("Ordinateur portable");
  await expect(v.getByRole("region", { name: "Pied" })).toContainText("Reste à recevoir");
  await page.keyboard.press("Escape");
  await soumettre(page, /Purchase Orders/, fournisseur);
  await decider(browser, base, /Purchase Orders/, fournisseur, "Approuver");
  await page.reload();
  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  await expect(bc).toContainText("approved");

  obs.etape("exports des onglets");
  testInfo.annotations.push({ type: "export", description: await exporter(page, /^commandes.*\.csv$/) });
  await page.getByRole("tab", { name: /Requisitions/ }).click();
  testInfo.annotations.push({ type: "export", description: await exporter(page, /^demandes-achat.*\.csv$/) });

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});

test("commande directe : refusée tant que la demande est obligatoire, puis approuvée par un tiers et réceptionnée", async ({ page, browser }, testInfo) => {
  const base = testInfo.project.use.baseURL;
  const obs = surveiller(page);
  const fournisseur = `${RUN} Fournisseur Direct`;

  obs.etape("prérequis : fournisseur");
  await creerFournisseur(page, fournisseur);

  obs.etape("commande : en-tête, deux lignes, pied calculé");
  await page.goto("/procurement/transactions");
  await page.getByRole("button", { name: /New PO/i }).click();
  const d = await saisirLignes(page, "Prix unitaire", [["Ramettes de papier", "10", "3500"], ["Cartouches d'encre", "4", "25000"]]);
  await d.getByLabel("Fournisseur").selectOption({ label: fournisseur });
  await expect(d.getByTestId("doc-footer-total")).toHaveText("135 000");
  await d.getByRole("button", { name: "Créer la commande" }).click();
  await expect(d).toBeHidden();
  testInfo.annotations.push({ type: "message", description: await dernierToast(page) });

  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  const bc = ligne(page, fournisseur);
  await expect(bc).toContainText("135 000");

  obs.etape("paramètre « demande obligatoire avant commande » appliqué");
  obs.refusAttendu(/QG007.*exige une demande d'achat/);
  await demandeObligatoire(page, true);
  await page.goto("/procurement/transactions");
  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  await ligne(page, fournisseur).getByRole("button", { name: "Soumettre" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "exige une demande d'achat" })).toBeVisible();
  await expect(ligne(page, fournisseur)).toContainText("draft");

  obs.etape("paramètre assoupli par l'écran, soumission, approbation par un tiers");
  await demandeObligatoire(page, false);
  await page.goto("/procurement/transactions");
  await soumettre(page, /Purchase Orders/, fournisseur);
  await decider(browser, base, /Purchase Orders/, fournisseur, "Approuver");
  await page.reload();
  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  await expect(bc).toContainText(/approved/);
  await demandeObligatoire(page, true);
  await page.goto("/procurement/transactions");
  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  const poNumero = (await bc.locator("td").first().innerText()).trim();

  obs.etape("réception partielle : fournisseur d'abord, sur-réception refusée");
  await page.getByRole("button", { name: "Nouvelle réception" }).click();
  let r = page.getByRole("dialog");
  await expect(r.getByLabel("Commande")).toBeDisabled();
  await r.getByLabel("Fournisseur").selectOption({ label: fournisseur });
  const options = r.getByLabel("Commande").locator("option");
  expect(await options.count(), "seules les commandes de ce fournisseur (1) + « Sélectionner »").toBe(2);
  await r.getByLabel("Commande").selectOption(await options.filter({ hasText: poNumero }).getAttribute("value") ?? "");
  await expect(r.getByLabel("Quantité reçue ligne 1")).toHaveValue("10");
  await r.getByLabel("Quantité reçue ligne 1").fill("11");
  await r.getByRole("button", { name: "Enregistrer et valider" }).click();
  await expect(r.getByRole("alert")).toContainText("Sur-réception");
  await r.getByLabel("Quantité reçue ligne 1").fill("6");
  await r.getByLabel("Quantité reçue ligne 2").fill("4");
  await expect(r.getByTestId("gr-footer"), "pied : 10 unités, 6 × 3 500 + 4 × 25 000").toHaveText("10 · 121 000 XOF");
  await r.getByRole("button", { name: "Enregistrer et valider" }).click();
  const m1 = await dernierToast(page);
  testInfo.annotations.push({ type: "réception 1", description: m1 });
  await expect(r, `réception partielle : ${m1}`).toBeHidden();
  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  await expect(ligne(page, fournisseur).locator("td").nth(3)).toHaveText("partially_received");

  obs.etape("réception du solde");
  await page.getByRole("button", { name: "Nouvelle réception" }).click();
  r = page.getByRole("dialog");
  await r.getByLabel("Fournisseur").selectOption({ label: fournisseur });
  await r.getByLabel("Commande").selectOption(await r.getByLabel("Commande").locator("option").filter({ hasText: poNumero }).getAttribute("value") ?? "");
  await expect(r.getByLabel("Quantité reçue ligne 1"), "restant proposé : 10 − 6").toHaveValue("4");
  await expect(r.getByLabel("Quantité reçue ligne 2"), "ligne soldée").toBeDisabled();
  await r.getByRole("button", { name: "Enregistrer et valider" }).click();
  await expect(r).toBeHidden();
  await expect(ligne(page, fournisseur).locator("td").nth(3), "commande entièrement reçue").toHaveText("received");

  obs.etape("détail d'une réception et export");
  await page.getByRole("tab", { name: /Goods Receipt/ }).click();
  const gr = ligne(page, poNumero);
  await expect(gr).toContainText("completed");
  await gr.getByRole("button", { name: "Voir" }).click();
  const v = page.getByRole("dialog");
  await expect(v.getByRole("region", { name: "En-tête" })).toContainText(poNumero);
  await expect(v.getByRole("region", { name: "Pied" })).toContainText("Valeur au coût de la commande");
  await page.keyboard.press("Escape");
  testInfo.annotations.push({ type: "export", description: await exporter(page, /^receptions.*\.csv$/) });

  obs.etape("commande soldée : plus rien à réceptionner");
  await page.getByRole("button", { name: "Nouvelle réception" }).click();
  await expect(page.getByRole("dialog").getByLabel("Fournisseur").locator("option", { hasText: fournisseur })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // V52 : retour fournisseur sur la dernière réception (4 reçus en ligne 1), remplacement attendu.
  obs.etape("retour fournisseur avec remplacement attendu");
  await page.getByRole("tab", { name: /Goods Receipt/ }).click();
  await ligne(page, poNumero).getByRole("button", { name: "Retour" }).click();
  const rt = page.getByRole("dialog");
  await expect(rt.getByLabel("Quantité à retourner ligne 2"), "ligne 2 non reçue sur cette réception").toHaveCount(0);
  await rt.getByLabel("Motif (obligatoire)").fill(`Article défectueux ${RUN}`);
  await rt.getByLabel("Quantité à retourner ligne 1").fill("5");
  await expect(rt.getByRole("alert"), "pas plus que le reçu de la réception").toContainText("4 retournable");
  await rt.getByLabel("Quantité à retourner ligne 1").fill("1");
  await expect(rt.getByTestId("return-value")).toHaveText("3 500 XOF");
  await rt.getByLabel(/Remplacement attendu/).check();
  await rt.getByRole("button", { name: "Enregistrer le retour" }).click();
  const mr = await dernierToast(page);
  testInfo.annotations.push({ type: "retour", description: mr });
  await expect(rt, `retour : ${mr}`).toBeHidden();
  await page.getByRole("tab", { name: /Retours/ }).click();
  const rl = page.getByTestId("supplier-return-row").filter({ hasText: poNumero });
  await expect(rl).toContainText(/RTF-\d{4}-\d{4}/);
  await expect(rl).toContainText("remplacement attendu");
  await rl.click();
  await expect(page.getByRole("dialog").getByRole("region", { name: "Pied" })).toContainText("3 500");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  await expect(ligne(page, fournisseur).locator("td").nth(3), "remplacement attendu : la commande se réceptionne de nouveau").toHaveText("partially_received");

  obs.etape("réception du remplacement");
  await page.getByRole("button", { name: "Nouvelle réception" }).click();
  r = page.getByRole("dialog");
  await r.getByLabel("Fournisseur").selectOption({ label: fournisseur });
  await r.getByLabel("Commande").selectOption(await r.getByLabel("Commande").locator("option").filter({ hasText: poNumero }).getAttribute("value") ?? "");
  await expect(r.getByLabel("Quantité reçue ligne 1"), "le retourné à remplacer").toHaveValue("1");
  await r.getByRole("button", { name: "Enregistrer et valider" }).click();
  await expect(r).toBeHidden();
  await expect(ligne(page, fournisseur).locator("td").nth(3)).toHaveText("received");

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
