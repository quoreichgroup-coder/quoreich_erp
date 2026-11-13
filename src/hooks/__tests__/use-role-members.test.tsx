import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
 * Membres des rôles d'un module : lus dans la matrice (user_role_assignments → erp_roles.code),
 * filtrés sur la société courante, toutes pages, et sous une clé de cache qui porte la société.
 * Avant : user_roles, sans filtre de société, clé sans société.
 */
type Call = { table: string; ops: [string, ...unknown[]][] };
const mocks = vi.hoisted(() => ({ calls: [] as Call[], pages: [] as unknown[][] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      mocks.calls.push(call);
      const b: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "order"]) {
        b[op] = (...args: unknown[]) => { call.ops.push([op, ...args]); return b; };
      }
      b.range = (from: number, to: number) => {
        call.ops.push(["range", from, to]);
        const data = mocks.pages.shift() ?? [];
        return Promise.resolve({ data, error: null });
      };
      return b;
    },
    rpc: vi.fn(),
  },
}));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-a" }), fetchTenantId: async () => "tenant-a" }));
vi.mock("@/api/client", () => ({ isApiEnabled: () => false, apiGet: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { fetchRoleMembers } from "../use-role-members";
import { useTenantTreasuryRoles } from "../use-treasury-data";

const row = (user_id: string, code: string) => ({ user_id, erp_roles: { code } });

beforeEach(() => { mocks.calls.length = 0; mocks.pages.length = 0; });
afterEach(cleanup);

describe("membres des rôles d'un module (matrice)", () => {
  it("lit la matrice de la société courante, filtrée sur les codes du module, et regroupe par utilisateur", async () => {
    mocks.pages.push([row("u1", "treasury_clerk"), row("u1", "treasury_manager"), row("u2", "cash_admin"), row("u1", "treasury_clerk")]);
    const map = await fetchRoleMembers("tenant-a", ["treasury_clerk", "treasury_manager", "cash_admin"]);

    expect(mocks.calls).toHaveLength(1);
    const { table, ops } = mocks.calls[0];
    expect(table).toBe("user_role_assignments");
    expect(ops).toContainEqual(["select", "user_id, erp_roles!inner(code)"]);
    expect(ops).toContainEqual(["eq", "tenant_id", "tenant-a"]);
    expect(ops).toContainEqual(["in", "erp_roles.code", ["treasury_clerk", "treasury_manager", "cash_admin"]]);
    expect(map.get("u1")).toEqual(["treasury_clerk", "treasury_manager"]);
    expect(map.get("u2")).toEqual(["cash_admin"]);
  });

  it("lit toutes les pages : rien n'est tronqué à 1 000 lignes", async () => {
    mocks.pages.push(Array.from({ length: 1000 }, (_, i) => row(`u${i}`, "sales_rep")), [row("u-dernier", "sales_rep")]);
    const map = await fetchRoleMembers("tenant-a", ["sales_rep"]);
    expect(mocks.calls).toHaveLength(2);
    expect(mocks.calls[1].ops).toContainEqual(["range", 1000, 1999]);
    expect(map.size).toBe(1001);
    expect(map.has("u-dernier")).toBe(true);
  });

  it("aucun code : aucune requête", async () => {
    expect((await fetchRoleMembers("tenant-a", [])).size).toBe(0);
    expect(mocks.calls).toHaveLength(0);
  });

  it("le hook d'un module garde sa clé d'invalidation et y ajoute la société", async () => {
    mocks.pages.push([row("u1", "treasury_manager")]);
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useTenantTreasuryRoles(), { wrapper });
    await waitFor(() => expect(result.current.data?.get("u1")).toEqual(["treasury_manager"]));
    expect(qc.getQueryCache().find({ queryKey: ["tenant-treasury-roles", "tenant-a"] })).toBeDefined();
    expect(mocks.calls[0].table).toBe("user_role_assignments");
  });
});
