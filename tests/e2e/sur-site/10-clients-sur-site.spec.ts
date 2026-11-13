import { test, expect, type Page } from "@playwright/test";
import { identifiants, RUN, surveiller, dernierToast } from "../parcours/outils";
import { ligne } from "../parcours/champs";

/*
 * Clients sur site, de bout en bout par l'API Java et la base locale : fiche client → facture à
 * lignes (pied calculé, numéro définitif) → détail (lignes lues par l'API) → encaissement par
 * client → soldée → export. À chaque étape, AUCUNE écriture de ce périmètre ne doit partir vers
 * Supabase : c'est ce qui distingue un déploiement sur site d'un front hybride.
 */
test.skip(!identifiants(), "identifiants du compte de test absents");

const PERIMETRE = /\/rest\/v1\/(customers|ar_invoices|ar_invoice_lines|payments)\b/;

function routage(page: Page) {
  const api = process.env.E2E_API_URL!;
  const versApi: string[] = [];
  const versNuage: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET" || r.method() === "OPTIONS" || r.method() === "HEAD") return;
    const u = r.url();
    if (u.startsWith(api)) versApi.push(`${r.method()} ${new URL(u).pathname}`);
    else if (/supabase\.co/.test(u) && PERIMETRE.test(u)) versNuage.push(`${r.method()} ${new URL(u).pathname}`);
  });
  return { versApi, versNuage };
}

test("client → facture à lignes → encaissement → export, tout par l'API sur site", async ({ page }, testInfo) => {
  const obs = surveiller(page);
  const flux = routage(page);
  const client = `${RUN} Client sur site`;

  obs.etape("fiche client par l'API");
  await page.goto("/customers");
  await page.getByRole("button", { name: /Add Customer/i }).click();
  let d = page.getByRole("dialog");
  await d.getByPlaceholder("Company or individual name").fill(client);
  await d.getByPlaceholder("email@example.com").fill("client.sursite@exemple.invalid");
  await d.getByRole("button", { name: "Create" }).click();
  await expect(d).toBeHidden();
  await page.getByPlaceholder("Search customers...").fill(RUN);
  await expect(ligne(page, client)).toBeVisible();

  obs.etape("facture à deux lignes par l'API");
  await page.goto("/receivables/transactions");
  await page.getByRole("button", { name: /Créer facture/ }).click();
  d = page.getByRole("dialog");
  await d.locator("select").first().selectOption({ label: client });
  await d.getByLabel("Libellé ligne 1").fill("Audit sur site");
  await d.getByLabel("Quantité ligne 1").fill("1");
  await d.getByLabel("Prix unitaire ligne 1").fill("200000");
  await d.getByTestId("btn-add-line").click();
  await d.getByLabel("Libellé ligne 2").fill("Rapport");
  await d.getByLabel("Quantité ligne 2").fill("2");
  await d.getByLabel("Prix unitaire ligne 2").fill("25000");
  await expect(d).toContainText("250");
  await d.getByRole("button", { name: "Créer" }).click();
  const msg = await dernierToast(page);
  testInfo.annotations.push({ type: "émission", description: msg });
  await expect(d, `émission : ${msg}`).toBeHidden();
  const f = ligne(page, client);
  await expect(f).toContainText("250");
  const numero = (await f.locator("td").nth(1).innerText()).trim();
  testInfo.annotations.push({ type: "numéro", description: numero });
  expect.soft(numero).not.toMatch(/BROUILLON/);

  obs.etape("détail : lignes lues par l'API");
  await f.click();
  const panneau = page.getByRole("dialog", { name: `Facture ${numero}` });
  await expect(panneau.getByRole("region", { name: "Lignes" })).toContainText("Rapport");
  await expect(panneau.getByRole("region", { name: "Pied" })).toContainText("250 000");

  obs.etape("encaissement par client (API, imputation par facture)");
  await panneau.getByRole("button", { name: /Enregistrer paiement/ }).click();
  const p = page.getByRole("dialog", { name: "Encaissement client" });
  await expect(p.getByLabel(`Montant imputé ${numero}`)).toHaveValue("250000");
  await p.getByLabel("Référence").fill(`ENC-SS-${RUN}`);
  await p.getByRole("button", { name: "Enregistrer le règlement" }).click();
  const m = await dernierToast(page);
  testInfo.annotations.push({ type: "encaissement", description: m });
  await expect(p, `encaissement : ${m}`).toBeHidden();
  await panneau.getByRole("button", { name: "Fermer" }).click().catch(() => undefined);
  await expect(ligne(page, numero)).toContainText(/payée|paid|Payée/i);

  obs.etape("export par l'API");
  const telechargement = page.waitForEvent("download");
  await page.getByTestId("btn-export-csv").click();
  testInfo.annotations.push({ type: "export", description: (await telechargement).suggestedFilename() });

  testInfo.annotations.push({ type: "écritures vers l'API", description: flux.versApi.join(" ; ") });
  expect(flux.versNuage, "aucune écriture clients / factures / encaissements vers Supabase").toEqual([]);
  expect(flux.versApi.some((x) => x.startsWith("POST /api/v1/customers"))).toBeTruthy();
  expect(flux.versApi.some((x) => x.startsWith("POST /api/v1/ar/invoices"))).toBeTruthy();
  await obs.joindre(testInfo);
  expect(obs.incidents, JSON.stringify(obs.incidents, null, 1)).toEqual([]);
});
