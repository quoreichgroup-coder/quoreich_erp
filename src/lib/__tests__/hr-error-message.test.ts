import { describe, expect, it } from "vitest";
import { hrErrorMessage } from "@/lib/hr-error-message";

describe("hrErrorMessage", () => {
  it("retains PostgREST message, SQLSTATE, and hint", () => {
    expect(hrErrorMessage({ message: "duplicate key", code: "23505", hint: "Choose another value" }))
      .toBe("duplicate key (23505) — Choose another value");
  });

  it("explains missing RH RPCs and database permission errors", () => {
    expect(hrErrorMessage({ code: "PGRST202", message: "Could not find public.list_hr_payroll_components" }))
      .toBe("RPC non trouvée par Supabase Data API : vérifier que V84 (rubriques de paie) et les migrations RH/Paie dépendantes sont appliquées, puis recharger son schéma si nécessaire.");
    expect(hrErrorMessage({ code: "42501", message: "permission denied" }))
      .toContain("rôle central");
  });

  it("accepts normal errors and ignores empty error shapes", () => {
    expect(hrErrorMessage(new Error("offline"))).toBe("offline");
    expect(hrErrorMessage({ code: "42501" })).toBeNull();
    expect(hrErrorMessage(null)).toBeNull();
  });
});
