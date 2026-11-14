import { describe, expect, it } from "vitest";
import { creditNoteRoom, creditTax, returnableLines, returnValue, validateSupplierReturn } from "@/lib/supplier-return";
import { linesToReceive } from "@/lib/goods-receipt";

describe("retour fournisseur", () => {
  const grLines = [
    { id: "g1", po_line_id: "p1", quantity_received: 10 },
    { id: "g2", po_line_id: "p2", quantity_received: 0 },
  ];
  const poLines = [{ id: "p1", description: "Ciment", unit_cost: 2000 }, { id: "p2", description: "Sable", unit_cost: 500 }];

  it("retournable = reçu − déjà retourné ; lignes non reçues ignorées", () => {
    const l = returnableLines(grLines, poLines, [{ gr_line_id: "g1", po_line_id: "p1", quantity: 3, replacement_expected: false }]);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ description: "Ciment", unit_cost: 2000, returned: 3, returnable: 7 });
  });

  it("contrôles : motif, sur-retour, au moins une quantité", () => {
    const e = [{ quantity: 2, returnable: 7, description: "Ciment" }];
    expect(validateSupplierReturn(e, " ")).toMatch(/motif/);
    expect(validateSupplierReturn([{ ...e[0], quantity: 8 }], "Casse")).toMatch(/7 retournable/);
    expect(validateSupplierReturn([{ ...e[0], quantity: 0 }], "Casse")).toMatch(/au moins/);
    expect(validateSupplierReturn(e, "Casse")).toBeNull();
  });

  it("valeur au coût de commande, TVA au taux de la facture, plafonds d'avoir", () => {
    expect(returnValue([{ quantity: 3, unit_cost: 2000 }, { quantity: 1, unit_cost: 333.333 }])).toBe(6333.33);
    expect(creditTax(6000, { subtotal: 20000, tax_amount: 3600 })).toBe(1080);
    expect(creditTax(6000, { subtotal: 0, tax_amount: 0 })).toBe(0);
    expect(creditNoteRoom({ subtotal: 20000, tax_amount: 3600 }, [{ subtotal: 6000, tax_amount: 1080 }])).toEqual({ subtotal: 14000, tax: 2520 });
  });

  it("réception : un retour avec remplacement redevient à recevoir, pas un retour sans remplacement", () => {
    const receipts = [{ po_id: "po", status: "completed", lines: [{ po_line_id: "p1", quantity_received: 5 }] }];
    const lines = [{ id: "p1", description: "Ciment", quantity: 5, unit_cost: 1000 }];
    const returns = [
      { po_line_id: "p1", quantity: 2, replacement_expected: true },
      { po_line_id: "p1", quantity: 1, replacement_expected: false },
    ];
    expect(linesToReceive("po", lines, receipts, returns)[0]).toMatchObject({ received: 3, remaining: 2 });
    expect(linesToReceive("po", lines, receipts)[0]).toMatchObject({ received: 5, remaining: 0 });
  });
});
