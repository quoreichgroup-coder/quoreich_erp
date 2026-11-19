import { describe, expect, it } from "vitest";
import { normalizeSetCode, resolveAccount } from "@/lib/account-sets";

describe("jeux de comptes (V105)", () => {
  it("code du jeu : majuscules, espaces en « _ », format de la base", () => {
    expect(normalizeSetCode(" clients groupe ")).toBe("CLIENTS_GROUPE");
    expect(normalizeSetCode("GROUPE-UEMOA")).toBe("GROUPE-UEMOA");
    expect(normalizeSetCode("é")).toBeNull();
    expect(normalizeSetCode("_X")).toBeNull();
    expect(normalizeSetCode("A".repeat(21))).toBeNull();
  });

  it("résolution comme la base : ligne du jeu, sinon défaut ; jeu inactif ignoré ; compte inactif = manquant", () => {
    const defaults = new Map([["AR_RECEIVABLE", "a411"], ["SALES_REVENUE", "a701"]]);
    const actifs = new Set(["a411", "a701", "a4111"]);
    const groupe = { is_active: true, lines: [{ role_code: "AR_RECEIVABLE", gl_account_id: "a4111" }] };
    expect(resolveAccount("AR_RECEIVABLE", groupe, defaults, actifs)).toEqual({ source: "set", accountId: "a4111" });
    expect(resolveAccount("SALES_REVENUE", groupe, defaults, actifs)).toEqual({ source: "default", accountId: "a701" });
    expect(resolveAccount("AR_RECEIVABLE", { ...groupe, is_active: false }, defaults, actifs)).toEqual({ source: "default", accountId: "a411" });
    expect(resolveAccount("AR_RECEIVABLE", groupe, defaults, new Set(["a411"]))).toEqual({ source: "set", accountId: null });
    expect(resolveAccount("AR_RECEIVABLE", null, defaults, actifs)).toEqual({ source: "default", accountId: "a411" });
  });
});
