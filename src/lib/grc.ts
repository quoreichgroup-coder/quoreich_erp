/*
 * Risques et conformité (V113) : logique pure partagée par les écrans, alignée sur la base.
 * Criticité = probabilité × impact comparée aux seuils de la société (risk_settings) ; résiduel = après contrôles.
 */

export type RiskStatus = "identified" | "assessed" | "treating" | "accepted" | "closed";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Treatment = "avoid" | "reduce" | "transfer" | "accept";
export type ControlStatus = "not_tested" | "effective" | "partially_effective" | "deficient" | "not_applicable";
export type TestResult = "pass" | "partial" | "fail" | "not_applicable";
export type IssueStatus = "open" | "in_progress" | "closed";
type Tone = "success" | "warning" | "error" | "info" | "neutral";

export interface RiskSettings { scale_max: number; medium_from: number; high_from: number; critical_from: number; appetite_score: number | null; review_days: number | null }
export const DEFAULT_RISK_SETTINGS: RiskSettings = { scale_max: 5, medium_from: 5, high_from: 10, critical_from: 15, appetite_score: null, review_days: null };

export const RISK_STATUS: Record<RiskStatus, [Tone, string]> = {
  identified: ["neutral", "Identifié"], assessed: ["info", "Évalué"], treating: ["warning", "En traitement"], accepted: ["neutral", "Accepté"], closed: ["success", "Clôturé"],
};
export const RISK_LEVEL: Record<RiskLevel, [Tone, string]> = {
  low: ["success", "Faible"], medium: ["info", "Modéré"], high: ["warning", "Élevé"], critical: ["error", "Critique"],
};
export const TREATMENT: Record<Treatment, string> = { avoid: "Éviter", reduce: "Réduire", transfer: "Transférer", accept: "Accepter" };
export const CONTROL_STATUS: Record<ControlStatus, [Tone, string]> = {
  not_tested: ["neutral", "Non testé"], effective: ["success", "Efficace"], partially_effective: ["warning", "Partiellement efficace"],
  deficient: ["error", "Déficient"], not_applicable: ["neutral", "Non applicable"],
};
export const TEST_RESULT: Record<TestResult, [Tone, string]> = {
  pass: ["success", "Conforme"], partial: ["warning", "Partiel"], fail: ["error", "Non conforme"], not_applicable: ["neutral", "Non applicable"],
};
export const ISSUE_STATUS: Record<IssueStatus, [Tone, string]> = { open: ["error", "Ouvert"], in_progress: ["warning", "En cours"], closed: ["success", "Clôturé"] };
export const SEVERITY: Record<RiskLevel, [Tone, string]> = RISK_LEVEL;
export const FREQUENCY: Record<string, string> = { monthly: "Mensuelle", quarterly: "Trimestrielle", semiannual: "Semestrielle", annual: "Annuelle" };

export function riskLevel(score: number | null | undefined, s: RiskSettings): RiskLevel | null {
  if (score == null) return null;
  if (score >= s.critical_from) return "critical";
  if (score >= s.high_from) return "high";
  if (score >= s.medium_from) return "medium";
  return "low";
}

export interface RiskLike { likelihood: number; impact: number; residual_likelihood: number | null; residual_impact: number | null; status: RiskStatus;
  treatment?: Treatment | null; review_date?: string | null; last_assessed_at?: string | null }

/** Score retenu : le résiduel quand il est évalué, sinon l'inhérent. */
export const netScore = (r: RiskLike) => (r.residual_likelihood != null && r.residual_impact != null ? r.residual_likelihood * r.residual_impact : r.likelihood * r.impact);

/** Carte de chaleur : cellule [impact][probabilité] → nombre de risques non clôturés (lignes de l'impact le plus fort au plus faible). */
export function heatMap(risks: RiskLike[], max: number, residual: boolean): number[][] {
  const m = Array.from({ length: max }, () => Array.from({ length: max }, () => 0));
  for (const r of risks) {
    if (r.status === "closed") continue;
    const l = residual ? r.residual_likelihood : r.likelihood, i = residual ? r.residual_impact : r.impact;
    if (l == null || i == null || l < 1 || i < 1 || l > max || i > max) continue;
    m[max - i][l - 1] += 1;
  }
  return m;
}

/** Au-delà de l'appétence (score retenu) et ni accepté ni clôturé : doit être traité. */
export const aboveAppetite = (r: RiskLike, s: RiskSettings) => s.appetite_score != null && r.status !== "closed" && r.status !== "accepted" && netScore(r) > s.appetite_score;

export const isOverdue = (date: string | null | undefined, today: string) => Boolean(date && date < today);

/** Taux de conformité : contrôles efficaces / contrôles actifs applicables ; null sans contrôle. */
export function complianceRate(controls: { status: ControlStatus; is_active: boolean }[]): number | null {
  const applicable = controls.filter((c) => c.is_active && c.status !== "not_applicable");
  if (applicable.length === 0) return null;
  return Math.round((applicable.filter((c) => c.status === "effective").length / applicable.length) * 1000) / 10;
}
