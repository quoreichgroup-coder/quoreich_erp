import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Building2, CreditCard, Landmark, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "banks", label: "Bank Accounts", icon: Building2 },
  { id: "instruments", label: "Instruments", icon: CreditCard },
  { id: "counterparties", label: "Counterparties", icon: Landmark },
];

const bankAccounts = [
  { code: "SGBS-OP", bank: "SGBS", name: "Operating Account", iban: "SN08 SGBS 0001 XXXX 0012 3456", currency: "XOF", balance: 145000000, status: "active" },
  { code: "BOA-RES", bank: "BOA", name: "Reserve Account", iban: "SN12 BOA0 0001 XXXX 0078 9012", currency: "XOF", balance: 88000000, status: "active" },
  { code: "SGBS-PAY", bank: "SGBS", name: "Payroll Account", iban: "SN08 SGBS 0001 XXXX 0034 5678", currency: "XOF", balance: 12000000, status: "active" },
  { code: "SGBS-EUR", bank: "SGBS", name: "EUR Account", iban: "SN08 SGBS 0002 XXXX 0045 6789", currency: "EUR", balance: 45000, status: "active" },
];

const instruments = [
  { code: "TD-001", type: "Term Deposit", bank: "SGBS", amount: 50000000, rate: 4.5, maturity: "2025-06-30", status: "active" },
  { code: "OD-001", type: "Overdraft Facility", bank: "BOA", amount: 30000000, rate: 8.0, maturity: "2025-12-31", status: "active" },
  { code: "LC-001", type: "Letter of Credit", bank: "SGBS", amount: 15000000, rate: 1.5, maturity: "2025-04-15", status: "pending" },
];

const counterparties = [
  { code: "CP-SGBS", name: "Société Générale Bénin", type: "Bank", rating: "A+", limit: 200000000, active: true },
  { code: "CP-BOA", name: "Bank of Africa", type: "Bank", rating: "A", limit: 150000000, active: true },
  { code: "CP-BCEAO", name: "BCEAO", type: "Central Bank", rating: "AAA", limit: null, active: true },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function TreasuryMasterData() {
  const [activeTab, setActiveTab] = useState("banks");

  return (
    <PageShell>
      <Breadcrumb items={[
        { label: "Finance" },
        { label: "Treasury", href: "/treasury" },
        { label: "Master Data" },
      ]} />

      <GuidanceBanner title="Treasury Master Data" description="Manage bank accounts, financial instruments and counterparty relationships." />

      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "banks" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">Bank Accounts</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Plus className="w-3 h-3" />Add Account</Button>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Code", "Bank", "Name", "IBAN", "Currency", "Balance", "Status"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {bankAccounts.map(b => (
                <tr key={b.code} className="border-b border-border hover:bg-muted/20 cursor-pointer">
                  <td className="px-3 py-2 font-mono font-medium">{b.code}</td>
                  <td className="px-3 py-2">{b.bank}</td>
                  <td className="px-3 py-2">{b.name}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground text-[10px]">{b.iban}</td>
                  <td className="px-3 py-2">{b.currency}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(b.balance)}</td>
                  <td className="px-3 py-2"><StatusBadge status="success" label={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "instruments" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">Financial Instruments</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs">+ Add Instrument</Button>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Code", "Type", "Bank", "Amount (XOF)", "Rate %", "Maturity", "Status"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {instruments.map(i => (
                <tr key={i.code} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono font-medium">{i.code}</td>
                  <td className="px-3 py-2">{i.type}</td>
                  <td className="px-3 py-2">{i.bank}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(i.amount)}</td>
                  <td className="px-3 py-2 text-right">{i.rate}%</td>
                  <td className="px-3 py-2 text-muted-foreground">{i.maturity}</td>
                  <td className="px-3 py-2"><StatusBadge status={i.status === "active" ? "success" : "warning"} label={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "counterparties" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Counterparties</h3></div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Code", "Name", "Type", "Rating", "Limit (XOF)", "Active"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {counterparties.map(c => (
                <tr key={c.code} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono font-medium">{c.code}</td>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2">{c.type}</td>
                  <td className="px-3 py-2 font-medium">{c.rating}</td>
                  <td className="px-3 py-2 text-right font-mono">{c.limit ? fmt(c.limit) : "Unlimited"}</td>
                  <td className="px-3 py-2">{c.active ? <span className="text-success">●</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
