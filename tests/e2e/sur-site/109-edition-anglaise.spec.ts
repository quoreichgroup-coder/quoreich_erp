import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { identifiants, RUN } from "../parcours/outils";

/*
 * PoC i18n (V155), AC06 de bout en bout sur site : modèle ANGLAIS publié, édition anglaise demandée par l'API,
 * rendue par Gotenberg, archivée ; langue / locale / version figées ; empreinte du PDF vérifiée ; l'utilisateur
 * repasse en français et la réimpression restitue les MÊMES octets ; l'édition précédente reste intacte.
 * Prérequis : l'API reliée au moteur de rendu (QERP_PDF_URL) et une facture émise avec une édition archivée
 * (parcours 107).
 */
const ids = identifiants();
const BASE = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";

test.use({ storageState: { cookies: [], origins: [] } });

type Edition = {
  id: string; status: string; pdf_sha256: string; replaces_id: string | null; error: string | null;
  language: string | null; locale: string | null; template_version_id: string; context_sha256: string;
};

test("facture anglaise : rendue, archivée, langue figée, réimpression identique après retour au français", async ({ request }) => {
  test.skip(!ids, "identifiants du compte de test absents");
  const login = await request.post(`${BASE}/auth/v1/token?grant_type=password`, { data: { email: ids!.email, password: ids!.password } });
  expect(login.ok(), "connexion API sur site").toBeTruthy();
  const headers = { Authorization: `Bearer ${(await login.json()).access_token}` };

  // Dernière édition archivée (sans successeur) d'une facture émise.
  const invoices = await (await request.get(`${BASE}/api/v1/ar/invoices`, { headers })).json() as Array<{ id: string; status: string }>;
  let invoiceId: string | undefined;
  let previous: Edition | undefined;
  for (const invoice of invoices.filter((i) => i.status !== "draft")) {
    const history = await (await request.get(`${BASE}/api/v1/document-editions?invoiceId=${invoice.id}`, { headers })).json() as Edition[];
    const replaced = new Set(history.map((e) => e.replaces_id));
    const latest = history.find((e) => !replaced.has(e.id) && e.status === "ready");
    if (latest) { invoiceId = invoice.id; previous = latest; break; }
  }
  expect(previous, "une facture avec une édition archivée (parcours 107)").toBeTruthy();
  const previousPdf = await download(request, headers, previous!.id);

  // Modèle anglais, langue fixée à la création.
  const save = await request.post(`${BASE}/api/v1/document-templates`, {
    headers,
    data: { name: `Invoice EN ${RUN}`, language: "en", reason: `Recette i18n ${RUN}`,
      layout: { title: "Invoice", intro: "Thank you for your business.", footer: "Archived copy", accent_color: "#17324D", font_size: 10 } },
  });
  expect(save.ok(), "modèle anglais enregistré").toBeTruthy();
  const { template, version } = await save.json();
  expect(template.language).toBe("en");
  expect((await request.post(`${BASE}/api/v1/document-templates/${version.id}/publish`, { headers, data: { reason: `Publication ${RUN}` } })).ok()).toBeTruthy();

  // Édition anglaise (remplacement motivé de la dernière édition).
  const issue = await request.post(`${BASE}/api/v1/document-editions`, {
    headers, data: { invoice_id: invoiceId, replace_id: previous!.id, reason: `Version anglaise ${RUN}`, language: "en" },
  });
  expect(issue.ok(), "édition anglaise demandée").toBeTruthy();
  const english = await waitForReady(request, headers, invoiceId!, (await issue.json()).id);
  expect(english.language).toBe("en");
  expect(english.locale).toBe("en-GB");
  expect(english.template_version_id).toBe(version.id);
  const pdf = await download(request, headers, english.id);
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(createHash("sha256").update(pdf).digest("hex")).toBe(english.pdf_sha256);

  // L'utilisateur repasse en français : l'archive anglaise ne change pas d'un octet.
  expect((await request.put(`${BASE}/api/v1/me/language`, { headers, data: { language: "fr", locale: "fr-FR" } })).ok()).toBeTruthy();
  expect(await download(request, headers, english.id)).toEqual(pdf);
  expect(await download(request, headers, previous!.id)).toEqual(previousPdf);
  const again = (await (await request.get(`${BASE}/api/v1/document-editions?invoiceId=${invoiceId}`, { headers })).json() as Edition[])
    .find((e) => e.id === english.id)!;
  expect([again.language, again.locale, again.context_sha256, again.pdf_sha256])
    .toEqual([english.language, english.locale, english.context_sha256, english.pdf_sha256]);
  expect((await request.put(`${BASE}/api/v1/me/language`, { headers, data: { language: null, locale: null } })).ok()).toBeTruthy();
});

async function waitForReady(request: APIRequestContext, headers: Record<string, string>, invoiceId: string, editionId: string) {
  const expires = Date.now() + 45_000;
  while (Date.now() < expires) {
    const editions = await (await request.get(`${BASE}/api/v1/document-editions?invoiceId=${invoiceId}`, { headers })).json() as Edition[];
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
