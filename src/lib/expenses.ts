/*
 * Notes de frais (V109) : logique pure, identique aux règles de la base, pour l'aperçu à l'écran.
 * La base reste juge : la soumission refuse ce que cet aperçu signale.
 */
export type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "posted" | "paid" | "cancelled";

export const EXPENSE_STATUS: Record<ExpenseStatus, [string, string]> = {
  draft: ["neutral", "Brouillon"], submitted: ["warning", "En approbation"], approved: ["info", "Approuvée"],
  rejected: ["error", "Rejetée"], posted: ["info", "Comptabilisée"], paid: ["success", "Remboursée"], cancelled: ["neutral", "Annulée"],
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** TVA comprise dans un montant TTC : TTC × taux / (100 + taux), arrondie au centime ; HT = TTC − TVA. */
export function splitTtc(ttc: number, rate: number | null | undefined): { net: number; tax: number } {
  const tax = rate && rate > 0 ? round2((ttc * rate) / (100 + rate)) : 0;
  return { net: round2(ttc - tax), tax };
}

export interface PolicyCategory { id: string; name: string; receipt_required_above: number | null; max_amount_per_line: number | null; is_active: boolean }
export interface PolicySettings { receipt_required_above: number | null; max_report_amount: number | null; late_submission_days: number | null }
export interface PolicyLine { expense_date: string; category_id: string | null; amount: number; receipt_ref: string | null; on_rate?: boolean }

/** Écarts aux règles de la société, dans les mêmes termes que le refus de la base. */
export function policyIssues(lines: PolicyLine[], categories: PolicyCategory[], settings: PolicySettings | null, today: string): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out: string[] = [];
  if (lines.length === 0) out.push("Une note sans dépense ne se soumet pas");
  lines.forEach((l, i) => {
    const n = i + 1;
    const c = l.category_id ? byId.get(l.category_id) : undefined;
    if (!c) { out.push(`ligne ${n} : catégorie manquante`); return; }
    if (!c.is_active) out.push(`ligne ${n} : catégorie ${c.name} inactive`);
    if (!(l.amount > 0)) out.push(`ligne ${n} : montant à saisir`);
    const seuil = c.receipt_required_above ?? settings?.receipt_required_above ?? null;
    // Indemnité au barème : forfait, pas de justificatif de montant (comme la base).
    if (!l.on_rate && seuil != null && l.amount >= seuil && !(l.receipt_ref ?? "").trim()) out.push(`ligne ${n} : justificatif exigé à partir de ${seuil}`);
    if (c.max_amount_per_line != null && l.amount > c.max_amount_per_line) out.push(`ligne ${n} : dépasse le plafond de la catégorie ${c.name} (${c.max_amount_per_line})`);
    if (settings?.late_submission_days != null && l.expense_date) {
      const limit = new Date(today); limit.setDate(limit.getDate() - settings.late_submission_days);
      if (l.expense_date < limit.toISOString().slice(0, 10)) out.push(`ligne ${n} : au-delà du délai de ${settings.late_submission_days} jours`);
    }
  });
  const total = lines.reduce((s, l) => s + (l.amount || 0), 0);
  if (settings?.max_report_amount != null && total > settings.max_report_amount) out.push(`total ${total} au-delà du plafond par note (${settings.max_report_amount})`);
  return out;
}

/** Totaux par clé (catégorie, salarié, mois) des notes retenues. */
export function sumBy<T>(rows: T[], key: (r: T) => string, amount: (r: T) => number): { label: string; amount: number; count: number }[] {
  const m = new Map<string, { amount: number; count: number }>();
  for (const r of rows) { const k = key(r) || "—"; const v = m.get(k) ?? { amount: 0, count: 0 }; v.amount += amount(r); v.count += 1; m.set(k, v); }
  return [...m.entries()].map(([label, v]) => ({ label, amount: round2(v.amount), count: v.count })).sort((a, b) => b.amount - a.amount);
}

/** Contre-valeur d'un montant en devise au cours saisi, arrondie au centime (comme la base). */
export function convert(original: number, rate: number): number {
  return round2(original * rate);
}
