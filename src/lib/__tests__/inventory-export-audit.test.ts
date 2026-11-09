/**
 * Unit tests for `logInventoryExportAudit` and the export-audit parser.
 *
 * Verifies that:
 *   - action is derived from status (success → export_csv/pdf, aborted → export_aborted, failed → export_failed)
 *   - URL-persisted filters (sort, pagination, period, status) are serialized in `comment`
 *   - `rows` reflects the rows actually exported (success/failure/cancellation)
 *   - the parser round-trips the payload back into a typed object
 *   - filtersToSearchParams reproduces the URL keys used by inventory-close-history
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const captured: { table?: string; payload?: Record<string, unknown> } = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        captured.table = table;
        captured.payload = payload;
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import { logInventoryExportAudit } from "@/hooks/use-inventory-data";
import {
  parseExportAuditRow,
  filtersToSearchParams,
  type ExportAuditRow,
} from "@/hooks/use-inventory-export-audit";

const TENANT = "t1";
const USER = "u1";
const URL_FILTERS = {
  search: "2025-",
  status: "failed",
  from: "2025-01-01",
  to: "2025-12-31",
  invalidOnly: true,
  sortKey: "closed_at",
  sortDir: "desc",
  page: 2,
  pageSize: 25,
};

beforeEach(() => {
  captured.table = undefined;
  captured.payload = undefined;
});

describe("logInventoryExportAudit — action derivation", () => {
  it("maps success+csv → export_csv and serialises filters/rows", async () => {
    await logInventoryExportAudit({
      tenantId: TENANT, userId: USER, kind: "csv", status: "success",
      rowCount: 142, filters: URL_FILTERS,
    });
    expect(captured.table).toBe("inventory_role_audit");
    expect(captured.payload?.action).toBe("export_csv");
    expect(captured.payload?.tenant_id).toBe(TENANT);
    const comment = String(captured.payload?.comment ?? "");
    expect(comment.startsWith("historique-clotures — ")).toBe(true);
    const json = JSON.parse(comment.slice("historique-clotures — ".length));
    expect(json.kind).toBe("csv");
    expect(json.rows).toBe(142);
    expect(json.filters).toMatchObject(URL_FILTERS);
    expect(json.error).toBeUndefined();
  });

  it("maps success+pdf → export_pdf", async () => {
    await logInventoryExportAudit({
      tenantId: TENANT, userId: USER, kind: "pdf", status: "success",
      rowCount: 7, filters: {},
    });
    expect(captured.payload?.action).toBe("export_pdf");
  });

  it("maps aborted → export_aborted with partial rowCount", async () => {
    await logInventoryExportAudit({
      tenantId: TENANT, userId: USER, kind: "csv", status: "aborted",
      rowCount: 30, filters: URL_FILTERS, error: "AbortError",
    });
    expect(captured.payload?.action).toBe("export_aborted");
    const json = JSON.parse(
      String(captured.payload?.comment).slice("historique-clotures — ".length),
    );
    expect(json.rows).toBe(30);
    expect(json.error).toBe("AbortError");
    expect(json.filters.sortKey).toBe("closed_at");
    expect(json.filters.page).toBe(2);
  });

  it("maps failed → export_failed and truncates long errors", async () => {
    const longErr = "x".repeat(500);
    await logInventoryExportAudit({
      tenantId: TENANT, userId: USER, kind: "pdf", status: "failed",
      rowCount: 0, filters: URL_FILTERS, error: longErr,
    });
    expect(captured.payload?.action).toBe("export_failed");
    const json = JSON.parse(
      String(captured.payload?.comment).slice("historique-clotures — ".length),
    );
    expect(json.error.length).toBeLessThanOrEqual(240);
  });
});

describe("parseExportAuditRow", () => {
  const buildRow = (action: ExportAuditRow["action"], payload: Record<string, unknown>): ExportAuditRow => ({
    id: "r1",
    action,
    performed_by: USER,
    created_at: "2025-06-01T10:00:00Z",
    comment: `historique-clotures — ${JSON.stringify(payload)}`,
  });

  it("recovers kind/rows/filters from a successful export entry", () => {
    const parsed = parseExportAuditRow(
      buildRow("export_csv", { kind: "csv", rows: 12, filters: URL_FILTERS }),
    );
    expect(parsed.kind).toBe("csv");
    expect(parsed.rows).toBe(12);
    expect(parsed.filters).toMatchObject(URL_FILTERS);
    expect(parsed.status_label).toBe("Succès");
    expect(parsed.error).toBeNull();
  });

  it("flags aborted/failed entries with the right status label", () => {
    expect(parseExportAuditRow(buildRow("export_aborted", { kind: "csv", rows: 3, filters: {} })).status_label)
      .toBe("Annulé");
    expect(parseExportAuditRow(buildRow("export_failed", { kind: "pdf", rows: 0, filters: {}, error: "x" })).error)
      .toBe("x");
  });

  it("tolerates malformed/empty comments", () => {
    const parsed = parseExportAuditRow({
      id: "r2", action: "export_csv", performed_by: USER,
      created_at: "2025-06-01T10:00:00Z", comment: "not-json",
    });
    expect(parsed.rows).toBe(0);
    expect(parsed.filters).toEqual({});
  });
});

describe("filtersToSearchParams — URL keys mirror inventory-close-history", () => {
  it("encodes the URL params consumed by the history page", () => {
    const sp = filtersToSearchParams(URL_FILTERS);
    expect(sp.get("q")).toBe("2025-");
    expect(sp.get("st")).toBe("failed");
    expect(sp.get("from")).toBe("2025-01-01");
    expect(sp.get("to")).toBe("2025-12-31");
    expect(sp.get("inv")).toBe("1");
    expect(sp.get("sk")).toBe("closed_at");
    expect(sp.get("sd")).toBe("desc");
    expect(sp.get("p")).toBe("2");
    expect(sp.get("ps")).toBe("25");
  });

  it("omits defaults (empty strings, status=all, false flags)", () => {
    const sp = filtersToSearchParams({
      search: "", status: "all", from: "", to: "",
      invalidOnly: false, sortKey: "closed_at", sortDir: "desc", page: 1, pageSize: 10,
    });
    // empty strings, "all" and false are dropped — only present keys remain.
    expect(sp.get("q")).toBeNull();
    expect(sp.get("st")).toBeNull();
    expect(sp.get("inv")).toBeNull();
    // Non-empty defaults still serialise (the page consumer dedupes via DEFAULT_FILTERS).
    expect(sp.get("sk")).toBe("closed_at");
  });
});
