import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, TrendingUp, Building2, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useBankAccounts, useBankTransactions } from "@/hooks/use-treasury-data";
import { buildMonthlyCashFlow } from "@/lib/treasury-cashflow";

const tabs = [
  { id: "position", label: "Position de trésorerie", icon: Building2 },
  { id: "flow", label: "Flux de trésorerie", icon: TrendingUp },
  { id: "bank", label: "Activité bancaire", icon: BarChart3 },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");
const fmtM = (n: number) => (n / 1000000).toFixed(1) + "M";

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function TreasuryReporting() {
  const [activeTab, setActiveTab] = useState("position");
  const accounts = useBankAccounts();
  const txs = useBankTransactions();
  const accs = accounts.data ?? [];
  const totalBalance = accs.filter((c) => c.currency === "XOF" && c.is_active).reduce((s, c) => s + Number(c.balance), 0);
  const flow = useMemo(() => buildMonthlyCashFlow(txs.data ?? [], 6), [txs.data]);

  const perAccount = useMemo(() => {
    const m: Record<string, { count: number; inflow: number; outflow: number; unrec: number }> = {};
    for (const t of txs.data ?? []) {
      const k = t.bank_account_id;
      m[k] ??= { count: 0, inflow: 0, outflow: 0, unrec: 0 };
      m[k].count++;
      const a = Number(t.amount);
      if (a >= 0) m[k].inflow += a; else m[k].outflow += -a;
      if (!t.is_reconciled) m[k].unrec++;
    }
    return m;
  }, [txs.data]);

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Trésorerie", href: "/treasury" }, { label: "Reporting" }]} />
      <GuidanceBanner title="Reporting trésorerie" description="Soldes réels des comptes bancaires et flux issus des transactions enregistrées." />

      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <Button variant="ghost" key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </Button>
        ))}
      </div>

      {(accounts.isError || txs.isError) && (
        <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-3 text-xs text-destructive flex justify-between items-center">
          Impossible de charger les données bancaires.
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { accounts.refetch(); txs.refetch(); }}>Réessayer</Button>
        </div>
      )}

      {activeTab === "position" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-4 flex justify-between items-center">
            <h3 className="text-sm font-semibold text-foreground">Position consolidée (comptes XOF actifs)</h3>
            {accounts.isLoading ? <Skeleton className="h-6 w-40" /> :
              <div className="text-lg font-bold text-foreground">{fmt(totalBalance)} <span className="text-xs text-muted-foreground font-normal">XOF</span></div>}
          </div>
          <div className="bg-card border border-border rounded-lg">
            <div className="p-3 border-b border-border flex justify-between">
              <h3 className="text-sm font-semibold text-foreground">Par compte</h3>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={!accs.length || accounts.isFetching || accounts.isError}
                onClick={() => downloadCsv("position-tresorerie.csv", [
                  ["Compte", "Banque", "Devise", "Solde", "Dernier rapprochement"],
                  ...accs.map((a) => [a.name, a.bank_name ?? "", a.currency, Number(a.balance), a.last_reconciled_at ?? ""]),
                ])}><Download className="w-3 h-3" />Exporter</Button>
            </div>
            {accounts.isLoading ? <div className="p-3 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div> :
              !accs.length ? <p className="p-4 text-xs text-muted-foreground">Aucun compte bancaire enregistré.</p> :
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border bg-muted/30">
                  {["Compte", "Banque", "Devise", "Solde", "Dernier rapprochement"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>))}
                </tr></thead>
                <tbody>
                  {accs.map((c) => (
                    <tr key={c.id} className="border-b border-border hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2">{c.bank_name ?? "—"}</td>
                      <td className="px-3 py-2">{c.currency}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(Number(c.balance))}</td>
                      <td className="px-3 py-2">{c.last_reconciled_at ?? "—"}</td>
                    </tr>))}
                </tbody>
              </table>}
          </div>
        </div>
      )}

      {activeTab === "flow" && (
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Flux sur 6 mois (encaissements / décaissements)</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={txs.isFetching || txs.isError}
              onClick={() => downloadCsv("flux-tresorerie.csv", [["Mois", "Encaissements", "Décaissements", "Net"],
                ...flow.map((f) => [f.month, f.inflow, f.outflow, f.inflow - f.outflow])])}><Download className="w-3 h-3" />Exporter</Button>
          </div>
          {txs.isLoading ? <Skeleton className="h-[300px] w-full" /> :
            !(txs.data ?? []).length ? <p className="text-xs text-muted-foreground">Aucune transaction bancaire sur la période.</p> :
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={flow}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={fmtM} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmt(v) + " XOF"} />
                <Bar dataKey="inflow" name="Encaissements" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="outflow" name="Décaissements" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>}
        </div>
      )}

      {activeTab === "bank" && (
        <div className="bg-card border border-border rounded-lg">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Compte", "Transactions", "Encaissements", "Décaissements", "Non rapprochées"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>))}
            </tr></thead>
            <tbody>
              {accs.map((a) => { const s = perAccount[a.id] ?? { count: 0, inflow: 0, outflow: 0, unrec: 0 }; return (
                <tr key={a.id} className="border-b border-border">
                  <td className="px-3 py-2 font-medium">{a.name}</td>
                  <td className="px-3 py-2">{s.count}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(s.inflow)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(s.outflow)}</td>
                  <td className="px-3 py-2">{s.unrec}</td>
                </tr>); })}
            </tbody>
          </table>
          <p className="p-3 text-[11px] text-muted-foreground">Toutes les transactions enregistrées de la société.</p>
        </div>
      )}
    </PageShell>
  );
}
