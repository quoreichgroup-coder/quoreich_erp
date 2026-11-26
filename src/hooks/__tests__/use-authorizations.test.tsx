import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; args: unknown[] }[],
  result: [{ id: "x" }] as unknown,
  rpc: vi.fn(),
}));

function builder(table: string) {
  const b: any = {};
  for (const op of ["select", "eq", "in", "insert", "update", "delete", "order", "limit"]) {
    b[op] = (...args: unknown[]) => { mocks.calls.push({ table, op, args }); return b; };
  }
  b.then = (resolve: (v: unknown) => void) => resolve({ data: mocks.result, error: null });
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => builder(t), rpc: mocks.rpc, auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) } },
}));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-a" }), fetchTenantId: async () => "tenant-a" }));
vi.mock("@/api/client", () => ({ isApiEnabled: () => false, apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useAssignRole, useRevokeRole, useSetRolePermissions, useUpdateRole } from "../use-authorizations";

const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
beforeEach(() => { mocks.calls = []; mocks.result = [{ id: "x" }]; mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null }); });
afterEach(cleanup);

describe("autorisations — chemin Supabase", () => {
  it("droits d'un rôle : remplacement atomique vérifié par la base, sans dépendre d'une ancienne liste locale", async () => {
    const { result } = renderHook(() => useSetRolePermissions(), { wrapper });
    await result.current.mutateAsync({ id: "r1", permissions: ["a", "c"], current: ["a", "b"] });
    expect(mocks.rpc).toHaveBeenCalledWith("set_erp_role_permissions", { _role: "r1", _permissions: ["a", "c"] });
    expect(mocks.calls).toEqual([]);
  });

  it("refus de la base : le remplacement des accès échoue et le message est conservé", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("Le rôle Administrateur est protégé") });
    const { result } = renderHook(() => useSetRolePermissions(), { wrapper });
    await expect(result.current.mutateAsync({ id: "admin", permissions: [], current: ["a"] })).rejects.toThrow("Administrateur est protégé");
  });

  it("affectation dans la société courante, auteur renseigné", async () => {
    const { result } = renderHook(() => useAssignRole(), { wrapper });
    await result.current.mutateAsync({ userId: "u1", roleId: "r1" });
    expect(mocks.calls.find((c) => c.op === "insert")!.args[0]).toEqual({ user_id: "u1", role_id: "r1", tenant_id: "tenant-a", assigned_by: "admin-1" });
  });

  it("modification d'un rôle système ou retrait filtré par la RLS : zéro ligne = refus", async () => {
    mocks.result = [];
    const update = renderHook(() => useUpdateRole(), { wrapper }).result;
    await expect(update.current.mutateAsync({ id: "sys", name: "x", active: false })).rejects.toThrow("Modification refusée");
    expect(mocks.calls).toContainEqual({ table: "erp_roles", op: "eq", args: ["is_system", false] });
    const revoke = renderHook(() => useRevokeRole(), { wrapper }).result;
    await expect(revoke.current.mutateAsync({ userId: "u1", roleId: "r1" })).rejects.toThrow("Modification refusée");
  });
});
