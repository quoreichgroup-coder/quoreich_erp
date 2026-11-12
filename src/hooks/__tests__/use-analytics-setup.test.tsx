import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  result: undefined as unknown,
  calls: [] as { table: string; op: string; args: unknown[] }[],
  rpc: vi.fn(),
}));

function builder(table: string) {
  const b: any = {};
  for (const op of ["select", "eq", "insert", "update", "upsert", "delete"]) {
    b[op] = (...args: unknown[]) => { mocks.calls.push({ table, op, args }); return b; };
  }
  b.then = (resolve: (v: unknown) => void) => resolve({ data: mocks.result ?? mocks.tables[table] ?? [], error: null });
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => builder(t), rpc: mocks.rpc } }));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-a" }), fetchTenantId: async () => "tenant-a" }));
vi.mock("@/api/client", () => ({ isApiEnabled: () => false, apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useAnalyticsSetup, useCreateAnalyticValue, useUpdateAnalyticAxis } from "../use-analytics-setup";

function wrapper() {
  const client = new QueryClient();
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.calls = [];
  mocks.result = undefined;
  mocks.rpc.mockReset();
  mocks.tables = {
    analytic_axes: [{ id: "dept", code: "DEPT", name: "Département", sort_order: 1, is_active: true }],
    analytic_values: [{ id: "com", axis_id: "dept", code: "COM", name: "Commercial", parent_id: null, valid_from: null, valid_to: null, is_active: true }],
    analytic_rules: [{ axis_id: "dept", account_prefix: "7", requirement: "required" }],
  };
});
afterEach(cleanup);

describe("analytique — chemin Supabase", () => {
  it("lit les tables V19 et les droits de la société courante", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "tenant_has_any_role", error: null }));
    const { result } = renderHook(() => useAnalyticsSetup(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith("tenant_has_any_role", { _roles: ["admin", "accountant"] });
    expect(result.current.data).toMatchObject({
      canManageAxes: false, canManageValues: true,
      axes: [{ code: "DEPT", values: [{ code: "COM", parentId: undefined }], rules: [{ accountPrefix: "7", requirement: "required" }] }],
    });
  });

  it("crée une section dans la société courante, champs vides envoyés comme absents", async () => {
    const { result } = renderHook(() => useCreateAnalyticValue(), { wrapper: wrapper() });
    await result.current.mutateAsync({ axisId: "dept", code: " RH ", name: "Ressources humaines", parentId: "", validFrom: "", validTo: "" });
    expect(mocks.calls.find((c) => c.op === "insert")?.args[0]).toEqual({
      tenant_id: "tenant-a", axis_id: "dept", code: "RH", name: "Ressources humaines", parent_id: null, valid_from: null, valid_to: null,
    });
  });

  it("une modification filtrée par la RLS (zéro ligne) est un refus, pas un succès", async () => {
    mocks.result = [];
    const { result } = renderHook(() => useUpdateAnalyticAxis(), { wrapper: wrapper() });
    await expect(result.current.mutateAsync({ id: "dept", name: "Département", active: false }))
      .rejects.toThrow("Modification refusée");
  });
});
