/*
 * Projets (V111) : logique pure à partir des chiffres de la base (budget par compte, réalisé lu dans les
 * écritures portant la section du projet, engagé des commandes en cours).
 */
export type ProjectStatus = "planned" | "active" | "on_hold" | "closed" | "cancelled";

export const PROJECT_STATUS: Record<ProjectStatus, [string, string]> = {
  planned: ["neutral", "Prévu"], active: ["success", "Actif"], on_hold: ["warning", "Suspendu"], closed: ["info", "Clôturé"], cancelled: ["neutral", "Annulé"],
};

export interface ProjectFigures { budget_costs: number; budget_revenue: number; actual_costs: number; actual_revenue: number; committed: number }

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Indicateurs d'un projet : consommé (réalisé + engagé), disponible, part consommée, marge réalisée. */
export function projectIndicators(f: ProjectFigures) {
  const consumed = round2(f.actual_costs + f.committed);
  return {
    consumed,
    available: round2(f.budget_costs - consumed),
    consumedPct: f.budget_costs > 0 ? Math.round((consumed / f.budget_costs) * 1000) / 10 : null,
    margin: round2(f.actual_revenue - f.actual_costs),
    budgetMargin: round2(f.budget_revenue - f.budget_costs),
  };
}

export interface ProjectAlertInput extends ProjectFigures { project_code: string; status: ProjectStatus; end_date: string | null }

/** Alertes de pilotage : dépassement (consommé > budget), seuil d'alerte atteint, échéance passée, projet sans budget. */
export function projectAlerts(p: ProjectAlertInput, today: string, alertPct: number): { level: "error" | "warning"; message: string }[] {
  const i = projectIndicators(p);
  const out: { level: "error" | "warning"; message: string }[] = [];
  if (p.status !== "active" && p.status !== "on_hold") return out;
  if (p.budget_costs <= 0) out.push({ level: "warning", message: "Aucun budget de charges" });
  else if (i.consumed > p.budget_costs) out.push({ level: "error", message: `Budget dépassé de ${round2(i.consumed - p.budget_costs)}` });
  else if (i.consumedPct != null && i.consumedPct >= alertPct) out.push({ level: "warning", message: `${i.consumedPct} % du budget consommé` });
  if (p.end_date && p.end_date < today) out.push({ level: "warning", message: `Échéance du ${p.end_date} dépassée` });
  return out;
}
