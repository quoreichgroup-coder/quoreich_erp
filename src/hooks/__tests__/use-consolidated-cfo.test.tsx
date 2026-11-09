import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAccessibleTenants, useConsolidatedCfoKpis } from "../use-consolidated-cfo";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));

function wrapper() {
  // Keep React Query defaults: these tests must detect accidental automatic retries.
  const client = new QueryClient();
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
beforeEach(() => mocks.rpc.mockReset());
afterEach(cleanup);

describe("CFO — chargement et périmètre", () => {
  it("transmet uniquement les sociétés sélectionnées et recharge après changement du périmètre", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const { result, rerender } = renderHook(({ ids }) => useConsolidatedCfoKpis(ids), {
      initialProps: { ids: ["tenant-a", "tenant-b"] }, wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith("get_consolidated_cfo_kpis", { _tenant_ids: ["tenant-a", "tenant-b"] });
    rerender({ ids: ["tenant-b"] });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("get_consolidated_cfo_kpis", { _tenant_ids: ["tenant-b"] }));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("ne lance aucun calcul sans société sélectionnée", () => {
    const { result } = renderHook(() => useConsolidatedCfoKpis([]), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["tenants", "kpis"])("expose immédiatement l'erreur %s sans nouvelle tentative et permet une reprise manuelle", async (kind) => {
    const error = { code: "42702", message: 'column reference "tenant_id" is ambiguous' };
    mocks.rpc.mockResolvedValueOnce({ data: null, error }).mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => kind === "tenants" ? useAccessibleTenants() : useConsolidatedCfoKpis(["tenant-a"]), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(error);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    await result.current.refetch();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});