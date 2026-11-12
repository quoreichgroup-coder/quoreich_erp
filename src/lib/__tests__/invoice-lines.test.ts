import { describe, expect, it } from "vitest";
import { invoiceTotals, lineAmounts, round2, type TaxCode } from "../invoice-lines";

const tva18: TaxCode = { id: "t18", code: "TVA18", name: "TVA 18 %", rate: 18, active: true };
const line = (over: Partial<Parameters<typeof lineAmounts>[0]> = {}) => ({
  description: "Article", quantity: "1", unitPrice: "100", discountPct: "", taxCodeId: "", ...over,
});

describe("lignes de facture — même calcul que la base", () => {
  it("arrondit comme ROUND(numeric, 2) : moitié loin de zéro, sans dérive flottante", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.125)).toBe(0.13);
    expect(round2(59.9994)).toBe(60);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(-1.005)).toBe(-1.01);
  });

  it("HT = quantité × prix × (1 − remise), TVA arrondie à la ligne", () => {
    expect(lineAmounts(line({ quantity: "2", unitPrice: "500", discountPct: "10", taxCodeId: "t18" }), [tva18]))
      .toEqual({ net: 900, tax: 162, valid: true });
    expect(lineAmounts(line({ unitPrice: "333,33", taxCodeId: "t18" }), [tva18])).toEqual({ net: 333.33, tax: 60, valid: true });
  });

  it("une ligne incomplète ou hors bornes n'est pas valide et ne compte pas", () => {
    for (const bad of [{ description: " " }, { quantity: "0" }, { unitPrice: "-1" }, { discountPct: "101" }, { quantity: "abc" }]) {
      expect(lineAmounts(line(bad), [tva18]).valid).toBe(false);
    }
  });

  it("totaux = somme des lignes arrondies, comme l'en-tête recalculé par la base", () => {
    const t = invoiceTotals([
      line({ quantity: "2", unitPrice: "500", discountPct: "10", taxCodeId: "t18" }),
      line({ unitPrice: "333.33", taxCodeId: "t18" }),
      line({ unitPrice: "100" }),
    ], [tva18]);
    expect(t).toMatchObject({ subtotal: 1333.33, tax: 222, total: 1555.33, allValid: true });
    expect(invoiceTotals([], [tva18]).allValid).toBe(false);
  });
});
