import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDownloadFile, apiGet, apiPost, isApiEnabled, saveFileBlob } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";
import { supabase } from "@/integrations/supabase/client";
import { safeFileName, sha256Hex } from "@/lib/attachments";

// Document edition tables and functions are not in the generated Supabase client yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const TEMPLATES = "/api/v1/document-templates";
const EDITIONS = "/api/v1/document-editions";
const STALE_RENDER_MS = 60_000;
const POLL_WINDOW_MS = STALE_RENDER_MS + 5_000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const queryOptions = { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

export type DocumentType = "ar_invoice" | "purchase_order";
export type PurchaseOrderPreset = "standard" | "reference-PO0004821";

export type DocumentLayout = {
  title: string;
  intro: string;
  footer: string;
  accent_color: string;
  font_size: number;
  doc_type?: "purchase_order";
  preset?: PurchaseOrderPreset;
};

export type DocumentTemplateVersion = {
  id: string;
  tenant_id: string;
  template_id: string;
  version_no: number;
  layout: DocumentLayout;
  content_html: string;
  sha256: string;
  created_at: string;
  created_by: string;
  reason: string;
  published_at: string | null;
  published_by: string | null;
};

type TemplateIdentity = {
  id: string;
  tenant_id: string;
  doc_type: DocumentType;
  name: string;
  current_version_id: string | null;
  is_default: boolean;
  created_at: string;
  created_by: string;
};

export type DocumentTemplate = TemplateIdentity & { versions: DocumentTemplateVersion[] };

export type IssuedDocument = {
  id: string;
  tenant_id: string;
  ar_invoice_id: string | null;
  po_id?: string | null;
  template_version_id: string;
  context: unknown;
  context_sha256: string;
  reference: string;
  status: "queued" | "rendering" | "ready" | "failed";
  storage_path: string | null;
  pdf_sha256: string | null;
  renderer: string | null;
  renderer_version: string | null;
  created_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  replaces_id: string | null;
  replacement_reason: string | null;
};

type SaveTemplate = { id?: string; name: string; layout: DocumentLayout; reason: string };
type SavedTemplate = { template: TemplateIdentity; version: DocumentTemplateVersion };
type RequestEdition = ({ invoice_id: string; po_id?: never } | { po_id: string; invoice_id?: never })
  & { template_id?: string; replace_id?: string; reason?: string };

async function readResult<T>(request: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
}

function templateKey(tenantId: string | undefined, docType?: DocumentType) {
  return ["document-templates", tenantId, isApiEnabled() ? "api" : "supabase", ...(docType ? [docType] : [])] as const;
}

function editionKey(tenantId: string | undefined, sourceId: string, docType: DocumentType) {
  return ["document-editions", tenantId, isApiEnabled() ? "api" : "supabase", docType, sourceId] as const;
}

export function useDocumentTemplates(enabled = true, docType: DocumentType = "ar_invoice") {
  const tenant = useTenantId();
  return useQuery({
    ...queryOptions,
    queryKey: templateKey(tenant.data, docType),
    enabled: enabled && Boolean(tenant.data),
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<DocumentTemplate[]>(docType === "purchase_order" ? `${TEMPLATES}?docType=purchase_order` : TEMPLATES);
      return readResult<DocumentTemplate[]>(db.from("document_templates")
        .select("*, versions:document_template_versions!document_template_versions_template_id_fkey(*)")
        .eq("tenant_id", tenant.data).eq("doc_type", docType).order("name"));
    },
  });
}

export function useSaveDocumentTemplate() {
  const { data: tenantId } = useTenantId();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (input: SaveTemplate) => {
      if (isApiEnabled()) return apiPost<SavedTemplate>(TEMPLATES, input);
      return readResult<SavedTemplate>(db.rpc("save_document_template", {
        _id: input.id ?? null, _name: input.name, _layout: input.layout, _reason: input.reason,
      }));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: templateKey(tenantId) }),
  });
}

export function useInstallPurchaseOrderTemplates() {
  const { data: tenantId } = useTenantId();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: () => isApiEnabled()
      ? apiPost<DocumentTemplate[]>(`${TEMPLATES}/purchase-orders/defaults`, {})
      : readResult<DocumentTemplate[]>(db.rpc("install_purchase_order_templates")),
    onSuccess: () => client.invalidateQueries({ queryKey: templateKey(tenantId, "purchase_order") }),
  });
}

export function usePublishDocumentTemplate() {
  const { data: tenantId } = useTenantId();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({ versionId, reason }: { versionId: string; reason: string }) => {
      if (isApiEnabled()) return apiPost<DocumentTemplateVersion>(`${TEMPLATES}/${versionId}/publish`, { reason });
      return readResult<DocumentTemplateVersion>(db.rpc("publish_document_template", { _version: versionId, _reason: reason }));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: templateKey(tenantId) }),
  });
}

