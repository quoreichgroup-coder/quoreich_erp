/**
 * Règlements par tiers (V36) : on choisit le tiers, on ne voit que SES pièces ouvertes, on répartit
 * le montant (SAP F-28 / F-53, Sage « Règlements »). Mêmes règles que record_settlement en base.
 */

export type SettlementKind = "ar" | "ap";

export type OpenItemSource = {
  id: string;
  invoice_number: string;
  due_date: string;
  invoice_date: string;
  total: number;
  amount_paid: number;
  status: string;
  approval_status?: string;
  customer_id?: string;
  supplier_id?: string;
  /** Facture fournisseur en devise (V124) : devise, cours de la facture, total en devise. */
  currency?: string | null;
  exchange_rate?: number | null;
  fx_total?: number | null;
};

/** Restant dû et total dans la devise de la pièce (devise de la société quand currency est vide). */
export type OpenItem = OpenItemSource & { outstanding: number; docTotal: number; docCurrency: string | null };

const CLOSED = new Set(["draft", "paid", "cancelled", "void"]);
const cents = (n: number) => Math.round(n * 100) / 100;

/** Pièces ouvertes du tiers, plus ancienne échéance d'abord. */
export function openItems(kind: SettlementKind, invoices: OpenItemSource[], partyId: string): OpenItem[] {
  if (!partyId) return [];
  return invoices
    .filter((i) => (kind === "ar" ? i.customer_id : i.supplier_id) === partyId)
    .filter((i) => !CLOSED.has(i.status))
    .filter((i) => kind === "ar" || i.approval_status === "approved")
    .map((i): OpenItem => i.currency && i.exchange_rate
      ? { ...i, docCurrency: i.currency, docTotal: Number(i.fx_total ?? 0), outstanding: cents((Number(i.total) - Number(i.amount_paid)) / Number(i.exchange_rate)) }
      : { ...i, docCurrency: null, docTotal: Number(i.total), outstanding: cents(Number(i.total) - Number(i.amount_paid)) })
    .filter((i) => i.outstanding > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.invoice_number.localeCompare(b.invoice_number));
}

/** Devises des pièces ouvertes (null = devise de la société), dans l'ordre d'apparition : un règlement n'en porte qu'une. */
export function itemCurrencies(items: OpenItem[]): (string | null)[] {
  return [...new Set(items.map((i) => i.docCurrency))];
}

/** Répartition automatique d'un montant : plus ancienne échéance d'abord. */
export function autoAllocate(amount: number, items: OpenItem[]): Record<string, number> {
  let rest = cents(amount);
  const out: Record<string, number> = {};
  for (const i of items) {
    if (rest <= 0) break;
    const take = cents(Math.min(rest, i.outstanding));
    out[i.id] = take;
    rest = cents(rest - take);
  }
  return out;
}

/** amount : montant dans la devise de la société ; fx_amount : montant en devise pour une facture en devise (V124). */
export type Allocation = { invoice_id: string; amount?: number; fx_amount?: number };

/** Imputations à envoyer (montants > 0) et premier problème rencontré, en français. */
export function checkAllocations(items: OpenItem[], entered: Record<string, number>, amount: number):
  { allocations: Allocation[]; error: string | null; allocated: number } {
  const allocations: Allocation[] = [];
  for (const i of items) {
    const v = entered[i.id];
    if (v === undefined || v === 0) continue;
    if (!Number.isFinite(v) || v < 0) return { allocations, allocated: 0, error: `Montant invalide sur ${i.invoice_number}.` };
    if (cents(v) > i.outstanding) return { allocations, allocated: 0, error: `${i.invoice_number} : imputé au-delà du restant dû.` };
    allocations.push(i.docCurrency ? { invoice_id: i.id, fx_amount: cents(v) } : { invoice_id: i.id, amount: cents(v) });
  }
  const allocated = cents(allocations.reduce((s, a) => s + (a.fx_amount ?? a.amount ?? 0), 0));
  if (allocations.length === 0) return { allocations, allocated, error: "Imputez le règlement sur au moins une facture." };
  if (cents(amount) !== allocated) {
    return { allocations, allocated, error: `Montant du règlement (${amount}) différent du total imputé (${allocated}).` };
  }
  return { allocations, allocated, error: null };
}

/**
 * Retenue à la source estimée sur un règlement fournisseur (V136) : au prorata du montant imputé sur le TTC de chaque
 * facture. La base calcule le montant exact (le dernier paiement solde la retenue) ; ceci n'est qu'un affichage.
 */
export function withholdingEstimate(items: OpenItem[], allocations: Record<string, number>): number {
  return cents(items.reduce((s, i: any) => {
    const a = allocations[i.id];
    const wh = Number(i.withholding_amount ?? 0);
    const total = Number(i.total ?? 0);
    if (!(a > 0) || !(wh > 0) || !(total > 0) || i.docCurrency) return s;
    return s + Math.min(wh, wh * a / total);
  }, 0));
}
