import { detectMapping } from "@/lib/chart-import";

/*
 * Lecture d'un relevé bancaire exporté par la banque (Excel ou CSV, V71) : colonnes reconnues sous
 * leurs noms usuels, montant unique signé ou colonnes Débit / Crédit, montants « 1 234,50 », dates
 * jj/mm/aaaa, aaaa-mm-jj ou numéro de série Excel. Les contrôles comptables sont faits par la base.
 */
export const STATEMENT_COLUMNS: Record<"date" | "label" | "amount" | "debit" | "credit" | "reference", string[]> = {
  date: ["Date", "Date opération", "Date d'opération", "Date comptable", "Date de valeur", "Date valeur", "Booking date", "Value date"],
  label: ["Libellé", "Libellé opération", "Libellé de l'opération", "Description", "Opération", "Détail", "Label", "Narrative"],
  amount: ["Montant", "Montant (XOF)", "Amount", "Mouvement"],
  debit: ["Débit", "Débit (XOF)", "Debit", "Retrait", "Sortie"],
  credit: ["Crédit", "Crédit (XOF)", "Credit", "Versement", "Entrée"],
  reference: ["Référence", "Réf.", "Ref", "Reference", "N° pièce", "Numéro de chèque", "Chèque"],
};
export type StatementMapping = Partial<Record<keyof typeof STATEMENT_COLUMNS, string>>;
export type StatementLine = { date: string; label: string; amount: number; reference: string };

export function detectStatementColumns(headers: string[]): StatementMapping {
  return detectMapping(headers, STATEMENT_COLUMNS) as StatementMapping;
}

export function missingStatementColumns(m: StatementMapping): string[] {
  const out: string[] = [];
  if (!m.date) out.push("Date");
  if (!m.amount && !(m.debit || m.credit)) out.push("Montant (ou Débit / Crédit)");
  return out;
}

/** « 1 234,50 », « -1500 », « 1.234,50 », « (250,00) » → nombre ; NaN si illisible. */
export function parseAmount(raw: string | undefined | null): number {
  let s = String(raw ?? "").trim().replace(/[\s\u00a0\u202f]/g, "").replace(/(XOF|FCFA|CFA|EUR|€)$/i, "");
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : NaN;
}

/** jj/mm/aaaa, jj-mm-aaaa, jj.mm.aaaa, aaaa-mm-jj, ou numéro de série Excel → aaaa-mm-jj ; null si illisible. */
export function parseDate(raw: string | undefined | null): string | null {
  const s = String(raw ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = new Date(Date.UTC(Number(y), Number(m[2]) - 1, Number(m[1])));
    if (d.getUTCMonth() !== Number(m[2]) - 1) return null;
    return d.toISOString().slice(0, 10);
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

export function readStatementLines(records: Record<string, string>[], m: StatementMapping): { lines: StatementLine[]; errors: string[] } {
  const lines: StatementLine[] = [];
  const errors: string[] = [];
  records.forEach((r, i) => {
    const get = (k: keyof StatementMapping) => (m[k] ? String(r[m[k]!] ?? "").trim() : "");
    if (Object.values(r).every((v) => String(v ?? "").trim() === "")) return;
    const date = parseDate(get("date"));
    const amount = m.amount ? parseAmount(get("amount")) : parseAmount(get("credit")) - Math.abs(parseAmount(get("debit")));
    const label = get("label");
    // Ligne de solde (« Solde au… ») ou de total sans date : ignorée.
    if (!date && /solde|total|report/i.test(label + " " + Object.values(r).join(" "))) return;
    if (!date) { errors.push(`ligne ${i + 2} : date illisible (« ${get("date")} »)`); return; }
    if (!Number.isFinite(amount)) { errors.push(`ligne ${i + 2} : montant illisible`); return; }
    if (amount === 0) return;
    lines.push({ date, label, amount: Math.round(amount * 100) / 100, reference: get("reference") });
  });
  return { lines, errors };
}

export function statementSummary(lines: StatementLine[]) {
  const dates = lines.map((l) => l.date).sort();
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  return { from: dates[0] ?? "", to: dates[dates.length - 1] ?? "", total, count: lines.length };
}
