/**
 * Réception de marchandises : ce qui reste à recevoir sur chaque ligne d'une commande.
 *
 * Même règle que la base (on_gr_completed, V34) : seules les réceptions VALIDÉES comptent ;
 * une ligne ne reçoit pas plus que son restant ; une commande se réceptionne si elle est
 * approuvée, commandée ou partiellement reçue.
 */

export type PoLine = { id: string; description: string; quantity: number; unit_cost: number; item_id?: string | null };
export type ReceiptLine = { po_line_id: string | null; quantity_received: number };
export type Receipt = { po_id: string; status: string; lines?: ReceiptLine[] | null };

export const RECEIVABLE_PO_STATUSES = ["approved", "ordered", "partially_received"] as const;

export function isReceivable(status: string): boolean {
  return (RECEIVABLE_PO_STATUSES as readonly string[]).includes(status);
}

export type LineToReceive = PoLine & { received: number; remaining: number };

/** Lignes de la commande avec le déjà-reçu (réceptions validées) et le restant. */
export function linesToReceive(poId: string, poLines: PoLine[], receipts: Receipt[]): LineToReceive[] {
  const received = new Map<string, number>();
  for (const r of receipts) {
    if (r.po_id !== poId || r.status !== "completed") continue;
    for (const l of r.lines ?? []) {
      if (!l.po_line_id) continue;
      received.set(l.po_line_id, (received.get(l.po_line_id) ?? 0) + Number(l.quantity_received || 0));
    }
  }
  return poLines.map((l) => {
    const done = received.get(l.id) ?? 0;
    return { ...l, received: done, remaining: Math.max(Number(l.quantity) - done, 0) };
  });
}

export type ReceiptEntry = { po_line_id: string; item_id?: string | null; quantity: number; remaining: number };

/** Message d'erreur en français, ou null si la saisie est recevable. */
export function validateReceipt(entries: ReceiptEntry[]): string | null {
  for (const e of entries) {
    if (!Number.isFinite(e.quantity) || e.quantity < 0) return "Les quantités reçues doivent être positives.";
    if (e.quantity > e.remaining) return `Sur-réception : ${e.quantity} reçu(s) pour ${e.remaining} restant(s).`;
  }
  if (!entries.some((e) => e.quantity > 0)) return "Saisissez au moins une quantité reçue.";
  return null;
}
