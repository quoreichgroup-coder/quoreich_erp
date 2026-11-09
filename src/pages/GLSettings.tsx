import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, BookOpen, Calendar, FileText, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "general", label: "General", icon: Settings },
  { id: "journals", label: "Journal Types", icon: BookOpen },
  { id: "fiscal", label: "Fiscal Calendar", icon: Calendar },
  { id: "numbering", label: "Numbering", icon: FileText },
  { id: "currency", label: "Currency", icon: Globe },
];

const journalTypes = [
  { code: "VT", name: "Sales Journal", autoPost: true, reversible: false, active: true },
  { code: "AC", name: "Purchases Journal", autoPost: true, reversible: false, active: true },
  { code: "BQ", name: "Bank Journal", autoPost: false, reversible: false, active: true },
  { code: "OD", name: "Miscellaneous", autoPost: false, reversible: true, active: true },
  { code: "AN", name: "Opening Entries", autoPost: false, reversible: false, active: true },
  { code: "CL", name: "Closing Entries", autoPost: false, reversible: false, active: true },
];

const fiscalPeriods = [
  { month: "January", start: "2025-01-01", end: "2025-01-31", status: "closed" },
  { month: "February", start: "2025-02-01", end: "2025-02-28", status: "open" },
  { month: "March", start: "2025-03-01", end: "2025-03-31", status: "future" },
  { month: "April", start: "2025-04-01", end: "2025-04-30", status: "future" },
];

export default function GLSettings() {
  const [activeTab, setActiveTab] = useState("general");

  return (
    <PageShell>
      <Breadcrumb items={[
        { label: "Finance" },
        { label: "General Ledger", href: "/journal" },
        { label: "Settings" },
      ]} />

      <GuidanceBanner title="GL Settings" description="Configure journal types, fiscal calendar, numbering series and currency for the General Ledger module." />

      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && (
        <div className="bg-card border border-border rounded-lg p-5 space-y-5 max-w-2xl">
          <h3 className="text-sm font-semibold text-foreground">General GL Settings</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label className="text-xs">Default Journal</Label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs">
                {journalTypes.map(j => <option key={j.code}>{j.code} — {j.name}</option>)}
              </select></div>
            <div className="space-y-1.5"><Label className="text-xs">Posting Mode</Label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs">
                <option>Real-time</option><option>Batch</option>
              </select></div>
            <div className="space-y-1.5"><Label className="text-xs">Require Balanced Entries</Label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs">
                <option>Yes — Strict</option><option>Warning only</option>
              </select></div>
            <div className="space-y-1.5"><Label className="text-xs">Auto-reverse Accruals</Label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs">
                <option>Enabled</option><option>Disabled</option>
              </select></div>
          </div>
          <Button size="sm" className="text-xs">Save Changes</Button>
        </div>
      )}

      {activeTab === "journals" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">Journal Types</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs">+ Add Journal</Button>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Code", "Name", "Auto-post", "Reversible", "Active"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {journalTypes.map(j => (
                <tr key={j.code} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono font-medium">{j.code}</td>
                  <td className="px-3 py-2">{j.name}</td>
                  <td className="px-3 py-2">{j.autoPost ? "✓" : "—"}</td>
                  <td className="px-3 py-2">{j.reversible ? "✓" : "—"}</td>
                  <td className="px-3 py-2">{j.active ? <span className="text-success">●</span> : <span className="text-muted-foreground">●</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "fiscal" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Fiscal Calendar — FY 2025</h3></div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Month", "Start", "End", "Status"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {fiscalPeriods.map(p => (
                <tr key={p.month} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{p.month}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{p.start}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{p.end}</td>
                  <td className="px-3 py-2"><span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded",
                    p.status === "closed" ? "bg-success/15 text-success" : p.status === "open" ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"
                  )}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "numbering" && (
        <div className="bg-card border border-border rounded-lg p-5 space-y-4 max-w-2xl">
          <h3 className="text-sm font-semibold text-foreground">Journal Entry Numbering</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label className="text-xs">Format</Label>
              <Input defaultValue="JE-YYYY-######" className="h-9 text-xs font-mono" readOnly /></div>
            <div className="space-y-1.5"><Label className="text-xs">Next Number</Label>
              <Input defaultValue="JE-2025-000043" className="h-9 text-xs font-mono" readOnly /></div>
            <div className="space-y-1.5"><Label className="text-xs">Reset</Label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"><option>Yearly</option><option>Never</option></select></div>
          </div>
        </div>
      )}

      {activeTab === "currency" && (
        <div className="bg-card border border-border rounded-lg p-5 space-y-4 max-w-2xl">
          <h3 className="text-sm font-semibold text-foreground">Functional Currency</h3>
          {[
            { code: "XOF", name: "CFA Franc BCEAO", rate: "1.0000", base: true },
            { code: "EUR", name: "Euro", rate: "655.957", base: false },
            { code: "USD", name: "US Dollar", rate: "615.000", base: false },
          ].map(c => (
            <div key={c.code} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div>
                <div className="text-xs font-medium text-foreground">{c.code} — {c.name}</div>
                <div className="text-[10px] text-muted-foreground">Rate: {c.rate} {c.base && "(Functional)"}</div>
              </div>
              {!c.base && <Button size="sm" variant="ghost" className="h-6 text-[10px]">Edit</Button>}
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
