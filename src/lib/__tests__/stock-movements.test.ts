import { describe, expect, it } from "vitest";
import { movementLabel, movementsOfTab, validateAdjustment } from "@/lib/stock-movements";

describe("mouvements de stock", () => {
  const rows = [{ movement_type: "receipt" }, { movement_type: "transfer_out" }, { movement_type: "transfer_in" }, { movement_type: "adjustment" }];

  it("libellés français, écart d'inventaire distingué", () => {
    expect(movementLabel("supplier_return")).toBe("Retour fournisseur");
    expect(movementLabel("adjustment", "inventory_count")).toBe("Écart d'inventaire");
    expect(movementLabel("inconnu")).toBe("inconnu");
  });

  it("onglets : tout, transferts, ajustements", () => {
    expect(movementsOfTab(rows, "movements")).toHaveLength(4);
    expect(movementsOfTab(rows, "transfers")).toHaveLength(2);
    expect(movementsOfTab(rows, "adjustments")).toHaveLength(1);
  });

  it("ajustement : article, quantité non nulle, motif, manquant ≤ stock", () => {
    const ok = { itemId: "i", quantity: -2, reason: "Casse" };
    expect(validateAdjustment({ ...ok, itemId: "" }, 10)).toMatch(/article/);
    expect(validateAdjustment({ ...ok, quantity: 0 }, 10)).toMatch(/quantité/);
    expect(validateAdjustment({ ...ok, reason: " " }, 10)).toMatch(/motif/);
    expect(validateAdjustment({ ...ok, quantity: -11 }, 10)).toMatch(/supérieur au stock/);
    expect(validateAdjustment(ok, 10)).toBeNull();
  });
});
