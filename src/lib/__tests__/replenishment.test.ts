import { describe, expect, it } from "vitest";
import { replenishmentQuantity, validateRule } from "@/lib/replenishment";

describe("réapprovisionnement", () => {
  it("rien au-dessus du point de commande", () => {
    expect(replenishmentQuantity({ method: "min_max", projected: 11, reorderPoint: 10, orderQty: 0, maxQty: 50 })).toBe(0);
  });
  it("min / max : remonter au maximum, arrondi au multiple (comme la base : 50 − 10 = 40 → 48)", () => {
    expect(replenishmentQuantity({ method: "min_max", projected: 10, reorderPoint: 10, orderQty: 0, maxQty: 50, multiple: 12 })).toBe(48);
  });
  it("point de commande : quantité fixe, relevée au minimum du fournisseur", () => {
    expect(replenishmentQuantity({ method: "reorder_point", projected: 2, reorderPoint: 5, orderQty: 10, maxQty: 0, minOrder: 24 })).toBe(24);
  });
  it("contrôles de saisie", () => {
    const ok = { itemId: "i", method: "min_max" as const, reorderPoint: 10, safetyStock: 3, orderQty: 0, maxQty: 50 };
    expect(validateRule(ok)).toBeNull();
    expect(validateRule({ ...ok, itemId: "" })).toMatch(/article/);
    expect(validateRule({ ...ok, safetyStock: 11 })).toMatch(/sécurité/);
    expect(validateRule({ ...ok, maxQty: 10 })).toMatch(/maximum/);
    expect(validateRule({ ...ok, method: "reorder_point", orderQty: 0 })).toMatch(/quantité à commander/);
  });
});
