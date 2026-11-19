import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { computeCfoCockpit, type CfoCockpitData } from "@/hooks/use-cfo-cockpit";

const base: CfoCockpitData = {
  ar: [], ap: [], banks: [], arPayments: [], apPayments: [], activeProjects: 0, risks: [], riskSettings: null,
  payroll: [], inventoryClose: [], treasuryClose: [], draftReconciliations: 0,
};

describe("computeCfoCockpit", () => {
  it("additionne la trésorerie calculée (balance) et les encours ouverts", () => {
    const k = computeCfoCockpit({
      ...base,
      banks: [{ balance: 1000 }, { balance: "250.5" }],
      ar: [{ total: 100, amount_paid: 40, status: "open", due_date: "2041-01-01" }, { total: 50, amount_paid: 50, status: "paid" }],
      ap: [{ total: 70, amount_paid: 0, status: "open", due_date: "2040-12-01" }],
    }, "2041-02-01", "2041-02-01");
    expect(k.cashOnHand).toBe(1250.5);
    expect(k.arOutstanding).toBe(60);
    expect(k.apOverdue).toBe(70);
    expect(k.workingCapital).toBe(1250.5 + 60 - 70);
  });

  it("compte les risques élevés par score net et selon les seuils de la société", () => {
    const risks = [
      { likelihood: 5, impact: 4, residual_likelihood: 2, residual_impact: 2, status: "treating" }, // net 4
      { likelihood: 4, impact: 3, residual_likelihood: null, residual_impact: null, status: "assessed" }, // net 12
      { likelihood: 5, impact: 5, residual_likelihood: null, residual_impact: null, status: "closed" },
    ];
    expect(computeCfoCockpit({ ...base, risks }).openRisksHigh).toBe(1);
    expect(computeCfoCockpit({ ...base, risks, riskSettings: { high_from: 3, critical_from: 20 } }).openRisksHigh).toBe(2);
  });
});
