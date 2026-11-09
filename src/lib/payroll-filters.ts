// Pure helpers for the PayrollRuns table — kept side-effect-free so we can
// unit-test search, sort and pagination without rendering the full page.

import type { PayrollRun } from "@/hooks/use-hr-data";

export type SortKey =
  | "period" | "pay_date" | "status" | "gross_total" | "net_total" | "employee_count";

export type SortDir = "asc" | "desc";

export type RunFilters = {
  q?: string;
  status?: string;          // "all" | "draft" | "approved" | "posted"
  periodFilter?: string;    // AAAA or AAAA-MM
};

export function filterRuns(rows: PayrollRun[], f: RunFilters): PayrollRun[] {
  const term = (f.q ?? "").trim().toLowerCase();
  const status = f.status ?? "all";
  const period = (f.periodFilter ?? "").trim();
  return rows.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (period && !r.period.startsWith(period)) return false;
    if (term && !(
      r.period.toLowerCase().includes(term) ||
      r.pay_date.includes(term) ||
      r.status.includes(term)
    )) return false;
    return true;
  });
}

export function sortRuns(rows: PayrollRun[], key: SortKey, dir: SortDir): PayrollRun[] {
  return [...rows].sort((a, b) => {
    const va = a[key] as string | number;
    const vb = b[key] as string | number;
    const cmp = typeof va === "number" && typeof vb === "number"
      ? va - vb
      : String(va).localeCompare(String(vb));
    return dir === "asc" ? cmp : -cmp;
  });
}

export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  return {
    page: p,
    pages,
    pageSize,
    total,
    rows: rows.slice((p - 1) * pageSize, p * pageSize),
  };
}
