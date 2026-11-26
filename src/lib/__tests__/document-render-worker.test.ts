import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { editionRequestRpc, parseEditionRequest, renderEdition, type EditionWorker } from "../../../supabase/functions/document-render/worker";

const ID = "00000000-0000-0000-0000-000000000141";
const TENANT = "33333333-3333-3333-3333-333333333141";
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
const pdf = new TextEncoder().encode("%PDF-1.7\narchived edition\n%%EOF");
function worker(existing: Uint8Array | null = null): EditionWorker {
  return {
    claim: vi.fn().mockResolvedValue({ id: ID, tenant_id: TENANT, storage_path: `${TENANT}/issued/${ID}.pdf`, html: "<!doctype html><html><body>Facture</body></html>" }),
    complete: vi.fn().mockResolvedValue(undefined), fail: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(existing), write: vi.fn().mockResolvedValue("created"),
    rendererUrl: "http://127.0.0.1:3000", rendererVersion: "9.2.0",
    fetcher: vi.fn().mockResolvedValue(new Response(pdf, { headers: { "content-type": "application/pdf", "Gotenberg-Remediation-Residual": "0" } })),
  };
}

describe("archived document render worker", () => {
  it("accepte les sources en ES2020 et ignore les identifiants hérités du prototype", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object, "hasOwn");
    let purchaseOrder: ReturnType<typeof parseEditionRequest>;
    let invoice: ReturnType<typeof parseEditionRequest>;
    Object.defineProperty(Object, "hasOwn", { value: undefined, configurable: true, writable: true });
    try {
      purchaseOrder = parseEditionRequest({ po_id: ID });
      const input = Object.assign(Object.create({ po_id: TENANT }), { invoice_id: ID });
      invoice = parseEditionRequest(input);
    } finally {
      if (descriptor) Object.defineProperty(Object, "hasOwn", descriptor);
      else Reflect.deleteProperty(Object, "hasOwn");
    }
    expect(purchaseOrder).toEqual({ po_id: ID });
    expect(invoice).toEqual({ invoice_id: ID });
  });

  it("rejects extra fields, arbitrary HTML and paths at the request boundary", () => {
    expect(parseEditionRequest({ invoice_id: ID })).toEqual({ invoice_id: ID });
    expect(() => parseEditionRequest({ invoice_id: ID, html: "<script>" })).toThrow();
    expect(() => parseEditionRequest({ invoice_id: ID, storage_path: "other/issued/x" })).toThrow();
    expect(() => parseEditionRequest({ id: ID, invoice_id: ID })).toThrow();
    expect(() => parseEditionRequest({ invoice_id: "not-a-uuid" })).toThrow();
  });

  it("accepts a purchase order source and preserves template and motivated replacement choices", () => {
    expect(parseEditionRequest({ po_id: ID })).toEqual({ po_id: ID });
    expect(parseEditionRequest({ po_id: ID, template_id: TENANT, replace_id: ID, reason: " Correction " }))
      .toEqual({ po_id: ID, template_id: TENANT, replace_id: ID, reason: "Correction" });
  });

  it("rejects absent, ambiguous or malformed sources and mixed retry/create fields", () => {
    for (const input of [
      {}, { invoice_id: ID, po_id: ID }, { id: ID, po_id: ID }, { id: ID, template_id: TENANT },
      { po_id: "not-a-uuid" }, { po_id: null }, { po_id: ID, html: "<script>" },
      { po_id: ID, storage_path: "other/issued/x" }, { po_id: ID, replace_id: ID },
      { po_id: ID, replace_id: ID, reason: " " }, { po_id: ID, template_id: "invalid" },
    ]) expect(() => parseEditionRequest(input)).toThrow();
  });

  it("dispatches each source to its own RPC without changing retry and invoice contracts", () => {
    expect(editionRequestRpc(parseEditionRequest({ po_id: ID, template_id: TENANT, replace_id: ID, reason: "Correction" })))
      .toEqual({ name: "request_purchase_order_edition", params: { _po: ID, _template: TENANT, _replace: ID, _reason: "Correction" } });
    expect(editionRequestRpc(parseEditionRequest({ invoice_id: ID })))
      .toEqual({ name: "request_document_edition", params: { _invoice: ID, _template: null, _replace: null, _reason: null, _language: null } });
    // V155 : langue documentaire transmise à la base, qui la valide ; jamais pour un bon de commande.
    expect(editionRequestRpc(parseEditionRequest({ invoice_id: ID, language: "en" })).params).toMatchObject({ _language: "en" });
    for (const input of [{ invoice_id: ID, language: "EN" }, { invoice_id: ID, language: "en-GB" }, { invoice_id: ID, language: 1 },
      { po_id: ID, language: "en" }]) expect(() => parseEditionRequest(input)).toThrow();
    expect(editionRequestRpc(parseEditionRequest({ id: ID })))
      .toEqual({ name: "retry_document_edition", params: { _id: ID } });
  });

  it("archives the checked PDF once and completes with its actual hash", async () => {
    const w = worker();
    await renderEdition(ID, w);
    const [path, bytes] = vi.mocked(w.write).mock.calls[0];
    expect(path).toBe(`${TENANT}/issued/${ID}.pdf`);
    expect(Array.from(bytes)).toEqual(Array.from(pdf));
    expect(w.complete).toHaveBeenCalledWith(expect.objectContaining({
      path: `${TENANT}/issued/${ID}.pdf`, sha256: createHash("sha256").update(pdf).digest("hex"), renderer: "gotenberg", rendererVersion: "9.2.0",
    }));
    expect(w.fail).not.toHaveBeenCalled();
    const form = vi.mocked(w.fetcher!).mock.calls[0][1]!.body as FormData;
    expect(String(form.get("stages"))).toContain("PDF/A-2b");
    expect(JSON.parse(String(form.get("stages")))[0].language).toBe("fr"); // édition sans langue figée : français
  });

  it("declares the frozen document language in the PDF/A metadata", async () => {
    const w = worker();
    const claim = vi.mocked(w.claim);
    const job = await claim();
    claim.mockResolvedValueOnce({ ...job!, language: "en" });
    await renderEdition(ID, w);
    const form = vi.mocked(w.fetcher!).mock.calls[0][1]!.body as FormData;
    expect(JSON.parse(String(form.get("stages")))[0].language).toBe("en");
  });

  it("recovers its existing immutable file without another conversion or overwrite", async () => {
    const w = worker(pdf);
    await renderEdition(ID, w);
    expect(w.fetcher).not.toHaveBeenCalled();
    expect(w.write).not.toHaveBeenCalled();
    expect(w.complete).toHaveBeenCalledOnce();
  });

  it("does no work when another worker owns the claim", async () => {
    const w = worker(); vi.mocked(w.claim).mockResolvedValue(null);
    await renderEdition(ID, w);
    expect(w.fetcher).not.toHaveBeenCalled(); expect(w.complete).not.toHaveBeenCalled();
  });

  it("records an explicit failure for a missing renderer without inventing a PDF", async () => {
    const w = worker(); w.rendererUrl = "";
    await renderEdition(ID, w);
    expect(w.write).not.toHaveBeenCalled(); expect(w.complete).not.toHaveBeenCalled();
    expect(w.fail).toHaveBeenCalledWith(expect.stringMatching(/configur/i));
  });

  it("refuses non-PDF output and a PDF without a conformity proof", async () => {
    for (const response of [new Response("<html>failure</html>"), new Response(pdf, { headers: { "content-type": "application/pdf" } })]) {
      const w = worker(); vi.mocked(w.fetcher!).mockResolvedValue(response);
      await renderEdition(ID, w);
      expect(w.write).not.toHaveBeenCalled(); expect(w.complete).not.toHaveBeenCalled(); expect(w.fail).toHaveBeenCalledOnce();
    }
  });
});
