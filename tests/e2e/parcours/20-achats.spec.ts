import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast } from "./outils";
import { choisir, ligne } from "./champs";
import { creerFournisseur } from "./actions";

/*
 * Achats et approvisionnement : demande d'achat → approbation → conversion en commande →
 * approbation de la commande ; commande directe ; réception de marchandises.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

test("demande d'achat → approbation → commande → approbation", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const fournisseur = `${RUN} Fournisseur Achats`;
  const objet = `${RUN} Ordinateurs portables x3`;

  obs.etape("prérequis : fournisseur");
  await creerFournisseur(page, fournisseur);

  obs.etape("demande d'achat");
  await page.goto("/procurement/transactions");
  await page.getByRole("button", { name: /New Requisition/i }).click();
  const d = page.getByRole("dialog");
  await d.getByPlaceholder("Ex: Serveurs Dell x5").fill(objet);
  await d.locator("input[type=number]").fill("1500000");
  await d.getByRole("button", { name: "Create", exact: true }).click();
  await expect(d).toBeHidden();
  const da = ligne(page, objet);
  await expect(da).toBeVisible();
  await expect(da).toContainText("draft");

  obs.etape("approbation de la demande");
  await da.getByRole("button", { name: "Approve" }).click();
  await expect(da).toContainText("approved");

  obs.etape("conversion en commande");
  const convertir = da.getByRole("button", { name: /Convertir/ });
  if (!(await convertir.isVisible())) {
    testInfo.annotations.push({ type: "constat", description: `Conversion non proposée : ${await da.innerText()}` });
  }
  await expect(convertir, "bouton « Convertir → PO » attendu pour un administrateur").toBeVisible();
  await convertir.click();
  const c = page.getByRole("dialog");
  await choisir(page, c.getByRole("combobox"), fournisseur);
  await c.getByRole("button", { name: "Convertir" }).click();
  await expect(c).toBeHidden();
  testInfo.annotations.push({ type: "message", description: await dernierToast(page) });
  await expect(da).toContainText(/converted|→ PO/);

  obs.etape("approbation de la commande");
  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  const bc = ligne(page, fournisseur);
  await expect(bc).toBeVisible();
  testInfo.annotations.push({ type: "commande", description: (await bc.innerText()).replace(/\s+/g, " ") });
  const approuver = bc.getByRole("button", { name: "Approve" });
  if (await approuver.isVisible()) {
    await approuver.click();
    await expect(bc).toContainText(/approved|ordered/);
  }

  await obs.joindre(testInfo);
  expect(obs.incidents.filter((i) => i.type !== "erreur-console"), JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});

test("commande directe → approbation → réception partielle refusée puis complète", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const fournisseur = `${RUN} Fournisseur Direct`;

  obs.etape("prérequis : fournisseur");
  await creerFournisseur(page, fournisseur);

  obs.etape("commande directe");
  await page.goto("/procurement/transactions");
  await page.getByRole("button", { name: /New PO/i }).click();
  const d = page.getByRole("dialog");
  await choisir(page, d.getByRole("combobox").first(), fournisseur);
  await d.locator("xpath=.//label[normalize-space()='Description']/following::input[1]").fill(`${RUN} Fournitures de bureau`);
  await d.locator("input[type=number]").fill("250000");
  await d.getByRole("button", { name: "Create PO", exact: true }).click();
  await expect(d).toBeHidden();
  testInfo.annotations.push({ type: "message", description: await dernierToast(page) });

  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  const bc = ligne(page, fournisseur);
  await expect(bc).toBeVisible();
  await expect(bc).toContainText("250");

  obs.etape("approbation de la commande");
  await bc.getByRole("button", { name: "Approve" }).click();
  await expect(bc).toContainText(/approved/);

  obs.etape("réception partielle");
  const poNumero = (await bc.locator("td").first().innerText()).trim();
  testInfo.annotations.push({ type: "commande", description: poNumero });
  await page.getByRole("button", { name: "Nouvelle réception" }).click();
  let r = page.getByRole("dialog");
  await r.getByLabel("Commande").selectOption({ label: `${poNumero} · ${fournisseur}` });
  await expect(r.getByLabel("Quantité reçue ligne 1"), "restant proposé par défaut = quantité commandée").toHaveValue("1");
  // Une seule unité commandée (le formulaire de commande crée une ligne de quantité 1) :
  // la sur-réception est refusée avant même d'appeler le serveur.
  await r.getByLabel("Quantité reçue ligne 1").fill("2");
  await r.getByRole("button", { name: "Enregistrer et valider" }).click();
  await expect(r.getByRole("alert")).toContainText("Sur-réception");

  obs.etape("réception complète et validée");
  await r.getByLabel("Quantité reçue ligne 1").fill("1");
  await r.getByRole("button", { name: "Enregistrer et valider" }).click();
  const msg = await dernierToast(page);
  testInfo.annotations.push({ type: "réception", description: msg });
  await expect(r, `réception : ${msg}`).toBeHidden();

  await page.getByRole("tab", { name: /Goods Receipt/ }).click();
  const gr = ligne(page, poNumero);
  await expect(gr).toBeVisible();
  await expect(gr).toContainText("completed");
  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  await expect(ligne(page, fournisseur), "commande entièrement reçue").toContainText("received");

  obs.etape("commande soldée : plus rien à réceptionner");
  await page.getByRole("button", { name: "Nouvelle réception" }).click();
  r = page.getByRole("dialog");
  await expect(r.getByLabel("Commande").locator("option", { hasText: poNumero })).toHaveCount(0);
  await r.getByRole("button", { name: "Close" }).click().catch(() => page.keyboard.press("Escape"));

  await obs.joindre(testInfo);
  expect(obs.incidents.filter((i) => i.type !== "erreur-console"), JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});
