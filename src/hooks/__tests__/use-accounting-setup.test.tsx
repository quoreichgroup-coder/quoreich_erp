import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  calls: [] as { table: string; op: string; args: unknown[] }[],
  rpc: vi.fn(),
}));

/** Constructeur PostgREST minimal : enregistre les appels, résout la donnée de la table. */
function builder(table: string) {
  const b: any = {};
  for (const op of ["select", "eq", "order", "upsert"]) {
    b[op] = (...args: unknown[]) => { mocks.calls.push({ table, op, args }); return b; };
  }
  b.then = (resolve: (v: unknown) => void) => resolve({ data: mocks.tables[table] ?? [], error: null });
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: mocks.rpc,
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  },
}));
vi.mock("@/hooks/use-tenant", () => ({
  useTenantId: () => ({ data: "tenant-a" }),
  fetchTenantId: async () => "tenant-a",
}));
vi.mock("@/api/client", () => ({ isApiEnabled: () => false, apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useAccountingSetup, useApplyAccountingFramework, useAssignPostingAccount } from "../use-accounting-setup";

function wrapper() {
  const client = new QueryClient();
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.calls = [];
  mocks.rpc.mockReset();
  mocks.tables = {
    tenant_accounting_settings: [{ accounting_frameworks: { code: "SYSCOHADA_REVISE", name: "SYSCOHADA révisé", scope: "OHADA", version: "2017", is_validated: false } }],
    posting_roles: [{ code: "BANK", label: "Banque", module: "TRE", description: "d" }],
    tenant_posting_accounts: [{ role_code: "BANK", gl_account_id: "acc-521" }],
    gl_accounts: [{ id: "acc-521", code: "521", name: "Banques", account_type: "asset", is_active: true }],
    accounting_framework_role_defaults: [{ role_code: "BANK", account_code: "521" }],
  };
});
afterEach(cleanup);

describe("useAccountingSetup — chemin Supabase", () => {
  it("assemble la vue depuis les tables V18 et lit les valeurs proposées du référentiel de la société", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const { result } = renderHook(() => useAccountingSetup(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.rpc).toHaveBeenCalledWith("is_tenant_admin");
    expect(mocks.calls).toContainEqual({ table: "accounting_framework_role_defaults", op: "eq", args: ["framework_code", "SYSCOHADA_REVISE"] });
    expect(result.current.data).toMatchObject({
      canEdit: true, complete: true, framework: { code: "SYSCOHADA_REVISE", validated: false },
      roles: [{ roleCode: "BANK", accountCode: "521", ready: true, suggestedAccountCode: "521" }],
    });
  });

  it("expose l'erreur sans nouvelle tentative automatique", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const { result } = renderHook(() => useAccountingSetup(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("mutations — chemin Supabase", () => {
  it("applique le référentiel par la RPC et traduit son résultat", async () => {
    mocks.rpc.mockResolvedValue({ data: { comptes_crees: 8, roles_parametres: 7 }, error: null });
    const { result } = renderHook(() => useApplyAccountingFramework(), { wrapper: wrapper() });
    const r = await result.current.mutateAsync("SYSCOHADA_REVISE");
    expect(mocks.rpc).toHaveBeenCalledWith("apply_accounting_framework", { _framework: "SYSCOHADA_REVISE" });
    expect(r).toEqual({ accountsCreated: 8, rolesAssigned: 7 });
  });

  it("enregistre le compte d'un rôle par upsert sur (tenant_id, role_code), dans la société courante", async () => {
    const { result } = renderHook(() => useAssignPostingAccount(), { wrapper: wrapper() });
    await result.current.mutateAsync({ role: "BANK", glAccountId: "acc-521" });
    const upsert = mocks.calls.find((c) => c.table === "tenant_posting_accounts" && c.op === "upsert");
    expect(upsert?.args[0]).toMatchObject({ tenant_id: "tenant-a", role_code: "BANK", gl_account_id: "acc-521", updated_by: "user-1" });
    expect(upsert?.args[1]).toEqual({ onConflict: "tenant_id,role_code" });
  });
});
