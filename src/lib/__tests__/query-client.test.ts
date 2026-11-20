import { describe, expect, it } from "vitest";
import { FreshQueryClient } from "../query-client";

describe("FreshQueryClient", () => {
  it("relance un premier chargement en vol au lieu de rendre une réponse lue avant l'écriture", async () => {
    const qc = new FreshQueryClient({ defaultOptions: { queries: { retry: false } } });
    let db = ["ancienne"];
    let calls = 0;
    const queryFn = () => {
      calls++;
      const snapshot = [...db];
      return new Promise<string[]>((resolve) => setTimeout(() => resolve(snapshot), calls === 1 ? 50 : 1));
    };
    const observer = qc.getQueryCache().build(qc, { queryKey: ["liste"], queryFn });
    const unsubscribe = qc.getQueryCache().subscribe(() => undefined);
    const first = qc.fetchQuery({ queryKey: ["liste"], queryFn }).catch(() => undefined);
    db = ["ancienne", "nouvelle"];
    await qc.invalidateQueries({ queryKey: ["liste"] }, { throwOnError: false });
    await qc.fetchQuery({ queryKey: ["liste"], queryFn, staleTime: Infinity });
    await first;
    expect(observer.state.data).toEqual(["ancienne", "nouvelle"]);
    expect(calls).toBe(2);
    unsubscribe();
  });
});
