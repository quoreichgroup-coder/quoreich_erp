import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- Supabase mock infrastructure --------------------------------------------------

type Call = { method: string; args: any[] };
const calls: Call[] = [];
let nextResponse: { data: any; error: any; count?: number } = {
  data: [],
  error: null,
  count: 0,
};
const rpcMock = vi.fn();

function makeBuilder(): any {
  const record = (method: string) =>
    function (this: any, ...args: any[]) {
      calls.push({ method, args });
      return this;
    };
  const builder: any = {
    select: record("select"),
    order: record("order"),
    eq: record("eq"),
    in: record("in"),
    is: record("is"),
    or: record("or"),
    limit: record("limit"),
    range: record("range"),
    then: (resolve: any) => Promise.resolve(nextResponse).then(resolve),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((_t: string) => makeBuilder()),
    rpc: (...args: any[]) => rpcMock(...args),
  },
}));

vi.mock("@/hooks/use-tenant", () => ({
  useTenantId: () => ({ data: "tenant-1" }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

// ---- Helpers -----------------------------------------------------------------------

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: any) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  calls.length = 0;
  rpcMock.mockReset();
  nextResponse = { data: [], error: null, count: 0 };
});

// ---- Tests -------------------------------------------------------------------------

import {
  useERPAlertsPaginated,
  useUnreadAlertsCount,
  useMarkAllAlertsRead,
  useResolveAllAlerts,
  useResolveAlert,
} from "../use-alerts-data";

describe("useERPAlertsPaginated", () => {
  it("applies range() for page/pageSize and order() for sort", async () => {
    nextResponse = { data: [{ id: "a" }], error: null, count: 42 };

    const { result } = renderHook(
      () =>
        useERPAlertsPaginated({
          page: 2,
          pageSize: 10,
          sortBy: "severity",
          sortDir: "asc",
        }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(42);

    const range = calls.find((c) => c.method === "range");
    expect(range?.args).toEqual([20, 29]); // page=2, pageSize=10 → [20, 29]
    const order = calls.find((c) => c.method === "order");
    expect(order?.args[0]).toBe("severity");
    expect(order?.args[1]).toEqual({ ascending: true });
  });

  it("applies .in() when prefs whitelists are provided", async () => {
    renderHook(
      () =>
        useERPAlertsPaginated({
          modules: ["ar", "ap"],
          severities: ["critical"],
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(calls.some((c) => c.method === "range")).toBe(true));
    const ins = calls.filter((c) => c.method === "in");
    expect(ins).toEqual(
      expect.arrayContaining([
        { method: "in", args: ["module", ["ar", "ap"]] },
        { method: "in", args: ["severity", ["critical"]] },
      ]),
    );
  });

  it("explicit module filter takes precedence over prefs whitelist", async () => {
    renderHook(
      () =>
        useERPAlertsPaginated({
          module: "treasury",
          modules: ["ar", "ap"],
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(calls.some((c) => c.method === "range")).toBe(true));
    const eqs = calls.filter((c) => c.method === "eq");
    expect(eqs).toEqual(
      expect.arrayContaining([{ method: "eq", args: ["module", "treasury"] }]),
    );
    // No .in for module when explicit eq is set
    expect(calls.find((c) => c.method === "in" && c.args[0] === "module")).toBeUndefined();
  });
});

describe("useUnreadAlertsCount", () => {
  it("queries unresolved + read_at IS NULL and honors prefs", async () => {
    nextResponse = { data: null, error: null, count: 7 };
    const { result } = renderHook(
      () => useUnreadAlertsCount({ modules: ["hr"] }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(7);
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["is_resolved", false] },
        { method: "is", args: ["read_at", null] },
        { method: "in", args: ["module", ["hr"]] },
      ]),
    );
  });
});

describe("bulk action mutations", () => {
  it("useMarkAllAlertsRead calls mark_all_erp_alerts_read RPC", async () => {
    rpcMock.mockResolvedValueOnce({ data: 3, error: null });
    const { result } = renderHook(() => useMarkAllAlertsRead(), { wrapper: wrapper() });
    await result.current.mutateAsync();
    expect(rpcMock).toHaveBeenCalledWith("mark_all_erp_alerts_read");
  });

  it("useResolveAllAlerts forwards module/severity filters (null when 'all')", async () => {
    rpcMock.mockResolvedValueOnce({ data: 5, error: null });
    const { result } = renderHook(() => useResolveAllAlerts(), { wrapper: wrapper() });
    await result.current.mutateAsync({ module: "all", severity: "critical" });
    expect(rpcMock).toHaveBeenCalledWith("resolve_all_erp_alerts", {
      _module: null,
      _severity: "critical",
    });
  });

  it("useResolveAlert calls resolve_erp_alert with id", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    const { result } = renderHook(() => useResolveAlert(), { wrapper: wrapper() });
    await result.current.mutateAsync("alert-42");
    expect(rpcMock).toHaveBeenCalledWith("resolve_erp_alert", { _alert_id: "alert-42" });
  });

  it("useResolveAllAlerts surfaces RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "Admin role required" } });
    const { result } = renderHook(() => useResolveAllAlerts(), { wrapper: wrapper() });
    await expect(result.current.mutateAsync({})).rejects.toMatchObject({
      message: "Admin role required",
    });
  });
});
