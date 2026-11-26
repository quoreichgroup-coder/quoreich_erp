import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { identifiants, RUN } from "../parcours/outils";

const ids = identifiants();
const BASE = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";

// This journey authenticates through APIRequestContext and does not consume the browser login state.
test.use({ storageState: { cookies: [], origins: [] } });

test("modèle versionné, PDF archivé, idempotence et remplacement immuable", async ({ request }) => {
  test.skip(!ids, "identifiants du compte de test absents");

  const login = await request.post(`${BASE}/auth/v1/token?grant_type=password`, {
    data: { email: ids!.email, password: ids!.password },
  });
  expect(login.ok(), "connexion API sur site").toBeTruthy();
  const { access_token: token } = await login.json() as { access_token: string };
  const headers = { Authorization: `Bearer ${token}` };

  const invoicesResponse = await request.get(`${BASE}/api/v1/ar/invoices`, { headers });
  expect(invoicesResponse.ok(), "liste des factures").toBeTruthy();
  const invoices = await invoicesResponse.json() as Array<{ id: string; status: string }>;
  const sent = invoices.filter((invoice) => invoice.status === "sent");
  let invoiceId: string | undefined;
  let firstReady: Edition | undefined;
  for (const invoice of sent) {
    const editions = await request.get(`${BASE}/api/v1/document-editions?invoiceId=${invoice.id}`, { headers });
    expect(editions.ok(), "liste des éditions archivées").toBeTruthy();
    const history = await editions.json() as Edition[];
    const ready = history.find((edition) => edition.status === "ready");
    if (ready) {
      invoiceId = invoice.id;
      firstReady = ready;
      break;
    }
    if (history.length === 0) {
      invoiceId = invoice.id;
      break;
    }
  }
  expect(invoiceId, "une facture émise disponible dans la société de test").toBeTruthy();

  const layout = {
    title: `Facture ${RUN}`,
    intro: "Édition officielle de recette.",
    footer: "Copie archivée",
    accent_color: "#17324D",
    font_size: 10,
  };
  const save = await request.post(`${BASE}/api/v1/document-templates`, {
    headers,
    data: { name: `Modèle facture ${RUN}`, layout, reason: `Recette ${RUN}` },
  });
  expect(save.ok(), "enregistrement du modèle").toBeTruthy();
  const { template, version } = await save.json();
  const publish = await request.post(`${BASE}/api/v1/document-templates/${version.id}/publish`, {
    headers,
    data: { reason: `Publication ${RUN}` },
  });
  expect(publish.ok(), "publication du modèle").toBeTruthy();

  if (!firstReady) {
    const issue = await request.post(`${BASE}/api/v1/document-editions`, { headers, data: { invoice_id: invoiceId } });
    expect(issue.ok(), "demande de rendu").toBeTruthy();
    const first = await issue.json() as { id: string; status: string };
    firstReady = await waitForReady(request, headers, invoiceId!, first.id);
  }
  const firstPdf = await download(request, headers, firstReady.id);
  const firstHash = createHash("sha256").update(firstPdf).digest("hex");
  expect(firstPdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(firstHash).toBe(firstReady.pdf_sha256);

  const repeatIssue = await request.post(`${BASE}/api/v1/document-editions`, { headers, data: { invoice_id: invoiceId } });
  expect(repeatIssue.ok()).toBeTruthy();
  expect((await repeatIssue.json()).id).toBe(firstReady.id);

  const secondSave = await request.post(`${BASE}/api/v1/document-templates`, {
    headers,
    data: {
      id: template.id,
      name: template.name,
      layout: { ...layout, title: `Remplacement ${RUN}` },
      reason: `Nouvelle version ${RUN}`,
    },
  });
  expect(secondSave.ok(), "création de la version suivante").toBeTruthy();
  const { version: secondVersion } = await secondSave.json();
  const secondPublish = await request.post(`${BASE}/api/v1/document-templates/${secondVersion.id}/publish`, {
    headers,
    data: { reason: `Publication version suivante ${RUN}` },
  });
  expect(secondPublish.ok()).toBeTruthy();

  const replace = await request.post(`${BASE}/api/v1/document-editions`, {
    headers,
    data: { invoice_id: invoiceId, replace_id: firstReady.id, reason: `Correction ${RUN}` },
  });
  expect(replace.ok(), "remplacement motivé").toBeTruthy();
  const replacement = await waitForReady(request, headers, invoiceId!, (await replace.json()).id);
  expect(replacement.replaces_id).toBe(firstReady.id);
  const originalAgain = await download(request, headers, firstReady.id);
  const replacementPdf = await download(request, headers, replacement.id);
  expect(originalAgain).toEqual(firstPdf);
  expect(createHash("sha256").update(replacementPdf).digest("hex")).not.toBe(firstHash);
});

type Edition = { id: string; status: string; pdf_sha256: string; replaces_id: string | null; error: string | null };

async function waitForReady(request: APIRequestContext, headers: Record<string, string>, invoiceId: string, editionId: string) {
  const expires = Date.now() + 45_000;
  while (Date.now() < expires) {
    const response = await request.get(`${BASE}/api/v1/document-editions?invoiceId=${invoiceId}`, { headers });
    expect(response.ok(), "relecture du statut").toBeTruthy();
    const editions = await response.json() as Edition[];
    const edition = editions.find((item) => item.id === editionId);
    expect(edition, "édition créée").toBeTruthy();
    if (edition!.status === "ready") return edition!;
    if (edition!.status === "failed") throw new Error(edition!.error ?? "Échec du rendu PDF sans détail");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Le rendu du PDF n'est pas terminé après 45 secondes");
}

async function download(request: APIRequestContext, headers: Record<string, string>, id: string) {
  const response = await request.get(`${BASE}/api/v1/document-editions/${id}/download`, { headers });
  expect(response.ok(), "téléchargement de l'archive immuable").toBeTruthy();
  return response.body();
}
