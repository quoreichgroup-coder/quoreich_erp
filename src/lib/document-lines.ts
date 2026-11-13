/**
 * Lignes d'une pièce d'achat (demande, commande) : la zone « lignes » du modèle en-tête / lignes /
 * pied. Le pied est TOUJOURS calculé à partir des lignes, jamais saisi (docs/audit-lot3.md,
 * principe transversal) ; la base recalcule de même (colonnes calculées, recompute_po_total).
 */

export type DraftDocLine = { description: string; quantity: string; unitPrice: string };

export const emptyDocLine = (): DraftDocLine => ({ description: "", quantity: "1", unitPrice: "" });

const num = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", "."));
const cents = (n: number) => Math.round(n * 100) / 100;

export function lineAmount(l: DraftDocLine): number {
  const q = num(l.quantity), p = num(l.unitPrice);
  return Number.isFinite(q) && Number.isFinite(p) ? cents(q * p) : 0;
}

export type DocFooter = { lineCount: number; totalQuantity: number; total: number };

export function documentFooter(lines: DraftDocLine[]): DocFooter {
  const used = lines.filter((l) => l.description.trim() !== "");
  return {
    lineCount: used.length,
    totalQuantity: cents(used.reduce((s, l) => s + (Number.isFinite(num(l.quantity)) ? num(l.quantity) : 0), 0)),
    total: cents(used.reduce((s, l) => s + lineAmount(l), 0)),
  };
}

/** Message d'erreur en français, ou null. Une ligne entièrement vide est ignorée. */
export function validateDocLines(lines: DraftDocLine[]): string | null {
  const used = lines.filter((l) => l.description.trim() !== "" || l.unitPrice.trim() !== "");
  if (used.length === 0) return "Ajoutez au moins une ligne.";
  for (const [i, l] of used.entries()) {
    if (l.description.trim() === "") return `Ligne ${i + 1} : libellé manquant.`;
    const q = num(l.quantity), p = num(l.unitPrice);
    if (!Number.isFinite(q) || q <= 0) return `Ligne ${i + 1} : quantité positive requise.`;
    if (!Number.isFinite(p) || p < 0 || l.unitPrice.trim() === "") return `Ligne ${i + 1} : prix unitaire requis.`;
  }
  return null;
}

/** Lignes prêtes à enregistrer (libellé, quantité, prix numériques). */
export function toLines(lines: DraftDocLine[]) {
  return lines
    .filter((l) => l.description.trim() !== "")
    .map((l) => ({ description: l.description.trim(), quantity: num(l.quantity), unitPrice: num(l.unitPrice) }));
}
