import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, Download, Building2, Wallet, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useTreasuryKpis, useReconciliationStatus, useCashflowForecast13w, useMyTreasuryRoles,
} from "@/hooks/use-treasury-data";
import { actionTooltip, canDo, maskAmount } from "@/lib/treasury-roles";
import { exportToCSV } from "@/lib/csv-export";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

export default function Treasury() {
  const [acctFilter, setAcctFilter] = useState<string>("all");
  const perms = useMyTreasuryRoles();
  const canExport = canDo(perms, "export");
  const exportTip = actionTooltip(perms, "export", "Exporter CSV");

  const { accounts, txns, totalCash, activeAccounts, unreconciledCount, net7d, net30d, runwayWeeks, forecastNet13w } = useTreasuryKpis();
  const { data: recon = [] } = useReconciliationStatus();
  const { data: forecast = [] } = useCashflowForecast13w();

  const filteredAccounts = useMemo(
    () => acctFilter === "all" ? accounts : accounts.filter(a => a.id === acctFilter),
    [accounts, acctFilter],
  );
  const filteredTxns = useMemo(
    () => acctFilter === "all" ? txns : txns.filter(t => t.bank_account_id === acctFilter),
    [txns, acctFilter],
  );
  const filteredRecon = useMemo(
    () => acctFilter === "all" ? recon : recon.filter(r => r.bank_account_id === acctFilter),
    [recon, acctFilter],
  );

  const iconMap: Record<string, any> = { checking: Building2, savings: Landmark, petty_cash: Wallet };

  const handleExport = () => {
    if (!canExport) return;
    exportToCSV(
      filteredTxns.map(t => ({
        date: t.transaction_date, account: (t.bank_account as any)?.name ?? "",
        type: t.transaction_type, amount: t.amount, reconciled: t.is_reconciled ? "yes" : "no",
        description: t.description ?? "",
      })),
      [
        { key: "date", header: "Date" }, { key: "account", header: "Compte" },
        { key: "type", header: "Type" }, { key: "amount", header: "Montant" },
        { key: "reconciled", header: "Rapproché" }, { key: "description", header: "Description" },
      ],
      `treasury-transactions-${new Date().toISOString().slice(0, 10)}`,
    );
  };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Treasury" }]} />
      <GuidanceBanner title="Treasury Dashboard" description="Position cash, rapprochements et prévision 13 semaines — données live." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Treasury Overview</h1>
        <div className="flex items-center gap-2">
          <Select value={acctFilter} onValueChange={setAcctFilter}>
            <SelectTrigger className="h-8 text-xs w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les comptes</SelectItem>
              {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            size="sm" variant="outline" className="h-8 text-xs gap-1"
            onClick={handleExport} disabled={!canExport}
            aria-label={exportTip} title={exportTip}
          >
            {canExport ? <Download className="w-3 h-3" /> : <Lock className="w-3 h-3" />} Export
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        {[
          { label: "Total Cash", value: maskAmount(perms, totalCash), suffix: "XOF", hint: `${activeAccounts} comptes` },
          { label: "Transactions", value: filteredTxns.length, hint: "filtre actif" },
          { label: "Non rapprochés", value: unreconciledCount, hint: "à traiter" },
          { label: "Net 7j", value: maskAmount(perms, net7d), suffix: "XOF" },
          { label: "Net 30j", value: maskAmount(perms, net30d), suffix: "XOF" },
          { label: "Runway (sem.)", value: runwayWeeks ?? "∞", hint: "à burn rate actuel" },
        ].map(k => (
          <Card key={k.label} className="border-border"><CardContent className="p-3.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{k.label}</span>
            <p className="text-lg font-semibold text-foreground tabular-nums">{k.value}{k.suffix && <span className="text-[10px] font-normal text-muted-foreground"> {k.suffix}</span>}</p>
            {k.hint && <p className="text-[11px] text-muted-foreground">{k.hint}</p>}
          </CardContent></Card>
        ))}
      </div>

      {/* Forecast 13 semaines */}
      <Card className="border-border mb-4">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Prévision flux nets — 13 semaines (net cumulé : {fmt(forecastNet13w)} XOF)</h3>
        </div>
        <CardContent className="p-3">
          {forecast.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">Aucune prévision disponible — créez-en depuis Treasury Master Data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={forecast}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,14%,88%)" />
                <XAxis dataKey="week_start" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(v) => (v / 1_000_000).toFixed(0) + "M"} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmt(v) + " XOF"} />
                <Bar dataKey="net_flow" fill="hsl(210,60%,40%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Reconciliation status */}
      <Card className="border-border mb-4">
        <div className="px-4 py-3 border-b border-border"><h3 className="text-sm font-medium text-foreground">Statut rapprochements</h3></div>
        {filteredRecon.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">Aucun compte à afficher</div>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Compte", "Non rapprochés", "Total", "% Rapproché", "Plus ancien (jours)", "Dernier rapprochement"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>{filteredRecon.map(r => (
              <tr key={r.bank_account_id} className="border-b border-border hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 tabular-nums">{r.unreconciled_count}</td>
                <td className="px-3 py-2 tabular-nums">{r.total_count}</td>
                <td className="px-3 py-2 tabular-nums">{Math.round(Number(r.reconciled_pct || 0))}%</td>
                <td className="px-3 py-2 tabular-nums">{r.oldest_unreconciled_days ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.last_reconciled_at ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      {/* Bank Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        {filteredAccounts.length === 0 ? (
          <Card className="border-border lg:col-span-3"><CardContent className="p-8 text-center text-xs text-muted-foreground">
            Aucun compte bancaire — créez-en un depuis Treasury &gt; Settings
          </CardContent></Card>
        ) : filteredAccounts.map(a => {
          const Icon = iconMap[a.account_type] || Building2;
          return (
            <Card key={a.id} className="border-border"><CardContent className="p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Icon className="w-4 h-4 text-primary" /></div>
                <div>
                  <p className="text-xs font-medium text-foreground">{a.name}</p>
                  <p className="text-[10px] text-muted-foreground">{a.bank_name} · {a.account_number || "—"}</p>
                </div>
              </div>
              <p className="text-lg font-semibold text-foreground tabular-nums">{maskAmount(perms, Number(a.balance))} <span className="text-[10px] font-normal text-muted-foreground">{a.currency}</span></p>
              <div className="flex items-center justify-between mt-2">
                <Badge variant="outline" className="text-[10px]">{a.account_type}</Badge>
                {a.last_reconciled_at && <span className="text-[10px] text-muted-foreground">Rapproché : {a.last_reconciled_at}</span>}
              </div>
            </CardContent></Card>
          );
        })}
      </div>
    </PageShell>
  );
}
