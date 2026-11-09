import { useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { cn } from "@/lib/utils";
import { TrendingUp, Clock, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { useARAging, type ARAgingRow } from "@/hooks/use-ar-data";

const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const fmtCurrency = (n: number) => `${fmt(n)} XOF`;

const BUCKETS: ARAgingRow["bucket"][] = ["current", "1-30", "31-60", "61-90", "90+"];
const BUCKET_LABEL: Record<string, string> = {
  current: "Non échu",
  "1-30": "1–30 j",
  "31-60": "31–60 j",
  "61-90": "61–90 j",
  "90+": "90+ j",
};

function bucketColor(bucket: string, amount: number) {
  if (amount === 0) return "";
  if (bucket === "current") return "bg-success/10 text-success";
  if (bucket === "1-30") return "bg-amber-50 text-amber-700";
  if (bucket === "31-60") return "bg-amber-100 text-amber-800";
  if (bucket === "61-90") return "bg-destructive/10 text-destructive";
  return "bg-destructive/20 text-destructive font-semibold";
}

export default function ARAgingAnalysis() {
  const { data: rows = [], isLoading } = useARAging();

  // Group by customer
  const grouped = useMemo(() => {
    const map = new Map<string, { customer: string; buckets: Record<string, number>; total: number }>();
    for (const r of rows) {
      const key = r.customer_id ?? "unknown";
      const name = r.customer_name ?? "—";
      if (!map.has(key)) {
        map.set(key, { customer: name, buckets: { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 }, total: 0 });
      }
      const g = map.get(key)!;
      g.buckets[r.bucket] = (g.buckets[r.bucket] || 0) + Number(r.outstanding);
      g.total += Number(r.outstanding);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  const bucketTotals = useMemo(() => {
    const t: Record<string, number> = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    grouped.forEach(g => BUCKETS.forEach(b => (t[b] += g.buckets[b] || 0)));
    return t;
  }, [grouped]);

  const grandTotal = grouped.reduce((s, g) => s + g.total, 0);
  const overdueTotal = bucketTotals["1-30"] + bucketTotals["31-60"] + bucketTotals["61-90"] + bucketTotals["90+"];
  const collectionRate = grandTotal > 0 ? Math.round(((grandTotal - overdueTotal) / grandTotal) * 100) : 100;
  const avgDaysOverdue = rows.length > 0
    ? Math.round(rows.reduce((s, r) => s + r.days_overdue, 0) / rows.length)
    : 0;

  const cards = [
    { label: "Total créances ouvertes", value: fmtCurrency(grandTotal), icon: TrendingUp, color: "text-primary" },
    { label: "Créances en retard", value: fmtCurrency(overdueTotal), icon: AlertTriangle, color: "text-destructive" },
    { label: "Retard moyen", value: `${avgDaysOverdue} j`, icon: Clock, color: "text-amber-600" },
    { label: "Taux non échu", value: `${collectionRate}%`, icon: CheckCircle, color: "text-success" },
  ];

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance", href: "/" }, { label: "Receivables", href: "/receivables" }, { label: "Aging Analysis" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">AR Aging Analysis</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Balance âgée client (calcul DB en temps réel)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(card => (
          <div key={card.label} className="card-elevated p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{card.label}</p>
              <card.icon className={cn("w-4 h-4", card.color)} />
            </div>
            <p className="text-lg font-semibold tabular-nums text-foreground">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                {BUCKETS.map(b => (<th key={b} className="text-right">{BUCKET_LABEL[b]}</th>))}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
              ) : grouped.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Aucune créance ouverte</td></tr>
              ) : (
                grouped.map(g => (
                  <tr key={g.customer}>
                    <td className="font-medium text-foreground">{g.customer}</td>
                    {BUCKETS.map(b => (
                      <td key={b} className={cn("text-right tabular-nums", bucketColor(b, g.buckets[b] || 0))}>
                        {g.buckets[b] > 0 ? fmt(g.buckets[b]) : "—"}
                      </td>
                    ))}
                    <td className="text-right tabular-nums font-semibold text-foreground">{fmt(g.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {grouped.length > 0 && (
              <tfoot>
                <tr className="bg-muted/40 font-semibold">
                  <td>Total</td>
                  {BUCKETS.map(b => (
                    <td key={b} className="text-right tabular-nums">{fmt(bucketTotals[b])}</td>
                  ))}
                  <td className="text-right tabular-nums">{fmt(grandTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </PageShell>
  );
}
