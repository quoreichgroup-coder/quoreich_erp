import { describe, it, expect } from "vitest";
import { filterRuns, sortRuns, paginate } from "@/lib/payroll-filters";
import type { PayrollRun } from "@/hooks/use-hr-data";

const mk = (over: Partial<PayrollRun>): PayrollRun => ({
  id: over.id ?? crypto.randomUUID(),
  tenant_id: "t",
  period: "2026-01",
  pay_date: "2026-01-28",
  status: "draft",
  gross_total: 0,
  net_total: 0,
  employee_count: 0,
  created_by: null, approved_by: null, executed_by: null,
  approved_at: null, executed_at: null, notes: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

const fixture: PayrollRun[] = [
  mk({ id: "1", period: "2026-01", pay_date: "2026-01-28", status: "posted",   gross_total: 800_000, net_total: 700_000, employee_count: 4 }),
  mk({ id: "2", period: "2026-02", pay_date: "2026-02-28", status: "approved", gross_total: 1_200_000, net_total: 1_000_000, employee_count: 6 }),
  mk({ id: "3", period: "2026-03", pay_date: "2026-03-28", status: "draft",    gross_total: 500_000, net_total: 420_000, employee_count: 3 }),
  mk({ id: "4", period: "2025-12", pay_date: "2025-12-28", status: "posted",   gross_total: 900_000, net_total: 780_000, employee_count: 5 }),
];

describe("filterRuns", () => {
  it("returns all rows when no filters", () => {
    expect(filterRuns(fixture, {})).toHaveLength(4);
  });
  it("filters by status", () => {
    expect(filterRuns(fixture, { status: "posted" })).toHaveLength(2);
  });
  it("filters by year prefix", () => {
    expect(filterRuns(fixture, { periodFilter: "2026" })).toHaveLength(3);
  });
  it("filters by full period", () => {
    expect(filterRuns(fixture, { periodFilter: "2026-02" })).toHaveLength(1);
  });
  it("search matches period, date or status", () => {
    expect(filterRuns(fixture, { q: "draft" })).toHaveLength(1);
    expect(filterRuns(fixture, { q: "2025" })).toHaveLength(1);
  });
});

describe("sortRuns", () => {
  it("sorts numbers ascending", () => {
    const s = sortRuns(fixture, "gross_total", "asc");
    expect(s.map((r) => r.gross_total)).toEqual([500_000, 800_000, 900_000, 1_200_000]);
  });
  it("sorts strings descending", () => {
    const s = sortRuns(fixture, "period", "desc");
    expect(s.map((r) => r.period)).toEqual(["2026-03", "2026-02", "2026-01", "2025-12"]);
  });
});

describe("paginate", () => {
  it("returns the correct page slice", () => {
    const p = paginate(fixture, 2, 2);
    expect(p.rows).toHaveLength(2);
    expect(p.pages).toBe(2);
    expect(p.page).toBe(2);
  });
  it("clamps out-of-range page", () => {
    expect(paginate(fixture, 99, 2).page).toBe(2);
    expect(paginate(fixture, 0, 2).page).toBe(1);
  });
  it("handles empty list", () => {
    const p = paginate([], 1, 10);
    expect(p.rows).toHaveLength(0);
    expect(p.pages).toBe(1);
  });
});
