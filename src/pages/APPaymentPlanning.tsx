import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import { Wallet, Calendar, TrendingDown, Shield, GripVertical } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useAPInvoices } from "@/hooks/use-ap-data";

const fmt = (n: number) => n.toLocaleString("fr-FR");
const fmtCurrency = (n: number) => `${fmt(n)} XOF`;

function priorityFromDueDate(dueDate: string, amount: number): "Critical" | "High" | "Normal" | "Low" {
  const days = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
  if (days <= 3) return "Critical";
  if (days <= 7 || amount >= 5000000) return "High";
  if (days <= 30) return "Normal";
  return "Low";
}

function priorityColor(p: string) {
  if (p === "Critical") return "error";
  if (p === "High") return "warning";
  if (p === "Low") return "info";
  return "Current";
}

export default function APPaymentPlanning() {
  const { data: invoices = [], isLoading } = useAPInvoices();
  const [draggedId, setDraggedId] = useState<string | null>(null);

  // Only unpaid/partially paid invoices
  const payments = useMemo(() => {
    return invoices
      .filter(inv => inv.status !== "paid" && inv.status !== "cancelled")
      .map(inv => ({
        id: inv.id,
        supplier: (inv as any).supplier?.name || "—",
        invoiceId: inv.invoice_number,
        dueDate: inv.due_date,
        amount: Number(inv.total) - Number(inv.amount_paid),
        priority: priorityFromDueDate(inv.due_date, Number(inv.total) - Number(inv.amount_paid)),
        method: "Wire Transfer",
      }))
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [invoices]);

  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);

  const thisWeekTotal = payments.filter(p => p.dueDate <= weekEnd).reduce((s, p) => s + p.amount, 0);
  const thisMonthTotal = payments.filter(p => p.dueDate <= monthEnd).reduce((s, p) => s + p.amount, 0);
  const availableCash = 18500000; // Could come from bank_accounts sum in future
  const liquidityBuffer = availableCash - thisMonthTotal;

  // Build cumulative timeline
  const cashTimeline = useMemo(() => {
    const sorted = [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    let cumulative = 0;
    const points: { date: string; cumulative: number; daily: number }[] = [];
    sorted.forEach(p => {
      cumulative += p.amount;
      const existing = points.find(pt => pt.date === p.dueDate);
      if (existing) {
        existing.cumulative = cumulative;
        existing.daily += p.amount;
      } else {
        points.push({ date: p.dueDate, cumulative, daily: p.amount });
      }
    });
    return points;
  }, [payments]);

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance", href: "/" }, { label: "Payables", href: "/payables" }, { label: "Payment Planning" }]} />
      <h1 className="text-xl font-semibold text-foreground">Payment Planning</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Payable This Week", value: fmtCurrency(thisWeekTotal), icon: Calendar, color: "text-destructive" },
          { label: "Payable This Month", value: fmtCurrency(thisMonthTotal), icon: TrendingDown, color: "text-amber-600" },
          { label: "Available Cash", value: fmtCurrency(availableCash), icon: Wallet, color: "text-success" },
          { label: "Liquidity Buffer", value: fmtCurrency(liquidityBuffer), icon: Shield, color: liquidityBuffer > 0 ? "text-success" : "text-destructive" },
        ].map(card => (
          <div key={card.label} className="card-elevated p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{card.label}</p>
              <card.icon className={cn("w-4 h-4", card.color)} />
            </div>
            <p className="text-lg font-semibold tabular-nums text-foreground">{card.value}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Chargement…</div>
      ) : (
        <>
          <div className="card-elevated overflow-hidden">
            <div className="p-3 border-b border-border">
              <p className="text-xs font-medium text-foreground">Payment Schedule</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{payments.length} factures en attente de paiement</p>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-8"></th>
                    <th>Supplier</th>
                    <th>Invoice</th>
                    <th>Due Date</th>
                    <th className="text-right">Amount</th>
                    <th>Priority</th>
                    <th>Method</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Aucun paiement planifié.</td></tr>
                  ) : payments.map(pay => (
                    <tr key={pay.id} draggable onDragStart={() => setDraggedId(pay.id)} onDragEnd={() => setDraggedId(null)} className={cn("cursor-grab", draggedId === pay.id && "opacity-50")}>
                      <td><GripVertical className="w-3.5 h-3.5 text-muted-foreground" /></td>
                      <td className="font-medium text-foreground">{pay.supplier}</td>
                      <td className="tabular-nums text-muted-foreground">{pay.invoiceId}</td>
                      <td className={cn("tabular-nums", pay.dueDate <= today && "text-destructive font-medium")}>{pay.dueDate}</td>
                      <td className="text-right tabular-nums font-medium">{fmt(pay.amount)}</td>
                      <td><StatusBadge status={priorityColor(pay.priority)} label={pay.priority} /></td>
                      <td className="text-xs text-muted-foreground">{pay.method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {cashTimeline.length > 0 && (
            <div className="card-elevated p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-4">Cash Outflow Timeline</p>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cashTimeline}>
                    <defs>
                      <linearGradient id="outflowGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(0, 45%, 45%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(0, 45%, 45%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 88%)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000000).toFixed(0)}M`} />
                    <Tooltip formatter={(value: number, name: string) => [fmtCurrency(value), name === "cumulative" ? "Cumulative" : "Daily"]} contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))" }} />
                    <Area type="monotone" dataKey="cumulative" stroke="hsl(0, 45%, 45%)" fill="url(#outflowGrad)" strokeWidth={2} name="cumulative" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
