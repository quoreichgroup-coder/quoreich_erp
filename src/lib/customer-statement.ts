/**
 * Relevé de compte client : mouvements du livre auxiliaire (débit = facture, annulation
 * d'encaissement ; crédit = encaissement, avoir), solde d'ouverture à la veille de la période, puis
 * solde progressif ligne à ligne. Ordre : date, puis débits avant crédits le même jour (une facture
 * précède son encaissement), puis numéro de pièce.
 */
export interface StatementMovement {
  date: string;
  piece: string;
  label: string;
  debit: number;
  credit: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function customerStatement(movements: StatementMovement[], from: string, to: string) {
  const sorted = [...movements].sort((a, b) =>
    a.date.localeCompare(b.date) || (b.debit - a.debit) || a.piece.localeCompare(b.piece));
  const opening = cents(sorted.filter((m) => m.date < from).reduce((s, m) => s + m.debit - m.credit, 0));
  let balance = opening;
  const rows = sorted.filter((m) => m.date >= from && m.date <= to).map((m) => {
    balance = cents(balance + m.debit - m.credit);
    return { ...m, balance };
  });
  const debit = cents(rows.reduce((s, r) => s + r.debit, 0));
  const credit = cents(rows.reduce((s, r) => s + r.credit, 0));
  return { opening, rows, debit, credit, closing: cents(opening + debit - credit) };
}
