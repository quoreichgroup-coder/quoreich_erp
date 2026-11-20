import { describe, expect, it } from "vitest";
import { attachmentPath, categoriesFor, formatSize, safeFileName, sha256Hex } from "../attachments";

describe("pièces jointes", () => {
  it("construit le chemin exigé par register_attachment, nom assaini", () => {
    expect(attachmentPath("t1", "ap_invoice", "d1", "Facture n° 12 (scan).pdf", "u1")).toBe("t1/ap_invoice/d1/u1-Facture_n_12_scan_.pdf");
    expect(safeFileName("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(safeFileName("x".repeat(120) + ".pdf")).toHaveLength(80);
  });
  it("calcule l'empreinte SHA-256", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("filtre les catégories par type de pièce et formate les tailles", () => {
    const cats = [{ doc_types: ["import_file"], is_active: true, c: "DOUANE" }, { doc_types: null, is_active: true, c: "AUTRE" }, { doc_types: null, is_active: false, c: "OFF" }];
    expect(categoriesFor(cats, "ap_invoice").map((c) => c.c)).toEqual(["AUTRE"]);
    expect(categoriesFor(cats, "import_file").map((c) => c.c)).toEqual(["DOUANE", "AUTRE"]);
    expect(formatSize(512)).toBe("512 o");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2,5 Mo");
  });
});
