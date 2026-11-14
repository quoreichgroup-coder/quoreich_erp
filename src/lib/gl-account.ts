/**
 * Attributs des comptes (V62, lot PC-1) : libellés français et contrôles identiques à la base
 * (default_gl_account_fields) pour un retour immédiat à la saisie.
 */

export const ACCOUNT_TYPES: [string, string][] = [
  ["asset", "Actif"], ["liability", "Passif"], ["equity", "Capitaux propres"], ["expense", "Charge"], ["revenue", "Produit"],
];
export const POSTING_MODES: [string, string][] = [
  ["manual", "Manuelle et automatique"], ["automatic_only", "Automatique seulement (compte collectif)"], ["blocked", "Bloquée"],
];
export const ANALYTIC_POLICIES: [string, string][] = [
  ["", "Selon les règles analytiques"], ["required", "Obligatoire"], ["optional", "Facultative"], ["forbidden", "Interdite"],
];

export type AttributeDefinition = {
  id: string; key: string; label: string; data_type: "text" | "number" | "date" | "boolean" | "list";
  options: string[] | null; required: boolean; is_active: boolean;
};

export function defaultNormalBalance(type: string): "debit" | "credit" {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

/** Message d'erreur en français, ou null. Un compte de regroupement n'exige pas les attributs obligatoires. */
export function validateCustomAttributes(defs: AttributeDefinition[], values: Record<string, unknown>, isHeader = false): string | null {
  for (const d of defs.filter((x) => x.is_active)) {
    const v = values[d.key];
    const empty = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    if (empty) { if (d.required && !isHeader) return `Attribut « ${d.label} » obligatoire.`; continue; }
    if (d.data_type === "number" && typeof v !== "number") return `Attribut « ${d.label} » : nombre attendu.`;
    if (d.data_type === "boolean" && typeof v !== "boolean") return `Attribut « ${d.label} » : oui / non attendu.`;
    if (d.data_type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return `Attribut « ${d.label} » : date attendue.`;
    if (d.data_type === "list" && !(d.options ?? []).includes(String(v))) return `Attribut « ${d.label} » : valeur hors liste.`;
  }
  return null;
}
