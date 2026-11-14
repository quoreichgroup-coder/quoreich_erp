import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { CompanyIdentityPanel } from "@/components/CompanyIdentityPanel";
import { Breadcrumb } from "@/components/Breadcrumb";
import { HelpIcon } from "@/components/HelpIcon";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CalendarDays, BookOpen, Receipt, CreditCard, GitBranch, Users, ShieldCheck,
  Plus, Pencil, Search, ChevronDown, ChevronRight, Trash2, Check, X,
  Clock, AlertTriangle, ArrowUp, Eye, FileText, Download, Play, UserMinus, RefreshCw,
  Zap, Shield, Hash, Bot, Landmark, Layers, Building2 } from "lucide-react";
import { PostingAccountsPanel } from "@/components/PostingAccountsPanel";
import { AnalyticAxesPanel } from "@/components/AnalyticAxesPanel";
import { TaxCodesPanel } from "@/components/TaxCodesPanel";
import { AuthorizationsPanel } from "@/components/AuthorizationsPanel";
import { AiSchedulesSettings } from "@/components/AiSchedulesSettings";
import { FiscalCalendarPanel } from "@/components/FiscalCalendarPanel";

import { cn } from "@/lib/utils";

// ── Tabs ────────────────────────────────────────────────────────────────────

const tabs = [
  { id: "company", label: "Société", icon: Building2 },
  { id: "fiscal", label: "Exercices et périodes", icon: CalendarDays },
  { id: "accounts", label: "Chart of Accounts", icon: BookOpen },
  { id: "posting", label: "Comptabilisation", icon: Landmark },
  { id: "analytics", label: "Analytique", icon: Layers },
  { id: "tax", label: "Codes TVA", icon: Receipt },
  { id: "payment", label: "Payment Terms", icon: CreditCard },
  { id: "workflow", label: "Workflow Engine", icon: GitBranch },
  { id: "roles", label: "Rôles et autorisations", icon: Users },
  { id: "audit", label: "Audit & Compliance", icon: ShieldCheck },
  { id: "ai", label: "Planification IA", icon: Bot },
];

// ── Existing Data ───────────────────────────────────────────────────────────

const chartOfAccounts = [
  { number: "1000", name: "Cash", category: "Assets", type: "Current Asset", status: "Active" },
  { number: "1100", name: "Accounts Receivable", category: "Assets", type: "Current Asset", status: "Active" },
  { number: "1200", name: "Inventory", category: "Assets", type: "Current Asset", status: "Active" },
  { number: "1500", name: "Fixed Assets", category: "Assets", type: "Non-Current", status: "Active" },
  { number: "2000", name: "Accounts Payable", category: "Liabilities", type: "Current Liability", status: "Active" },
  { number: "2100", name: "Short-term Loans", category: "Liabilities", type: "Current Liability", status: "Active" },
  { number: "3000", name: "Owner's Equity", category: "Equity", type: "Equity", status: "Active" },
  { number: "4000", name: "Sales Revenue", category: "Revenue", type: "Operating", status: "Active" },
  { number: "5000", name: "Cost of Goods Sold", category: "Expenses", type: "Operating", status: "Active" },
  { number: "5100", name: "Salaries Expense", category: "Expenses", type: "Operating", status: "Active" },
  { number: "5200", name: "Rent Expense", category: "Expenses", type: "Operating", status: "Inactive" },
];




const paymentTerms = [
  { code: "NET-30", name: "Net 30 Days", days: 30, discount: "—", status: "Active" },
  { code: "NET-60", name: "Net 60 Days", days: 60, discount: "—", status: "Active" },
  { code: "2/10-N30", name: "2% 10 Net 30", days: 30, discount: "2% if paid within 10 days", status: "Active" },
  { code: "COD", name: "Cash on Delivery", days: 0, discount: "—", status: "Active" },
  { code: "NET-90", name: "Net 90 Days", days: 90, discount: "—", status: "Inactive" },
];

// ── Enhanced Workflow Engine Data ───────────────────────────────────────────

