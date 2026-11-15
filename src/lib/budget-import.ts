/*
 * Budget : préparation par fichier (V78). Modèle Excel / CSV à colonnes claires (Compte, Intitulé, Section,
 * Période, Montant, Commentaire), relu quel que soit l'ordre des colonnes et avec les en-têtes usuels ; montants
 * à la française (espaces, virgule), périodes « 2041 », « 2041-03 », « 03/2041 », « mars 2041 » ou date Excel.
 * La base refait toutes les vérifications et refuse le fichier entier en listant les anomalies.
 */
export const BUDGET_COLUMN_MAP = {
  account: ["compte", "n° compte", "no compte", "numéro de compte", "code compte", "account", "gl account", "compte général"],
  name: ["intitulé", "libellé", "intitule du compte", "intitulé du compte", "account name", "description"],
  section: ["section", "section analytique", "centre", "centre de coût", "centre de cout", "centre financier", "axe/section", "cost center"],
  period: ["période", "periode", "mois", "period", "month"],
  amount: ["montant", "budget", "prévision", "prevision", "amount", "montant prévu", "montant budgété"],
  comment: ["commentaire", "commentaires", "remarque", "note", "comment"],
} as const;
type Key = keyof typeof BUDGET_COLUMN_MAP;

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function detectBudgetColumns(headers: string[]): Partial<Record<Key, string>> {
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const out: Partial<Record<Key, string>> = {};
  for (const k of Object.keys(BUDGET_COLUMN_MAP) as Key[]) {
    const hit = BUDGET_COLUMN_MAP[k].map(norm).find((c) => byNorm.has(c));
    if (hit) out[k] = byNorm.get(hit);
  }
  return out;
}

/** Montant saisi à la française ou à l'anglaise ; null si illisible. */
export function parseAmount(raw: string): number | null {
  let s = String(raw ?? "").replace(/[\s\u00a0\u202f]/g, "").replace(/(XOF|FCFA|F)$/i, "");
  if (s === "") return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+(,\d+)?$/.test(s)) s = s.replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const MONTHS_SHORT = ["janv", "fevr", "mars", "avr", "mai", "juin", "juil", "aout", "sept", "oct", "nov", "dec"];

/** Période du fichier → « AAAA » ou « AAAA-MM » ; vide = l'exercice ; la base refuse une période hors exercice. */
export function normalizePeriod(raw: string, year: string): string {
  const s = norm(String(raw ?? "")).replace(/\.$/, "");
  if (s === "" || /^annee\b/.test(s) && !/\d{4}/.test(s)) return year;
  let m = s.match(/^(?:annee\s+)?(\d{4})$/);
  if (m) return m[1];
  m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^\d{1,2}\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^([a-z]+)\.?(?:\s+(\d{4}))?$/);
  if (m) {
    const i = MONTHS.indexOf(m[1]) >= 0 ? MONTHS.indexOf(m[1]) : MONTHS_SHORT.indexOf(m[1]);
    if (i >= 0) return `${m[2] ?? year}-${String(i + 1).padStart(2, "0")}`;
  }
  if (/^\d{5}$/.test(s)) {   // date Excel (jours depuis le 30/12/1899)
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return String(raw).trim();
}

export type BudgetImportRow = { line: number; account: string; section: string; period?: string; amount: number | string; comment: string };

/**
 * Lignes du fichier prêtes pour import_budget_lines / import_budget_forecast_lines. Une ligne sans montant est
 * ignorée (modèle pré-rempli de tous les comptes) ; un montant illisible est transmis tel quel pour que la base
 * le signale avec son numéro de ligne.
 */
export function budgetImportRows(records: Record<string, string>[], headers: string[], year: string, withPeriod: boolean) {
  const m = detectBudgetColumns(headers);
  const get = (r: Record<string, string>, k: Key) => (m[k] ? String(r[m[k]!] ?? "").trim() : "");
  const missing = (["account", "amount"] as const).filter((k) => !m[k]).map((k) => (k === "account" ? "Compte" : "Montant"));
  const rows: BudgetImportRow[] = [];
  records.forEach((r, i) => {
    const account = get(r, "account"), rawAmount = get(r, "amount");
    if (!account && !rawAmount) return;
    if (rawAmount === "") return;
    const amount = parseAmount(rawAmount);
    rows.push({ line: i + 2, account, section: get(r, "section"), ...(withPeriod ? { period: normalizePeriod(get(r, "period"), year) } : {}),
      amount: amount ?? rawAmount, comment: get(r, "comment") });
  });
  return { missing, rows };
}

export const periodText = (p: string) => (p.length === 4 ? p : `${p.slice(0, 4)}-${p.slice(5, 7)}`);
