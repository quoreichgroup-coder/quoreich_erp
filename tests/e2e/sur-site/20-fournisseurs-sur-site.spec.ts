import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller } from "../parcours/outils";
import { ligne, champ } from "../parcours/champs";
import { creerFournisseur, parametresFournisseurs } from "../parcours/actions";

/*
 * Comptes fournisseurs sur site (lot 3), de bout en bout par l'API Java et la base locale :
 * paramètres AP, fiche fournisseur, facture à lignes (en-tête calculé par la base), soumission
 * à l'approbation, refus d'approuver sa propre facture. AUCUN accès de ce périmètre — lecture
 * comprise — ne doit partir vers Supabase.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

const PERIMETRE = /\/rest\/v1\/(suppliers|supplier_change_log|ap_[a-z_]+|payments|purchase_order_analytics|ap_invoice_analytics|ap_invoice_line_analytics)\b|\/rest\/v1\/rpc\/(ap_[a-z_]+|verify_supplier_bank_details|record_settlement|reverse_settlement|seed_ap_defaults)\b/;

function routage(page: Page) {
  const api = process.env.E2E_API_URL!;
  const versApi: string[] = [];
  const versNuage: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "OPTIONS") return;
    const u = r.url();
    if (u.startsWith(api)) versApi.push(`${r.method()} ${new URL(u).pathname}`);
    else if (/supabase\.co/.test(u) && PERIMETRE.test(u)) versNuage.push(`${r.method()} ${new URL(u).pathname}`);
  });
  return { versApi, versNuage };
}

test("fournisseur → facture à lignes → soumission, tout par l'API sur site", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const flux = routage(page);
  const fournisseur = `${RUN} Fournisseur sur site`;
  const numero = `FF-${RUN}-SS`;

  obs.etape("paramètres AP par l'API (pas de commande exigée)");
  await parametresFournisseurs(page, "optional", false);

  obs.etape("fiche fournisseur par l'API");
  await creerFournisseur(page, fournisseur);
  await page.getByPlaceholder("Rechercher un fournisseur").fill(RUN);
  await expect(ligne(page, fournisseur)).toBeVisible();

  obs.etape("facture à deux lignes par l'API");
  await page.goto("/payables/transactions");
  await page.getByRole("button", { name: "Nouvelle facture fournisseur" }).click();
  const d = page.getByRole("dialog");
  await d.locator("select").first().selectOption({ label: fournisseur });
  await champ(d, "N° Facture").fill(numero);
  await d.getByLabel("Libellé ligne 1").fill("Fournitures");
  await d.getByLabel("Quantité ligne 1").fill("3");
  await d.getByLabel("Prix unitaire ligne 1").fill("12000");
  await d.getByTestId("btn-add-line").click();
  await d.getByLabel("Libellé ligne 2").fill("Livraison");
  await d.getByLabel("Quantité ligne 2").fill("1");
  await d.getByLabel("Prix unitaire ligne 2").fill("4000");
  await d.getByRole("button", { name: "Créer" }).click();
  await expect(d).toBeHidden();
  await expect(ligne(page, numero)).toContainText("40 000");

  obs.etape("soumission par la fonction de la base, refus d'approuver sa propre facture");
  await ligne(page, numero).getByRole("button", { name: "Soumettre" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Facture soumise" }).first()).toBeVisible();
  await expect(ligne(page, numero)).toContainText(/En approbation|Soumise/);
  await ligne(page, numero).click();
  await expect(page.getByText("vous êtes l'auteur").first()).toBeVisible();

  testInfo.annotations.push({ type: "vers l'API", description: [...new Set(flux.versApi)].join(", ") });
  expect(flux.versNuage, `accès du périmètre partis vers Supabase : ${flux.versNuage.join(", ")}`).toEqual([]);
  expect(flux.versApi.some((r) => r.includes("/api/v1/ap/invoices/with-lines")), "facture créée par l'API").toBe(true);
  await obs.joindre(testInfo);
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
