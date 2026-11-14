import { describe, expect, it } from "vitest";
import { accountsForMethod, defaultAccountFor, kindForMethod, validateTreasuryAccount, type TreasuryAccount } from "@/lib/treasury-accounts";

const acc = (id: string, account_type: TreasuryAccount["account_type"], is_default = false, is_active = true): TreasuryAccount => ({
  id, name: id, bank_name: null, account_number: null, currency: "XOF", account_type, gl_account_id: "g", opening_balance: 0, opening_date: null,
  balance: 0, is_default, is_active, last_reconciled_at: null,
});

describe("comptes de trésorerie", () => {
  it("le mode de paiement désigne le type de compte", () => {
    expect(["bank_transfer", "check", "cash", "mobile_money"].map(kindForMethod)).toEqual(["bank", "bank", "cash", "mobile_money"]);
  });

  it("propose les comptes actifs du bon type, le défaut en premier", () => {
    const list = [acc("B2", "bank"), acc("B1", "bank", true), acc("C1", "cash", true), acc("B3", "bank", false, false)];
    expect(accountsForMethod(list, "bank_transfer").map((a) => a.id)).toEqual(["B1", "B2"]);
    expect(defaultAccountFor(list, "cash")).toBe("C1");
    expect(defaultAccountFor(list, "mobile_money")).toBe("");
  });

  it("contrôle la classe du compte comptable selon le type", () => {
    expect(validateTreasuryAccount({ name: "BOA", account_type: "bank", gl_code: "5211", currency: "XOF" })).toBeNull();
    expect(validateTreasuryAccount({ name: "Caisse", account_type: "cash", gl_code: "5211", currency: "XOF" })).toContain("57x");
    expect(validateTreasuryAccount({ name: "Wave", account_type: "mobile_money", gl_code: "552", currency: "XOF" })).toBeNull();
    expect(validateTreasuryAccount({ name: "BOA", account_type: "bank", gl_code: null, currency: "XOF" })).toContain("Compte comptable requis");
    expect(validateTreasuryAccount({ name: "BOA", account_type: "bank", gl_code: "521", currency: "xof" })).toContain("Devise");
  });
});
