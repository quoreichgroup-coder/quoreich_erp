import { describe, expect, it } from "vitest";
import { validatePayrollRunInput, validatePayrollReportRange } from "@/lib/hr-periods";

describe("validatePayrollRunInput", () => {
  it("accepts a real calendar month and payment date", () => {
    expect(validatePayrollRunInput("2026-02", "2026-03-05")).toBeNull();
  });

  it("rejects impossible months and malformed payment dates", () => {
    expect(validatePayrollRunInput("2026-13", "2026-12-31")).toBe("Période invalide (AAAA-MM).");
    expect(validatePayrollRunInput("2026-02", "2026-02-30")).toBe("Date de paie invalide.");
  });
});

describe("validatePayrollReportRange", () => {
  it("rejects malformed or reversed report ranges", () => {
    expect(validatePayrollReportRange("2026-02", "2026-01")).toBe("La période de début doit précéder ou égaler la période de fin.");
    expect(validatePayrollReportRange("2026-1", "2026-12")).toBe("Périodes invalides (AAAA-MM).");
  });
});
