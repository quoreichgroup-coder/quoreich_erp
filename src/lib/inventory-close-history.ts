// Pure helpers for filtering/sorting/paginating inventory close history rows.
// Kept framework-agnostic so it can be unit-tested in isolation.

export type CloseHistoryRow = {
  id: string;
  period: string;
  closed_at: string;
  closed_at_fmt?: string;
  closed_by?: string | null;
  status_label: string; // "Terminée" | "Échec"
  error_message: string;
  items_count: number | null;
  total_qty: number | null;
  total_value: number | null;
};

export type StatusFilter = "all" | "ok" | "failed";
export type SortKey = "closed_at" | "status_label" | "period";
export type SortDir = "asc" | "desc";

export type HistoryFilters = {
  search: string;
  status: StatusFilter;
  from: string; // YYYY-MM-DD ("" = no bound)
  to: string;   // YYYY-MM-DD ("" = no bound)
  invalidOnly: boolean; // période non YYYY-MM ou erreur
  sortKey: SortKey;
  sortDir: SortDir;
  page: number;     // 1-indexed
  pageSize: number;
};

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isValidPeriod = (p: string) => PERIOD_RE.test(p);

export const DEFAULT_FILTERS: HistoryFilters = {
  search: "",
  status: "all",
  from: "",
  to: "",
  invalidOnly: false,
  sortKey: "closed_at",
  sortDir: "desc",
  page: 1,
  pageSize: 10,
};

export function filterCloseHistory<T extends CloseHistoryRow>(rows: T[], f: HistoryFilters): T[] {
  const q = f.search.trim().toLowerCase();
  const fromTs = f.from ? new Date(f.from + "T00:00:00").getTime() : null;
  const toTs = f.to ? new Date(f.to + "T23:59:59").getTime() : null;

  return rows.filter((r) => {
    if (q) {
      const hay = `${r.period} ${r.closed_by ?? ""} ${r.error_message ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.status === "ok" && r.status_label !== "Terminée") return false;
    if (f.status === "failed" && r.status_label !== "Échec") return false;
    if (f.invalidOnly && isValidPeriod(r.period) && !r.error_message) return false;
    if (fromTs !== null || toTs !== null) {
      const ts = new Date(r.closed_at).getTime();
      if (Number.isNaN(ts)) return false;
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
    }
    return true;
  });
}

export function sortCloseHistory<T extends CloseHistoryRow>(rows: T[], key: SortKey, dir: SortDir): T[] {
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let av: string | number = "";
    let bv: string | number = "";
    if (key === "closed_at") { av = new Date(a.closed_at).getTime(); bv = new Date(b.closed_at).getTime(); }
    else if (key === "status_label") { av = a.status_label; bv = b.status_label; }
    else { av = a.period; bv = b.period; }
    if (av < bv) return -1 * mult;
    if (av > bv) return 1 * mult;
    return 0;
  });
}

export function paginate<T>(rows: T[], page: number, pageSize: number): { rows: T[]; total: number; totalPages: number; page: number } {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  const start = (p - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total, totalPages, page: p };
}

export function applyHistoryView<T extends CloseHistoryRow>(rows: T[], f: HistoryFilters) {
  const filtered = filterCloseHistory(rows, f);
  const sorted = sortCloseHistory(filtered, f.sortKey, f.sortDir);
  return { ...paginate(sorted, f.page, f.pageSize), filteredCount: filtered.length };
}

/* ============================================================
 * URL persistence helpers — same logic that powers the page,
 * exposed so it is exercised by tests.
 * ============================================================ */

export const URL_PARAM_MAP: Record<keyof HistoryFilters, string> = {
  search: "q",  status: "st", from: "from", to: "to", invalidOnly: "inv",
  sortKey: "sk", sortDir: "sd", page: "p", pageSize: "ps",
};

export function parseFiltersFromSearchParams(sp: URLSearchParams): HistoryFilters {
  const num = (raw: string | null, fallback: number) => {
    const n = Number(raw ?? fallback);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    search:      sp.get(URL_PARAM_MAP.search) ?? DEFAULT_FILTERS.search,
    status:      (sp.get(URL_PARAM_MAP.status) as StatusFilter) ?? DEFAULT_FILTERS.status,
    from:        sp.get(URL_PARAM_MAP.from) ?? "",
    to:          sp.get(URL_PARAM_MAP.to) ?? "",
    invalidOnly: sp.get(URL_PARAM_MAP.invalidOnly) === "1",
    sortKey:     (sp.get(URL_PARAM_MAP.sortKey) as SortKey) ?? DEFAULT_FILTERS.sortKey,
    sortDir:     (sp.get(URL_PARAM_MAP.sortDir) as SortDir) ?? DEFAULT_FILTERS.sortDir,
    page:        num(sp.get(URL_PARAM_MAP.page), DEFAULT_FILTERS.page),
    pageSize:    num(sp.get(URL_PARAM_MAP.pageSize), DEFAULT_FILTERS.pageSize),
  };
}

export function applyFilterChange<K extends keyof HistoryFilters>(
  current: URLSearchParams, key: K, value: HistoryFilters[K],
): URLSearchParams {
  const next = new URLSearchParams(current);
  const writeKey = <KK extends keyof HistoryFilters>(kk: KK, val: HistoryFilters[KK]) => {
    const def = DEFAULT_FILTERS[kk];
    if (kk === "invalidOnly") {
      if (val) next.set(URL_PARAM_MAP[kk], "1"); else next.delete(URL_PARAM_MAP[kk]);
    } else if (val === "" || val === def) {
      next.delete(URL_PARAM_MAP[kk]);
    } else {
      next.set(URL_PARAM_MAP[kk], String(val));
    }
  };
  writeKey(key, value);
  if (key !== "page") writeKey("page", 1);
  return next;
}

export function toggleSort(current: URLSearchParams, key: SortKey): URLSearchParams {
  const f = parseFiltersFromSearchParams(current);
  if (f.sortKey === key) {
    return applyFilterChange(current, "sortDir", f.sortDir === "asc" ? "desc" : "asc");
  }
  const withKey = applyFilterChange(current, "sortKey", key);
  return applyFilterChange(withKey, "sortDir", "desc");
}

/** Columns exposed when exporting a single snapshot — stable contract for the dialog/tests. */
export const SNAPSHOT_EXPORT_COLUMNS = [
  { key: "code",      header: "Code" },
  { key: "name",      header: "Article" },
  { key: "category",  header: "Catégorie" },
  { key: "qty",       header: "Quantité" },
  { key: "unit_cost", header: "Coût unitaire" },
  { key: "value",     header: "Valeur (XOF)" },
] as const;

