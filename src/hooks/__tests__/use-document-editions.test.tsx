import { webcrypto, createHash } from "node:crypto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { canRetryDocumentEdition, downloadDocumentEdition, useDocumentEditions, useDocumentTemplates, useInstallPurchaseOrderTemplates, useRequestDocumentEdition, useSaveDocumentTemplate, type IssuedDocument } from "@/hooks/use-document-editions";

const calls = vi.hoisted(() => ({ apiMode: false, tenantId: "tenant-a", get: vi.fn(), post: vi.fn(), dbFrom: vi.fn(), rpc: vi.fn(), invoke: vi.fn(), from: vi.fn(), sign: vi.fn(), download: vi.fn() }));
vi.mock("@/api/client", () => ({
  isApiEnabled: () => calls.apiMode,
  apiGet: calls.get,
  apiPost: calls.post,
  apiDownloadFile: vi.fn(),
  saveFileBlob: calls.download,
}));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: calls.tenantId }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: calls.dbFrom, rpc: calls.rpc, functions: { invoke: calls.invoke }, storage: { from: calls.from } },
}));

const pdf = "%PDF-1.7\noriginal\n%%EOF\n";
const edition: IssuedDocument = {
  id: "edition-a", tenant_id: "tenant-a", ar_invoice_id: "invoice-a", template_version_id: "version-a",
  context: {}, context_sha256: "d".repeat(64), reference: "FAC-1-001", status: "ready",
  storage_path: "tenant-a/issued/edition-a.pdf", pdf_sha256: createHash("sha256").update(pdf).digest("hex"),
  renderer: "gotenberg", renderer_version: "9.2", created_by: "user-a", created_at: "2026-11-20T11:00:00Z",
  started_at: "2026-11-20T11:00:01Z", finished_at: "2026-11-20T11:00:03Z", error: null,
  replaces_id: null, replacement_reason: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  calls.apiMode = false;
  calls.tenantId = "tenant-a";
  calls.from.mockReturnValue({ createSignedUrl: calls.sign });
  calls.sign.mockResolvedValue({ data: { signedUrl: "https://storage.test/edition-a" }, error: null });
  vi.stubGlobal("crypto", webcrypto);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("downloads the original PDF only after checking the 60-second signed copy", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(pdf));
  vi.stubGlobal("fetch", fetch);
  await downloadDocumentEdition(edition);
  expect(calls.from).toHaveBeenCalledWith("issued-documents");
  expect(calls.sign).toHaveBeenCalledWith("tenant-a/issued/edition-a.pdf", 60);
  expect(fetch).toHaveBeenCalledWith("https://storage.test/edition-a", { cache: "no-store" });
  expect(calls.download).toHaveBeenCalledWith(expect.objectContaining({ type: "application/pdf", size: 24 }), "FAC-1-001.pdf");
});

it("rejects altered PDF bytes and never offers them as the archived file", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(pdf.replace("original", "altéré"))));
  await expect(downloadDocumentEdition(edition)).rejects.toThrow(/intégrité/i);
  expect(calls.download).not.toHaveBeenCalled();
});

it("rejects a streamed storage response over 25 MiB even without a declared content length", async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(25 * 1024 * 1024 + 1));
    controller.close();
  } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  await expect(downloadDocumentEdition(edition)).rejects.toThrow(/25 Mio/);
  expect(calls.download).not.toHaveBeenCalled();
});

it("refreshes an active edition every second but stops at its polling deadline", async () => {
  calls.apiMode = true;
  const queued: IssuedDocument = { ...edition, status: "queued", started_at: null, finished_at: null };
  calls.get.mockResolvedValue([queued]);
  vi.useFakeTimers({ now: new Date("2026-11-20T11:00:00Z") });
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useDocumentEditions("invoice-a", 0), { wrapper });
  await act(() => vi.advanceTimersByTimeAsync(2));
  expect(result.current.data).toEqual([queued]);
  expect(calls.get).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(calls.get).toHaveBeenCalledTimes(2);
  await act(() => vi.advanceTimersByTimeAsync(66_000));
  const requests = calls.get.mock.calls.length;
  expect(requests).toBeGreaterThan(2);
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(calls.get).toHaveBeenCalledTimes(requests);
});

it("gives an explicitly retried edition a fresh window even when its creation timestamp is old", () => {
  const queued: IssuedDocument = { ...edition, status: "queued", started_at: null, finished_at: null };
  const retriedAt = Date.parse("2026-11-20T11:02:00Z");
  expect(canRetryDocumentEdition(queued, retriedAt)).toBe(true);
  expect(canRetryDocumentEdition(queued, retriedAt + 1_000, retriedAt)).toBe(false);
  expect(canRetryDocumentEdition(queued, retriedAt + 61_000, retriedAt)).toBe(true);
});

function queryWrapper() {
  const client = new QueryClient();
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}

