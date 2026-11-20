import { test, expect } from "@playwright/test";
import { identifiants, RUN, surveiller } from "./outils";
import { creerFournisseur, pageApprobateur } from "./actions";

/*
 * Demandes de prix (V139) : consultation de deux fournisseurs, saisie de leurs offres, comparatif ; attribution par une
 * autre personne que l'auteur (second membre), au fournisseur le plus cher avec motif ; commande brouillon créée.
 */
test.skip(!identifiants() || !identifiants("approbateur"), "identifiants des comptes de test absents");

const toast = (page: import("@playwright/test").Page, texte: string) => page.locator("[data-sonner-toast]").filter({ hasText: texte }).first();

test("demande de prix : deux offres, comparatif, attribution motivée par un tiers, commande créée", async ({ page, browser }, testInfo) => {
  const obs = surveiller(page);
  const base = testInfo.project.use.baseURL;
  const local = `${RUN} Fournisseur local DP`, etranger = `${RUN} Fournisseur moins-disant DP`;
  const objet = `${RUN} Consultation imprimantes`;

  obs.etape("demande de prix libre, deux fournisseurs consultés");
  await creerFournisseur(page, local);
  await creerFournisseur(page, etranger);
  await page.goto("/procurement/transactions");
  await page.getByRole("tab", { name: "Demandes de prix" }).click();
  await page.getByTestId("rfq-new").click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Objet").fill(objet);
  await d.getByLabel("Désignation ligne 1").fill("Imprimante laser");
  await d.getByLabel("Quantité ligne 1").fill("4");
  await d.getByRole("checkbox", { name: local }).check();
  await d.getByRole("checkbox", { name: etranger }).check();
  await d.getByTestId("rfq-create").click();
  await expect(toast(page, "Demande de prix créée")).toBeVisible();
  const detail = page.getByTestId("rfq-detail");
  await expect(detail).toContainText(objet);
  await detail.getByTestId("rfq-send").click();
  await expect(toast(page, "Demande de prix envoyée")).toBeVisible();

  obs.etape("offres saisies");
  for (const [nom, prix, delai] of [[local, "250000", "2"], [etranger, "240000", "20"]] as const) {
    await detail.getByTestId("rfq-supplier-row").filter({ hasText: nom }).getByTestId("rfq-enter-quote").click();
    const q = page.getByRole("dialog");
    await q.getByLabel("Prix unitaire ligne 1").fill(prix);
    await q.getByLabel("Délai ligne 1").fill(delai);
    await q.getByTestId("rfq-save-quote").click();
    await expect(toast(page, `Offre de ${nom} enregistrée`)).toBeVisible();
  }
  await expect(detail.getByTestId("rfq-offer-row").filter({ hasText: etranger })).toContainText("moins-disant");

  obs.etape("attribution par le second membre, offre la plus chère avec motif");
  const { ctx, page: pa } = await pageApprobateur(browser, base);
  await pa.goto("/procurement/transactions");
  await pa.getByRole("tab", { name: "Demandes de prix" }).click();
  await pa.getByTestId("rfq-row").filter({ hasText: objet }).click();
  const da = pa.getByTestId("rfq-detail");
  await da.getByRole("radio", { name: `Retenir ${local} pour la ligne 1` }).check();
  await expect(da.getByTestId("rfq-award")).toBeDisabled();
  await da.getByLabel(/Motif — ligne 1 attribuée/).fill("Livraison en 2 jours contre 20");
  await da.getByTestId("rfq-award").click();
  await expect(pa.locator("[data-sonner-toast]").filter({ hasText: "commande(s) brouillon créée(s)" }).first()).toBeVisible();
  await expect(da.getByTestId("rfq-awards")).toContainText("Livraison en 2 jours contre 20");
  await ctx.close();

  obs.etape("commande brouillon chez le fournisseur retenu");
  await page.goto("/procurement/transactions");
  await page.getByRole("tab", { name: /Commandes fournisseurs/ }).click();
  await expect(page.locator("tr").filter({ hasText: local }).first()).toContainText("Brouillon");

  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
