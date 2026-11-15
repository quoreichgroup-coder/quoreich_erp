import { describe, expect, it } from "vitest";
import { budgetAlerts, bySection, compareAmounts, consumptionPct, covers, elapsedMonths, forecastRows, landingOf, monthlySeries, rootLines, spreadAnnual, totals, type BudgetRowLike } from "@/lib/budget-forecast";

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

  const ventes = row({ line_id: "v", account_code: "701", nature: "revenue", planned: 120000, actual: 20000, available: 100000 });

  it("produits : objectif à atteindre, sens favorable inversé, hors des alertes de dépassement", () => {
    expect(landingOf(20000, 80000, "prudent", "revenue")).toBe(20000);
    expect(landingOf(60000, 120000, "prudent", "expense")).toBe(120000);
    expect(landingOf(60000, 120000, "run_rate", "expense")).toBe(120000);
    expect(landingOf(60000, 120000, "commitments", "expense")).toBe(60000);
    const [v] = forecastRows([ventes], "2041", new Date(2041, 2, 15), 90, "run_rate");
    expect(v.landing).toBe(80000);
    expect(v.status).toBe("over");
    const [atteint] = forecastRows([{ ...ventes, actual: 40000 }], "2041", new Date(2041, 2, 15), 90, "run_rate");
    expect(atteint.status).toBe("ok");
    expect(budgetAlerts([{ ...ventes, available: -5 }], 90)).toEqual([]);
    expect(totals([general, ventes], "revenue").planned).toBe(120000);
    expect(totals([general, ventes]).planned).toBe(120000);
  });

  it("répartition d'une ligne annuelle : douzièmes ou profil de l'exercice précédent", () => {
    expect(spreadAnnual(1200, "even", undefined)).toEqual(Array(12).fill(100));
    const profil = [0, 0, 300, 0, 0, 0, 0, 0, 0, 0, 0, 100];
    expect(spreadAnnual(1200, "prior_year", profil)[2]).toBe(900);
    expect(spreadAnnual(1200, "prior_year", Array(12).fill(0))).toEqual(Array(12).fill(100));
    const s = monthlySeries([general], [], "2041", new Date(2040, 0, 1), { spread: "prior_year", prior: [{ line_id: "g", month: 6, actual: 10 }] });
    expect(s[5].planned).toBe(120000);
    expect(s[0].planned).toBe(0);
  });

  it("rapports : par section et comparaison de deux jeux de montants", () => {
    // La ligne générale ne masque pas les sections : le rapport par section ne regarde que les lignes de section.
    expect(bySection([general, section, autre], "expense")).toEqual(bySection([section, autre], "expense"));
    expect(bySection([section, autre], "expense")).toEqual([{ section: "PROD Production", planned: 30000, precommitted: 0, committed: 20000, actual: 15000, available: -5000 }]);
    expect(compareAmounts([{ account: "60", section: "", amount: 100 }], [{ account: "60", section: "", amount: 120 }, { account: "62", section: "", amount: 5 }]))
      .toEqual([{ key: "60|", account: "60", section: "", a: 100, b: 120, diff: 20, pct: 20 }, { key: "62|", account: "62", section: "", a: 0, b: 5, diff: 5, pct: null }]);
  });
});
