import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/**
 * Realtime alerts subscription test.
 * We capture the handler synchronously inside the mocked supabase.channel().on()
 * call, then invoke it deterministically via act() — no timers, no waitFor races.
 */

const invalidateSpy = vi.fn();

type RT = {
  capturedHandler: ((payload: any) => void) | null;
  onFilter: any;
  removeChannel: ReturnType<typeof vi.fn>;
};

vi.mock("@/integrations/supabase/client", () => {
  (globalThis as any).__rt = {
    capturedHandler: null,
    onFilter: null,
    removeChannel: vi.fn(),
  } as RT;
  return {
    supabase: {
      channel: vi.fn(() => ({
        on: (_evt: string, filter: any, handler: any) => {
          (globalThis as any).__rt.onFilter = filter;
          (globalThis as any).__rt.capturedHandler = handler;
          return { subscribe: () => ({}) };
        },
      })),
      removeChannel: (...a: any[]) => (globalThis as any).__rt.removeChannel(...a),
    },
  };
});

vi.mock("@/hooks/use-tenant", () => ({
  useTenantId: () => ({ data: "tenant-XYZ" }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock("@tanstack/react-query", async (orig) => {
  const actual = await (orig as any)();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateSpy }),
  };
});

import { useRealtimeAlerts } from "../use-alerts-data";

function wrapper() {
  const qc = new QueryClient();
  return ({ children }: any) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const rt = () => (globalThis as any).__rt as RT;

beforeEach(() => {
  rt().capturedHandler = null;
  rt().onFilter = null;
  rt().removeChannel.mockReset();
  invalidateSpy.mockReset();
});

describe("useRealtimeAlerts", () => {
  it("subscribes with tenant_id filter (no cross-tenant leakage)", async () => {
    renderHook(() => useRealtimeAlerts(), { wrapper: wrapper() });
    await waitFor(() => expect(rt().capturedHandler).not.toBeNull());
    expect(rt().onFilter).toMatchObject({
      schema: "public",
      table: "erp_alerts",
      filter: "tenant_id=eq.tenant-XYZ",
    });
  });

  it("invalidates list + unread count on UPDATE (mark read / resolve)", async () => {
    renderHook(() => useRealtimeAlerts(), { wrapper: wrapper() });
    await waitFor(() => expect(rt().capturedHandler).not.toBeNull());
    await act(async () => {
      rt().capturedHandler!({
        eventType: "UPDATE",
        new: { id: "a1", severity: "info", title: "x", message: "y" },
      });
    });
    const keys = invalidateSpy.mock.calls.map((c) => c[0].queryKey[0]);
    expect(keys).toEqual(
      expect.arrayContaining(["erp-alerts", "erp-alerts-unread-count"]),
    );
  });

  it("tears down channel on unmount", async () => {
    const { unmount } = renderHook(() => useRealtimeAlerts(), { wrapper: wrapper() });
    await waitFor(() => expect(rt().capturedHandler).not.toBeNull());
    unmount();
    expect(rt().removeChannel).toHaveBeenCalledTimes(1);
  });
});
