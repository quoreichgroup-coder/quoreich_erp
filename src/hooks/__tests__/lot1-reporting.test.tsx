import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConsolidatedTrends } from "../use-consolidated-trends";
import { useBankAccounts, useBankTransactions } from "../use-treasury-data";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), tenant: "company-a" as string | undefined }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: mocks.tenant }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));
function wrapper() {
  const client = new QueryClient();
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => { vi.resetAllMocks(); mocks.tenant = "company-a"; });
afterEach(cleanup);

describe("Lot 1 — reporting réel", () => {
  it.each([3, 6, 12] as const)("transmet le périmètre et la période %s mois, conserve un historique inconnu", async (months) => {
    mocks.rpc.mockResolvedValue({ data: [{ month: "2026-10", revenue: 100, expenses: 40, net_profit: 60, cash_balance: null }], error: null });
    const { result } = renderHook(() => useConsolidatedTrends(["company-a"], months), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith("get_consolidated_cfo_trends", { _tenant_ids: ["company-a"], _months: months });
    expect(result.current.data?.[0]).toMatchObject({ cashBalance: null, revenue: 100, expenses: 40, netProfit: 60 });
  });
  it("ne calcule rien sans société", () => {
    renderHook(() => useConsolidatedTrends([]), { wrapper: wrapper() });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("expose une erreur sans tentative automatique et reprend manuellement", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("failure") }).mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useConsolidatedTrends(["company-a"]), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    await result.current.refetch();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("charge 501 transactions et applique le tenant à chaque page, sans limite à 200", async () => {
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
    query.range.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null })
      .mockResolvedValueOnce({ data: [{ id: 500 }], error: null });
    mocks.from.mockReturnValue(query);
    const { result } = renderHook(() => useBankTransactions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(501);
    expect(query.range.mock.calls).toEqual([[0, 499], [500, 999]]);
    expect(query.eq.mock.calls).toEqual([["tenant_id", "company-a"], ["tenant_id", "company-a"]]);
  });
  it("ne charge aucun compte ni transaction sans tenant", () => {
    mocks.tenant = undefined;
    renderHook(() => { useBankAccounts(); useBankTransactions(); }, { wrapper: wrapper() });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});