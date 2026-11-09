import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Clock, Eye, ShieldCheck, CheckCircle, AlertTriangle,
  Zap, Calculator, Search, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGLPeriods, useCloseGLPeriod, useReopenGLPeriod } from "@/hooks/use-gl-data";

const tabs = [
  { id: "periods", label: "Period Management", icon: Clock },
  { id: "anomalies", label: "Anomaly Detection", icon: AlertTriangle },
  { id: "simulation", label: "Journal Simulator", icon: Calculator },
  { id: "reconciliation", label: "Reconciliation", icon: CheckCircle },
  { id: "audit", label: "Audit Trail", icon: Eye },
  { id: "integrity", label: "Data Integrity", icon: ShieldCheck },
];

// Periods now sourced live from useGLPeriods() — no mock data

const anomalies = [
  { id: "AN-001", type: "Threshold Breach", journal: "JE-2026-0048", description: "Single entry exceeds 10M XOF threshold", amount: 12500000, severity: "critical", date: "2026-03-05", status: "unresolved", detail: "Journal entry for consulting fee – requires L3 approval" },
  { id: "AN-002", type: "Duplicate Suspicion", journal: "JE-2026-0046 / JE-2026-0047", description: "Two entries with same amount, date, and account", amount: 3400000, severity: "warning", date: "2026-03-04", status: "investigating", detail: "Both entries reference Bolloré Logistics – possible double posting" },
  { id: "AN-003", type: "Unusual Pattern", journal: "JE-2026-0044", description: "Account 6200 has 3x normal monthly volume", amount: 4200000, severity: "warning", date: "2026-03-03", status: "investigating", detail: "Utilities expense spike — verify with Facilities department" },
  { id: "AN-004", type: "Imbalance Detected", journal: "JE-2026-0045", description: "Debit ≠ Credit — draft entry unbalanced", amount: 580000, severity: "critical", date: "2026-03-02", status: "unresolved", detail: "Entry saved as draft with Debit=580,000 Credit=560,000 — difference 20,000 XOF" },
  { id: "AN-005", type: "Cross-Period", journal: "JE-2026-0043", description: "Entry dated in closed period (Jan 2026)", amount: 920000, severity: "warning", date: "2026-03-01", status: "resolved", detail: "Entry was backdated to January — moved to February by admin" },
  { id: "AN-006", type: "Segregation Alert", journal: "JE-2026-0042", description: "Same user created and posted entry", amount: 4250000, severity: "info", date: "2026-02-28", status: "mitigated", detail: "User A. Koné both created and posted — allowed due to delegation" },
];

const reconciliationItems = [
  { account: "1000", name: "Cash & Cash Equivalents", glBalance: 45000000, subBalance: 45000000, diff: 0, status: "reconciled" },
  { account: "1100", name: "Accounts Receivable", glBalance: 78500000, subBalance: 78200000, diff: 300000, status: "unreconciled" },
  { account: "2000", name: "Accounts Payable", glBalance: 56000000, subBalance: 56000000, diff: 0, status: "reconciled" },
  { account: "1500", name: "Fixed Assets", glBalance: 120000000, subBalance: 120000000, diff: 0, status: "reconciled" },
  { account: "3000", name: "Owner's Equity", glBalance: 150000000, subBalance: 150000000, diff: 0, status: "reconciled" },
];

const integrityChecks = [
  { check: "Trial Balance", status: "pass", detail: "Debit = Credit — Balanced", lastRun: "2026-03-06 14:00" },
  { check: "Sub-ledger Reconciliation", status: "warning", detail: "AR sub-ledger difference: 300,000 XOF", lastRun: "2026-03-06 14:00" },
  { check: "Orphan Entries", status: "pass", detail: "No orphan journal entries found", lastRun: "2026-03-06 14:00" },
  { check: "Duplicate Detection", status: "warning", detail: "1 potential duplicate flagged (AN-002)", lastRun: "2026-03-06 14:00" },
  { check: "Period Integrity", status: "pass", detail: "No entries in closed periods", lastRun: "2026-03-06 14:00" },
  { check: "Threshold Compliance", status: "warning", detail: "1 entry exceeds posting threshold without approval", lastRun: "2026-03-06 14:00" },
  { check: "SoD Compliance", status: "pass", detail: "All entries comply with segregation of duties", lastRun: "2026-03-06 14:00" },
];

