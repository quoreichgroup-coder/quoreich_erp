import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/**
 * Cross-tenant isolation: verifies that alert queries/RPCs invoked by a user
 * scoped to tenant-A never return or mutate rows belonging to tenant-B.
 *
 * We mock the Supabase client to behave like a RLS-enforced backend:
 *  - `from('erp_alerts').select(...)` returns only rows whose tenant_id
 *    matches the current tenant context.
 *  - RPCs reject when invoked against an alert id belonging to another tenant.
 */

const CURRENT_TENANT = "tenant-A";

const allRows = [
  { id: "a1", tenant_id: "tenant-A", module: "ar", severity: "info", title: "A1", message: "", is_resolved: false, read_at: null, created_at: "2026-01-01" },
  { id: "a2", tenant_id: "tenant-A", module: "ap", severity: "critical", title: "A2", message: "", is_resolved: false, read_at: null, created_at: "2026-01-02" },
  { id: "b1", tenant_id: "tenant-B", module: "ar", severity: "info", title: "B1", message: "", is_resolved: false, read_at: null, created_at: "2026-01-03" },
  { id: "b2", tenant_id: "tenant-B", module: "hr", severity: "critical", title: "B2", message: "", is_resolved: false, read_at: null, created_at: "2026-01-04" },
];

const rpcMock = vi.fn(async (fn: string, args: any) => {
  if (fn === "resolve_erp_alert") {
    const row = allRows.find((r) => r.id === args._alert_id);
    if (!row || row.tenant_id !== CURRENT_TENANT) {
      return { data: null, error: { message: "row-level security: forbidden" } };
    }
    return { data: true, error: null };
  }
  if (fn === "mark_all_erp_alerts_read" || fn === "resolve_all_erp_alerts") {
    // Backend RPC scopes by auth.uid()/tenant; only tenant-A rows touched.
    const n = allRows.filter((r) => r.tenant_id === CURRENT_TENANT).length;
    return { data: n, error: null };
  }
  return { data: null, error: { message: "unknown rpc" } };
});

function makeBuilder() {
  // Simulate RLS: always pre-filter by current tenant.
  let rows = allRows.filter((r) => r.tenant_id === CURRENT_TENANT);
  let count = rows.length;
  const b: any = {
    select: (_c: string, opts?: any) => {
      if (opts?.count) count = rows.length;
      return b;
    },
    order: () => b,
    eq: (col: string, val: any) => {
      rows = rows.filter((r: any) => r[col] === val);
      count = rows.length;
      return b;
    },
    in: (col: string, vals: any[]) => {
      rows = rows.filter((r: any) => vals.includes(r[col]));
      count = rows.length;
      return b;
    },
    is: (col: string, val: any) => {
      rows = rows.filter((r: any) => r[col] === val);
      count = rows.length;
      return b;
    },
    or: () => b,
    limit: () => b,
    range: (from: number, to: number) => {
      rows = rows.slice(from, to + 1);
      return b;
    },
    then: (resolve: any) =>
      Promise.resolve({ data: rows, error: null, count }).then(resolve),
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => makeBuilder()),
    rpc: (fn: string, args: any) => rpcMock(fn, args),
  },
}));

vi.mock("@/hooks/use-tenant", () => ({
  useTenantId: () => ({ data: CURRENT_TENANT }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import {
  useERPAlerts,
  useERPAlertsPaginated,
  useResolveAlert,
} from "../use-alerts-data";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: any) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => rpcMock.mockClear());

describe("Alerts — cross-tenant isolation", () => {
  it("useERPAlerts never returns rows from another tenant", async () => {
    const { result } = renderHook(() => useERPAlerts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const ids = result.current.data!.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["a1", "a2"]));
    expect(ids).not.toContain("b1");
    expect(ids).not.toContain("b2");
    expect(result.current.data!.every((r) => r.tenant_id === CURRENT_TENANT)).toBe(true);
  });

  it("useERPAlertsPaginated total count excludes other tenants", async () => {
    const { result } = renderHook(
      () => useERPAlertsPaginated({ page: 0, pageSize: 50 }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.total).toBe(2);
    expect(result.current.data!.rows.every((r) => r.tenant_id === CURRENT_TENANT)).toBe(true);
  });

  it("resolve_erp_alert is rejected when targeting another tenant's alert", async () => {
    const { result } = renderHook(() => useResolveAlert(), { wrapper: wrapper() });
    await expect(result.current.mutateAsync("b1")).rejects.toMatchObject({
      message: expect.stringMatching(/row-level security|forbidden/i),
    });
    expect(rpcMock).toHaveBeenCalledWith("resolve_erp_alert", { _alert_id: "b1" });
  });

  it("resolve_erp_alert succeeds for an alert in the current tenant", async () => {
    const { result } = renderHook(() => useResolveAlert(), { wrapper: wrapper() });
    await expect(result.current.mutateAsync("a1")).resolves.toBeUndefined();
  });
});
