import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Call = { table: string; ops: [string, ...unknown[]][] };
const mocks = vi.hoisted(() => ({ calls: [] as Call[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      mocks.calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "ilike", "order"]) {
        builder[method] = (...args: unknown[]) => { call.ops.push([method, ...args]); return builder; };
      }
      builder.range = (...args: unknown[]) => {
        call.ops.push(["range", ...args]);
        return Promise.resolve({ data: [], error: null, count: 0 });
      };
      return builder;
    },
  },
}));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-a" }) }));
vi.mock("@/hooks/use-my-access", () => ({ useMyAccess: () => ({ data: { roles: [], permissions: [] } }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/hooks/use-role-members", () => ({ useTenantRoleMembers: () => ({ data: new Map() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { usePayrollRunAudit } from "../use-hr-data";

const queryClient = new QueryClient();
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => { mocks.calls.length = 0; queryClient.clear(); });
afterEach(cleanup);

describe("audit du cycle de paie", () => {
  it("lit l'historique du cycle et filtre les événements de workflow", async () => {
    const { result } = renderHook(
      () => usePayrollRunAudit("run-1", { eventType: "approved", page: 1, pageSize: 10 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.calls).toHaveLength(1);
    expect(mocks.calls[0].table).toBe("payroll_run_audit");
    expect(mocks.calls[0].ops).toContainEqual(["eq", "tenant_id", "tenant-a"]);
    expect(mocks.calls[0].ops).toContainEqual(["eq", "run_id", "run-1"]);
    expect(mocks.calls[0].ops).toContainEqual(["eq", "event_type", "approved"]);
    expect(queryClient.getQueryCache().find({ queryKey: ["payroll-run-audit", "tenant-a", "supabase", "user-1", "run-1", "approved", 1, 10] })).toBeDefined();
  });
});