interface WorkflowCondition {
  variable: string;
  operator: string;
  value: string;
}

interface WorkflowRule {
  id: string;
  name: string;
  docType: string;
  department: string;
  conditions: WorkflowCondition[];
  conditionLogic: "AND" | "OR";
  amountMin: number;
  amountMax: number | null;
  currency: string;
  costCenter: string;
  levels: { level: number; role: string; sla: string; substitute?: string; substituteUntil?: string }[];
  escalation: { after: string; to: string; condition: string };
  slaType: string;
  status: string;
}

const workflowRules: WorkflowRule[] = [
  {
    id: "WF-001", name: "Invoice Approval – Low", docType: "Supplier Invoice", department: "All",
    conditions: [
      { variable: "amount", operator: "<=", value: "5,000,000 XOF" },
    ],
    conditionLogic: "AND",
    amountMin: 0, amountMax: 5000000, currency: "XOF", costCenter: "All",
    levels: [{ level: 1, role: "AP Clerk", sla: "24h" }],
    escalation: { after: "48h", to: "Finance Manager", condition: "SLA exceeded" },
    slaType: "Standard (24h)",
    status: "Active",
  },
  {
    id: "WF-002", name: "Invoice Approval – Multi-Condition", docType: "Supplier Invoice", department: "Operations",
    conditions: [
      { variable: "amount", operator: ">=", value: "5,000,000 XOF" },
      { variable: "amount", operator: "<=", value: "25,000,000 XOF" },
      { variable: "currency", operator: "=", value: "XOF" },
      { variable: "cost_center", operator: "IN", value: "OPS-01, OPS-02, OPS-03" },
    ],
    conditionLogic: "AND",
    amountMin: 5000000, amountMax: 25000000, currency: "XOF", costCenter: "OPS-01, OPS-02",
    levels: [
      { level: 1, role: "AP Clerk", sla: "24h" },
      { level: 2, role: "Finance Manager", sla: "48h", substitute: "Deputy CFO", substituteUntil: "2026-03-31" },
    ],
    escalation: { after: "72h", to: "CFO", condition: "SLA exceeded OR amount > 15M" },
    slaType: "Extended (48h)",
    status: "Active",
  },
  {
    id: "WF-003", name: "Invoice Approval – High Value", docType: "Supplier Invoice", department: "All",
    conditions: [
      { variable: "amount", operator: ">", value: "25,000,000 XOF" },
    ],
    conditionLogic: "AND",
    amountMin: 25000000, amountMax: null, currency: "Any", costCenter: "All",
    levels: [
      { level: 1, role: "AP Clerk", sla: "24h" },
      { level: 2, role: "Finance Manager", sla: "48h" },
      { level: 3, role: "CFO", sla: "72h" },
    ],
    escalation: { after: "96h", to: "CEO", condition: "L3 SLA exceeded" },
    slaType: "Critical (72h)",
    status: "Active",
  },
  {
    id: "WF-004", name: "Payment Authorization", docType: "Payment Order", department: "Treasury",
    conditions: [
      { variable: "amount", operator: ">", value: "0 XOF" },
      { variable: "department", operator: "=", value: "Treasury" },
    ],
    conditionLogic: "AND",
    amountMin: 0, amountMax: null, currency: "Any", costCenter: "TREAS",
    levels: [
      { level: 1, role: "Treasury Analyst", sla: "24h" },
      { level: 2, role: "Treasury Manager", sla: "48h" },
    ],
    escalation: { after: "72h", to: "CFO", condition: "SLA exceeded" },
    slaType: "Standard (24h)",
    status: "Active",
  },
  {
    id: "WF-005", name: "Journal Entry Approval", docType: "Manual Journal Entry", department: "GL",
    conditions: [
      { variable: "amount", operator: ">", value: "0 XOF" },
      { variable: "doc_type", operator: "=", value: "Manual JE" },
    ],
    conditionLogic: "AND",
    amountMin: 0, amountMax: null, currency: "Any", costCenter: "All",
    levels: [
      { level: 1, role: "Accountant", sla: "24h" },
      { level: 2, role: "Finance Manager", sla: "48h" },
    ],
    escalation: { after: "72h", to: "CFO", condition: "SLA exceeded" },
    slaType: "Standard (24h)",
    status: "Active",
  },
  {
    id: "WF-006", name: "Credit Note – Combined OR", docType: "Credit Note", department: "AR",
    conditions: [
      { variable: "amount", operator: ">", value: "10,000,000 XOF" },
      { variable: "department", operator: "=", value: "Sales" },
    ],
    conditionLogic: "OR",
    amountMin: 0, amountMax: null, currency: "XOF", costCenter: "SALES",
    levels: [
      { level: 1, role: "AR Clerk", sla: "24h" },
      { level: 2, role: "Sales Manager", sla: "48h" },
    ],
    escalation: { after: "72h", to: "Finance Manager", condition: "Any condition met + SLA exceeded" },
    slaType: "Standard (24h)",
    status: "Draft",
  },
];

