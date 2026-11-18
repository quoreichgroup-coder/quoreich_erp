import { describe, expect, it } from "vitest";
import { postedPayrollToDateTotals, sumPostedPayrollGrossForFiscalYear, sumReportAmounts } from "@/lib/payroll-summary";

describe("postedPayrollToDateTotals", () => {
  it("calcule MTD et YTD depuis les cycles comptabilisés, avec l'exercice paramétré", () => {
    const runs = [
      { period: "2026-06", status: "posted", gross_total: 50, net_total: 40, payroll_currency_code: "XOF" },
      { period: "2026-07", status: "posted", gross_total: 100, net_total: 80, payroll_currency_code: "XOF" },
      { period: "2026-07", status: "posted", gross_total: 25, net_total: 20, payroll_currency_code: "XOF" },
      { period: "2026-08", status: "draft", gross_total: 900, net_total: 800, payroll_currency_code: "XOF" },
    ];
    expect(postedPayrollToDateTotals(runs, "2026-07", 7)).toEqual({
      yearStart: "2026-07", mtdGross: 125, mtdNet: 100, ytdGross: 125, ytdNet: 100,
    });
  });

  it("refuse le cumul quand les cycles réels mélangent des devises", () => {
    const runs = [
      { period: "2026-01", status: "posted", gross_total: 100, net_total: 80, payroll_currency_code: "XOF" },
      { period: "2026-02", status: "posted", gross_total: 200, net_total: 160, payroll_currency_code: "XAF" },
    ];
    const totals = postedPayrollToDateTotals(runs, "2026-02", 1);
    expect(totals.mtdGross).toBe(200);
    expect(totals.ytdGross).toBeNull();
    expect(totals.ytdNet).toBeNull();
  });
});

describe("sumPostedPayrollGrossForFiscalYear", () => {
  it("uses the configured fiscal year and excludes drafts, approvals and future periods", () => {
    const runs = [
      { period: "2026-07", status: "posted", gross_total: 100 },
      { period: "2026-10", status: "posted", gross_total: 200 },
      { period: "2026-06", status: "posted", gross_total: 300 },
      { period: "2026-11", status: "approved", gross_total: 400 },
      { period: "2026-12", status: "posted", gross_total: 500 },
    ];

    expect(sumPostedPayrollGrossForFiscalYear(runs, "2026-11", 7)).toBe(300);
  });

  it("uses the previous calendar year when the current month precedes fiscal start", () => {
    const runs = [
      { period: "2025-07", status: "posted", gross_total: 12 },
      { period: "2026-03", status: "posted", gross_total: 34 },
      { period: "2025-06", status: "posted", gross_total: 56 },
    ];

    expect(sumPostedPayrollGrossForFiscalYear(runs, "2026-03", 7)).toBe(46);
  });

  it("does not combine posted cycles whose stored currency differs from company settings", () => {
    const runs = [
      { period: "2026-01", status: "posted", gross_total: 100, payroll_currency_code: "XOF" },
      { period: "2026-02", status: "posted", gross_total: 100, payroll_currency_code: "XAF" },
    ];

    expect(sumPostedPayrollGrossForFiscalYear(runs, "2026-03", 1, "XOF")).toBeNull();
  });
});

describe("sumReportAmounts", () => {
  it("refuses totals across currencies or rows with an unknown currency", () => {
    expect(sumReportAmounts([{ currency: "XOF", amount: 50 }, { currency: "XAF", amount: 25 }])).toBeNull();
    expect(sumReportAmounts([{ currency: null, amount: 50 }])).toBeNull();
  });

  it("sums amounts when every row uses one known currency", () => {
    expect(sumReportAmounts([{ currency: "XOF", amount: 50 }, { currency: "XOF", amount: 25 }])).toBe(75);
  });
});
