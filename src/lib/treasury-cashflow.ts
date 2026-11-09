export interface CashTx { transaction_date: string; amount: number | string }

/** Agrège les transactions bancaires réelles en flux mensuels (positif = encaissement). */
export function buildMonthlyCashFlow(txs: CashTx[], months: number, now = new Date()) {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  const map = new Map(keys.map((k) => [k, { month: k, inflow: 0, outflow: 0 }]));
  for (const t of txs) {
    const row = map.get(String(t.transaction_date).slice(0, 7));
    if (!row) continue;
    const a = Number(t.amount);
    if (a >= 0) row.inflow += a; else row.outflow += -a;
  }
  return Array.from(map.values());
}