// ── Workflow Simulation Results ─────────────────────────────────────────────

const simulationResults = [
  { doc: "BILL-TEST-001", amount: 3200000, currency: "XOF", costCenter: "OPS-01", dept: "Operations", matchedRule: "WF-001", levels: 1, estimatedSLA: "24h", result: "Auto-approved L1" },
  { doc: "BILL-TEST-002", amount: 12000000, currency: "XOF", costCenter: "OPS-02", dept: "Operations", matchedRule: "WF-002", levels: 2, estimatedSLA: "72h", result: "L1→L2 (substitute: Deputy CFO)" },
  { doc: "BILL-TEST-003", amount: 50000000, currency: "XOF", costCenter: "FIN-01", dept: "Finance", matchedRule: "WF-003", levels: 3, estimatedSLA: "144h", result: "L1→L2→L3 (CFO)" },
  { doc: "PAY-TEST-001", amount: 8000000, currency: "XOF", costCenter: "TREAS", dept: "Treasury", matchedRule: "WF-004", levels: 2, estimatedSLA: "72h", result: "Treasury flow" },
];

const workflowHistory = [
  { date: "2026-03-02 16:30", doc: "BILL-2026-087", workflow: "WF-002", action: "Approved L1", user: "A. Traoré", duration: "4h", ip: "192.168.1.45", hash: "a3f8c2...d91e" },
  { date: "2026-03-02 14:15", doc: "JE-2026-042", workflow: "WF-005", action: "Approved L2", user: "M. Koné", duration: "18h", ip: "192.168.1.12", hash: "b7d4e1...f82a" },
  { date: "2026-03-01 09:00", doc: "BILL-2026-082", workflow: "WF-001", action: "Approved L1", user: "S. Diallo", duration: "2h", ip: "192.168.1.33", hash: "c2a9f5...e14b" },
  { date: "2026-02-28 11:45", doc: "PAY-2026-015", workflow: "WF-004", action: "Escalated → CFO", user: "System", duration: "72h exceeded", ip: "System", hash: "d5b3c8...a27f" },
  { date: "2026-02-27 16:00", doc: "CN-2026-003", workflow: "WF-006", action: "Pending L2", user: "—", duration: "Waiting", ip: "—", hash: "e8f1d2...c49d" },
  { date: "2026-02-26 10:20", doc: "BILL-2026-079", workflow: "WF-003", action: "Approved L3", user: "J. Dupont", duration: "36h", ip: "10.0.0.5", hash: "f4a7b9...d63c" },
  { date: "2026-02-25 08:10", doc: "BILL-2026-076", workflow: "WF-002", action: "Substitute Approved L2", user: "Deputy CFO (delegate)", duration: "12h", ip: "192.168.1.50", hash: "g1c5e3...b78a" },
];

// ── Approver Delegations ────────────────────────────────────────────────────

