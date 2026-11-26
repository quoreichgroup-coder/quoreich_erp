/** Shared, transport-independent archive worker; the HTML and path come only from the trusted claim RPC. */
type EditionChoices = { template_id?: string; replace_id?: string; reason?: string };
export type EditionRequest = { id: string } | (EditionChoices & ({ invoice_id: string } | { po_id: string }));
export type EditionClaim = { id: string; tenant_id: string; storage_path: string; html: string };
export type EditionCompletion = { path: string; sha256: string; renderer: string; rendererVersion: string };
export interface EditionWorker {
  claim(): Promise<EditionClaim | null>;
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, bytes: Uint8Array): Promise<"created" | "exists">;
  complete(result: EditionCompletion): Promise<unknown>;
  fail(message: string): Promise<unknown>;
  rendererUrl: string;
  rendererVersion: string;
  authorization?: string;
  fetcher?: typeof fetch;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PDF = 25 * 1024 * 1024;
const messages: Record<string, string> = {
  configuration: "Le service de rendu PDF n'est pas configuré.",
  invalid_pdf: "Le service de rendu n'a pas produit un PDF conforme. Vous pouvez relancer.",
  invalid_job: "Les données de l'édition sont invalides. Contactez l'administrateur.",
  render: "Le rendu du PDF a échoué. Vous pouvez relancer.",
};

export function parseEditionRequest(value: unknown): EditionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Demande d'édition invalide.");
  const v = value as Record<string, unknown>;
  const allowed = v.id !== undefined ? ["id"] : ["invoice_id", "po_id", "template_id", "replace_id", "reason"];
  if (Object.keys(v).some((key) => !allowed.includes(key))) throw new Error("Champ d'édition non autorisé.");
  if (["id", "invoice_id", "po_id"].filter((key) => Object.prototype.hasOwnProperty.call(v, key)).length !== 1) {
    throw new Error("Une seule facture ou commande source est obligatoire.");
  }
  if (v.id !== undefined) {
    if (typeof v.id !== "string" || !UUID.test(v.id)) throw new Error("Identifiant d'édition invalide.");
    return { id: v.id };
  }
  const source = Object.prototype.hasOwnProperty.call(v, "po_id") ? "po_id" : "invoice_id";
  if (typeof v[source] !== "string" || !UUID.test(v[source])) throw new Error("Identifiant de facture ou de commande invalide.");
  const result: Exclude<EditionRequest, { id: string }> = source === "po_id" ? { po_id: v[source] } : { invoice_id: v[source] };
  for (const key of ["template_id", "replace_id"] as const) {
    if (v[key] != null) {
      if (typeof v[key] !== "string" || !UUID.test(v[key])) throw new Error("Identifiant de modèle ou de remplacement invalide.");
      result[key] = v[key];
    }
  }
  if (v.reason != null && (typeof v.reason !== "string" || v.reason.length > 1000)) throw new Error("Motif invalide (1 000 caractères maximum).");
  if (typeof v.reason === "string") result.reason = v.reason.trim();
  if (result.replace_id && !result.reason) throw new Error("Le motif du remplacement est obligatoire.");
  return result;
}

export function editionRequestRpc(input: EditionRequest): { name: string; params: Record<string, unknown> } {
  if ("id" in input) return { name: "retry_document_edition", params: { _id: input.id } };
  const choices = { _template: input.template_id ?? null, _replace: input.replace_id ?? null, _reason: input.reason ?? null };
  return "po_id" in input
    ? { name: "request_purchase_order_edition", params: { _po: input.po_id, ...choices } }
    : { name: "request_document_edition", params: { _invoice: input.invoice_id, ...choices } };
}

export async function readEditionRequest(request: Request): Promise<EditionRequest> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Demande d'édition vide.");
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > 8192) { await reader.cancel(); throw new Error("Demande d'édition trop volumineuse."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("Demande JSON invalide."); }
  return parseEditionRequest(value);
}

function checkPdf(bytes: Uint8Array): void {
  if (bytes.byteLength < 8 || bytes.byteLength > MAX_PDF || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("invalid_pdf");
}

async function convertedPdf(response: Response): Promise<Uint8Array> {
  if (!response.ok || response.headers.get("Gotenberg-Remediation-Residual") !== "0" ||
      !response.headers.get("content-type")?.toLowerCase().startsWith("application/pdf")) throw new Error("invalid_pdf");
  if (Number(response.headers.get("content-length")) > MAX_PDF) { await response.body?.cancel(); throw new Error("invalid_pdf"); }
  const reader = response.body?.getReader(); if (!reader) throw new Error("invalid_pdf");
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > MAX_PDF) { await reader.cancel(); throw new Error("invalid_pdf"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  checkPdf(bytes); return bytes;
}

export async function renderEdition(id: string, worker: EditionWorker): Promise<void> {
  const job = await worker.claim();
  if (!job) return;
  try {
    if (job.id !== id || !UUID.test(job.tenant_id) || job.storage_path !== `${job.tenant_id}/issued/${id}.pdf` ||
        typeof job.html !== "string" || new TextEncoder().encode(job.html).byteLength > 1024 * 1024) throw new Error("invalid_job");
    let bytes = await worker.read(job.storage_path);
    if (!bytes) {
      if (!worker.rendererUrl) throw new Error("configuration");
      const url = new URL(worker.rendererUrl);
      if (url.username || url.password || !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "gotenberg"].includes(url.hostname)))) throw new Error("configuration");
      const form = new FormData();
      form.append("files", new Blob([job.html], { type: "text/html;charset=utf-8" }), "index.html");
      form.append("paperSize", "A4"); form.append("preferCssPageSize", "true"); form.append("printBackground", "true");
      form.append("stages", JSON.stringify([{ op: "remediate", profile: "PDF/A-2b", language: "fr" }]));
      const response = await (worker.fetcher ?? fetch)(`${worker.rendererUrl.replace(/\/$/, "")}/forms/chromium/convert/html`, {
        method: "POST", body: form, signal: AbortSignal.timeout(30_000), redirect: "error",
        headers: worker.authorization ? { authorization: worker.authorization } : {},
      });
      bytes = await convertedPdf(response);
      if (await worker.write(job.storage_path, bytes) === "exists") {
        const archived = await worker.read(job.storage_path); if (!archived) throw new Error("render");
        bytes = archived;
      }
    }
    checkPdf(bytes);
    const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    const sha256 = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
    await worker.complete({ path: job.storage_path, sha256, renderer: "gotenberg", rendererVersion: worker.rendererVersion });
  } catch (error) {
    await worker.fail(messages[error instanceof Error ? error.message : "render"] ?? messages.render);
  }
}
