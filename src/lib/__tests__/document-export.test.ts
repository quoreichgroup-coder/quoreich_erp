import { describe, expect, it } from "vitest";
import { currencyWords, documentXlsxBytes, type DocumentPdf } from "@/lib/document-pdf";
import { titleFromFilename } from "@/lib/table-export";

const piece: DocumentPdf = {
  title: "Facture FA-2026-0001",
  fileName: "facture-fa-2026-0001",
  company: { name: "Société test", legal_name: "SOCIÉTÉ TEST SARL", rccm: "BF-OUA-2026-B-1", tax_id: "00012345A" } as DocumentPdf["company"],
  header: [["Client", "Client & fils"], ["Échéance", "2026-12-31"]],
  columns: [{ label: "Libellé" }, { label: "Quantité", align: "right" }, { label: "Montant HT", align: "right" }],
  rows: [["Prestation <conseil>", "2", "150 000"], ["Frais", "1", "12 500,5"]],
  footer: [["Total HT", "162 500,5"], ["Total TTC", "191 750,59", true]],
  signatures: ["Le client", "La société"],
};

// Le paquet n'est pas compressé (méthode « stockée ») : la feuille se lit en texte dans les octets.
const sheetXml = (bytes: Uint8Array) => {
  const text = new TextDecoder().decode(bytes);
  const start = text.indexOf("<worksheet");
  return text.slice(start, text.indexOf("</worksheet>", start) + 12);
};

describe("pièce en Excel", () => {
  const xml = sheetXml(documentXlsxBytes(piece));

  it("reprend l'identité de la société, le titre, l'en-tête, les lignes, les totaux et les signatures", () => {
    for (const t of ["SOCIÉTÉ TEST SARL", "RCCM : BF-OUA-2026-B-1", "FACTURE FA-2026-0001", "Client &amp; fils", "Prestation &lt;conseil&gt;",
      "Total TTC", "Le client : ________________"]) expect(xml).toContain(t);
  });

  it("garde les montants en nombres (virgule décimale française relue)", () => {
    expect(xml).toContain("<v>150000</v>");
    expect(xml).toContain("<v>12500.5</v>");
    expect(xml).toContain("<v>191750.59</v>");
    // Le total en gras utilise le style nombre gras.
    expect(xml).toMatch(/s="4"><v>191750\.59<\/v>/);
  });

  it("ne pose pas de filtre automatique sur une pièce", () => {
    expect(xml).not.toContain("autoFilter");
  });
});

describe("libellés d'export", () => {
  it("titre lisible tiré du nom de fichier", () => {
    expect(titleFromFilename("mouvements-de-stock.csv")).toBe("Mouvements de stock");
    expect(titleFromFilename("")).toBe("Liste");
  });

  it("devise du montant en lettres", () => {
    expect(currencyWords("XOF")).toBe("francs CFA");
    expect(currencyWords(null)).toBe("francs CFA");
    expect(currencyWords("eur")).toBe("euros");
    expect(currencyWords("JPY")).toBe("JPY");
  });
});

describe("texte imprimable en PDF", () => {
  it("remplace les espaces insécables du format français et les signes absents de la police", async () => {
    const { pdfSafe } = await import("@/lib/pdf-export");
    expect(pdfSafe((125000).toLocaleString("fr-FR"))).toBe("125 000");
    expect(pdfSafe("2026-01 → 2026-03 − 5 ≤ 6")).toBe("2026-01 -> 2026-03 - 5 <= 6");
  });
});

describe("dates imprimées", () => {
  it("date ISO au format français, autre texte inchangé", async () => {
    const { dateFr } = await import("@/lib/document-pdf");
    expect(dateFr("2026-11-14")).toBe("14/11/2026");
    expect(dateFr("2026-11")).toBe("2026-11");
    expect(dateFr("FA-2026-0001")).toBe("FA-2026-0001");
  });
});
