import { describe, expect, it } from "vitest";
import { defaultNormalBalance, validateCustomAttributes, type AttributeDefinition } from "@/lib/gl-account";

const def = (p: Partial<AttributeDefinition>): AttributeDefinition =>
  ({ id: "1", key: "k", label: "Rubrique", data_type: "text", options: null, required: false, is_active: true, ...p });

describe("attributs de compte", () => {
  it("sens normal déduit du type", () => {
    expect(defaultNormalBalance("asset")).toBe("debit");
    expect(defaultNormalBalance("expense")).toBe("debit");
    expect(defaultNormalBalance("revenue")).toBe("credit");
    expect(defaultNormalBalance("liability")).toBe("credit");
  });
  it("attributs personnalisés : obligatoire, liste, nombre ; regroupement dispensé", () => {
    const list = def({ data_type: "list", options: ["a", "b"], required: true });
    expect(validateCustomAttributes([list], {})).toMatch(/obligatoire/);
    expect(validateCustomAttributes([list], {}, true)).toBeNull();
    expect(validateCustomAttributes([list], { k: "c" })).toMatch(/hors liste/);
    expect(validateCustomAttributes([list], { k: "a" })).toBeNull();
    expect(validateCustomAttributes([def({ data_type: "number" })], { k: "12" })).toMatch(/nombre/);
    expect(validateCustomAttributes([def({ required: true, is_active: false })], {})).toBeNull();
  });
});
