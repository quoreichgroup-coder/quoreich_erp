import { useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { HelpIcon } from "@/components/HelpIcon";
import { StatusBadge } from "@/components/StatusBadge";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  FileWarning,
  CalendarClock,
  ChevronRight,
  Filter,
  Loader2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { useAPInvoices, useSuppliers } from "@/hooks/use-ap-data";
import { differenceInDays, format, subMonths, startOfMonth, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useNavigate } from "react-router-dom";

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function AccountsPayable() {
  const { data: invoices = [], isLoading } = useAPInvoices();
  const { data: suppliers = [] } = useSuppliers();
  const navigate = useNavigate();
  const now = new Date();

  // ─── KPIs ───
  const kpis = useMemo(() => {
    const open = invoices.filter(i => i.status !== "paid");
    const totalDebt = open.reduce((s, i) => s + (i.total - i.amount_paid), 0);

    const due7 = open.filter(i => {
      const d = differenceInDays(parseISO(i.due_date), now);
      return d >= 0 && d <= 7;
    });
    const due30 = open.filter(i => {
      const d = differenceInDays(parseISO(i.due_date), now);
      return d >= 0 && d <= 30;
    });
    const overdue = open.filter(i => differenceInDays(parseISO(i.due_date), now) < 0);
    const overdueAmt = overdue.reduce((s, i) => s + (i.total - i.amount_paid), 0);

    return [
      { label: "Total dettes fournisseurs", value: totalDebt, sub: `${open.length} factures`, alert: false, help: "Somme de toutes les factures fournisseurs non soldées." },
      { label: "Paiements à venir (7j)", value: due7.reduce((s, i) => s + (i.total - i.amount_paid), 0), sub: `${due7.length} factures`, alert: false, help: "Factures à échéance dans les 7 prochains jours." },
      { label: "Paiements à venir (30j)", value: due30.reduce((s, i) => s + (i.total - i.amount_paid), 0), sub: `${due30.length} factures`, alert: false, help: "Factures à échéance dans les 30 prochains jours." },
      { label: "Factures en retard", value: overdueAmt, sub: `${overdue.length} factures`, alert: overdueAmt > 0, help: "Factures dont la date d'échéance est dépassée." },
      { label: "Total payé (période)", value: invoices.reduce((s, i) => s + i.amount_paid, 0), sub: `${invoices.filter(i => i.status === "paid").length} factures soldées`, alert: false, help: "Total des paiements enregistrés." },
    ];
  }, [invoices]);

  // ─── Aging data ───
  const agingData = useMemo(() => {
    const open = invoices.filter(i => i.status !== "paid");
    const buckets = [
      { bucket: "0–30 j", min: 0, max: 30, amount: 0 },
      { bucket: "30–60 j", min: 31, max: 60, amount: 0 },
      { bucket: "60–90 j", min: 61, max: 90, amount: 0 },
      { bucket: "90+ j", min: 91, max: 9999, amount: 0 },
    ];
    open.forEach(i => {
      const age = differenceInDays(now, parseISO(i.invoice_date));
      const outstanding = i.total - i.amount_paid;
      const b = buckets.find(b => age >= b.min && age <= b.max);
      if (b) b.amount += outstanding;
    });
    return buckets.map(b => ({ bucket: b.bucket, amount: Math.round(b.amount / 1000) }));
  }, [invoices]);

  // ─── Monthly payment history (last 6 months) ───
  const paymentHistory = useMemo(() => {
    const months: { month: string; paid: number; due: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      const start = startOfMonth(d);
      const end = startOfMonth(subMonths(now, i - 1));
      const label = format(d, "MMM", { locale: fr });

      const dueAmt = invoices
        .filter(inv => { const dd = parseISO(inv.due_date); return dd >= start && dd < end; })
        .reduce((s, inv) => s + inv.total, 0);

      const paidAmt = invoices
        .filter(inv => inv.status === "paid" && parseISO(inv.invoice_date) >= start && parseISO(inv.invoice_date) < end)
        .reduce((s, inv) => s + inv.amount_paid, 0);

      months.push({ month: label, paid: Math.round(paidAmt / 1000), due: Math.round(dueAmt / 1000) });
    }
    return months;
  }, [invoices]);

  // ─── Unvalidated bills ───
  const unvalidated = useMemo(() =>
    invoices.filter(i => i.approval_status === "pending").slice(0, 5)
  , [invoices]);

  // ─── Upcoming payments ───
  const upcoming = useMemo(() =>
    invoices
      .filter(i => i.status !== "paid" && i.approval_status === "approved")
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .slice(0, 5)
  , [invoices]);

  // ─── Overdue suppliers ───
  const overdueSuppliers = useMemo(() => {
    const overdue = invoices.filter(i => i.status !== "paid" && differenceInDays(parseISO(i.due_date), now) < 0);
    const bySupplier = new Map<string, { supplier: string; amount: number; daysOverdue: number; count: number }>();
    overdue.forEach(i => {
      const name = i.supplier?.name || "Inconnu";
      const days = Math.abs(differenceInDays(parseISO(i.due_date), now));
      const outstanding = i.total - i.amount_paid;
      const existing = bySupplier.get(name);
      if (existing) {
        existing.amount += outstanding;
        existing.daysOverdue = Math.max(existing.daysOverdue, days);
        existing.count++;
      } else {
        bySupplier.set(name, { supplier: name, amount: outstanding, daysOverdue: days, count: 1 });
      }
    });
    return Array.from(bySupplier.values()).sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 5);
  }, [invoices]);

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance", href: "/" }, { label: "AP", href: "/payables" }, { label: "Dashboard" }]} />
      <GuidanceBanner message="Tableau de bord du module Comptes Fournisseurs — suivez les dettes ouvertes, les échéances de paiement et la prévision de décaissement pour optimiser la trésorerie." />

      {/* Global Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filtres :</span>
        </div>
        <select className="h-8 px-3 rounded-md border border-input bg-background text-xs">
          <option>FY 2025-2026</option>
        </select>
        <select className="h-8 px-3 rounded-md border border-input bg-background text-xs">
          <option>Tous les fournisseurs</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="card-elevated p-4">
            <div className="flex items-start justify-between">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium leading-tight">
                {k.label}
                <HelpIcon text={k.help} />
              </p>
            </div>
            <p className={`text-xl font-semibold tabular-nums mt-2 ${k.alert ? "text-destructive" : "text-foreground"}`}>
              {fmt(k.value)} <span className="text-xs font-normal text-muted-foreground">XOF</span>
            </p>
            <div className="flex items-center gap-1 mt-1.5">
              {k.alert ? (
                <TrendingUp className="w-3 h-3 text-destructive" />
              ) : (
                <TrendingDown className="w-3 h-3 text-success" />
              )}
              <span className={`text-[11px] font-medium ${k.alert ? "text-destructive" : "text-muted-foreground"}`}>
                {k.sub}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Aging */}
        <div className="card-elevated p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Antériorité des dettes
              <HelpIcon text="Répartition des factures fournisseurs ouvertes par tranche d'âge." />
            </p>
            <span className="text-[10px] text-muted-foreground">(en milliers XOF)</span>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                  formatter={(value: number) => [`${fmt(value * 1000)} XOF`, "Montant"]}
                />
                <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-border">
            {agingData.map((d) => (
              <div key={d.bucket} className="text-center">
                <p className="text-[10px] text-muted-foreground">{d.bucket}</p>
                <p className="text-sm font-semibold tabular-nums">{fmt(d.amount * 1000)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Payment History */}
        <div className="card-elevated p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Historique paiements — 6 derniers mois
              <HelpIcon text="Comparaison des paiements effectués vs les montants dus." />
            </p>
            <span className="text-[10px] text-muted-foreground">(en milliers XOF)</span>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={paymentHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                  formatter={(value: number) => [`${fmt(value * 1000)} XOF`]}
                />
                <Legend iconType="line" wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="paid" name="Payé" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))" }} />
                <Line type="monotone" dataKey="due" name="Dû" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Priority Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Unvalidated Bills */}
        <div className="card-elevated">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <FileWarning className="w-4 h-4 text-destructive/70" />
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Factures non validées</p>
            <span className="ml-auto text-[10px] font-semibold bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">{unvalidated.length}</span>
          </div>
          <div className="divide-y divide-border">
            {unvalidated.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">Aucune facture en attente</div>
            ) : unvalidated.map((b) => (
              <div key={b.id} className="px-3 py-2.5 flex items-center justify-between hover:bg-muted/30 transition-colors cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-foreground tabular-nums">{b.invoice_number}</p>
                  <p className="text-xs text-muted-foreground">{b.supplier?.name || "—"}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums">{fmt(b.total)}</p>
                  <p className="text-[10px] text-muted-foreground">{b.invoice_date}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-border">
            <button onClick={() => navigate("/payables/transactions")} className="w-full text-xs text-primary font-medium flex items-center justify-center gap-1 py-1.5 hover:bg-muted/30 rounded transition-colors">
              Voir toutes les factures <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Upcoming Payments */}
        <div className="card-elevated">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-primary/70" />
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Échéances à venir</p>
            <span className="ml-auto text-[10px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded">{upcoming.length}</span>
          </div>
          <div className="divide-y divide-border">
            {upcoming.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">Aucune échéance</div>
            ) : upcoming.map((p) => (
              <div key={p.id} className="px-3 py-2.5 flex items-center justify-between hover:bg-muted/30 transition-colors cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-foreground tabular-nums">{p.invoice_number}</p>
                  <p className="text-xs text-muted-foreground">{p.supplier?.name || "—"}</p>
                </div>
                <div className="text-right flex items-center gap-2">
                  <div>
                    <p className="text-sm font-medium tabular-nums">{fmt(p.total - p.amount_paid)}</p>
                    <p className="text-[10px] text-muted-foreground">{p.due_date}</p>
                  </div>
                  <StatusBadge status={differenceInDays(parseISO(p.due_date), now) < 0 ? "Overdue" : "Approved"} />
                </div>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-border">
            <button onClick={() => navigate("/payables/payment-planning")} className="w-full text-xs text-primary font-medium flex items-center justify-center gap-1 py-1.5 hover:bg-muted/30 rounded transition-colors">
              Planifier les paiements <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Overdue Suppliers */}
        <div className="card-elevated">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Fournisseurs en retard</p>
            <span className="ml-auto text-[10px] font-semibold bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">{overdueSuppliers.length}</span>
          </div>
          <div className="divide-y divide-border">
            {overdueSuppliers.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">Aucun retard</div>
            ) : overdueSuppliers.map((s) => (
              <div key={s.supplier} className="px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{s.supplier}</p>
                  <span className="text-[10px] font-semibold text-destructive tabular-nums">{s.daysOverdue} jours</span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-muted-foreground">Montant : {fmt(s.amount)} XOF</span>
                  <span className="text-[10px] text-muted-foreground">{s.count} facture(s)</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-destructive rounded-full" style={{ width: `${Math.min((s.daysOverdue / 90) * 100, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-border">
            <button onClick={() => navigate("/payables/reporting")} className="w-full text-xs text-primary font-medium flex items-center justify-center gap-1 py-1.5 hover:bg-muted/30 rounded transition-colors">
              Voir le rapport d'antériorité <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