const delegations = [
  { original: "Finance Manager", substitute: "Deputy CFO", from: "2026-03-01", until: "2026-03-31", reason: "Annual leave", status: "Active" },
  { original: "Treasury Manager", substitute: "Senior Treasury Analyst", from: "2026-03-15", until: "2026-03-22", reason: "Conference", status: "Scheduled" },
];


// ── SoD Conflicts (static reference data) ──────────────────────────────────


// ── Audit Logs ──────────────────────────────────────────────────────────────

const auditLogs = [
  { date: "2026-03-03 14:23", user: "J. Dupont", action: "Modified Chart of Accounts", detail: "Added account 5300 – Utilities", module: "Settings", ip: "192.168.1.5", hash: "a1b2c3" },
  { date: "2026-03-02 09:11", user: "M. Koné", action: "Closed Period", detail: "Period 1 – FY 2025", module: "GL", ip: "192.168.1.12", hash: "d4e5f6" },
  { date: "2026-03-01 16:45", user: "A. Traoré", action: "Approved Invoice", detail: "BILL-2026-087 – 3,400,000 XOF", module: "AP", ip: "192.168.1.45", hash: "g7h8i9" },
  { date: "2026-02-28 11:30", user: "J. Dupont", action: "Created Workflow", detail: "Payment Authorization workflow", module: "Settings", ip: "192.168.1.5", hash: "j1k2l3" },
  { date: "2026-02-27 08:55", user: "S. Diallo", action: "Bank Reconciliation", detail: "BIAO-CI – February 2026", module: "Treasury", ip: "192.168.1.33", hash: "m4n5o6" },
  { date: "2026-02-26 15:20", user: "System", action: "Auto-Escalation", detail: "PAY-2026-015 escalated to CFO (SLA exceeded)", module: "Workflow", ip: "System", hash: "p7q8r9" },
  { date: "2026-02-25 10:00", user: "Admin", action: "Role Modified", detail: "AP Clerk: Added 'Export' permission on Reports", module: "Settings", ip: "10.0.0.1", hash: "s1t2u3" },
  { date: "2026-02-24 14:30", user: "System", action: "SoD Alert", detail: "User X attempted Create Invoice + Validate Payment", module: "Security", ip: "System", hash: "v4w5x6" },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

// ── Component ───────────────────────────────────────────────────────────────

const Settings = () => {
  // L'onglet suit l'URL (?tab=…) : la barre latérale et les modules y renvoient directement.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState(tabs.some((t) => t.id === requested) ? requested! : "fiscal");
  useEffect(() => {
    if (requested && tabs.some((t) => t.id === requested)) setActiveTabState(requested);
  }, [requested]);
  const setActiveTab = (id: string) => {
    setActiveTabState(id);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("tab", id); return next; }, { replace: true });
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedWF, setExpandedWF] = useState<string | null>("WF-002");
  const [workflowSubTab, setWorkflowSubTab] = useState<"rules" | "simulation" | "delegations" | "history">("rules");


  const filteredAccounts = chartOfAccounts.filter(
    (a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.number.includes(searchQuery) || a.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Financial Settings" }]} />
      <GuidanceBanner message="Configure your organization's financial parameters, approval workflows with multi-variable conditions (AND/OR), approver substitutions, conditional escalation, dynamic SLAs, and SOX-ready audit trails. Changes require proper authorization." />

      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-foreground">Financial Settings</h1>
        <HelpIcon text="Manage fiscal years, chart of accounts, tax rates, payment terms, workflow engine with multi-variable rules, and granular permissions matrix with SoD controls." />
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Left Navigation */}
        <div className="lg:w-52 shrink-0">
          <nav className="space-y-0.5">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => { setActiveTab(tab.id); setSearchQuery(""); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors rounded-md ${
                  activeTab === tab.id ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted"
                }`}>
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          {/* ── Fiscal Years ── */}
          {/* ── Exercices et périodes (calendrier fiscal central, V33) ── */}
          {activeTab === "company" && <CompanyIdentityPanel />}
          {activeTab === "fiscal" && <div className="max-w-6xl"><FiscalCalendarPanel /></div>}

          {/* ── Chart of Accounts ── */}
          {activeTab === "posting" && <div className="max-w-4xl"><PostingAccountsPanel /></div>}

          {activeTab === "analytics" && <div className="max-w-5xl"><AnalyticAxesPanel /></div>}

          {activeTab === "accounts" && (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-medium text-foreground">Chart of Accounts</h3>
                  <HelpIcon text="Account numbers follow a standard hierarchy." />
                  <span className="text-[11px] text-muted-foreground ml-1">({filteredAccounts.length} accounts)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input placeholder="Search accounts..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-8 h-8 w-48 text-xs" />
                  </div>
                  <Button size="sm" className="h-8 text-xs gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Account</Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">No.</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Account Name</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Category</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2 w-10"></th>
                  </tr></thead>
                  <tbody>
                    {filteredAccounts.map((account) => (
                      <tr key={account.number} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-foreground">{account.number}</td>
                        <td className="px-4 py-2.5 text-foreground font-medium">{account.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{account.category}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{account.type}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={account.status} /></td>
                        <td className="px-4 py-2.5 text-right">
                          <button className="p-1 rounded hover:bg-muted transition-colors"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Tax Configuration ── */}
          {activeTab === "tax" && <div className="max-w-4xl"><TaxCodesPanel /></div>}

          {activeTab === "payment" && (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-medium text-foreground">Payment Terms</h3>
                  <HelpIcon text="Payment terms define due date calculations." />
                </div>
                <Button size="sm" className="h-7 text-[11px] gap-1"><Plus className="w-3 h-3" /> Add Term</Button>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Code</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Description</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Days</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Discount</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-4 py-2 w-10"></th>
                </tr></thead>
                <tbody>
                  {paymentTerms.map((term) => (
                    <tr key={term.code} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-mono text-foreground font-medium">{term.code}</td>
                      <td className="px-4 py-2.5 text-foreground">{term.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{term.days}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{term.discount}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={term.status} /></td>
                      <td className="px-4 py-2.5 text-right"><button className="p-1 rounded hover:bg-muted transition-colors"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Enhanced Workflow Engine ── */}
          {activeTab === "workflow" && (
            <div className="space-y-4">
              {/* Workflow Sub-Tabs */}
              <div className="flex items-center gap-1.5">
                {[
                  { id: "rules" as const, label: "Rules & Conditions", icon: Zap },
                  { id: "simulation" as const, label: "Simulation", icon: Play },
                  { id: "delegations" as const, label: "Delegations", icon: UserMinus },
                  { id: "history" as const, label: "Audit Journal", icon: Shield },
                ].map(t => (
                  <button key={t.id} onClick={() => setWorkflowSubTab(t.id)}
                    className={cn("h-7 px-3 rounded text-xs font-medium transition-colors flex items-center gap-1.5",
                      workflowSubTab === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                    )}>
                    <t.icon className="w-3 h-3" />{t.label}
                  </button>
                ))}
              </div>

              {/* ── Rules & Conditions ── */}
              {workflowSubTab === "rules" && (
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-medium text-foreground">Multi-Variable Approval Rules</h3>
                      <HelpIcon text="Rules with AND/OR conditions on amount, currency, cost center, department, and document type. Supports conditional escalation and dynamic SLA per document type." />
                    </div>
                    <Button size="sm" className="h-7 text-[11px] gap-1"><Plus className="w-3 h-3" /> New Rule</Button>
                  </div>
                  <div className="divide-y divide-border">
                    {workflowRules.map((wf) => (
                      <div key={wf.id}>
                        <button onClick={() => setExpandedWF(expandedWF === wf.id ? null : wf.id)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors text-left">
                          <div className="flex items-center gap-3">
                            {expandedWF === wf.id ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[10px] text-muted-foreground">{wf.id}</span>
                                <span className="text-xs font-medium text-foreground">{wf.name}</span>
                                <span className={cn("text-[9px] px-1 py-0.5 rounded font-medium", wf.conditionLogic === "AND" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>
                                  {wf.conditionLogic}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{wf.docType}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{wf.department}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{wf.currency}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {wf.conditions.length} condition{wf.conditions.length > 1 ? "s" : ""}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] text-muted-foreground">{wf.levels.length} level{wf.levels.length > 1 ? "s" : ""}</span>
                            <StatusBadge status={wf.status} />
                          </div>
                        </button>
                        {expandedWF === wf.id && (
                          <div className="px-4 pb-3 pl-10 space-y-3">
                            {/* Conditions */}
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Conditions ({wf.conditionLogic})</p>
                              <div className="space-y-1">
                                {wf.conditions.map((c, i) => (
                                  <div key={i} className="flex items-center gap-2">
                                    {i > 0 && <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded",
                                      wf.conditionLogic === "AND" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                                    )}>{wf.conditionLogic}</span>}
                                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border bg-muted/20 text-xs">
                                      <Hash className="w-3 h-3 text-muted-foreground" />
                                      <span className="font-medium text-foreground">{c.variable}</span>
                                      <span className="text-primary font-mono">{c.operator}</span>
                                      <span className="text-muted-foreground">{c.value}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Approval chain */}
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Approval Chain</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                {wf.levels.map((lvl, i) => (
                                  <div key={lvl.level} className="flex items-center gap-2">
                                    <div className="px-3 py-2 rounded border border-border bg-muted/20 text-center">
                                      <p className="text-[10px] text-muted-foreground">Level {lvl.level}</p>
                                      <p className="text-xs font-medium text-foreground">{lvl.role}</p>
                                      <p className="text-[10px] text-muted-foreground flex items-center gap-0.5 justify-center"><Clock className="w-2.5 h-2.5" /> SLA: {lvl.sla}</p>
                                      {lvl.substitute && (
                                        <p className="text-[9px] text-primary mt-0.5 flex items-center gap-0.5 justify-center">
                                          <RefreshCw className="w-2 h-2" /> {lvl.substitute}
                                        </p>
                                      )}
                                    </div>
                                    {i < wf.levels.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                                  </div>
                                ))}
                                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                                <div className="px-3 py-2 rounded border border-destructive/30 bg-destructive/5 text-center">
                                  <p className="text-[10px] text-destructive flex items-center gap-0.5 justify-center"><AlertTriangle className="w-2.5 h-2.5" /> Escalation</p>
                                  <p className="text-xs font-medium text-foreground">{wf.escalation.to}</p>
                                  <p className="text-[10px] text-muted-foreground">After {wf.escalation.after}</p>
                                  <p className="text-[9px] text-destructive mt-0.5">{wf.escalation.condition}</p>
                                </div>
                              </div>
                            </div>

                            {/* Rule details */}
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                              <div className="p-2 rounded bg-muted/20 border border-border">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Document Type</p>
                                <p className="font-medium text-foreground mt-0.5">{wf.docType}</p>
                              </div>
                              <div className="p-2 rounded bg-muted/20 border border-border">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Department</p>
                                <p className="font-medium text-foreground mt-0.5">{wf.department}</p>
                              </div>
                              <div className="p-2 rounded bg-muted/20 border border-border">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">SLA Type</p>
                                <p className="font-medium text-foreground mt-0.5">{wf.slaType}</p>
                              </div>
                              <div className="p-2 rounded bg-muted/20 border border-border">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Cost Center</p>
                                <p className="font-medium text-foreground mt-0.5">{wf.costCenter}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Workflow Simulation ── */}
              {workflowSubTab === "simulation" && (
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-medium text-foreground">Workflow Simulation</h3>
                      <HelpIcon text="Test documents against active workflow rules before activation. Dry-run mode — no actual approvals triggered." />
                    </div>
                    <Button size="sm" className="h-7 text-[11px] gap-1"><Play className="w-3 h-3" /> Run Simulation</Button>
                  </div>
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Test Document</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Cost Center</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Matched Rule</th>
                      <th className="text-center px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Levels</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Est. SLA</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Result</th>
                    </tr></thead>
                    <tbody>
                      {simulationResults.map((s, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-mono text-foreground font-medium">{s.doc}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmt(s.amount)} {s.currency}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{s.costCenter}</td>
                          <td className="px-4 py-2.5"><span className="font-mono text-primary">{s.matchedRule}</span></td>
                          <td className="px-4 py-2.5 text-center">{s.levels}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{s.estimatedSLA}</td>
                          <td className="px-4 py-2.5 text-foreground">{s.result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Approver Delegations ── */}
              {workflowSubTab === "delegations" && (
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-medium text-foreground">Temporary Approver Substitutions</h3>
                      <HelpIcon text="Define temporary delegates for approvers on leave or unavailable. Substitutes inherit the original approver's workflow permissions for the defined period." />
                    </div>
                    <Button size="sm" className="h-7 text-[11px] gap-1"><Plus className="w-3 h-3" /> New Delegation</Button>
                  </div>
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Original Approver</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Substitute</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Period</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Reason</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    </tr></thead>
                    <tbody>
                      {delegations.map((d, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-medium text-foreground">{d.original}</td>
                          <td className="px-4 py-2.5 text-primary font-medium">{d.substitute}</td>
                          <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{d.from} → {d.until}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{d.reason}</td>
                          <td className="px-4 py-2.5"><StatusBadge status={d.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Immutable Audit Journal ── */}
              {workflowSubTab === "history" && (
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-medium text-foreground">Immutable Workflow Audit Journal</h3>
                      <HelpIcon text="Tamper-proof log with cryptographic hashing. Each entry includes IP address, timestamp, and SHA-256 hash chain for SOX compliance." />
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1"><Download className="w-3 h-3" /> Export</Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Timestamp</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Document</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Rule</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Action</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">User</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Duration</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">IP</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Hash</th>
                      </tr></thead>
                      <tbody>
                        {workflowHistory.map((h, i) => (
                          <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="px-3 py-2.5 font-mono text-muted-foreground whitespace-nowrap">{h.date}</td>
                            <td className="px-3 py-2.5 font-mono text-foreground font-medium">{h.doc}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{h.workflow}</td>
                            <td className="px-3 py-2.5">
                              <span className={cn("text-foreground",
                                h.action.includes("Escalated") && "text-destructive font-medium",
                                h.action.includes("Approved") && "text-success",
                                h.action.includes("Substitute") && "text-primary",
                                h.action.includes("Pending") && "text-muted-foreground"
                              )}>{h.action}</span>
                            </td>
                            <td className="px-3 py-2.5 text-foreground">{h.user}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{h.duration}</td>
                            <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground">{h.ip}</td>
                            <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground">{h.hash}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Granular Permissions Matrix ── */}
          {activeTab === "roles" && <AuthorizationsPanel />}

          {activeTab === "audit" && (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-medium text-foreground">Audit & Compliance Log</h3>
                  <HelpIcon text="Complete audit trail with IP tracking and hash chain verification for SOX compliance." />
                </div>
                <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1"><Download className="w-3 h-3" /> Export Audit Log</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Timestamp</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">User</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Action</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Detail</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Module</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">IP</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Hash</th>
                  </tr></thead>
                  <tbody>
                    {auditLogs.map((log, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2.5 font-mono text-muted-foreground whitespace-nowrap">{log.date}</td>
                        <td className="px-3 py-2.5 text-foreground font-medium">{log.user}</td>
                        <td className="px-3 py-2.5 text-foreground">{log.action}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{log.detail}</td>
                        <td className="px-3 py-2.5"><StatusBadge status={log.module} /></td>
                        <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground">{log.ip}</td>
                        <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground">{log.hash}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── AI Schedules ── */}
          {activeTab === "ai" && <AiSchedulesSettings />}
        </div>
      </div>
    </PageShell>
  );
};

export default Settings;
