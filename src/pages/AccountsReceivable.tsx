import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { HelpIcon } from "@/components/HelpIcon";
import { StatusBadge } from "@/components/StatusBadge";
import { useARInvoices, useCustomers, useARPayments } from "@/hooks/use-ar-data";
import { differenceInDays, subMonths, format, startOfMonth } from "date-fns";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  FileWarning,
  Clock,
  ChevronRight,
  Filter,
  Loader2,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function AccountsReceivable() {
  const [fiscalYear] = useState("2025-2026");
  const [period] = useState("P11 – Février 2026");

  const { data: invoices = [], isLoading: loadingInv } = useARInvoices();
  const { data: customers = [], isLoading: loadingCust } = useCustomers();
  const { data: payments = [] } = useARPayments();

  const stats = useMemo(() => {
    const now = new Date();
    const totalOpen = invoices
      .filter((i) => i.status !== "paid" && i.status !== "cancelled")
      .reduce((s, i) => s + (i.total - i.amount_paid), 0);

    const overdue = invoices
      .filter((i) => i.status !== "paid" && i.status !== "cancelled" && new Date(i.due_date) < now)
      .reduce((s, i) => s + (i.total - i.amount_paid), 0);

    const openInvoices = invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled");
    const dso = openInvoices.length > 0
      ? Math.round(openInvoices.reduce((s, i) => s + differenceInDays(now, new Date(i.invoice_date)), 0) / openInvoices.length)
      : 0;

    const monthStart = startOfMonth(now);
    const collectionsThisMonth = payments
      .filter((p) => new Date(p.payment_date) >= monthStart)
      .reduce((s, p) => s + p.amount, 0);

    // Clients at risk: overdue > 60 days or over credit limit
    const overdueByCustomer = new Map<string, number>();
    invoices.forEach((i) => {
      if (i.status !== "paid" && i.status !== "cancelled" && differenceInDays(now, new Date(i.due_date)) > 60) {
        overdueByCustomer.set(i.customer_id, (overdueByCustomer.get(i.customer_id) || 0) + 1);
      }
    });
    const outstandingByCustomer = new Map<string, number>();
    invoices.forEach((i) => {
      if (i.status !== "paid" && i.status !== "cancelled") {
        outstandingByCustomer.set(i.customer_id, (outstandingByCustomer.get(i.customer_id) || 0) + (i.total - i.amount_paid));
      }
    });
    const creditBreachCustomers = customers.filter((c) =>
      c.credit_limit && (outstandingByCustomer.get(c.id) || 0) > c.credit_limit
    );
    const riskCount = new Set([...overdueByCustomer.keys(), ...creditBreachCustomers.map((c) => c.id)]).size;

    return { totalOpen, overdue, dso, collectionsThisMonth, riskCount };
  }, [invoices, customers, payments]);

  // Aging buckets
  const agingData = useMemo(() => {
    const now = new Date();
    const buckets = [
      { bucket: "0–30 j", min: 0, max: 30, amount: 0 },
      { bucket: "30–60 j", min: 30, max: 60, amount: 0 },
      { bucket: "60–90 j", min: 60, max: 90, amount: 0 },
      { bucket: "90+ j", min: 90, max: Infinity, amount: 0 },
    ];
    invoices.forEach((i) => {
      if (i.status === "paid" || i.status === "cancelled") return;
      const age = differenceInDays(now, new Date(i.invoice_date));
      const outstanding = i.total - i.amount_paid;
      const b = buckets.find((b) => age >= b.min && age < b.max);
      if (b) b.amount += outstanding;
    });
    return buckets.map((b) => ({ bucket: b.bucket, amount: Math.round(b.amount / 1000) }));
  }, [invoices]);

  // Collections last 12 months
  const collectionsData = useMemo(() => {
    const now = new Date();
    const months: { month: string; collected: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = subMonths(now, i);
      const ms = startOfMonth(d);
      const me = startOfMonth(subMonths(now, i - 1));
      const total = payments
        .filter((p) => { const pd = new Date(p.payment_date); return pd >= ms && pd < me; })
        .reduce((s, p) => s + p.amount, 0);
      months.push({ month: format(d, "MMM"), collected: Math.round(total / 1000) });
    }
    return months;
  }, [payments]);

  // Unvalidated (draft) invoices
  const unvalidatedInvoices = useMemo(() =>
    invoices.filter((i) => i.status === "draft").slice(0, 5).map((i) => ({
      id: i.invoice_number, customer: i.customer?.name || "—", amount: i.total, date: i.invoice_date,
    })), [invoices]);

  // Credit limit breaches
  const creditLimitBreaches = useMemo(() => {
    const outstandingByCustomer = new Map<string, number>();
    invoices.forEach((i) => {
      if (i.status !== "paid" && i.status !== "cancelled") {
        outstandingByCustomer.set(i.customer_id, (outstandingByCustomer.get(i.customer_id) || 0) + (i.total - i.amount_paid));
      }
    });
    return customers
      .filter((c) => c.credit_limit && (outstandingByCustomer.get(c.id) || 0) > c.credit_limit)
      .map((c) => ({
        customer: c.name,
        limit: c.credit_limit!,
        outstanding: outstandingByCustomer.get(c.id) || 0,
        excess: (outstandingByCustomer.get(c.id) || 0) - c.credit_limit!,
      }));
  }, [invoices, customers]);

  // Invoices > 60 days overdue
  const aged60Plus = useMemo(() => {
    const now = new Date();
    return invoices
      .filter((i) => i.status !== "paid" && i.status !== "cancelled" && differenceInDays(now, new Date(i.due_date)) > 60)
      .map((i) => ({
        id: i.invoice_number, customer: i.customer?.name || "—", amount: i.total - i.amount_paid,
        daysOverdue: differenceInDays(now, new Date(i.due_date)), status: "Overdue",
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .slice(0, 5);
  }, [invoices]);

  const kpis = [
    { label: "Total créances ouvertes", value: stats.totalOpen, help: "Somme de toutes les factures clients non soldées." },
    { label: "Montant en retard", value: stats.overdue, alert: true, help: "Factures dont la date d'échéance est dépassée." },
    { label: "DSO", value: stats.dso, unit: "jours", help: "Days Sales Outstanding — délai moyen d'encaissement." },
    { label: "Encaissements mois en cours", value: stats.collectionsThisMonth, help: "Total des paiements reçus ce mois." },
    { label: "Clients à risque", value: stats.riskCount, unit: "clients", alert: stats.riskCount > 0, help: "Clients avec retard > 60j ou dépassement crédit." },
  ];

  const isLoading = loadingInv || loadingCust;

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" /> Chargement…
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance", href: "/" }, { label: "AR", href: "/receivables" }, { label: "Dashboard" }]} />
      <GuidanceBanner message="Tableau de bord du module Comptes Clients — suivez les créances ouvertes, l'analyse d'antériorité et les actions prioritaires pour optimiser le recouvrement." />

      {/* ── Global Filters ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filtres :</span>
        </div>
        <select className="h-8 px-3 rounded-md border border-input bg-background text-xs"><option>{fiscalYear}</option></select>
        <select className="h-8 px-3 rounded-md border border-input bg-background text-xs"><option>{period}</option></select>
        <select className="h-8 px-3 rounded-md border border-input bg-background text-xs"><option>Tous les clients</option></select>
        <select className="h-8 px-3 rounded-md border border-input bg-background text-xs"><option>Toutes devises (XOF)</option></select>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="card-elevated p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium leading-tight">
              {k.label}<HelpIcon text={k.help} />
            </p>
            <p className={`text-xl font-semibold tabular-nums mt-2 ${k.alert ? "text-destructive" : "text-foreground"}`}>
              {k.unit ? k.value : fmt(k.value)}{" "}
              <span className="text-xs font-normal text-muted-foreground">{k.unit || "XOF"}</span>
            </p>
          </div>
        ))}
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Aging */}
        <div className="card-elevated p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Analyse d'antériorité<HelpIcon text="Répartition des créances par tranche d'âge." /></p>
            <span className="text-[10px] text-muted-foreground">(en milliers XOF)</span>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} formatter={(value: number) => [`${fmt(value * 1000)} XOF`, "Montant"]} />
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

        {/* Collections */}
        <div className="card-elevated p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Encaissements — 12 derniers mois<HelpIcon text="Encaissements réels par mois." /></p>
            <span className="text-[10px] text-muted-foreground">(en milliers XOF)</span>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={collectionsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} formatter={(value: number) => [`${fmt(value * 1000)} XOF`]} />
                <Legend iconType="line" wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="collected" name="Encaissé" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Priority Actions ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Unvalidated */}
        <div className="card-elevated">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <FileWarning className="w-4 h-4 text-destructive/70" />
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Factures non validées</p>
            <span className="ml-auto text-[10px] font-semibold bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">{unvalidatedInvoices.length}</span>
          </div>
          <div className="divide-y divide-border">
            {unvalidatedInvoices.length === 0 && <p className="p-3 text-xs text-muted-foreground text-center">Aucune facture en brouillon</p>}
            {unvalidatedInvoices.map((inv) => (
              <div key={inv.id} className="px-3 py-2.5 flex items-center justify-between hover:bg-muted/30 transition-colors cursor-pointer">
                <div><p className="text-sm font-medium text-foreground tabular-nums">{inv.id}</p><p className="text-xs text-muted-foreground">{inv.customer}</p></div>
                <div className="text-right"><p className="text-sm font-medium tabular-nums">{fmt(inv.amount)}</p><p className="text-[10px] text-muted-foreground">{inv.date}</p></div>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-border">
            <button className="w-full text-xs text-primary font-medium flex items-center justify-center gap-1 py-1.5 hover:bg-muted/30 rounded transition-colors">Voir toutes les factures <ChevronRight className="w-3 h-3" /></button>
          </div>
        </div>

        {/* Credit Limit Breaches */}
        <div className="card-elevated">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Dépassement limite crédit</p>
            <span className="ml-auto text-[10px] font-semibold bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">{creditLimitBreaches.length}</span>
          </div>
          <div className="divide-y divide-border">
            {creditLimitBreaches.length === 0 && <p className="p-3 text-xs text-muted-foreground text-center">Aucun dépassement</p>}
            {creditLimitBreaches.map((c) => (
              <div key={c.customer} className="px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{c.customer}</p>
                  <span className="text-[10px] font-semibold text-destructive tabular-nums">+{fmt(c.excess)} XOF</span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-muted-foreground">Limite : {fmt(c.limit)}</span>
                  <span className="text-[10px] text-muted-foreground">Encours : {fmt(c.outstanding)}</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-destructive rounded-full" style={{ width: `${Math.min((c.outstanding / c.limit) * 100, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-border">
            <button className="w-full text-xs text-primary font-medium flex items-center justify-center gap-1 py-1.5 hover:bg-muted/30 rounded transition-colors">Gérer les limites <ChevronRight className="w-3 h-3" /></button>
          </div>
        </div>

        {/* >60 days */}
        <div className="card-elevated">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <Clock className="w-4 h-4 text-destructive" />
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Factures &gt; 60 jours</p>
            <span className="ml-auto text-[10px] font-semibold bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">{aged60Plus.length}</span>
          </div>
          <div className="divide-y divide-border">
            {aged60Plus.length === 0 && <p className="p-3 text-xs text-muted-foreground text-center">Aucune facture en retard &gt; 60j</p>}
            {aged60Plus.map((inv) => (
              <div key={inv.id} className="px-3 py-2.5 flex items-center justify-between hover:bg-muted/30 transition-colors cursor-pointer">
                <div><p className="text-sm font-medium text-foreground tabular-nums">{inv.id}</p><p className="text-xs text-muted-foreground">{inv.customer}</p></div>
                <div className="text-right flex items-center gap-3">
                  <div><p className="text-sm font-medium tabular-nums">{fmt(inv.amount)}</p><p className="text-[10px] text-destructive font-medium">{inv.daysOverdue} jours</p></div>
                  <StatusBadge status={inv.status} />
                </div>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-border">
            <button className="w-full text-xs text-primary font-medium flex items-center justify-center gap-1 py-1.5 hover:bg-muted/30 rounded transition-colors">Voir le rapport d'antériorité <ChevronRight className="w-3 h-3" /></button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
