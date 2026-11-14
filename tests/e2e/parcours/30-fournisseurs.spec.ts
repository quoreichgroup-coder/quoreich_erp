import { test, expect, type Page, type Browser } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast, aujourdhui } from "./outils";
import { champ, ligne } from "./champs";
import {
  creerFournisseur, assurerPlanComptable, pageApprobateur, parametresFournisseurs, approuverFactureFournisseur,
} from "./actions";

/*
 * Comptabilité fournisseurs (V41) avec les paramètres de la société de test, appliqués tels qu'ils
 * sont enregistrés : bon de commande requis, réception avant facture, rapprochement à 3 voies
 * (tolérance 2 % / 5 000 XOF). Séparation des tâches : l'auteur saisit, l'approbateur (second
 * membre, rôle Comptable) approuve.
 */
test.skip(!identifiants() || !identifiants("approbateur"), "identifiants des comptes de test absents");

async function nouvelleFacture(page: Page, fournisseur: string, numero: string, ht: string, tva: string, commande?: string) {
  await page.goto("/payables/transactions");
  await page.getByRole("button", { name: "Nouvelle facture fournisseur" }).click();
  const d = page.getByRole("dialog");
  await d.locator("select").first().selectOption({ label: fournisseur });
  if (commande) {
    const options = d.getByLabel("Commande d'origine").locator("option");
    await d.getByLabel("Commande d'origine").selectOption(await options.filter({ hasText: commande }).getAttribute("value") ?? "");
  }
  await champ(d, "N° Facture").fill(numero);
  await champ(d, "Date").fill(aujourdhui());
  await champ(d, "Échéance").fill(aujourdhui());
  await champ(d, "Montant HT").fill(ht);
  await champ(d, "TVA (XOF)").fill(tva);
  await d.getByRole("button", { name: "Créer" }).click();
  await expect(d).toBeHidden();
  const f = ligne(page, numero);
  await expect(f).toContainText("Brouillon");
  return f;
}

async function soumettreParAuteur(page: Page, numero: string) {
  const f = ligne(page, numero);
  await f.getByRole("button", { name: "Soumettre" }).click();
  await expect(f).toContainText("Soumise");
  await expect(f.getByTestId("ap-approval-level")).toContainText("vous êtes l'auteur");
  await expect(f.getByRole("button", { name: "Approuver" }), "l'auteur n'approuve pas sa facture").toHaveCount(0);
}

async function exigerDemande(page: Page, actif: boolean): Promise<boolean> {
  await page.goto("/procurement/settings");
  await page.waitForLoadState("networkidle");
  const interrupteur = page.getByRole("switch", { name: "Exiger une PR approuvée avant PO" });
  const avant = (await interrupteur.getAttribute("aria-checked")) === "true";
  if (avant !== actif) {
    await interrupteur.click();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).first().click();
    await expect(page.locator("[data-sonner-toast]").last()).toBeVisible();
  }
  return avant;
}

