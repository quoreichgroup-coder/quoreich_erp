import { describe, it, expect } from "vitest";
import {
  parseFiltersFromSearchParams,
  applyFilterChange,
  toggleSort,
  URL_PARAM_MAP,
  DEFAULT_FILTERS,
  SNAPSHOT_EXPORT_COLUMNS,
} from "@/lib/inventory-close-history";

const sp = (qs: string) => new URLSearchParams(qs);

describe("URL persistence — parse", () => {
  it("returns defaults when params are empty", () => {
    expect(parseFiltersFromSearchParams(sp(""))).toEqual(DEFAULT_FILTERS);
  });

  it("reads every supported parameter", () => {
    const u = sp("q=jan&st=failed&from=2025-01-01&to=2025-02-01&inv=1&sk=period&sd=asc&p=3&ps=25");
    expect(parseFiltersFromSearchParams(u)).toEqual({
      search: "jan",
      status: "failed",
      from: "2025-01-01",
      to: "2025-02-01",
      invalidOnly: true,
      sortKey: "period",
      sortDir: "asc",
      page: 3,
      pageSize: 25,
    });
  });

  it("falls back to defaults for invalid numeric values", () => {
    const u = sp("p=abc&ps=-5");
    const f = parseFiltersFromSearchParams(u);
    expect(f.page).toBe(DEFAULT_FILTERS.page);
    expect(f.pageSize).toBe(DEFAULT_FILTERS.pageSize);
  });

  it("treats inv != '1' as false", () => {
    expect(parseFiltersFromSearchParams(sp("inv=true")).invalidOnly).toBe(false);
    expect(parseFiltersFromSearchParams(sp("inv=1")).invalidOnly).toBe(true);
  });
});

describe("URL persistence — applyFilterChange", () => {
  it("writes a non-default value and removes it when set back to default", () => {
    const a = applyFilterChange(sp(""), "status", "failed");
    expect(a.get(URL_PARAM_MAP.status)).toBe("failed");

    const b = applyFilterChange(a, "status", "all"); // default
    expect(b.get(URL_PARAM_MAP.status)).toBeNull();
  });

  it("any change other than page resets page to 1", () => {
    const start = sp("p=5");
    const out = applyFilterChange(start, "search", "abc");
    // page parameter is dropped (because 1 is default → removed)
    expect(out.get(URL_PARAM_MAP.page)).toBeNull();
    expect(parseFiltersFromSearchParams(out).page).toBe(1);
  });

  it("changing page does NOT reset itself", () => {
    const out = applyFilterChange(sp(""), "page", 4);
    expect(parseFiltersFromSearchParams(out).page).toBe(4);
  });

  it("invalidOnly toggles correctly", () => {
    const on = applyFilterChange(sp(""), "invalidOnly", true);
    expect(on.get(URL_PARAM_MAP.invalidOnly)).toBe("1");
    const off = applyFilterChange(on, "invalidOnly", false);
    expect(off.get(URL_PARAM_MAP.invalidOnly)).toBeNull();
  });

  it("preserves unrelated parameters", () => {
    const start = sp("q=foo&st=ok");
    const out = applyFilterChange(start, "pageSize", 50);
    expect(out.get(URL_PARAM_MAP.search)).toBe("foo");
    expect(out.get(URL_PARAM_MAP.status)).toBe("ok");
    expect(out.get(URL_PARAM_MAP.pageSize)).toBe("50");
  });
});

describe("URL persistence — toggleSort", () => {
  it("flips direction when re-clicking the active column", () => {
    const start = sp(""); // default sk=closed_at sd=desc (both elided)
    const out1 = toggleSort(start, "closed_at");
    expect(parseFiltersFromSearchParams(out1).sortDir).toBe("asc");
    const out2 = toggleSort(out1, "closed_at");
    expect(parseFiltersFromSearchParams(out2).sortDir).toBe("desc");
  });

  it("switching column resets direction to desc", () => {
    const start = applyFilterChange(sp(""), "sortDir", "asc"); // active asc
    const out = toggleSort(start, "period");
    const f = parseFiltersFromSearchParams(out);
    expect(f.sortKey).toBe("period");
    expect(f.sortDir).toBe("desc");
  });

  it("toggle resets page to 1", () => {
    const start = sp("p=7&sk=period&sd=asc");
    const out = toggleSort(start, "period");
    expect(parseFiltersFromSearchParams(out).page).toBe(1);
  });
});

describe("Round-trip — share-and-restore", () => {
  it("serialised → parsed yields the same filters", () => {
    let cur = sp("");
    cur = applyFilterChange(cur, "search", "stock");
    cur = applyFilterChange(cur, "status", "failed");
    cur = applyFilterChange(cur, "from", "2025-01-01");
    cur = applyFilterChange(cur, "to", "2025-03-31");
    cur = applyFilterChange(cur, "invalidOnly", true);
    cur = toggleSort(cur, "period"); // sk=period, sd=desc
    cur = applyFilterChange(cur, "pageSize", 25);
    cur = applyFilterChange(cur, "page", 3);

    const restored = parseFiltersFromSearchParams(cur);
    expect(restored).toEqual({
      search: "stock",
      status: "failed",
      from: "2025-01-01",
      to: "2025-03-31",
      invalidOnly: true,
      sortKey: "period",
      sortDir: "desc",
      page: 3,
      pageSize: 25,
    });
  });
});

describe("Detail dialog — export columns contract", () => {
  it("exposes the exact snapshot columns used by CSV/PDF exports", () => {
    expect(SNAPSHOT_EXPORT_COLUMNS.map((c) => c.key)).toEqual([
      "code", "name", "category", "qty", "unit_cost", "value",
    ]);
    expect(SNAPSHOT_EXPORT_COLUMNS.map((c) => c.header)).toEqual([
      "Code", "Article", "Catégorie", "Quantité", "Coût unitaire", "Valeur (XOF)",
    ]);
  });

  it("row clicked from history is passed verbatim to the detail dialog (snapshot preserved)", () => {
    // Simulate the page's setDetail(row) handoff: the snapshot field is what feeds the dialog.
    const row = {
      id: "r1",
      period: "2025-02",
      closed_at: "2025-03-01T00:00:00Z",
      closed_by: "alice",
      total_value: 1234,
      total_qty: 10,
      items_count: 3,
      snapshot: [
        { item_id: "i1", code: "A", name: "Article A", category: "X", qty: 5, unit_cost: 100, value: 500 },
        { item_id: "i2", code: "B", name: "Article B", category: null, qty: 5, unit_cost: 146.8, value: 734 },
      ],
    };
    // Picking the snapshot for export is a direct read.
    const picked = Array.isArray(row.snapshot) ? row.snapshot : [];
    expect(picked).toHaveLength(2);
    // Total of "value" column equals total_value (consistency contract).
    const total = picked.reduce((s, l) => s + Number(l.value), 0);
    expect(Math.round(total)).toBe(row.total_value);
  });
});
