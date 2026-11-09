import { describe, it, expect } from "vitest";
import {
  applyHistoryView, filterCloseHistory, sortCloseHistory, paginate, isValidPeriod,
  DEFAULT_FILTERS, type CloseHistoryRow,
} from "@/lib/inventory-close-history";

const mk = (over: Partial<CloseHistoryRow>): CloseHistoryRow => ({
  id: over.id ?? Math.random().toString(36),
  period: "2025-01",
  closed_at: "2025-01-15T10:00:00Z",
  closed_at_fmt: "",
  closed_by: "alice",
  status_label: "Terminée",
  error_message: "",
  items_count: 1, total_qty: 10, total_value: 100,
  ...over,
});

const rows: CloseHistoryRow[] = [
  mk({ id: "a", period: "2025-01", closed_at: "2025-02-01T10:00:00Z", status_label: "Terminée" }),
  mk({ id: "b", period: "2025-02", closed_at: "2025-03-05T10:00:00Z", status_label: "Échec", error_message: "boom" }),
  mk({ id: "c", period: "bad-period", closed_at: "2025-04-10T10:00:00Z", status_label: "Terminée", closed_by: "bob" }),
  mk({ id: "d", period: "2025-03", closed_at: "2025-05-20T10:00:00Z", status_label: "Terminée" }),
];

describe("isValidPeriod", () => {
  it("accepts YYYY-MM and rejects others", () => {
    expect(isValidPeriod("2025-01")).toBe(true);
    expect(isValidPeriod("2025-13")).toBe(false);
    expect(isValidPeriod("bad")).toBe(false);
  });
});

describe("filterCloseHistory", () => {
  it("filters by status", () => {
    expect(filterCloseHistory(rows, { ...DEFAULT_FILTERS, status: "failed" }).map(r => r.id)).toEqual(["b"]);
  });
  it("filters by search across period/user/error", () => {
    expect(filterCloseHistory(rows, { ...DEFAULT_FILTERS, search: "bob" }).map(r => r.id)).toEqual(["c"]);
    expect(filterCloseHistory(rows, { ...DEFAULT_FILTERS, search: "boom" }).map(r => r.id)).toEqual(["b"]);
  });
  it("filters by date range", () => {
    const f = { ...DEFAULT_FILTERS, from: "2025-03-01", to: "2025-04-30" };
    expect(filterCloseHistory(rows, f).map(r => r.id).sort()).toEqual(["b", "c"]);
  });
  it("invalidOnly returns invalid period OR rows with error", () => {
    expect(filterCloseHistory(rows, { ...DEFAULT_FILTERS, invalidOnly: true }).map(r => r.id).sort()).toEqual(["b", "c"]);
  });
});

describe("sortCloseHistory", () => {
  it("sorts by closed_at desc/asc", () => {
    expect(sortCloseHistory(rows, "closed_at", "desc").map(r => r.id)).toEqual(["d", "c", "b", "a"]);
    expect(sortCloseHistory(rows, "closed_at", "asc").map(r => r.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("sorts by status_label", () => {
    expect(sortCloseHistory(rows, "status_label", "asc")[0].status_label).toBe("Terminée"); // É > T in unicode actually... check
  });
});

describe("paginate", () => {
  it("clamps page and slices", () => {
    const r = paginate(rows, 2, 2);
    expect(r.rows.map(x => x.id)).toEqual(["c", "d"]);
    expect(r.totalPages).toBe(2);
    const r2 = paginate(rows, 99, 2);
    expect(r2.page).toBe(2);
  });
});

describe("applyHistoryView", () => {
  it("combines filter+sort+paginate", () => {
    const v = applyHistoryView(rows, { ...DEFAULT_FILTERS, status: "all", sortKey: "closed_at", sortDir: "desc", pageSize: 2, page: 1 });
    expect(v.rows.map(r => r.id)).toEqual(["d", "c"]);
    expect(v.totalPages).toBe(2);
    expect(v.filteredCount).toBe(4);
  });
});
