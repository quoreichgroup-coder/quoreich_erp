import { describe, expect, it } from "vitest";
import { aboveAppetite, complianceRate, DEFAULT_RISK_SETTINGS, heatMap, isOverdue, netScore, riskLevel, type RiskLike } from "@/lib/grc";

const r = (l: number, i: number, rl: number | null = null, ri: number | null = null, status: RiskLike["status"] = "assessed"): RiskLike =>
  ({ likelihood: l, impact: i, residual_likelihood: rl, residual_impact: ri, status });

describe("risques et conformité", () => {
  it("criticité selon les seuils de la société", () => {
    expect(riskLevel(4, DEFAULT_RISK_SETTINGS)).toBe("low");
    expect(riskLevel(5, DEFAULT_RISK_SETTINGS)).toBe("medium");
    expect(riskLevel(12, DEFAULT_RISK_SETTINGS)).toBe("high");
    expect(riskLevel(15, DEFAULT_RISK_SETTINGS)).toBe("critical");
    expect(riskLevel(4, { ...DEFAULT_RISK_SETTINGS, scale_max: 3, medium_from: 2, high_from: 4, critical_from: 6 })).toBe("high");
    expect(riskLevel(null, DEFAULT_RISK_SETTINGS)).toBeNull();
  });
  it("score retenu, carte de chaleur, appétence", () => {
    expect(netScore(r(4, 5))).toBe(20);
    expect(netScore(r(4, 5, 2, 3))).toBe(6);
    const m = heatMap([r(4, 5, 2, 3), r(4, 5), r(1, 1, null, null, "closed")], 5, false);
    expect(m[0][3]).toBe(2);
    expect(m.flat().reduce((a, b) => a + b, 0)).toBe(2);
    const res = heatMap([r(4, 5, 2, 3)], 5, true);
    expect(res[2][1]).toBe(1);
    const s = { ...DEFAULT_RISK_SETTINGS, appetite_score: 8 };
    expect(aboveAppetite(r(4, 5, 2, 3), s)).toBe(false);
    expect(aboveAppetite(r(4, 5), s)).toBe(true);
    expect(aboveAppetite(r(4, 5, null, null, "accepted"), s)).toBe(false);
    expect(aboveAppetite(r(4, 5), DEFAULT_RISK_SETTINGS)).toBe(false);
  });
  it("taux de conformité et échéances", () => {
    expect(complianceRate([])).toBeNull();
    expect(complianceRate([{ status: "effective", is_active: true }, { status: "deficient", is_active: true }, { status: "not_applicable", is_active: true },
      { status: "deficient", is_active: false }])).toBe(50);
    expect(isOverdue("2026-01-01", "2026-02-01")).toBe(true);
    expect(isOverdue(null, "2026-02-01")).toBe(false);
  });
});
