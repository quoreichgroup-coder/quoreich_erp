import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
 * Régression : la cloche (en-tête de chaque page) et la page Alertes s'abonnaient au même canal
 * temps réel. supabase-js rend le canal existant pour un nom déjà ouvert ; le second `.on()`
 * arrivait après `subscribe()` et levait une erreur qui faisait planter toute la page /alerts.
 * Le double ci-dessous reproduit exactement ce comportement de supabase-js.
 */
const mocks = vi.hoisted(() => {
  const channels = new Map<string, { subscribed: boolean }>();
  const channel = vi.fn((name: string) => {
    const state = channels.get(name) ?? { subscribed: false };
    channels.set(name, state);
    const ch = {
      on: () => {
        if (state.subscribed) throw new Error(`cannot add \`postgres_changes\` callbacks for realtime:${name} after \`subscribe()\`.`);
        return ch;
      },
      subscribe: () => { state.subscribed = true; return ch; },
    };
    return ch;
  });
  return { channels, channel, removeChannel: vi.fn((ch: unknown) => ch) };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel: mocks.channel, removeChannel: mocks.removeChannel, from: vi.fn() },
}));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-a" }), fetchTenantId: async () => "tenant-a" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { useRealtimeAlerts } from "../use-alerts-data";

function Subscriber() {
  useRealtimeAlerts();
  return null;
}

afterEach(() => {
  cleanup();
  mocks.channels.clear();
  mocks.channel.mockClear();
});

describe("useRealtimeAlerts", () => {
  it("deux abonnés simultanés (cloche + page Alertes) : pas d'erreur, un canal chacun", () => {
    expect(() =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <Subscriber />
          <Subscriber />
        </QueryClientProvider>,
      ),
    ).not.toThrow();
    const names = mocks.channel.mock.calls.map(([n]) => n);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names.every((n) => n.startsWith("erp-alerts-tenant-a-"))).toBe(true);
  });
});
