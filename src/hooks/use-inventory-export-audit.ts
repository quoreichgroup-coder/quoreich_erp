/**
 * Reads the recent CSV/PDF export audit entries written by
 * `logInventoryExportAudit` and exposes a parser that recovers
 * the filters used at export time (so the UI can replay them).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ExportAuditAction =
  | "export_csv"
  | "export_pdf"
  | "export_aborted"
  | "export_failed";

export type ExportAuditRow = {
  id: string;
  action: ExportAuditAction;
  performed_by: string | null;
  comment: string | null;
  created_at: string;
};

export type ParsedExportAudit = {
  id: string;
  action: ExportAuditAction;
  kind: "csv" | "pdf" | null;
  rows: number;
  filters: Record<string, unknown>;
  error: string | null;
  performed_by: string | null;
  created_at: string;
  status_label: "Succès" | "Échec" | "Annulé";
};

const STATUS_LABEL: Record<ExportAuditAction, ParsedExportAudit["status_label"]> = {
  export_csv: "Succès",
  export_pdf: "Succès",
  export_failed: "Échec",
  export_aborted: "Annulé",
};

export function parseExportAuditRow(row: ExportAuditRow): ParsedExportAudit {
  let payload: Record<string, unknown> = {};
  const c = row.comment ?? "";
  const sep = c.indexOf(" — ");
  const json = sep >= 0 ? c.slice(sep + 3) : "";
  try {
    payload = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    payload = {};
  }
  const kind = (payload.kind === "csv" || payload.kind === "pdf") ? payload.kind : null;
  const rows = Number(payload.rows ?? 0) || 0;
  const filters = (payload.filters && typeof payload.filters === "object")
    ? (payload.filters as Record<string, unknown>) : {};
  const error = typeof payload.error === "string" ? payload.error : null;
  return {
    id: row.id,
    action: row.action,
    kind,
    rows,
    filters,
    error,
    performed_by: row.performed_by,
    created_at: row.created_at,
    status_label: STATUS_LABEL[row.action] ?? "Succès",
  };
}

export function useInventoryExportAudit(limit = 25) {
  return useQuery({
    queryKey: ["inventory-export-audit", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_role_audit" as never)
        .select("id, action, performed_by, comment, created_at")
        .in("action", ["export_csv", "export_pdf", "export_aborted", "export_failed"])
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return ((data as unknown as ExportAuditRow[]) || []).map(parseExportAuditRow);
    },
  });
}

/** Serialise audit filters back into URL search params (mirror of inventory-close-history URL_PARAM_MAP). */
const URL_PARAM_MAP_INVERSE: Record<string, string> = {
  search: "q",
  status: "st",
  from: "from",
  to: "to",
  invalidOnly: "inv",
  sortKey: "sk",
  sortDir: "sd",
  page: "p",
  pageSize: "ps",
};

export function filtersToSearchParams(filters: Record<string, unknown>): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    const key = URL_PARAM_MAP_INVERSE[k];
    if (!key) continue;
    if (v === null || v === undefined || v === "" || v === "all" || v === false) continue;
    if (v === true) { sp.set(key, "1"); continue; }
    sp.set(key, String(v));
  }
  return sp;
}
