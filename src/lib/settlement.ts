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
};

export type OpenItem = OpenItemSource & { outstanding: number };

const CLOSED = new Set(["draft", "paid", "cancelled", "void"]);
const cents = (n: number) => Math.round(n * 100) / 100;

/** Pièces ouvertes du tiers, plus ancienne échéance d'abord. */
export function openItems(kind: SettlementKind, invoices: OpenItemSource[], partyId: string): OpenItem[] {
  if (!partyId) return [];
  return invoices
    .filter((i) => (kind === "ar" ? i.customer_id : i.supplier_id) === partyId)
    .filter((i) => !CLOSED.has(i.status))
    .filter((i) => kind === "ar" || i.approval_status === "approved")
    .map((i) => ({ ...i, outstanding: cents(Number(i.total) - Number(i.amount_paid)) }))
    .filter((i) => i.outstanding > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.invoice_number.localeCompare(b.invoice_number));
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

export type Allocation = { invoice_id: string; amount: number };

/** Imputations à envoyer (montants > 0) et premier problème rencontré, en français. */
export function checkAllocations(items: OpenItem[], entered: Record<string, number>, amount: number):
  { allocations: Allocation[]; error: string | null; allocated: number } {
  const allocations: Allocation[] = [];
  for (const i of items) {
    const v = entered[i.id];
    if (v === undefined || v === 0) continue;
    if (!Number.isFinite(v) || v < 0) return { allocations, allocated: 0, error: `Montant invalide sur ${i.invoice_number}.` };
    if (cents(v) > i.outstanding) return { allocations, allocated: 0, error: `${i.invoice_number} : imputé au-delà du restant dû.` };
    allocations.push({ invoice_id: i.id, amount: cents(v) });
  }
  const allocated = cents(allocations.reduce((s, a) => s + a.amount, 0));
  if (allocations.length === 0) return { allocations, allocated, error: "Imputez le règlement sur au moins une facture." };
  if (cents(amount) !== allocated) {
    return { allocations, allocated, error: `Montant du règlement (${amount}) différent du total imputé (${allocated}).` };
  }
  return { allocations, allocated, error: null };
}
