import { describe, it, expect } from "vitest";
import {
  computePayrollLine,
  aggregatePayroll,
  buildJournalPreview,
  canMutatePayrollRun,
  canDeletePayrollRun,
  computeProgressiveIncomeTax,
  validatePayrollRules,
  type PayrollRules,
} from "@/lib/payroll-engine";

const fixtureRules: PayrollRules = {
  // Synthetic rates only: legal country rules must come from confirmed tenant settings.
  employeeSocialRate: 0.05,
  employerSocialRate: 0.12,
  taxBands: [{ upTo: null, rate: 0.1 }],
};

describe("compute_payroll_line (TS mirror)", () => {
  it("returns zeros for null / negative base salary", () => {
    expect(computePayrollLine(0, fixtureRules)).toEqual({ gross: 0, deductions: 0, taxes: 0, net: 0, employerCharges: 0 });
    expect(computePayrollLine(-1000, fixtureRules)).toEqual({ gross: 0, deductions: 0, taxes: 0, net: 0, employerCharges: 0 });
  });

  it("applies configured employee contributions and income tax on taxable salary", () => {
    const r = computePayrollLine(500_000, fixtureRules);
    expect(r.gross).toBe(500_000);
    expect(r.deductions).toBe(25_000);
    expect(r.taxes).toBe(47_500);
    expect(r.employerCharges).toBe(60_000);
    expect(r.net).toBeCloseTo(r.gross - r.deductions - r.taxes, 2);
  });

  it("rounds to 2 decimals", () => {
    const r = computePayrollLine(123_456.789, fixtureRules);
    expect(Number.isInteger(r.gross * 100)).toBe(true);
    expect(Number.isInteger(r.net * 100)).toBe(true);
  });

  it("uses a configured country profile and progressive tax bands", () => {
    const result = computePayrollLine(1_000_000, {
      employeeSocialRate: 0.05,
      employerSocialRate: 0.12,
      employeeSocialCap: 500_000,
      employerSocialCap: 600_000,
      taxBands: [
        { upTo: 500_000, rate: 0 },
        { upTo: null, rate: 0.1 },
      ],
    });

    expect(result).toEqual({
      gross: 1_000_000,
      deductions: 25_000,
      taxes: 47_500,
      net: 927_500,
      employerCharges: 72_000,
    });
  });

  it("calculates progressive tax by marginal band and rounds once", () => {
    expect(computeProgressiveIncomeTax(1_000_000, [
      { upTo: 500_000, rate: 0.1 },
      { upTo: null, rate: 0.2 },
    ])).toBe(150_000);
  });

  it("rejects missing or unordered country tax bands", () => {
    expect(validatePayrollRules({ employeeSocialRate: 0.05, employerSocialRate: 0.1, taxBands: [] })).toBe(false);
    expect(validatePayrollRules({ employeeSocialRate: 0.05, employerSocialRate: 0.1, taxBands: [
      { upTo: 500_000, rate: 0.1 },
      { upTo: 400_000, rate: 0.2 },
      { upTo: null, rate: 0.3 },
    ] })).toBe(false);
    expect(validatePayrollRules({ employeeSocialRate: 0.05, employerSocialRate: 0.1, taxBands: [
      { upTo: 500_000, rate: 0.1 },
      { upTo: null, rate: 0.2 },
    ] })).toBe(true);
  });
});

describe("generate_payroll_lines aggregation (TS mirror)", () => {
  it("sums totals across employees", () => {
    const lines = [computePayrollLine(300_000, fixtureRules), computePayrollLine(450_000, fixtureRules), computePayrollLine(120_000, fixtureRules)];
    const agg = aggregatePayroll(lines);
    expect(agg.gross).toBeCloseTo(870_000, 2);
    expect(agg.employerCharges).toBeCloseTo(870_000 * fixtureRules.employerSocialRate, 2);
    expect(agg.net).toBeCloseTo(lines.reduce((s, l) => s + l.net, 0), 2);
  });

  it("handles empty employee list", () => {
    const agg = aggregatePayroll([]);
    expect(agg).toEqual({ gross: 0, deductions: 0, taxes: 0, net: 0, employerCharges: 0 });
  });
});

describe("Journal entry preview (post_payroll_run mirror)", () => {
  it("is balanced when all SYSCOHADA accounts are mapped", () => {
    const lines = [computePayrollLine(500_000, fixtureRules), computePayrollLine(300_000, fixtureRules)];
    const je = buildJournalPreview(lines, { accounts: {
      PAYROLL_SALARIES: "661", PAYROLL_EMPLOYER_CHARGES: "664", PAYROLL_NET_PAYABLE: "422",
      PAYROLL_SOCIAL: "431", PAYROLL_TAX: "447",
    } });
    expect(je.balanced).toBe(true);
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
  });

  it("refuses a balanced preview when country posting roles are missing", () => {
    const lines = [computePayrollLine(400_000, fixtureRules)];
    const je = buildJournalPreview(lines, { accounts: { PAYROLL_SALARIES: "661", PAYROLL_EMPLOYER_CHARGES: "664", PAYROLL_NET_PAYABLE: "422" } });
    expect(je.balanced).toBe(false);
    expect(je.missingRoles).toEqual(["PAYROLL_SOCIAL", "PAYROLL_TAX"]);
    expect(je.lines.find((l) => l.role === "PAYROLL_SOCIAL")?.account).toBe("—");
  });

  it("uses the tenant's posting account mapping in the journal preview", () => {
    const lines = [computePayrollLine(1_000_000, fixtureRules)];
    const je = buildJournalPreview(lines, { accounts: {
      PAYROLL_SALARIES: "6611", PAYROLL_EMPLOYER_CHARGES: "6642", PAYROLL_NET_PAYABLE: "4221",
      PAYROLL_SOCIAL: "4312", PAYROLL_TAX: "4471",
    } });
    expect(je.lines.map((l) => l.account)).toEqual(["6611", "6642", "4221", "4312", "4471"]);
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
