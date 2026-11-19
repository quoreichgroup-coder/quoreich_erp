/*
 * Rapports d'approvisionnement (logique pure, testée) à partir des commandes et réceptions réelles :
 * dépenses engagées par fournisseur et par catégorie de fournisseur, commandes par mois, délai de
 * livraison (commande → réception validée) et taux de livraison à la date promise (V56).
 */
export const ENGAGED_PO_STATUSES = ["approved", "ordered", "partially_received", "received", "closed"];

export interface ReportPO {
  id: string; po_number: string; order_date: string; expected_date: string | null; total: number; status: string;
  supplier: string; category: string | null;
}
export interface ReportGR { po_id: string; receipt_date: string; status: string }

const month = (d: string) => d.slice(0, 7);
const days = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

export function engagedOrders(pos: ReportPO[], year: string): ReportPO[] {
  return pos.filter((p) => ENGAGED_PO_STATUSES.includes(p.status) && p.order_date?.startsWith(year));
}

export function spendBy(pos: ReportPO[], key: "supplier" | "category"): { label: string; amount: number; orders: number; pct: number }[] {
  const m = new Map<string, { amount: number; orders: number }>();
  for (const p of pos) {
    const k = key === "supplier" ? p.supplier || "Fournisseur inconnu" : p.category?.trim() || "Sans catégorie";
    const v = m.get(k) ?? { amount: 0, orders: 0 };
    v.amount += Number(p.total) || 0; v.orders += 1; m.set(k, v);
  }
  const total = [...m.values()].reduce((s, v) => s + v.amount, 0);
  return [...m.entries()].map(([label, v]) => ({ label, ...v, pct: total ? Math.round((v.amount / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export function ordersByMonth(pos: ReportPO[], year: string): { month: string; amount: number; orders: number }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, "0")}`;
    const list = pos.filter((p) => month(p.order_date) === m);
    return { month: m, amount: list.reduce((s, p) => s + (Number(p.total) || 0), 0), orders: list.length };
  });
}

/**
 * Délai et ponctualité : pour chaque commande, la première réception validée. Délai = jours entre la
 * commande et cette réception ; à l'heure = réception au plus tard à la date promise (si elle existe).
 */
export function deliveryPerformance(pos: ReportPO[], grs: ReportGR[]) {
  const first = new Map<string, string>();
  for (const g of grs) {
    if (g.status !== "completed" || !g.receipt_date) continue;
    const cur = first.get(g.po_id);
    if (!cur || g.receipt_date < cur) first.set(g.po_id, g.receipt_date);
  }
  const rows = pos.filter((p) => first.has(p.id)).map((p) => {
    const r = first.get(p.id)!;
    return { po: p, receipt: r, lead: Math.max(0, days(p.order_date, r)), onTime: p.expected_date ? r <= p.expected_date : null };
  });
  const byMonth = new Map<string, number[]>();
  for (const r of rows) { const k = month(r.receipt); byMonth.set(k, [...(byMonth.get(k) ?? []), r.lead]); }
  const dated = rows.filter((r) => r.onTime !== null);
  return {
    received: rows.length,
    averageLead: rows.length ? Math.round((rows.reduce((s, r) => s + r.lead, 0) / rows.length) * 10) / 10 : null,
    onTimeRate: dated.length ? Math.round((dated.filter((r) => r.onTime).length / dated.length) * 1000) / 10 : null,
    byMonth: [...byMonth.entries()].sort().map(([m, l]) => ({ month: m, days: Math.round((l.reduce((a, b) => a + b, 0) / l.length) * 10) / 10 })),
    bySupplier: [...new Set(rows.map((r) => r.po.supplier))].map((s) => {
      const l = rows.filter((r) => r.po.supplier === s);
      const d = l.filter((r) => r.onTime !== null);
      return { supplier: s, received: l.length, averageLead: Math.round((l.reduce((a, r) => a + r.lead, 0) / l.length) * 10) / 10,
        onTimeRate: d.length ? Math.round((d.filter((r) => r.onTime).length / d.length) * 1000) / 10 : null };
    }).sort((a, b) => b.received - a.received),
  };
}
