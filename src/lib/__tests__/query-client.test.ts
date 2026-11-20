import { describe, expect, it } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { FreshQueryClient } from "../query-client";

const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); };

describe("FreshQueryClient", () => {
  it("relit après un premier chargement en vol au lieu de garder une réponse lue avant l'écriture", async () => {
    const qc = new FreshQueryClient({ defaultOptions: { queries: { retry: false } } });
    let db = ["ancienne"];
    let calls = 0;
    const queryFn = () => {
      calls++;
      const snapshot = [...db];
      return new Promise<string[]>((resolve) => setTimeout(() => resolve(snapshot), calls === 1 ? 50 : 1));
    };
    const observer = new QueryObserver(qc, { queryKey: ["liste"], queryFn });
    const unsubscribe = observer.subscribe(() => undefined);
    await until(() => calls === 1);
    db = ["ancienne", "nouvelle"];
    await qc.invalidateQueries({ queryKey: ["liste"] });
    await until(() => calls === 2 && observer.getCurrentResult().fetchStatus === "idle");
    expect(observer.getCurrentResult().data).toEqual(["ancienne", "nouvelle"]);
    expect(calls).toBe(2);
    unsubscribe();
  });

  it("n'annule pas le premier chargement sous des invalidations répétées (temps réel)", async () => {
    const qc = new FreshQueryClient({ defaultOptions: { queries: { retry: false } } });
    let calls = 0;
    const queryFn = () => { calls++; return new Promise<number>((resolve) => setTimeout(() => resolve(calls), 30)); };
    const observer = new QueryObserver(qc, { queryKey: ["lente"], queryFn });
    const unsubscribe = observer.subscribe(() => undefined);
    await until(() => calls === 1);
    for (let i = 0; i < 5; i++) { void qc.invalidateQueries({ queryKey: ["lente"] }); await new Promise((r) => setTimeout(r, 5)); }
    await until(() => observer.getCurrentResult().data !== undefined && observer.getCurrentResult().fetchStatus === "idle");
    expect(observer.getCurrentResult().data, "la liste finit par se charger").toBeDefined();
    expect(calls).toBeGreaterThanOrEqual(2);
    unsubscribe();
  });
});
