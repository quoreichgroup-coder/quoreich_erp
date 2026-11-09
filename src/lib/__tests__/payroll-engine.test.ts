import { describe, it, expect } from "vitest";
import {
  computePayrollLine,
  aggregatePayroll,
  buildJournalPreview,
  canMutatePayrollRun,
  canDeletePayrollRun,
  CNPS_EMPLOYEE_RATE,
  IRPP_RATE,
  EMPLOYER_CHARGES_RATE,
} from "@/lib/payroll-engine";

describe("compute_payroll_line (TS mirror)", () => {
  it("returns zeros for null / negative base salary", () => {
    expect(computePayrollLine(0)).toEqual({ gross: 0, deductions: 0, taxes: 0, net: 0 });
    expect(computePayrollLine(-1000)).toEqual({ gross: 0, deductions: 0, taxes: 0, net: 0 });
  });

  it("applies CNPS 6.3% and IRPP 10% on net of CNPS", () => {
    const r = computePayrollLine(500_000);
    expect(r.gross).toBe(500_000);
    expect(r.deductions).toBeCloseTo(500_000 * CNPS_EMPLOYEE_RATE, 2);
    expect(r.taxes).toBeCloseTo((500_000 - 500_000 * CNPS_EMPLOYEE_RATE) * IRPP_RATE, 2);
    expect(r.net).toBeCloseTo(r.gross - r.deductions - r.taxes, 2);
  });

  it("rounds to 2 decimals", () => {
    const r = computePayrollLine(123_456.789);
    expect(Number.isInteger(r.gross * 100)).toBe(true);
    expect(Number.isInteger(r.net * 100)).toBe(true);
  });
});

describe("generate_payroll_lines aggregation (TS mirror)", () => {
  it("sums totals across employees", () => {
    const lines = [computePayrollLine(300_000), computePayrollLine(450_000), computePayrollLine(120_000)];
    const agg = aggregatePayroll(lines);
    expect(agg.gross).toBeCloseTo(870_000, 2);
    expect(agg.employerCharges).toBeCloseTo(870_000 * EMPLOYER_CHARGES_RATE, 2);
    expect(agg.net).toBeCloseTo(lines.reduce((s, l) => s + l.net, 0), 2);
  });

  it("handles empty employee list", () => {
    const agg = aggregatePayroll([]);
    expect(agg).toEqual({ gross: 0, deductions: 0, taxes: 0, net: 0, employerCharges: 0 });
  });
});

describe("Journal entry preview (post_payroll_run mirror)", () => {
  it("is balanced when all SYSCOHADA accounts are mapped", () => {
    const lines = [computePayrollLine(500_000), computePayrollLine(300_000)];
    const je = buildJournalPreview(lines);
    expect(je.balanced).toBe(true);
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
  });

  it("falls back to Personnel account when CNPS missing and stays balanced", () => {
    const lines = [computePayrollLine(400_000)];
    const je = buildJournalPreview(lines, { hasCnpsAccount: false, hasTaxAccount: false });
    expect(je.balanced).toBe(true);
    expect(je.lines.find((l) => l.account === "4310")).toBeUndefined();
    expect(je.lines.find((l) => l.account === "4470")).toBeUndefined();
  });

  it("merges employer charges into 6610 when 6630 missing", () => {
    const lines = [computePayrollLine(1_000_000)];
    const je = buildJournalPreview(lines, { hasEmployerChargesAccount: false });
    expect(je.lines.find((l) => l.account === "6630")).toBeUndefined();
    expect(je.balanced).toBe(true);
  });

  it("produces zero debit / credit on empty payroll", () => {
    const je = buildJournalPreview([]);
    expect(je.totalDebit).toBe(0);
    expect(je.totalCredit).toBe(0);
    expect(je.balanced).toBe(true);
  });
});

describe("guard_payroll_run_lock (TS mirror)", () => {
  it("blocks moving away from posted", () => {
    expect(canMutatePayrollRun("posted", "draft").ok).toBe(false);
    expect(canMutatePayrollRun("posted", "approved").ok).toBe(false);
  });

  it("allows transitions within open statuses", () => {
    expect(canMutatePayrollRun("draft", "approved").ok).toBe(true);
    expect(canMutatePayrollRun("approved", "posted").ok).toBe(true);
  });

  it("forbids delete on posted, allows on draft/approved", () => {
    expect(canDeletePayrollRun("posted").ok).toBe(false);
    expect(canDeletePayrollRun("draft").ok).toBe(true);
    expect(canDeletePayrollRun("approved").ok).toBe(true);
  });
});
