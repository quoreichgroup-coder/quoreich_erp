import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "jeton-de-session" } } })) } },
}));
vi.mock("@/api/client", () => ({ apiBaseUrl: () => "http://api.local:8090" }));

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(public url: string) { FakeSocket.all.push(this); }
  send(s: string) { this.sent.push(s); }
  close() { this.onclose?.(); }
}

describe("subscribeRealtime (sur site)", () => {
  afterEach(() => { vi.useRealTimers(); FakeSocket.all = []; });

  it("envoie le jeton dans le premier message, relaie les changements, se reconnecte, se ferme au dernier désabonnement", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    const { subscribeRealtime } = await import("@/api/realtime");
    const recu: string[] = [];
    const stop = subscribeRealtime((t) => recu.push(t));
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    const ws = FakeSocket.all[0];
    expect(ws.url).toBe("ws://api.local:8090/api/v1/realtime");
    ws.onopen?.();
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "auth", token: "jeton-de-session" });
    ws.onmessage?.({ data: '{"type":"ready"}' });
    ws.onmessage?.({ data: '{"type":"change","table":"erp_alerts"}' });
    ws.onmessage?.({ data: "pas du json" });
    expect(recu).toEqual(["erp_alerts"]);

    ws.close(); // coupure : reconnexion après attente
    await vi.advanceTimersByTimeAsync(1_100);
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(2));

    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});
