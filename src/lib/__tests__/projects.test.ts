import { describe, expect, it } from "vitest";
import { projectAlerts, projectIndicators } from "@/lib/projects";

const f = { budget_costs: 500000, budget_revenue: 800000, actual_costs: 120000, actual_revenue: 300000, committed: 80000 };

describe("projets", () => {
  it("indicateurs : consommé = réalisé + engagé, disponible, part, marges", () => {
    expect(projectIndicators(f)).toEqual({ consumed: 200000, available: 300000, consumedPct: 40, margin: 180000, budgetMargin: 300000 });
    expect(projectIndicators({ ...f, budget_costs: 0 }).consumedPct).toBeNull();
  });

  it("alertes : dépassement, seuil, échéance, sans budget ; rien pour un projet clôturé", () => {
    const base = { ...f, project_code: "P1", status: "active" as const, end_date: "2041-12-31" };
    expect(projectAlerts(base, "2041-06-01", 90)).toEqual([]);
    expect(projectAlerts({ ...base, actual_costs: 450000 }, "2041-06-01", 90)).toEqual([{ level: "error", message: "Budget dépassé de 30000" }]);
    expect(projectAlerts({ ...base, actual_costs: 380000 }, "2041-06-01", 90)).toEqual([{ level: "warning", message: "92 % du budget consommé" }]);
    expect(projectAlerts({ ...base, budget_costs: 0 }, "2042-01-02", 90).map((a) => a.message)).toEqual(["Aucun budget de charges", "Échéance du 2041-12-31 dépassée"]);
    expect(projectAlerts({ ...base, status: "closed", actual_costs: 9e9 }, "2041-06-01", 90)).toEqual([]);
  });
});
