import { describe, expect, it } from "vitest";
import { documentFooter, emptyDocLine, toLines, validateDocLines } from "../document-lines";

describe("lignes et pied d'une pièce d'achat", () => {
  it("calcule le pied à partir des lignes, en ignorant les lignes vides", () => {
    const lignes = [
      { description: "Portable", quantity: "3", unitPrice: "450 000" },
      { description: "Souris", quantity: "2,5", unitPrice: "1000,4" },
      emptyDocLine(),
    ];
    expect(documentFooter(lignes)).toEqual({ lineCount: 2, totalQuantity: 5.5, total: 1352501 });
    expect(toLines(lignes)).toEqual([
      { description: "Portable", quantity: 3, unitPrice: 450000 },
      { description: "Souris", quantity: 2.5, unitPrice: 1000.4 },
    ]);
  });

  it("refuse une pièce sans ligne, un libellé manquant, une quantité ou un prix invalide", () => {
    expect(validateDocLines([emptyDocLine()])).toMatch(/au moins une ligne/);
    expect(validateDocLines([{ description: "", quantity: "1", unitPrice: "10" }])).toMatch(/libellé/);
    expect(validateDocLines([{ description: "A", quantity: "0", unitPrice: "10" }])).toMatch(/quantité/);
    expect(validateDocLines([{ description: "A", quantity: "1", unitPrice: "" }])).toMatch(/prix/);
    expect(validateDocLines([{ description: "A", quantity: "1", unitPrice: "0" }, emptyDocLine()])).toBeNull();
  });
});
