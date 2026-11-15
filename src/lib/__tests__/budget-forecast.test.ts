import { describe, expect, it } from "vitest";
import { budgetAlerts, consumptionPct, covers, elapsedMonths, forecastRows, monthlySeries, rootLines, totals, type BudgetRowLike } from "@/lib/budget-forecast";

const row = (p: Partial<BudgetRowLike> & { line_id: string; account_code: string }): BudgetRowLike => ({
  period: "2041", analytic_value_id: null, planned: 0, precommitted: 0, committed: 0, actual: 0, available: 0, ...p,
});

describe("budget-forecast", () => {
  const general = row({ line_id: "g", account_code: "60", planned: 120000, precommitted: 10000, committed: 20000, actual: 30000, available: 60000 });
  const sub = row({ line_id: "s", account_code: "604", planned: 20000, actual: 5000, available: 15000 });
  const section = row({ line_id: "p", account_code: "60", analytic_value_id: "PROD", analytic_code: "PROD", analytic_name: "Production",
    planned: 30000, committed: 20000, actual: 15000, available: -5000 });
  const autre = row({ line_id: "a", account_code: "62", planned: 10000, actual: 9500, available: 500 });

  it("une ligne générale couvre ses sous-comptes et ses sections, pas l'inverse", () => {
    expect(covers(general, sub)).toBe(true);
    expect(covers(general, section)).toBe(true);
    expect(covers(section, general)).toBe(false);
    expect(covers(sub, general)).toBe(false);
    expect(covers(row({ line_id: "x", account_code: "60", period: "2041" }), row({ line_id: "y", account_code: "60", period: "2041-03" }))).toBe(true);
  });

  it("les totaux ne comptent pas deux fois les lignes imbriquées", () => {
    expect(rootLines([general, sub, section, autre]).map((r) => r.line_id)).toEqual(["g", "a"]);
    expect(totals([general, sub, section, autre])).toEqual({ planned: 130000, precommitted: 10000, committed: 20000, actual: 39500, available: 60500 });
  });

  it("alertes : dépassement d'abord, puis seuil", () => {
    expect(consumptionPct(autre)).toBe(95);
    const a = budgetAlerts([general, section, autre], 90);
    expect(a.map((x) => [x.row.line_id, x.level])).toEqual([["p", "over"], ["a", "threshold"]]);
    expect(budgetAlerts([autre], 96)).toEqual([]);
  });

  it("mois écoulés", () => {
    expect(elapsedMonths("2041", new Date(2040, 11, 31))).toBe(0);
    expect(elapsedMonths("2041", new Date(2041, 2, 15))).toBe(3);
    expect(elapsedMonths("2041", new Date(2042, 0, 1))).toBe(12);
  });

  it("atterrissage : le plus prudent entre engagements connus et rythme du réalisé", () => {
    const [g, a] = forecastRows([general, autre], "2041", new Date(2041, 2, 15));
    expect(g.known).toBe(60000);
    expect(g.runRate).toBe(120000);
    expect(g.landing).toBe(120000);
    expect(g.variance).toBe(0);
    expect(g.status).toBe("risk");
    expect(a.landing).toBe(38000);
    expect(a.status).toBe("over");
    const [avant] = forecastRows([general], "2041", new Date(2040, 5, 1));
    expect(avant.runRate).toBeNull();
    expect(avant.landing).toBe(60000);
  });

  it("série mensuelle : douzièmes du budget annuel, réalisé des mois écoulés, prévision jusqu'à l'atterrissage", () => {
    const s = monthlySeries([general], [{ line_id: "g", month: 1, actual: 10000 }, { line_id: "g", month: 2, actual: 20000 }, { line_id: "x", month: 1, actual: 999 }],
      "2041", new Date(2041, 1, 20));
    expect(s).toHaveLength(12);
    expect(s[0]).toMatchObject({ planned: 10000, actual: 10000, cumulActual: 10000 });
    expect(s[1]).toMatchObject({ cumulPlanned: 20000, cumulActual: 30000 });
    expect(s[2].actual).toBeNull();
    // atterrissage = max(60 000 connus, 30 000 / 2 × 12 = 180 000) : 150 000 répartis sur 10 mois.
    expect(s[11].cumulForecast).toBe(180000);
    expect(s[11].cumulPlanned).toBe(120000);
  });
});
