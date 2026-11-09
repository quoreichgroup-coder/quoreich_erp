import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, ArrowUpDown, Building2, CreditCard, Search, Plus, BookOpen, Download, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { useBankAccounts, useBankTransactions, useMyTreasuryRoles } from "@/hooks/use-treasury-data";
import { actionTooltip, canDo, maskAmount } from "@/lib/treasury-roles";
import { exportToCSV } from "@/lib/csv-export";

const tabs = [
  { id: "bank", label: "Bank Transactions", icon: Building2 },
  { id: "transfers", label: "Internal Transfers", icon: ArrowUpDown },
  { id: "fx", label: "FX Operations", icon: CreditCard },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function TreasuryTransactions() {
  const [activeTab, setActiveTab] = useState("bank");
  const [search, setSearch] = useState("");

  const { data: accounts = [], isLoading: loadingAccounts } = useBankAccounts();
  const { data: txns = [], isLoading: loadingTxns } = useBankTransactions();
  const isLoading = loadingAccounts || loadingTxns;
  const perms = useMyTreasuryRoles();
  const canExport = canDo(perms, "export");
  const canImport = canDo(perms, "import_statement");
  const canViewSensitive = canDo(perms, "view_sensitive");
  const exportTip = actionTooltip(perms, "export", "Exporter CSV");
  const importTip = actionTooltip(perms, "import_statement", "Importer relevé");

  const bankRows = useMemo(() => {
    const accMap = new Map(accounts.map((a: any) => [a.id, a]));
    return txns.map((t: any) => {
      const acc = accMap.get(t.bank_account_id) as any;
      return {
        id: t.id.slice(0, 12).toUpperCase(),
        date: t.transaction_date,
        bank: acc?.bank_name || "—",
        type: t.transaction_type,
        ref: t.reference || "—",
        description: t.description || "—",
        amount: Number(t.amount),
        reconciled: t.is_reconciled,
      };
    });
  }, [txns, accounts]);

  const filtered = bankRows.filter(t => t.description.toLowerCase().includes(search.toLowerCase()));

  if (isLoading) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "Finance" }, { label: "Treasury" }, { label: "Transactions" }]} />
        <Skeleton className="h-96" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Treasury", href: "/treasury" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Treasury Transactions" description="Bank movements, internal transfers, and foreign exchange operations from live data." />

      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "bank" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">Bank Transactions ({bankRows.length})</h3>
            <div className="flex gap-2">
              <div className="relative w-48"><Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                <Input placeholder="Search…" className="pl-8 h-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} /></div>
              <Button
                size="sm" variant="outline" className="h-8 text-xs gap-1"
                disabled={!canImport} aria-label={importTip} title={importTip}
              >
                {canImport ? <Plus className="w-3 h-3" /> : <Lock className="w-3 h-3" />}Import
              </Button>
              <Button
                size="sm" variant="outline" className="h-8 text-xs gap-1"
                disabled={!canExport} aria-label={exportTip} title={exportTip}
                onClick={() => {
                  if (!canExport) return;
                  exportToCSV(
                    filtered.map(t => ({ id: t.id, date: t.date, bank: t.bank, type: t.type, ref: t.ref, description: t.description, amount: t.amount, reconciled: t.reconciled ? "yes" : "no" })),
                    [
                      { key: "id", header: "ID" }, { key: "date", header: "Date" }, { key: "bank", header: "Banque" },
                      { key: "type", header: "Type" }, { key: "ref", header: "Réf" }, { key: "description", header: "Description" },
                      { key: "amount", header: "Montant" }, { key: "reconciled", header: "Rapproché" },
                    ],
                    `treasury-transactions-${new Date().toISOString().slice(0, 10)}`,
                  );
                }}
              >
                {canExport ? <Download className="w-3 h-3" /> : <Lock className="w-3 h-3" />}Export CSV
              </Button>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["ID", "Date", "Bank", "Type", "Ref", "Description", "Amount (XOF)", "Reconciled"]
                .filter(h => canViewSensitive || (h !== "Amount (XOF)" && h !== "Reconciled"))
                .map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={canViewSensitive ? 8 : 6} className="px-3 py-8 text-center text-sm text-muted-foreground">No bank transactions yet.</td></tr>
              ) : filtered.map(t => (
                <tr key={t.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-primary">{t.id}</td>
                  <td className="px-3 py-2">{t.date}</td>
                  <td className="px-3 py-2">{t.bank}</td>
                  <td className="px-3 py-2"><StatusBadge status={t.type === "credit" ? "success" : "error"} label={t.type} /></td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{t.ref}</td>
                  <td className="px-3 py-2">{t.description}</td>
                  {canViewSensitive && (
                    <>
                      <td className={cn("px-3 py-2 text-right font-mono", t.amount >= 0 ? "text-success" : "text-destructive")}>{fmt(t.amount)}</td>
                      <td className="px-3 py-2">{t.reconciled ? "✓" : "—"}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "transfers" && (
        <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
          Internal transfers will appear here once bank accounts are configured and transfers are recorded.
        </div>
      )}

      {activeTab === "fx" && (
        <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
          FX operations will appear here once foreign exchange transactions are recorded.
        </div>
      )}

      <div className="space-y-4 mt-6">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">GL Posting — Treasury</h2>
        </div>
        <GLPostingKPIsLive module="Treasury" />
        <GLBatchHistoryLive module="Treasury" />
      </div>
    </PageShell>
  );
}
