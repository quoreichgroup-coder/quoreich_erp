/**
 * Lignes de facture (V21) : calcul d'aperçu des montants, identique à la base.
 *
 * La base fait foi (compute_ar_invoice_line) : HT = ROUND(quantité × prix × (1 − remise/100), 2),
 * TVA = ROUND(HT × taux/100, 2), arrondis à la ligne, en-tête = somme des lignes. Ce module
 * reproduit exactement ce calcul pour que l'aperçu affiché avant envoi soit celui que la base
 * enregistrera. Le calcul se fait en centièmes entiers pour éviter les erreurs de virgule
 * flottante (0,1 + 0,2), et l'arrondi suit celui de PostgreSQL sur numeric : moitié vers le haut
 * (en valeur absolue).
 */
import type { ApiSchemas } from "@/api";

export type TaxCode = ApiSchemas["TaxCodeView"];

export interface DraftLine {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxCodeId: string;
}

/** Arrondi à 2 décimales comme ROUND(numeric, 2) : moitié loin de zéro, sans dérive flottante. */
export function round2(x: number): number {
  const scaled = Math.abs(x) * 100;
  // Corrige les représentations flottantes juste sous la moitié (1.005 × 100 = 100.49999…).
  const rounded = Math.round(Number(scaled.toPrecision(15)));
  return (Math.sign(x) * rounded) / 100;
}

const num = (s: string) => {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export function lineAmounts(line: DraftLine, taxCodes: TaxCode[]): { net: number; tax: number; valid: boolean } {
  const qty = num(line.quantity);
  const price = num(line.unitPrice);
  const disc = line.discountPct === "" ? 0 : num(line.discountPct);
  const valid = line.description.trim().length > 0 && qty > 0 && price >= 0 && disc >= 0 && disc <= 100;
  if (!valid) return { net: 0, tax: 0, valid: false };
  const net = round2(qty * price * (1 - disc / 100));
  const rate = taxCodes.find((t) => t.id === line.taxCodeId)?.rate ?? 0;
  return { net, tax: round2((net * rate) / 100), valid: true };
}

export function invoiceTotals(lines: DraftLine[], taxCodes: TaxCode[]) {
  const amounts = lines.map((l) => lineAmounts(l, taxCodes));
  const subtotal = round2(amounts.reduce((s, a) => s + a.net, 0));
  const tax = round2(amounts.reduce((s, a) => s + a.tax, 0));
  return { amounts, subtotal, tax, total: round2(subtotal + tax), allValid: amounts.length > 0 && amounts.every((a) => a.valid) };
}

export const emptyLine = (taxCodeId = ""): DraftLine => ({ description: "", quantity: "1", unitPrice: "", discountPct: "", taxCodeId });