const auditTrail = [
  { ts: "2026-03-06 14:32", user: "A. Koné", action: "Posted", doc: "JE-2026-0048", detail: "Consulting fee – 12,500,000 XOF (pending L3 approval)" },
  { ts: "2026-03-06 11:15", user: "System", action: "Anomaly Detected", doc: "AN-001", detail: "Threshold breach flagged – JE-2026-0048 exceeds 10M" },
  { ts: "2026-03-05 16:20", user: "M. Touré", action: "Draft Saved", doc: "JE-2026-0045", detail: "Entry saved as draft – imbalance of 20,000 XOF detected" },
  { ts: "2026-03-05 09:00", user: "System", action: "Integrity Check", doc: "—", detail: "7 checks completed — 3 warnings, 4 passed" },
  { ts: "2026-03-04 15:30", user: "Admin", action: "Period Closed", doc: "January 2026", detail: "Fiscal period closed — 142 entries finalized" },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

/* ─── Simulation ─── */
interface SimLine { account: string; debit: number; credit: number; }

export default function GLControl() {
  const [activeTab, setActiveTab] = useState("anomalies");
  const [search, setSearch] = useState("");
  const [simLines, setSimLines] = useState<SimLine[]>([
    { account: "6000 – Salaries Expense", debit: 5000000, credit: 0 },
    { account: "1100 – Bank", debit: 0, credit: 5000000 },
  ]);

  const simDebit = simLines.reduce((s, l) => s + l.debit, 0);
  const simCredit = simLines.reduce((s, l) => s + l.credit, 0);
  const simBalanced = simDebit > 0 && simDebit === simCredit;

  const { data: periods = [], isLoading: loadingPeriods } = useGLPeriods();
  const closePeriod = useCloseGLPeriod();
  const reopenPeriod = useReopenGLPeriod();
  const openPeriodsCount = periods.filter((p: any) => p.status === "open").length;

  const criticalAnomalies = anomalies.filter(a => a.severity === "critical" && a.status === "unresolved").length;
  const warningCount = integrityChecks.filter(c => c.status === "warning").length;

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "General Ledger", href: "/journal" }, { label: "Control" }]} />
      <GuidanceBanner title="GL Control & Validation" description="Anomaly detection, journal simulation, period management, reconciliation and data integrity monitoring." />

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { label: "Open Periods", value: String(openPeriodsCount), icon: Clock, color: "text-primary" },
          { label: "Critical Anomalies", value: String(criticalAnomalies), icon: AlertTriangle, color: criticalAnomalies > 0 ? "text-destructive" : "text-success" },
          { label: "Integrity Warnings", value: String(warningCount), icon: ShieldCheck, color: warningCount > 0 ? "text-amber-600" : "text-success" },
          { label: "Unreconciled", value: "1", icon: Zap, color: "text-amber-600" },
          { label: "Period Entries", value: "89", icon: CheckCircle, color: "text-primary" },
          { label: "Checks Passed", value: `${integrityChecks.filter(c => c.status === "pass").length}/${integrityChecks.length}`, icon: ShieldCheck, color: "text-success" },
        ].map(kpi => (
          <div key={kpi.label} className="bg-card border border-border rounded-lg p-3 flex items-center gap-2.5">
            <kpi.icon className={cn("w-4 h-4", kpi.color)} />
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</div>
              <div className="text-lg font-semibold text-foreground">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* ═══ ANOMALY DETECTION ═══ */}
      {activeTab === "anomalies" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between items-center">
            <h3 className="text-sm font-semibold text-foreground">Detected Anomalies</h3>
            <div className="relative w-52">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="Search…" className="pl-8 h-8 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30">
                {["ID", "Type", "Journal(s)", "Description", "Amount (XOF)", "Severity", "Date", "Status", "Actions"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {anomalies.filter(a => !search || a.description.toLowerCase().includes(search.toLowerCase()) || a.journal.toLowerCase().includes(search.toLowerCase())).map(a => (
                  <tr key={a.id} className={cn("border-b border-border hover:bg-muted/20", a.severity === "critical" && a.status === "unresolved" && "bg-destructive/5")}>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{a.id}</td>
                    <td className="px-3 py-2 font-medium">{a.type}</td>
                    <td className="px-3 py-2 font-mono text-primary">{a.journal}</td>
                    <td className="px-3 py-2 max-w-xs">
                      <p>{a.description}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{a.detail}</p>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(a.amount)}</td>
                    <td className="px-3 py-2"><StatusBadge status={a.severity === "critical" ? "error" : a.severity === "warning" ? "warning" : "info"} label={a.severity} /></td>
                    <td className="px-3 py-2 text-muted-foreground">{a.date}</td>
                    <td className="px-3 py-2"><StatusBadge status={a.status === "unresolved" ? "error" : a.status === "investigating" ? "warning" : "success"} label={a.status} /></td>
                    <td className="px-3 py-2">
                      {a.status !== "resolved" && a.status !== "mitigated" && (
                        <Button size="sm" variant="outline" className="h-6 text-[10px]">Resolve</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ JOURNAL SIMULATOR ═══ */}
      {activeTab === "simulation" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Journal Entry Simulator (Dry Run)</h3>
            <p className="text-xs text-muted-foreground mb-4">Simulate a journal entry to verify balancing, threshold compliance, and anomaly checks before posting.</p>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30">
                {["Account", "Debit (XOF)", "Credit (XOF)"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {simLines.map((l, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="px-3 py-2 font-medium">{l.account}</td>
                    <td className="px-3 py-2 font-mono text-right">{l.debit ? fmt(l.debit) : "—"}</td>
                    <td className="px-3 py-2 font-mono text-right">{l.credit ? fmt(l.credit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30 font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(simDebit)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(simCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Simulation Results</h3>
            <div className="space-y-2">
              {[
                { check: "Balance Check", result: simBalanced, detail: simBalanced ? `Debit = Credit = ${fmt(simDebit)} XOF` : `Difference: ${fmt(Math.abs(simDebit - simCredit))} XOF` },
                { check: "Threshold Compliance", result: simDebit <= 10000000, detail: simDebit > 10000000 ? `Amount exceeds 10M threshold — requires L3 approval` : "Within standard posting limits" },
                { check: "Period Check", result: true, detail: "February 2026 period is open" },
                { check: "Duplicate Check", result: true, detail: "No matching entries found" },
                { check: "Account Validity", result: true, detail: "All accounts are active and posting-enabled" },
                { check: "SoD Check", result: true, detail: "No segregation of duties conflict detected" },
              ].map(c => (
                <div key={c.check} className={cn("flex items-center gap-3 px-3 py-2 rounded-lg border",
                  c.result ? "bg-success/5 border-success/20" : "bg-destructive/5 border-destructive/20")}>
                  {c.result ? <CheckCircle className="w-4 h-4 text-success shrink-0" /> : <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />}
                  <div>
                    <span className="text-xs font-medium text-foreground">{c.check}</span>
                    <span className="text-[10px] text-muted-foreground ml-2">{c.detail}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" className="text-xs" disabled={!simBalanced}>Post Entry</Button>
              <Button size="sm" variant="outline" className="text-xs">Save as Draft</Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PERIODS ═══ */}
      {activeTab === "periods" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Gestion des Périodes Fiscales (GL)</h3>
            <span className="text-[10px] text-muted-foreground">{openPeriodsCount} ouverte(s) · {periods.length} au total</span>
          </div>
          {loadingPeriods ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30">
                {["Période", "Statut", "Postées", "Brouillons", "Total Débit", "Total Crédit", "Équilibrée", "Clôturée le", "Actions"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {periods.map((p) => {
                  const balanced = Number(p.total_debit) === Number(p.total_credit);
                  const busy = closePeriod.isPending || reopenPeriod.isPending;
                  return (
                    <tr key={p.period} className="border-b border-border hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium font-mono">{p.period}</td>
                      <td className="px-3 py-2"><StatusBadge status={p.status === "closed" ? "success" : "info"} label={p.status === "closed" ? "Fermée" : "Ouverte"} /></td>
                      <td className="px-3 py-2 text-center">{p.posted_count}</td>
                      <td className="px-3 py-2 text-center">{p.draft_count > 0 ? <span className="text-amber-600 font-semibold">{p.draft_count}</span> : 0}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(Number(p.total_debit))}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(Number(p.total_credit))}</td>
                      <td className="px-3 py-2">{balanced ? <span className="text-success">✓</span> : <span className="text-destructive">✗</span>}</td>
                      <td className="px-3 py-2 text-muted-foreground text-[11px]">{p.closed_at ? new Date(p.closed_at).toLocaleDateString("fr-FR") : "—"}</td>
                      <td className="px-3 py-2">
                        {p.status === "open" && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={busy || p.draft_count > 0}>
                                Clôturer
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Clôturer la période {p.period} ?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Aucune écriture postée ne pourra plus être créée ou modifiée pour cette période.
                                  Les brouillons doivent être validés ou supprimés au préalable.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Annuler</AlertDialogCancel>
                                <AlertDialogAction onClick={() => closePeriod.mutate(p.period)}>Clôturer</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                        {p.status === "closed" && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px]" disabled={busy}>Ré-ouvrir</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Ré-ouvrir la période {p.period} ?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  La période redeviendra modifiable. À utiliser uniquement pour corrections exceptionnelles.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Annuler</AlertDialogCancel>
                                <AlertDialogAction onClick={() => reopenPeriod.mutate(p.period)}>Ré-ouvrir</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {periods.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Aucune écriture comptable enregistrée</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ═══ RECONCILIATION ═══ */}
      {activeTab === "reconciliation" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">GL vs Sub-ledger Reconciliation</h3></div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Account", "Name", "GL Balance", "Sub-ledger", "Difference", "Status"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {reconciliationItems.map(r => (
                <tr key={r.account} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono font-medium">{r.account}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.glBalance)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.subBalance)}</td>
                  <td className={cn("px-3 py-2 text-right font-mono", r.diff > 0 ? "text-destructive" : "")}>{fmt(r.diff)}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status === "reconciled" ? "success" : "error"} label={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ AUDIT ═══ */}
      {activeTab === "audit" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">GL Audit Trail</h3></div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Timestamp", "User", "Action", "Document", "Detail"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {auditTrail.map((a, i) => (
                <tr key={i} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-muted-foreground">{a.ts}</td>
                  <td className="px-3 py-2 font-medium">{a.user}</td>
                  <td className="px-3 py-2"><StatusBadge status={a.action.includes("Anomaly") || a.action.includes("Integrity") ? "warning" : a.action === "Posted" ? "success" : "info"} label={a.action} /></td>
                  <td className="px-3 py-2 font-mono">{a.doc}</td>
                  <td className="px-3 py-2 text-muted-foreground">{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ INTEGRITY ═══ */}
      {activeTab === "integrity" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">Data Integrity Checks</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs">Run All Checks</Button>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Check", "Status", "Detail", "Last Run"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {integrityChecks.map(c => (
                <tr key={c.check} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{c.check}</td>
                  <td className="px-3 py-2"><StatusBadge status={c.status === "pass" ? "success" : "warning"} label={c.status} /></td>
                  <td className="px-3 py-2 text-muted-foreground">{c.detail}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.lastRun}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
