/**
 * Retour fournisseur (V52) : ce qui reste retournable sur chaque ligne d'une réception validée,
 * contrôles de saisie et valeur du retour. Mêmes règles que create_supplier_return :
 * quantité ≤ reçu − déjà retourné, motif obligatoire, au moins une quantité.
 */

export type GrLine = { id: string; po_line_id: string | null; quantity_received: number };
export type PoLineRef = { id: string; description?: string | null; unit_cost: number };
export type ReturnedLine = { gr_line_id: string; po_line_id: string; quantity: number; replacement_expected: boolean };

export type ReturnableLine = GrLine & {
  description: string;
  unit_cost: number;
  returned: number;
  returnable: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function returnableLines(grLines: GrLine[], poLines: PoLineRef[], returns: ReturnedLine[]): ReturnableLine[] {
  const done = new Map<string, number>();
  for (const r of returns) done.set(r.gr_line_id, (done.get(r.gr_line_id) ?? 0) + Number(r.quantity || 0));
  return grLines
    .filter((l) => Number(l.quantity_received) > 0)
    .map((l) => {
      const pl = poLines.find((p) => p.id === l.po_line_id);
      const returned = done.get(l.id) ?? 0;
      return {
        ...l,
        description: pl?.description || "Ligne",
        unit_cost: Number(pl?.unit_cost ?? 0),
        returned,
        returnable: Math.max(Number(l.quantity_received) - returned, 0),
      };
    });
}

export type ReturnEntry = { quantity: number; returnable: number; description: string };

/** Message d'erreur en français, ou null si le retour est recevable. */
export function validateSupplierReturn(entries: ReturnEntry[], reason: string): string | null {
  if (!reason.trim()) return "Le motif du retour est obligatoire.";
  for (const e of entries) {
    if (!Number.isFinite(e.quantity) || e.quantity < 0) return "Les quantités retournées doivent être positives.";
    if (e.quantity > e.returnable) return `« ${e.description} » : ${e.quantity} retourné(s) pour ${e.returnable} retournable(s).`;
  }
  if (!entries.some((e) => e.quantity > 0)) return "Saisissez au moins une quantité à retourner.";
  return null;
}

/** Valeur du retour au coût de commande (arrondi par ligne, comme la base). */
export function returnValue(entries: { quantity: number; unit_cost: number }[]): number {
  return round2(entries.reduce((s, e) => s + round2(e.quantity * e.unit_cost), 0));
}

/** TVA de l'avoir d'un retour : taux moyen de la facture créditée (même calcul que credit_supplier_return). */
export function creditTax(value: number, invoice: { subtotal: number; tax_amount: number }): number {
  return invoice.subtotal > 0 ? round2((value * invoice.tax_amount) / invoice.subtotal) : 0;
}

/** Plafonds d'un avoir fournisseur : HT et TVA de la facture moins les avoirs déjà reçus. */
export function creditNoteRoom(invoice: { subtotal: number; tax_amount: number }, notes: { subtotal: number; tax_amount: number }[]) {
  const sub = notes.reduce((s, n) => s + Number(n.subtotal), 0);
  const tax = notes.reduce((s, n) => s + Number(n.tax_amount), 0);
  return { subtotal: round2(Math.max(invoice.subtotal - sub, 0)), tax: round2(Math.max(invoice.tax_amount - tax, 0)) };
}