/** Commande directe approuvée par un tiers puis réceptionnée en partie (6 sur 10 à 10 000 XOF). */
async function commandeReceptionnee(page: Page, browser: Browser, base: string | undefined, fournisseur: string) {
  await page.goto("/procurement/transactions");
  await page.getByRole("button", { name: /New PO/i }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Libellé ligne 1").fill("Pièces détachées");
  await d.getByLabel("Quantité ligne 1").fill("10");
  await d.getByLabel("Prix unitaire ligne 1").fill("10000");
  await d.getByLabel("Fournisseur").selectOption({ label: fournisseur });
  await d.getByRole("button", { name: "Créer la commande" }).click();
  await expect(d).toBeHidden();

  // La société exige une demande avant commande : assoupli le temps de cette commande directe.
  const exigeait = await exigerDemande(page, false);
  await page.goto("/procurement/transactions");
  await page.getByRole("tab", { name: /Purchase Orders/ }).click();
  const bc = ligne(page, fournisseur);
  const numero = (await bc.locator("td").first().innerText()).trim();
  await bc.getByRole("button", { name: "Soumettre" }).click();
  await expect(bc).toContainText("pending_approval");
  const { ctx, page: pa } = await pageApprobateur(browser, base);
  await pa.goto("/procurement/transactions");
  await pa.getByRole("tab", { name: /Purchase Orders/ }).click();
  await ligne(pa, fournisseur).getByRole("button", { name: "Approuver" }).click();
  await expect(ligne(pa, fournisseur)).toContainText("approved");
  await ctx.close();
  if (exigeait) await exigerDemande(page, true);

  await page.goto("/procurement/transactions");
  await page.getByRole("button", { name: "Nouvelle réception" }).click();
  const r = page.getByRole("dialog");
  await r.getByLabel("Fournisseur").selectOption({ label: fournisseur });
  await r.getByLabel("Commande").selectOption(await r.getByLabel("Commande").locator("option").filter({ hasText: numero }).getAttribute("value") ?? "");
  await r.getByLabel("Quantité reçue ligne 1").fill("6");
  await r.getByRole("button", { name: "Enregistrer et valider" }).click();
  await expect(r).toBeHidden();
  return numero;
}

test("chaîne complète : commande → réception → facture hors tolérance refusée → corrigée → approuvée par un tiers → comptabilisée → payée",
  async ({ page, browser }, testInfo) => {
    const obs = surveiller(page);
    const base = testInfo.project.use.baseURL;
    const fournisseur = `${RUN} Fournisseur chaîne`;
    const numero = `FF-${RUN}-CH`;

    obs.etape("prérequis : plan comptable, paramètres tels qu'enregistrés, fournisseur");
    await assurerPlanComptable(page);
    await parametresFournisseurs(page, "mandatory", true);
    await creerFournisseur(page, fournisseur);

    obs.etape("commande approuvée par un tiers, réception partielle");
    const commande = await commandeReceptionnee(page, browser, base, fournisseur);

    obs.etape("facture au-delà du reçu : refusée par le rapprochement à 3 voies");
    obs.refusAttendu(/QG008.*Rapprochement à 3 voies/);
    await nouvelleFacture(page, fournisseur, numero, "70000", "12600", commande);
    await ligne(page, numero).getByRole("button", { name: "Soumettre" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Rapprochement à 3 voies" })).toBeVisible();
    await expect(ligne(page, numero)).toContainText("Brouillon");

    obs.etape("facture corrigée à la valeur reçue, soumise ; l'auteur ne peut pas l'approuver");
    await ligne(page, numero).getByRole("button", { name: "Modifier" }).click();
    const m = page.getByRole("dialog");
    await champ(m, "Montant HT").fill("60000");
    await champ(m, "TVA (XOF)").fill("10800");
    await m.getByRole("button", { name: "Enregistrer" }).click();
    await expect(m).toBeHidden();
    await soumettreParAuteur(page, numero);

    obs.etape("approbation par un tiers → comptabilisée (601 / 4452 / 401)");
    await approuverFactureFournisseur(browser, base, numero);
    await page.reload();
    await ligne(page, numero).locator("td").first().click();
    const panneau = page.getByRole("dialog", { name: `Facture ${numero}` });
    const ecriture = panneau.getByTestId("journal-entry-preview");
    await expect(ecriture.locator("tbody tr").filter({ hasText: /^601/ })).toContainText("60 000");
    await expect(ecriture.locator("tbody tr").filter({ hasText: /^4452/ })).toContainText("10 800");
    await expect(ecriture.locator("tbody tr").filter({ hasText: /^401/ })).toContainText("70 800");

    // V52 : avoir fournisseur (remise) imputé sur le reste à payer, TVA au taux de la facture.
    obs.etape("avoir fournisseur sur la facture approuvée");
    await panneau.getByRole("button", { name: "Créer un avoir" }).click();
    const av = page.getByRole("dialog", { name: /Avoir fournisseur sur la facture/ });
    await av.getByLabel("Motif (obligatoire)").fill(`Remise commerciale ${RUN}`);
    await av.getByLabel(/Montant HT/).fill("70000");
    await expect(av.getByRole("alert"), "plafonné au HT de la facture").toContainText("HT au plus");
    await av.getByLabel(/Montant HT/).fill("10000");
    await expect(av.getByLabel(/^TVA/)).toHaveValue("1800");
    await av.getByLabel("N° de l'avoir du fournisseur").fill(`AVF-EXT-${RUN}`);
    await av.getByRole("button", { name: "Comptabiliser l'avoir" }).click();
    testInfo.annotations.push({ type: "avoir", description: await dernierToast(page) });
    await expect(av).toBeHidden();
    const avoirs = panneau.getByRole("region", { name: "Avoirs sur cette facture" });
    await expect(avoirs.getByTestId("ap-credit-note-row")).toContainText(/AVF-\d{4}-\d{4}/);
    await expect(avoirs.getByTestId("ap-credit-note-row")).toContainText("11 800");
    await expect(panneau.getByRole("region", { name: "Pied" })).toContainText("59 000");
    await panneau.getByRole("button", { name: "Fermer" }).click();
    await page.getByRole("tab", { name: /^Avoirs/ }).click();
    await expect(page.getByTestId("ap-credit-note-row").filter({ hasText: numero })).toContainText(`AVF-EXT-${RUN}`);
    await page.getByRole("tab", { name: /^Factures/ }).click();

    obs.etape("paiement");
    await ligne(page, numero).getByRole("button", { name: /Pay/ }).click();
    const p = page.getByRole("dialog", { name: "Règlement fournisseur" });
    await p.getByLabel("Référence").fill(`VIR-${RUN}-CH`);
    await p.getByRole("button", { name: "Enregistrer le règlement" }).click();
    testInfo.annotations.push({ type: "règlement", description: await dernierToast(page) });
    await expect(p).toBeHidden();
    await expect(ligne(page, numero).getByRole("button", { name: /Pay/ })).toHaveCount(0);

    await obs.joindre(testInfo);
    expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
  });

test("règlements par fournisseur : seules SES factures, répartition (paramètres assouplis par l'écran, puis rétablis)",
  async ({ page, browser }, testInfo) => {
    const obs = surveiller(page);
    const base = testInfo.project.use.baseURL;
    const fournisseur = `${RUN} Fournisseur AP`;
    const autre = `${RUN} Autre fournisseur AP`;
    const ff1 = `FF-${RUN}-1`, ff2 = `FF-${RUN}-2`, ffAutre = `FF-${RUN}-X`;

    obs.etape("prérequis : factures sans commande permises le temps du parcours");
    await assurerPlanComptable(page);
    await parametresFournisseurs(page, "optional", false);
    await creerFournisseur(page, fournisseur);
    await creerFournisseur(page, autre);

    obs.etape("trois factures soumises puis approuvées par un tiers");
    for (const [f, n, ht] of [[fournisseur, ff1, "100000"], [fournisseur, ff2, "20000"], [autre, ffAutre, "30000"]] as const) {
      await nouvelleFacture(page, f, n, ht, "0");
      await soumettreParAuteur(page, n);
      await approuverFactureFournisseur(browser, base, n);
    }

    obs.etape("règlement par fournisseur : seules SES factures, répartition");
    await page.goto("/payables/transactions");
    await page.getByRole("button", { name: "Règlement fournisseur" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Fournisseur *").selectOption({ label: fournisseur });
    await expect(d.getByLabel(`Montant imputé ${ff1}`)).toBeVisible();
    await expect(d.getByLabel(`Montant imputé ${ff2}`)).toBeVisible();
    await expect(d.getByText(ffAutre), "la facture d'un autre fournisseur n'est pas proposée").toHaveCount(0);
    await d.getByLabel("Montant du règlement (XOF)").fill("120000");
    await d.getByRole("button", { name: "Répartir" }).click();
    await expect(d.getByTestId("settlement-remaining")).toHaveText("0");
    await d.getByLabel("Référence").fill(`VIR-${RUN}-2`);
    await d.getByRole("button", { name: "Enregistrer le règlement" }).click();
    testInfo.annotations.push({ type: "règlement", description: await dernierToast(page) });
    await expect(d).toBeHidden();
    await expect(ligne(page, ff1).getByRole("button", { name: /Pay/ })).toHaveCount(0);
    await expect(ligne(page, ffAutre).getByRole("button", { name: /Pay/ }), "la facture de l'autre fournisseur reste due").toBeVisible();

    // Standard de présentation : règlements et approbations ont leur onglet dans Transactions.
    obs.etape("onglets Règlements et Approbations");
    await page.getByRole("tab", { name: "Règlements" }).click();
    await expect(page.getByTestId("ap-payment-row").filter({ hasText: `VIR-${RUN}-2` }), "une ligne par facture réglée").toHaveCount(2);
    await page.getByRole("tab", { name: /Approbations/ }).click();
    await expect(page.getByRole("cell", { name: ff1 }).first(), "décision de l'approbateur historisée").toBeVisible();
    await page.getByRole("tab", { name: /Factures/ }).click();

    obs.etape("détail, export, paramètres rétablis");
    await ligne(page, ff1).locator("td").first().click();
    const panneau = page.getByRole("dialog", { name: `Facture ${ff1}` });
    await expect(panneau.getByRole("region", { name: "Pied" })).toContainText("Reste à payer");
    await panneau.getByRole("button", { name: "Fermer" }).click();
    const telechargement = page.waitForEvent("download");
    await page.getByTestId("btn-export-csv").click();
    expect((await telechargement).suggestedFilename()).toMatch(/^factures-fournisseurs.*\.csv$/);
    await parametresFournisseurs(page, "mandatory", true);

    await obs.joindre(testInfo);
    expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
  });
