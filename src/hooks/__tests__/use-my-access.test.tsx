import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, from: vi.fn() } }));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-a" }), fetchTenantId: async () => "tenant-a" }));
vi.mock("@/api/client", () => ({ isApiEnabled: () => false, apiGet: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { moduleCan, useMyAccess } from "../use-my-access";
import { useMyTreasuryRoles } from "../use-treasury-data";
import { useMyHrRoles } from "../use-hr-data";
import { useMyBudgetRoles } from "../use-budget-data";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);
beforeEach(() => mocks.rpc.mockReset());
afterEach(cleanup);

describe("droits dits par la base (my_access)", () => {
  it("lit my_access une fois, sans nouvelle tentative en cas de refus", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const { result } = renderHook(() => useMyAccess(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("my_access");
  });

  it("trésorerie : admin a tout (l'ancien calcul l'ignorait) ; un rôle sur mesure, exactement ses droits", async () => {
    mocks.rpc.mockResolvedValue({ data: { roles: ["admin"], permissions: [
      "treasury.create_txn", "treasury.import_statement", "treasury.match", "treasury.validate_recon", "treasury.edit_forecast",
      "treasury.manage_accounts", "treasury.export", "treasury.view_sensitive", "treasury.close_period", "treasury.audit",
    ] }, error: null });
    const admin = renderHook(() => useMyTreasuryRoles(), { wrapper }).result;
    await waitFor(() => expect(admin.current.canClosePeriod).toBe(true));
    expect(Object.values(admin.current).every(Boolean)).toBe(true);

    cleanup();
    mocks.rpc.mockResolvedValue({ data: { roles: [], permissions: ["treasury.match"] }, error: null });
    const caissier = renderHook(() => useMyTreasuryRoles(), { wrapper }).result;
    await waitFor(() => expect(caissier.current.canMatch).toBe(true));
    expect(caissier.current.canClosePeriod).toBe(false);
    expect(caissier.current.canExport).toBe(false);
  });

  it("RH : création de salarié suit hr.manage_employees, comme la base (plus d'ouverture à hr_clerk)", async () => {
    mocks.rpc.mockResolvedValue({ data: { roles: ["hr_clerk"], permissions: ["hr.create_payroll_run", "hr.view_sensitive"] }, error: null });
    const { result } = renderHook(() => useMyHrRoles(), { wrapper });
    await waitFor(() => expect(result.current.canCreatePayrollRun).toBe(true));
    expect(result.current.canCreateEmployee).toBe(false);
  });

  it("budget (contrôlé par rôle en base) : rôles de la société courante, via my_access", async () => {
    mocks.rpc.mockResolvedValue({ data: { roles: ["budget_planner"], permissions: [] }, error: null });
    const { result } = renderHook(() => useMyBudgetRoles(), { wrapper });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("my_access"));
    await waitFor(() => expect(Object.values(result.current).some(Boolean)).toBe(true));
  });

  it("moduleCan : un droit d'un autre module ne compte pas", () => {
    const can = moduleCan({ roles: [], permissions: ["crm.view"] }, "treasury");
    expect(can("view")).toBe(false);
    expect(moduleCan({ roles: [], permissions: ["crm.view"] }, "crm")("view")).toBe(true);
    expect(moduleCan(undefined, "crm")("view")).toBe(false);
  });
});