export function useSetDefaultDocumentTemplate() {
  const { data: tenantId } = useTenantId();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({ templateId }: { templateId: string }) => isApiEnabled()
      ? apiPost<DocumentTemplate>(`${TEMPLATES}/${templateId}/default`, {})
      : readResult<DocumentTemplate>(db.rpc("set_default_document_template", { _template: templateId })),
    onSuccess: () => client.invalidateQueries({ queryKey: templateKey(tenantId) }),
  });
}

function activeAge(edition: IssuedDocument, now: number) {
  const timestamp = edition.status === "rendering" ? edition.started_at : edition.created_at;
  return now - Date.parse(timestamp ?? edition.created_at);
}

export function canRetryDocumentEdition(edition: IssuedDocument, now: number, retriedAt = 0) {
  return edition.status === "failed" || ((edition.status === "queued" || edition.status === "rendering")
    && activeAge(edition, now) > STALE_RENDER_MS && now - retriedAt > STALE_RENDER_MS);
}

export function useDocumentEditions(sourceId: string, requestedAt: number, docType: DocumentType = "ar_invoice") {
  const { data: tenantId } = useTenantId();
  return useQuery({
    ...queryOptions,
    queryKey: editionKey(tenantId, sourceId, docType),
    enabled: Boolean(tenantId && sourceId),
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<IssuedDocument[]>(`${EDITIONS}?${docType === "purchase_order" ? "poId" : "invoiceId"}=${encodeURIComponent(sourceId)}`);
      return readResult<IssuedDocument[]>(db.from("issued_documents").select("*")
        .eq("tenant_id", tenantId).eq(docType === "purchase_order" ? "po_id" : "ar_invoice_id", sourceId)
        .order("created_at", { ascending: false }).order("id", { ascending: false }));
    },
    refetchInterval: ({ state }) => {
      if (state.status === "error") return false;
      const now = Date.now();
      return state.data?.some((edition) => {
        if (edition.status !== "queued" && edition.status !== "rendering") return false;
        const age = activeAge(edition, now);
        return (age >= -5000 && age < POLL_WINDOW_MS) || now - requestedAt < POLL_WINDOW_MS;
      }) ? 1000 : false;
    },
  });
}

async function invokeDocumentRender(body: RequestEdition | { id: string }) {
  const { data, error } = await supabase.functions.invoke<IssuedDocument>("document-render", { body });
  if (error) {
    const response: unknown = "context" in error ? error.context : null;
    const payload = response instanceof Response ? await response.json().catch(() => null) : null;
    throw new Error(typeof payload?.error === "string" ? payload.error : error.message);
  }
  if (!data) throw new Error("Le serveur n’a renvoyé aucune édition.");
  return data;
}

export function useRequestDocumentEdition(sourceId: string, docType: DocumentType = "ar_invoice") {
  const { data: tenantId } = useTenantId();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (body: RequestEdition | { id: string }) => {
      if (!isApiEnabled()) return invokeDocumentRender(body);
      if ("id" in body) return apiPost<IssuedDocument>(`${EDITIONS}/${body.id}/retry`, {});
      return apiPost<IssuedDocument>(EDITIONS, body);
    },
    // A response can be lost after the job was saved. Refresh even if the request failed.
    onSettled: () => client.invalidateQueries({ queryKey: editionKey(tenantId, sourceId, docType) }),
  });
}

export async function downloadDocumentEdition(edition: IssuedDocument) {
  const filename = `${safeFileName(edition.reference)}.pdf`;
  if (isApiEnabled()) return apiDownloadFile(`${EDITIONS}/${edition.id}/download`, filename);
  if (!edition.storage_path) throw new Error("Le chemin du PDF archivé est manquant.");
  if (!edition.pdf_sha256) throw new Error("L’empreinte du PDF archivé est manquante.");
  const data = await readResult(supabase.storage.from("issued-documents")
    .createSignedUrl(edition.storage_path, 60));
  if (!data?.signedUrl) throw new Error("Le lien de téléchargement du PDF archivé est indisponible.");
  const response = await fetch(data.signedUrl, { cache: "no-store" });
  if (!response.ok || !response.body) throw new Error("Le PDF archivé est indisponible.");
  const bytes = await readArchivedPdf(response);
  const header = new TextDecoder().decode(bytes.subarray(0, 5));
  if (header !== "%PDF-" || await sha256Hex(bytes.buffer) !== edition.pdf_sha256.toLowerCase()) {
    throw new Error("Le contrôle d’intégrité du PDF archivé a échoué.");
  }
  saveFileBlob(new Blob([bytes], { type: "application/pdf" }), filename);
}

async function readArchivedPdf(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  const tooLarge = "Le PDF archivé dépasse la limite de 25 Mio.";
  if (Number(response.headers.get("content-length")) > MAX_PDF_BYTES) {
    await response.body.cancel().catch(() => undefined);
    throw new Error(tooLarge);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PDF_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error(tooLarge);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
