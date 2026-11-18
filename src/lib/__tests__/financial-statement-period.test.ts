import { describe, expect, it } from "vitest";
import { combineStatementComparison, fiscalYearStartDate, shiftStatementDate } from "@/lib/financial-statement-period";

describe("shiftStatementDate", () => {
  it("keeps the same month and day for a comparable year", () => {
    expect(shiftStatementDate("2026-11-15", -1)).toBe("2025-11-15");
  });

  it("clamps leap day to the last day of February in a non-leap year", () => {
    expect(shiftStatementDate("2024-02-29", -1)).toBe("2023-02-28");
  });

  it("leaves malformed input unchanged for UI validation", () => {
    expect(shiftStatementDate("not-a-date", -1)).toBe("not-a-date");
  });
});

describe("combineStatementComparison", () => {
  const current = [{ line_code: "TA", label: "Ventes", amount: 100 }, { line_code: "RA", label: "Achats", amount: 25 }];

  it("matches amounts by report line when comparative ledger history exists", () => {
    const result = combineStatementComparison(current, [{ line_code: "TA", label: "Ventes", amount: 80 }], true);
    expect(result.map((line) => line.amount_prior)).toEqual([80, 0]);
  });

  it("keeps the whole prior column unavailable when there is no history", () => {
    const result = combineStatementComparison(current, [{ line_code: "TA", label: "Ventes", amount: 80 }], false);
    expect(result.map((line) => line.amount_prior)).toEqual([null, null]);
  });
});

describe("fiscalYearStartDate", () => {
  it("uses the configured non-calendar fiscal year", () => {
    expect(fiscalYearStartDate("2026-03-15", 7)).toBe("2025-07-01");
  });

  it("starts this year when the configured start month has passed", () => {
    expect(fiscalYearStartDate("2026-11-15", 7)).toBe("2026-07-01");
  });
});
