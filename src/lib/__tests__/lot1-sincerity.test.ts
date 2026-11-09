import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { buildMonthlyCashFlow } from "@/lib/treasury-cashflow";
import { computeRealGrossMargin } from "@/hooks/use-sales-data";

describe("Lot 1 — sincérité", () => {
  it("marge = CA facturé - coût réel des sorties (pas 60 %)", () => {
    const r = computeRealGrossMargin([1000, 500], [-300, -150]);
    expect(r.cogs).toBe(450);
    expect(r.grossMargin).toBe(1050);
    expect(r.grossMarginPct).toBeCloseTo(70);
  });
  it("marge nulle sans CA", () => {
    expect(computeRealGrossMargin([], [100]).grossMarginPct).toBe(0);
  });
  it("ne calcule aucune marge en l’absence de mouvements valorisés", () => {
    expect(computeRealGrossMargin([1000], [])).toEqual({ revenue: 1000, cogs: null, grossMargin: null, grossMarginPct: null });
  });
  it.each([[null], [undefined], [0], [NaN], [Infinity], [-300, null], [-300, 0]])(
    "ne calcule aucune marge si une valorisation manque : %j", (...values) => {
      const result = computeRealGrossMargin([1000], values);
      expect(result.grossMargin).toBeNull();
      expect(result.grossMarginPct).toBeNull();
      expect(result.cogs).toBeNull();
    },
  );
  it("flux mensuels issus des transactions réelles", () => {
    const f = buildMonthlyCashFlow(
      [{ transaction_date: "2026-11-02", amount: 100 }, { transaction_date: "2026-11-03", amount: -40 }, { transaction_date: "2025-01-01", amount: 999 }],
      3, new Date("2026-11-04T00:00:00Z"));
    expect(f.map((x) => x.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(f[2]).toEqual({ month: "2026-11", inflow: 100, outflow: 40 });
  });
});