it("separates PO and invoice models in the cache and reloads models when the tenant changes", async () => {
  calls.apiMode = true;
  calls.get.mockImplementation((path: string) => Promise.resolve(path.includes("purchase_order") ? [{ id: `po-${calls.tenantId}` }] : [{ id: "invoice-model" }]));
  const { wrapper } = queryWrapper();
  const { result, rerender } = renderHook(({ po }) => useDocumentTemplates(true, po ? "purchase_order" : "ar_invoice"), { wrapper, initialProps: { po: false } });
  await waitFor(() => expect(result.current.data).toEqual([{ id: "invoice-model" }]));
  rerender({ po: true });
  await waitFor(() => expect(result.current.data).toEqual([{ id: "po-tenant-a" }]));
  calls.tenantId = "tenant-b";
  rerender({ po: true });
  await waitFor(() => expect(result.current.data).toEqual([{ id: "po-tenant-b" }]));
  expect(calls.get.mock.calls.map(([path]) => path)).toEqual([
    "/api/v1/document-templates", "/api/v1/document-templates?docType=purchase_order", "/api/v1/document-templates?docType=purchase_order",
  ]);
});

it("scopes Supabase PO template and edition reads to the current tenant and source column", async () => {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  calls.dbFrom.mockReturnValue(query);
  const { wrapper } = queryWrapper();
  const { result } = renderHook(() => ({ models: useDocumentTemplates(true, "purchase_order"), editions: useDocumentEditions("po-a", 0, "purchase_order") }), { wrapper });
  await waitFor(() => expect(result.current.models.isSuccess && result.current.editions.isSuccess).toBe(true));
  expect(calls.dbFrom).toHaveBeenCalledWith("document_templates");
  expect(calls.dbFrom).toHaveBeenCalledWith("issued_documents");
  expect(query.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
  expect(query.eq).toHaveBeenCalledWith("doc_type", "purchase_order");
  expect(query.eq).toHaveBeenCalledWith("po_id", "po-a");
  expect(query.eq).not.toHaveBeenCalledWith("ar_invoice_id", "po-a");
});

it("requests PO archives with poId and sends only the PO source to document-render", async () => {
  calls.apiMode = true;
  calls.get.mockResolvedValue([]);
  calls.post.mockResolvedValue({ ...edition, ar_invoice_id: null, po_id: "po/a" });
  calls.invoke.mockResolvedValue({ data: { ...edition, ar_invoice_id: null, po_id: "po/a" }, error: null });
  const { wrapper } = queryWrapper();
  const { result } = renderHook(() => ({ editions: useDocumentEditions("po/a", 0, "purchase_order"), request: useRequestDocumentEdition("po/a", "purchase_order") }), { wrapper });
  await waitFor(() => expect(result.current.editions.isSuccess).toBe(true));
  expect(calls.get).toHaveBeenCalledWith("/api/v1/document-editions?poId=po%2Fa");
  await act(() => result.current.request.mutateAsync({ po_id: "po/a", template_id: "po-model" }));
  expect(calls.post).toHaveBeenCalledWith("/api/v1/document-editions", { po_id: "po/a", template_id: "po-model" });
  calls.apiMode = false;
  await act(() => result.current.request.mutateAsync({ po_id: "po/a" }));
  expect(calls.invoke).toHaveBeenCalledWith("document-render", { body: { po_id: "po/a" } });
});

it("installs the tenant PO defaults explicitly and refreshes its PO models", async () => {
  calls.apiMode = true;
  let installed = false;
  calls.get.mockImplementation(() => Promise.resolve(installed ? [{ id: "standard" }, { id: "landscape" }] : []));
  calls.post.mockImplementation(() => { installed = true; return Promise.resolve([{ id: "standard" }, { id: "landscape" }]); });
  const { wrapper } = queryWrapper();
  const { result } = renderHook(() => ({ models: useDocumentTemplates(true, "purchase_order"), install: useInstallPurchaseOrderTemplates() }), { wrapper });
  await waitFor(() => expect(result.current.models.data).toEqual([]));
  expect(calls.post).not.toHaveBeenCalled();
  await act(() => result.current.install.mutateAsync());
  await waitFor(() => expect(result.current.models.data).toEqual([{ id: "standard" }, { id: "landscape" }]));
  expect(calls.post).toHaveBeenCalledWith("/api/v1/document-templates/purchase-orders/defaults", {});
  calls.apiMode = false;
  calls.rpc.mockResolvedValue({ data: [], error: null });
  await act(() => result.current.install.mutateAsync());
  expect(calls.rpc).toHaveBeenCalledWith("install_purchase_order_templates");
});

it("keeps the four-argument template RPC and carries PO presentation inside the layout", async () => {
  calls.rpc.mockResolvedValue({ data: {}, error: null });
  const { wrapper } = queryWrapper();
  const { result } = renderHook(() => useSaveDocumentTemplate(), { wrapper });
  const layout = { title: "Bon de commande", intro: "", footer: "", accent_color: "#17324d", font_size: 10, doc_type: "purchase_order" as const, preset: "reference-PO0004821" as const };
  await act(() => result.current.mutateAsync({ name: "PO paysage", layout, reason: "Création" }));
  expect(calls.rpc).toHaveBeenCalledWith("save_document_template", { _id: null, _name: "PO paysage", _layout: layout, _reason: "Création" });
});

it("exposes PO model failures without automatic recovery requests", async () => {
  calls.apiMode = true;
  calls.get.mockRejectedValue(new Error("Modèles indisponibles"));
  const { wrapper } = queryWrapper();
  const { result } = renderHook(() => useDocumentTemplates(true, "purchase_order"), { wrapper });
  await waitFor(() => expect(result.current.error?.message).toBe("Modèles indisponibles"));
  expect(calls.get).toHaveBeenCalledTimes(1);
});
