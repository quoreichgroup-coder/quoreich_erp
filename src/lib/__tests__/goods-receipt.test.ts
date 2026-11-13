import { describe, expect, it } from "vitest";
import { isReceivable, linesToReceive, validateReceipt } from "../goods-receipt";

const lignes = [
  { id: "l1", description: "Portable", quantity: 10, unit_cost: 1000 },
  { id: "l2", description: "Souris", quantity: 5, unit_cost: 50 },
];

describe("réception de marchandises", () => {
  it("ne compte que les réceptions validées de la commande", () => {
    const r = linesToReceive("po1", lignes, [
      { po_id: "po1", status: "completed", lines: [{ po_line_id: "l1", quantity_received: 4 }] },
      { po_id: "po1", status: "pending", lines: [{ po_line_id: "l1", quantity_received: 6 }] },
      { po_id: "po2", status: "completed", lines: [{ po_line_id: "l2", quantity_received: 5 }] },
    ]);
    expect(r.map((l) => [l.id, l.received, l.remaining])).toEqual([["l1", 4, 6], ["l2", 0, 5]]);
  });

  it("refuse la sur-réception, les quantités négatives et la saisie vide", () => {
    expect(validateReceipt([{ po_line_id: "l1", quantity: 7, remaining: 6 }])).toMatch(/Sur-réception/);
    expect(validateReceipt([{ po_line_id: "l1", quantity: -1, remaining: 6 }])).toMatch(/positives/);
    expect(validateReceipt([{ po_line_id: "l1", quantity: 0, remaining: 6 }])).toMatch(/au moins une/);
    expect(validateReceipt([{ po_line_id: "l1", quantity: 6, remaining: 6 }, { po_line_id: "l2", quantity: 0, remaining: 5 }])).toBeNull();
  });

  it("réceptionne une commande approuvée, commandée ou partiellement reçue", () => {
    expect(["draft", "approved", "ordered", "partially_received", "received"].filter(isReceivable))
      .toEqual(["approved", "ordered", "partially_received"]);
  });
});
