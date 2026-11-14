import { describe, expect, it } from "vitest";
import { bankStatus, validateSupplier } from "@/lib/supplier";

describe("fiche fournisseur", () => {
  const ok = { name: "Alpha", country: "BF", currency: "XOF", bank_swift: "ECOCBFBF", lead_time_days: 5, payment_terms: 30, email: null };
  it("contrôles de saisie", () => {
    expect(validateSupplier(ok)).toBeNull();
    expect(validateSupplier({ ...ok, name: "" })).toMatch(/nom/);
    expect(validateSupplier({ ...ok, country: "BFA" })).toMatch(/ISO/);
    expect(validateSupplier({ ...ok, currency: "FCFA" })).toMatch(/Devise/);
    expect(validateSupplier({ ...ok, bank_swift: "ECO" })).toMatch(/BIC/);
    expect(validateSupplier({ ...ok, email: "pas-un-mail" })).toMatch(/e-mail/);
  });
  it("double contrôle : sans compte, à valider, validé", () => {
    expect(bankStatus({ bank_account: null })).toBe("none");
    expect(bankStatus({ bank_account: "BF01", bank_verified: false })).toBe("pending");
    expect(bankStatus({ bank_account: "BF01", bank_verified: true })).toBe("verified");
  });
});
