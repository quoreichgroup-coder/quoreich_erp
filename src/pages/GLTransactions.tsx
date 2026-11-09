import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookOpen, FileText, RefreshCcw, Search, Plus, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "manual", label: "Manual Entries", icon: FileText },
  { id: "auto", label: "Auto-Generated", icon: RefreshCcw },
  { id: "recurring", label: "Recurring", icon: BookOpen },
];

const manualEntries = [
  { id: "JE-2025-0042", date: "2025-02-15", journal: "OD", ref: "ADJ-FEB", description: "Month-end accrual adjustment", debit: 2500000, credit: 2500000, status: "posted", user: "A. Diallo" },
  { id: "JE-2025-0041", date: "2025-02-14", journal: "OD", ref: "PROV-FEB", description: "Provision for bad debts", debit: 1800000, credit: 1800000, status: "validated", user: "M. Koné" },
  { id: "JE-2025-0040", date: "2025-02-13", journal: "OD", ref: "RECLSS-01", description: "Reclassification entry", debit: 5000000, credit: 5000000, status: "draft", user: "S. Traoré" },
];

const autoEntries = [
  { id: "AUTO-2025-0120", date: "2025-02-15", source: "AR", ref: "INV-2025-0089", description: "Customer invoice posting", debit: 12500000, credit: 12500000, status: "posted" },
  { id: "AUTO-2025-0119", date: "2025-02-15", source: "AP", ref: "APINV-2025-0045", description: "Supplier invoice posting", debit: 22000000, credit: 22000000, status: "posted" },
  { id: "AUTO-2025-0118", date: "2025-02-14", source: "AR", ref: "REC-2025-0034", description: "Receipt posting", debit: 8750000, credit: 8750000, status: "posted" },
];

const recurringEntries = [
  { id: "REC-001", description: "Monthly rent expense", journal: "OD", frequency: "Monthly", nextRun: "2025-03-01", amount: 3500000, status: "active" },
  { id: "REC-002", description: "Depreciation — Fixed Assets", journal: "OD", frequency: "Monthly", nextRun: "2025-03-01", amount: 1200000, status: "active" },
  { id: "REC-003", description: "Insurance prepaid amortization", journal: "OD", frequency: "Monthly", nextRun: "2025-03-01", amount: 450000, status: "paused" },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function GLTransactions() {
  const [activeTab, setActiveTab] = useState("manual");
  const [search, setSearch] = useState("");

  return (
    <PageShell>
      <Breadcrumb items={[
        { label: "Finance" },
        { label: "General Ledger", href: "/journal" },
        { label: "Transactions" },
      ]} />

      <GuidanceBanner title="GL Transactions" description="View and manage manual journal entries, auto-generated postings from sub-ledgers, and recurring entries." />

      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "manual" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">Manual Journal Entries</h3>
            <div className="flex gap-2">
              <div className="relative w-48">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                <Input placeholder="Search…" className="pl-8 h-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1"><Plus className="w-3 h-3" />New Entry</Button>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["ID", "Date", "Journal", "Ref", "Description", "Debit", "Credit", "Status", "User"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {manualEntries.filter(e => e.description.toLowerCase().includes(search.toLowerCase())).map(e => (
                <tr key={e.id} className="border-b border-border hover:bg-muted/20 cursor-pointer">
                  <td className="px-3 py-2 font-mono text-primary">{e.id}</td>
                  <td className="px-3 py-2">{e.date}</td>
                  <td className="px-3 py-2">{e.journal}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{e.ref}</td>
                  <td className="px-3 py-2">{e.description}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(e.debit)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(e.credit)}</td>
                  <td className="px-3 py-2"><StatusBadge status={e.status === "posted" ? "success" : e.status === "validated" ? "info" : "warning"} label={e.status} /></td>
                  <td className="px-3 py-2 text-muted-foreground">{e.user}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "auto" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Auto-Generated Entries (Sub-ledger)</h3></div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["ID", "Date", "Source", "Ref", "Description", "Debit", "Credit", "Status"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {autoEntries.map(e => (
                <tr key={e.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-primary">{e.id}</td>
                  <td className="px-3 py-2">{e.date}</td>
                  <td className="px-3 py-2"><StatusBadge status="info" label={e.source} /></td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{e.ref}</td>
                  <td className="px-3 py-2">{e.description}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(e.debit)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(e.credit)}</td>
                  <td className="px-3 py-2"><StatusBadge status="success" label={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "recurring" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">Recurring Entries</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs">+ New Recurring</Button>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["ID", "Description", "Journal", "Frequency", "Next Run", "Amount (XOF)", "Status", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {recurringEntries.map(e => (
                <tr key={e.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono">{e.id}</td>
                  <td className="px-3 py-2 font-medium">{e.description}</td>
                  <td className="px-3 py-2">{e.journal}</td>
                  <td className="px-3 py-2">{e.frequency}</td>
                  <td className="px-3 py-2">{e.nextRun}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(e.amount)}</td>
                  <td className="px-3 py-2"><StatusBadge status={e.status === "active" ? "success" : "warning"} label={e.status} /></td>
                  <td className="px-3 py-2">
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]">{e.status === "active" ? "Pause" : "Resume"}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
