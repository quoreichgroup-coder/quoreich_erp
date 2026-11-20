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
  // Numéro d'expédition au format de la procédure Sage 300 (ANNÉE-TRANSITAIRE-MODE-NNN), séquence continue.
  const reglages = page.getByTestId("import-settings");
  await reglages.getByRole("button", { name: /Paramètres des dossiers/ }).click();
  const format = reglages.getByLabel("Numéro d'expédition");
  if ((await format.inputValue()) !== "{YYYY}-{FWD}-{MODE}-{SEQ3}") {
    await format.selectOption("{YYYY}-{FWD}-{MODE}-{SEQ3}");
    await expect(toast("Paramètres des dossiers enregistrés")).toBeVisible();
  }
  // Connecteur de suivi (V134) : adresse de réception propre à la société.
  const connexion = reglages.getByTestId("tracking-connection");
  await connexion.getByTestId("tracking-connection-save").click();
  await expect(toast("Connexion de suivi enregistrée")).toBeVisible();
  const adresse = (await connexion.getByTestId("tracking-webhook-url").locator("code").innerText()).trim();
  expect(adresse).toMatch(/tracking-webhook/);
  const form = page.getByTestId("import-file-form");
  const options = await form.getByLabel("Fournisseur *").locator("option").allTextContents();
  await form.getByLabel("Fournisseur *").selectOption({ label: disponible && options.includes(fournisseur) ? fournisseur : options[1] });
  await form.getByLabel("Transitaire").selectOption({ index: 1 });
  await form.getByLabel("Connaissement / LTA").fill(`BL-${RUN}`);
  await form.getByLabel("Catégorie TEC").selectOption("10");
  await page.getByTestId("import-file-create").click();
  await expect(toast("Dossier d'importation ouvert")).toBeVisible();
  // Le dossier créé s'ouvre seul ; cliquer la première ligne avant le rechargement ouvrirait le dossier précédent.
  const detail = page.getByTestId("import-file-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(`BL-${RUN}`);
  await expect(page.getByTestId("import-file-row").first().locator("td").first()).toHaveText(/^\d{4}-[A-Z]{3}-MER-\d{3}$/);

  if (process.env.E2E_SUR_SITE) {
    obs.etape("événement DCSA reçu du prestataire");
    const reponse = await page.request.post(adresse, { data: { events: [{ eventID: `${RUN}-depa`, eventType: "TRANSPORT", transportEventTypeCode: "DEPA",
      eventClassifierCode: "ACT", eventDateTime: new Date().toISOString(), transportDocumentReference: `BL-${RUN}`,
      transportCall: { UNLocationCode: "CNNGB", vessel: { vesselName: "MSC ANNA" } } }] } });
    expect(await reponse.json()).toMatchObject({ added: 1 });
  }

  obs.etape("processus : frais estimés, commande de transport");
  const processus = detail.getByTestId("import-process");
  await processus.getByTestId("import-estimate").click();
  await expect(toast("frais estimé(s) d'après les règles")).toBeVisible();
  await processus.getByTestId("import-transport-po").click();
  await expect(toast("Commande de transport créée")).toBeVisible();

  obs.etape("suivi : événement saisi, fichier de suivi importé");
  const suivi = detail.getByTestId("shipment-tracking");
  const ev = suivi.getByTestId("shipment-event-form");
  await ev.getByLabel("Étape").selectOption({ label: "Départ" });
  await ev.getByLabel("Navire / vol").fill("MSC ANNA");
  await suivi.getByTestId("shipment-event-add").click();
  await expect(toast("Événement de suivi ajouté")).toBeVisible();
  await expect(suivi.getByTestId("timeline-row").filter({ hasText: "Départ" }).first()).toBeVisible();
  const jour = new Date().toISOString().slice(0, 10).split("-").reverse().join("/");
  const csv = `Date;Événement;Lieu;Navire;Conteneur
${jour} 08:00;Vessel arrival;CIABJ;MSC ANNA;MSCU1234567
${jour};Mainlevée accordée (BAE);CIABJ;;
${jour};Inspection;CIABJ;;
`;
  await suivi.getByLabel("Fichier de suivi").setInputFiles({ name: "suivi-transitaire.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
  await expect(suivi.getByTestId("shipment-import-preview")).toContainText("2 ligne(s) reconnue(s) sur 3");
  await suivi.getByTestId("shipment-import-confirm").click();
  await expect(toast("Suivi importé : 2 événement(s) ajouté(s)")).toBeVisible();
  await expect(suivi.getByTestId("tracking-state")).toBeVisible();

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
  // V135 : coût de revient unitaire par article (achat + frais répartis).
  await expect(detail.getByTestId("import-cost-report").getByRole("row").nth(1)).toBeVisible();
  expect(obs.inattendus(), JSON.stringify(obs.inattendus(), null, 1)).toEqual([]);
});
