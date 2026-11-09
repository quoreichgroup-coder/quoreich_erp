import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { HelpIcon } from "@/components/HelpIcon";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Download,
  Printer,
  FileText,
  FolderOpen,
  Clock,
  Layers,
  ChevronRight,
  ChevronDown,
  Plus,
  GripVertical,
  Save,
  Filter,
  Search,
  Globe,
  Building,
  GitMerge,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ── Navigation ──────────────────────────────────────────────────────────────

const leftNavItems = [
  { id: "standard", label: "Standard Reports", icon: FileText },
  { id: "custom", label: "Custom Reports", icon: Layers },
  { id: "saved", label: "Saved Reports", icon: FolderOpen },
  { id: "scheduled", label: "Scheduled Reports", icon: Clock },
];

const standardReports = [
  { id: "balance", label: "Balance Sheet" },
  { id: "income", label: "Income Statement" },
  { id: "trial", label: "Trial Balance" },
  { id: "analytical", label: "Analytical Balance" },
  { id: "ar-aging", label: "AR Aging" },
  { id: "ap-aging", label: "AP Aging" },
  { id: "cashflow", label: "Cash Flow" },
];

// ── Types & Data ────────────────────────────────────────────────────────────

interface AccountRow {
  code: string;
  name: string;
  current: number;
  previous: number;
  children?: AccountRow[];
}

const currencies = [
  { code: "XOF", label: "XOF – Franc CFA", rate: 1 },
  { code: "EUR", label: "EUR – Euro", rate: 0.00152 },
  { code: "USD", label: "USD – US Dollar", rate: 0.00164 },
  { code: "GBP", label: "GBP – British Pound", rate: 0.0013 },
];

const entities = [
  { id: "all", label: "All Entities (Consolidated)" },
  { id: "hq", label: "QUOREICH HQ" },
  { id: "ci", label: "QUOREICH Côte d'Ivoire" },
  { id: "sn", label: "QUOREICH Sénégal" },
  { id: "ml", label: "QUOREICH Mali" },
];

const periods = [
  { id: "P01", label: "P01 – January" },
  { id: "P02", label: "P02 – February" },
  { id: "P03", label: "P03 – March" },
  { id: "P04", label: "P04 – April" },
  { id: "P05", label: "P05 – May" },
  { id: "P06", label: "P06 – June" },
  { id: "P07", label: "P07 – July" },
  { id: "P08", label: "P08 – August" },
  { id: "P09", label: "P09 – September" },
  { id: "P10", label: "P10 – October" },
  { id: "P11", label: "P11 – November" },
  { id: "P12", label: "P12 – December" },
  { id: "YTD", label: "Year-to-Date" },
  { id: "FULL", label: "Full Year" },
];

const balanceSheetData: { category: string; rows: AccountRow[] }[] = [
  {
    category: "Assets",
    rows: [
      {
        code: "1000", name: "Current Assets", current: 463800000, previous: 412500000,
        children: [
          { code: "1010", name: "Cash & Cash Equivalents", current: 245800000, previous: 198400000 },
          { code: "1100", name: "Accounts Receivable", current: 128400000, previous: 134500000 },
          { code: "1200", name: "Inventory", current: 89600000, previous: 79600000 },
        ],
      },
      {
        code: "1500", name: "Non-Current Assets", current: 412000000, previous: 438000000,
        children: [
          { code: "1510", name: "Property, Plant & Equipment", current: 380000000, previous: 400000000 },
          { code: "1600", name: "Intangible Assets", current: 32000000, previous: 38000000 },
        ],
      },
    ],
  },
  {
    category: "Liabilities",
    rows: [
      {
        code: "2000", name: "Current Liabilities", current: 217200000, previous: 198500000,
        children: [
          { code: "2010", name: "Accounts Payable", current: 67200000, previous: 58500000 },
          { code: "2100", name: "Short-term Loans", current: 150000000, previous: 140000000 },
        ],
      },
      {
        code: "2500", name: "Non-Current Liabilities", current: 280000000, previous: 310000000,
        children: [
          { code: "2510", name: "Long-term Debt", current: 280000000, previous: 310000000 },
        ],
      },
    ],
  },
  {
    category: "Equity",
    rows: [
      {
        code: "3000", name: "Shareholders' Equity", current: 378600000, previous: 342000000,
        children: [
          { code: "3010", name: "Share Capital", current: 300000000, previous: 300000000 },
          { code: "3100", name: "Retained Earnings", current: 78600000, previous: 42000000 },
        ],
      },
    ],
  },
];

const incomeData: { category: string; rows: AccountRow[] }[] = [
  {
    category: "Revenue",
    rows: [
      {
        code: "4000", name: "Operating Revenue", current: 360000000, previous: 318000000,
        children: [
          { code: "4010", name: "Sales Revenue", current: 340000000, previous: 298000000 },
          { code: "4020", name: "Service Revenue", current: 20000000, previous: 20000000 },
        ],
      },
    ],
  },
  {
    category: "Expenses",
    rows: [
      {
        code: "5000", name: "Operating Expenses", current: 262000000, previous: 244000000,
        children: [
          { code: "5010", name: "Cost of Goods Sold", current: 158000000, previous: 148000000 },
          { code: "5100", name: "Salaries & Wages", current: 72000000, previous: 68000000 },
          { code: "5200", name: "Rent Expense", current: 18000000, previous: 16000000 },
          { code: "5300", name: "Utilities", current: 14000000, previous: 12000000 },
        ],
      },
    ],
  },
];

const analyticalData = [
  { costCenter: "CC-100", label: "Administration", accounts: [
    { code: "5100", name: "Salaries", debit: 28000000, credit: 0 },
    { code: "5200", name: "Rent", debit: 18000000, credit: 0 },
    { code: "5300", name: "Utilities", debit: 8000000, credit: 0 },
  ]},
  { costCenter: "CC-200", label: "Commercial", accounts: [
    { code: "4010", name: "Sales Revenue", debit: 0, credit: 240000000 },
    { code: "5010", name: "COGS", debit: 108000000, credit: 0 },
    { code: "5100", name: "Salaries", debit: 24000000, credit: 0 },
  ]},
  { costCenter: "CC-300", label: "Production", accounts: [
    { code: "4020", name: "Service Revenue", debit: 0, credit: 20000000 },
    { code: "5010", name: "COGS", debit: 50000000, credit: 0 },
    { code: "5100", name: "Salaries", debit: 20000000, credit: 0 },
    { code: "5300", name: "Utilities", debit: 6000000, credit: 0 },
  ]},
  { costCenter: "CC-400", label: "R&D", accounts: [
    { code: "5100", name: "Salaries", debit: 0, credit: 0 },
    { code: "5400", name: "Research Costs", debit: 12000000, credit: 0 },
  ]},
];

const quarterlyData = [
  { quarter: "Q1", revenue: 85000000, expenses: 62000000, profit: 23000000 },
  { quarter: "Q2", revenue: 92000000, expenses: 68000000, profit: 24000000 },
  { quarter: "Q3", revenue: 78000000, expenses: 59000000, profit: 19000000 },
  { quarter: "Q4", revenue: 105000000, expenses: 73000000, profit: 32000000 },
];

const savedReports = [
  { name: "Monthly P&L – January 2025", type: "Income Statement", created: "2025-02-01", status: "Posted" },
  { name: "Q4 Balance Sheet", type: "Balance Sheet", created: "2025-01-15", status: "Approved" },
  { name: "AR Aging – 90 Days", type: "AR Aging", created: "2025-01-10", status: "Draft" },
  { name: "Annual Trial Balance FY2024", type: "Trial Balance", created: "2024-12-31", status: "Closed" },
  { name: "Consolidated P&L – All Entities", type: "Income Statement", created: "2025-01-31", status: "Approved" },
];

const scheduledReports = [
  { name: "Monthly P&L", frequency: "Monthly", nextRun: "2025-03-01", recipients: "finance@quoreich.com", status: "Active" },
  { name: "Weekly Cash Flow", frequency: "Weekly", nextRun: "2025-02-24", recipients: "cfo@quoreich.com", status: "Active" },
  { name: "Quarterly AR Aging", frequency: "Quarterly", nextRun: "2025-04-01", recipients: "ar-team@quoreich.com", status: "Draft" },
];

const customDimensions = [
  { id: "dept", label: "Department" },
  { id: "project", label: "Project" },
  { id: "region", label: "Region" },
  { id: "costcenter", label: "Cost Center" },
];

const customAccounts = [
  { code: "4010", name: "Sales Revenue" },
  { code: "5010", name: "COGS" },
  { code: "5100", name: "Salaries" },
  { code: "5200", name: "Rent" },
  { code: "5300", name: "Utilities" },
  { code: "1010", name: "Cash" },
  { code: "1100", name: "Receivables" },
];

const gridStroke = "hsl(220, 14%, 88%)";
const axisStroke = "hsl(220, 10%, 46%)";

function fmtCurrency(n: number, currency: string, rate: number) {
  const converted = n * rate;
  if (currency === "XOF") return converted.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
  return converted.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Collapsible Row ─────────────────────────────────────────────────────────

function CollapsibleRow({ row, depth = 0, currency, rate }: { row: AccountRow; depth?: number; currency: string; rate: number }) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = row.children && row.children.length > 0;
  const variance = row.current - row.previous;
  const pct = row.previous !== 0 ? ((variance / row.previous) * 100).toFixed(1) : "—";

  return (
    <>
      <tr className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${depth === 0 ? "bg-muted/30" : ""}`}>
        <td className="px-4 py-2" style={{ paddingLeft: `${16 + depth * 20}px` }}>
          <div className="flex items-center gap-1.5">
            {hasChildren ? (
              <button onClick={() => setOpen(!open)} className="p-0.5 rounded hover:bg-muted transition-colors">
                {open ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
              </button>
            ) : (
              <span className="w-4" />
            )}
            <span className="font-mono text-muted-foreground text-[11px]">{row.code}</span>
          </div>
        </td>
        <td className={`px-4 py-2 ${depth === 0 ? "font-medium text-foreground" : "text-foreground"}`}>{row.name}</td>
        <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtCurrency(row.current, currency, rate)}</td>
        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fmtCurrency(row.previous, currency, rate)}</td>
        <td className={`px-4 py-2 text-right tabular-nums ${variance >= 0 ? "text-success" : "text-destructive"}`}>
          {variance >= 0 ? "+" : ""}{fmtCurrency(Math.abs(variance), currency, rate)} ({pct}%)
        </td>
      </tr>
      {open && hasChildren && row.children!.map((child) => (
        <CollapsibleRow key={child.code} row={child} depth={depth + 1} currency={currency} rate={rate} />
      ))}
    </>
  );
}

// ── Financial Table ─────────────────────────────────────────────────────────

function FinancialTable({ data, title, subtitle, currency, rate, fiscalYear }: {
  data: { category: string; rows: AccountRow[] }[];
  title: string;
  subtitle: string;
  currency: string;
  rate: number;
  fiscalYear: string;
}) {
  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <p className="text-[11px] text-muted-foreground">{subtitle} · Currency: {currency}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1">
            <Printer className="w-3 h-3" /> Print
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1">
            <Download className="w-3 h-3" /> PDF
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1">
            <Download className="w-3 h-3" /> Excel
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider w-28">Code</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Account</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">N ({fiscalYear})</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">N-1 ({parseInt(fiscalYear) - 1})</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Variance</th>
            </tr>
          </thead>
          <tbody>
            {data.map((section) => (
              <> 
                <tr key={section.category} className="bg-primary/5">
                  <td colSpan={5} className="px-4 py-2 font-semibold text-foreground uppercase text-[11px] tracking-wider">{section.category}</td>
                </tr>
                {section.rows.map((row) => (
                  <CollapsibleRow key={row.code} row={row} currency={currency} rate={rate} />
                ))}
                <tr className="border-t border-border bg-muted/40">
                  <td colSpan={2} className="px-4 py-2 font-semibold text-foreground text-[11px]">Total {section.category}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmtCurrency(section.rows.reduce((s, r) => s + r.current, 0), currency, rate)}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-muted-foreground">{fmtCurrency(section.rows.reduce((s, r) => s + r.previous, 0), currency, rate)}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">
                    {fmtCurrency(section.rows.reduce((s, r) => s + r.current, 0) - section.rows.reduce((s, r) => s + r.previous, 0), currency, rate)}
                  </td>
                </tr>
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Global Filters Bar ──────────────────────────────────────────────────────

function GlobalFilters({ fiscalYear, setFiscalYear, period, setPeriod, currency, setCurrency, entity, setEntity, consolidated, setConsolidated }: {
  fiscalYear: string; setFiscalYear: (v: string) => void;
  period: string; setPeriod: (v: string) => void;
  currency: string; setCurrency: (v: string) => void;
  entity: string; setEntity: (v: string) => void;
  consolidated: boolean; setConsolidated: (v: boolean) => void;
}) {
  return (
    <div className="bg-card rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Fiscal Year</label>
          <select value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}
            className="h-7 px-2 rounded-md border border-input bg-background text-xs text-foreground">
            <option value="2026">FY 2026</option>
            <option value="2025">FY 2025</option>
            <option value="2024">FY 2024</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Period</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="h-7 px-2 rounded-md border border-input bg-background text-xs text-foreground">
            {periods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <Globe className="w-3 h-3 text-muted-foreground" />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}
            className="h-7 px-2 rounded-md border border-input bg-background text-xs text-foreground">
            {currencies.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <Building className="w-3 h-3 text-muted-foreground" />
          <select value={entity} onChange={(e) => { setEntity(e.target.value); setConsolidated(e.target.value === "all"); }}
            className="h-7 px-2 rounded-md border border-input bg-background text-xs text-foreground">
            {entities.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </div>
        {consolidated && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 rounded text-[10px] font-medium text-primary">
            <GitMerge className="w-3 h-3" /> Consolidated View
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

const Reports = () => {
  const [activeSection, setActiveSection] = useState("standard");
  const [activeReport, setActiveReport] = useState("balance");
  const [fiscalYear, setFiscalYear] = useState("2025");
  const [period, setPeriod] = useState("FULL");
  const [currency, setCurrency] = useState("XOF");
  const [entity, setEntity] = useState("all");
  const [consolidated, setConsolidated] = useState(true);
  const [searchSaved, setSearchSaved] = useState("");

  const rate = currencies.find(c => c.code === currency)?.rate ?? 1;

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance", href: "/" }, { label: "Reporting" }]} />
      <GuidanceBanner message="Financial Reporting Center — Generate statutory statements (Balance Sheet, Income Statement, Trial Balance) and analytical reports with N/N-1 comparison, multi-currency conversion, and entity consolidation. All reports are audit-ready and exportable." />

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">Financial Reporting</h1>
            <HelpIcon text="Access all standard and custom financial reports. Reports support multi-currency, consolidation, and N-1 comparison." />
          </div>
          <p className="text-xs text-muted-foreground">QUOREICH · Fiscal Year {fiscalYear}–{parseInt(fiscalYear) + 1}</p>
        </div>
      </div>

      {/* Global Filters */}
      <GlobalFilters
        fiscalYear={fiscalYear} setFiscalYear={setFiscalYear}
        period={period} setPeriod={setPeriod}
        currency={currency} setCurrency={setCurrency}
        entity={entity} setEntity={setEntity}
        consolidated={consolidated} setConsolidated={setConsolidated}
      />

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Left Navigation */}
        <div className="lg:w-52 shrink-0 space-y-4">
          <nav className="space-y-0.5">
            {leftNavItems.map((item) => (
              <button key={item.id} onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors rounded-md ${
                  activeSection === item.id ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted"
                }`}>
                <item.icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            ))}
          </nav>
          {activeSection === "standard" && (
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-3 py-1.5">Reports</p>
              {standardReports.map((r) => (
                <button key={r.id} onClick={() => setActiveReport(r.id)}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors rounded-md ${
                    activeReport === r.id ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50"
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 space-y-4">
          {activeSection === "standard" && (
            <>
              {/* ── Balance Sheet ── */}
              {activeReport === "balance" && (
                <FinancialTable data={balanceSheetData} title="Balance Sheet" fiscalYear={fiscalYear}
                  subtitle={`As of ${period === "FULL" ? "December 31" : periods.find(p => p.id === period)?.label}, ${fiscalYear} — N/N-1 Comparative`}
                  currency={currency} rate={rate} />
              )}

              {/* ── Income Statement ── */}
              {activeReport === "income" && (
                <>
                  <FinancialTable data={incomeData} title="Income Statement" fiscalYear={fiscalYear}
                    subtitle={`Period: ${periods.find(p => p.id === period)?.label ?? "Full Year"} ${fiscalYear}`}
                    currency={currency} rate={rate} />
                  <div className="bg-card rounded-lg border border-border p-4">
                    <div className="flex items-center gap-1.5 mb-4">
                      <h3 className="text-sm font-medium text-foreground">Quarterly Performance — N vs N-1</h3>
                      <HelpIcon text="Revenue, expenses, and net profit across fiscal quarters." />
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={quarterlyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                        <XAxis dataKey="quarter" tick={{ fontSize: 11 }} stroke={axisStroke} />
                        <YAxis tick={{ fontSize: 11 }} stroke={axisStroke} tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} />
                        <Tooltip formatter={(value: number) => [`${fmtCurrency(value, currency, rate)} ${currency}`, undefined]}
                          contentStyle={{ borderRadius: "0.375rem", border: `1px solid ${gridStroke}`, fontSize: "11px" }} />
                        <Legend wrapperStyle={{ fontSize: "11px" }} />
                        <Bar dataKey="revenue" fill="hsl(220, 50%, 22%)" radius={[2, 2, 0, 0]} name="Revenue" />
                        <Bar dataKey="expenses" fill="hsl(220, 14%, 78%)" radius={[2, 2, 0, 0]} name="Expenses" />
                        <Bar dataKey="profit" fill="hsl(152, 40%, 32%)" radius={[2, 2, 0, 0]} name="Net Profit" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}

              {/* ── Trial Balance ── */}
              {activeReport === "trial" && (
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-foreground">Trial Balance</h3>
                      <p className="text-[11px] text-muted-foreground">Period: {periods.find(p => p.id === period)?.label ?? "Full Year"} {fiscalYear} · {currency}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1"><Download className="w-3 h-3" /> PDF</Button>
                      <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1"><Download className="w-3 h-3" /> Excel</Button>
                    </div>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Code</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Account</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Debit ({currency})</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Credit ({currency})</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { code: "1010", name: "Cash", debit: 245800000, credit: 0 },
                        { code: "1100", name: "Accounts Receivable", debit: 128400000, credit: 0 },
                        { code: "1200", name: "Inventory", debit: 89600000, credit: 0 },
                        { code: "1500", name: "Fixed Assets", debit: 412000000, credit: 0 },
                        { code: "2010", name: "Accounts Payable", debit: 0, credit: 67200000 },
                        { code: "2100", name: "Short-term Loans", debit: 0, credit: 150000000 },
                        { code: "2500", name: "Long-term Debt", debit: 0, credit: 280000000 },
                        { code: "3010", name: "Share Capital", debit: 0, credit: 300000000 },
                        { code: "3100", name: "Retained Earnings", debit: 0, credit: 78600000 },
                      ].map((row) => (
                        <tr key={row.code} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-4 py-2 font-mono text-muted-foreground">{row.code}</td>
                          <td className="px-4 py-2 text-foreground">{row.name}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{row.debit > 0 ? fmtCurrency(row.debit, currency, rate) : "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{row.credit > 0 ? fmtCurrency(row.credit, currency, rate) : "—"}</td>
                          <td className={`px-4 py-2 text-right tabular-nums font-medium ${row.debit - row.credit >= 0 ? "text-foreground" : "text-destructive"}`}>
                            {fmtCurrency(Math.abs(row.debit - row.credit), currency, rate)}
                            {row.debit - row.credit < 0 ? " Cr" : " Dr"}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-border bg-muted/50">
                        <td colSpan={2} className="px-4 py-2 font-semibold text-foreground">Totals</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmtCurrency(875800000, currency, rate)}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmtCurrency(875800000, currency, rate)}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-success">Balanced ✓</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Analytical Balance ── */}
              {activeReport === "analytical" && (
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-foreground">Analytical Balance</h3>
                      <p className="text-[11px] text-muted-foreground">By Cost Center — {periods.find(p => p.id === period)?.label ?? "Full Year"} {fiscalYear} · {currency}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select className="h-7 px-2 rounded-md border border-input bg-background text-xs text-foreground">
                        <option>Group by: Cost Center</option>
                        <option>Group by: Department</option>
                        <option>Group by: Project</option>
                        <option>Group by: Region</option>
                      </select>
                      <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1"><Download className="w-3 h-3" /> Excel</Button>
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {analyticalData.map((cc) => {
                      const totalDebit = cc.accounts.reduce((s, a) => s + a.debit, 0);
                      const totalCredit = cc.accounts.reduce((s, a) => s + a.credit, 0);
                      return (
                        <div key={cc.costCenter}>
                          <div className="px-4 py-2 bg-primary/5 flex items-center justify-between">
                            <div>
                              <span className="font-mono text-[11px] text-muted-foreground mr-2">{cc.costCenter}</span>
                              <span className="text-xs font-medium text-foreground">{cc.label}</span>
                            </div>
                            <div className="flex items-center gap-4 text-[11px]">
                              <span>Debit: <strong className="tabular-nums">{fmtCurrency(totalDebit, currency, rate)}</strong></span>
                              <span>Credit: <strong className="tabular-nums">{fmtCurrency(totalCredit, currency, rate)}</strong></span>
                              <span className={`font-medium ${totalDebit - totalCredit >= 0 ? "text-foreground" : "text-destructive"}`}>
                                Net: {fmtCurrency(Math.abs(totalDebit - totalCredit), currency, rate)} {totalDebit >= totalCredit ? "Dr" : "Cr"}
                              </span>
                            </div>
                          </div>
                          <table className="w-full text-xs">
                            <tbody>
                              {cc.accounts.map((a) => (
                                <tr key={`${cc.costCenter}-${a.code}`} className="border-b border-border/30 hover:bg-muted/20">
                                  <td className="px-4 py-1.5 pl-8 font-mono text-muted-foreground w-20">{a.code}</td>
                                  <td className="px-4 py-1.5 text-foreground">{a.name}</td>
                                  <td className="px-4 py-1.5 text-right tabular-nums w-32">{a.debit > 0 ? fmtCurrency(a.debit, currency, rate) : "—"}</td>
                                  <td className="px-4 py-1.5 text-right tabular-nums w-32">{a.credit > 0 ? fmtCurrency(a.credit, currency, rate) : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-4 py-2.5 bg-muted/50 flex items-center justify-between border-t border-border">
                    <span className="text-xs font-semibold text-foreground">Grand Total</span>
                    <div className="flex items-center gap-4 text-xs font-semibold">
                      <span>Debit: {fmtCurrency(analyticalData.reduce((s, cc) => s + cc.accounts.reduce((s2, a) => s2 + a.debit, 0), 0), currency, rate)}</span>
                      <span>Credit: {fmtCurrency(analyticalData.reduce((s, cc) => s + cc.accounts.reduce((s2, a) => s2 + a.credit, 0), 0), currency, rate)}</span>
                    </div>
                  </div>
                </div>
              )}

              {(activeReport === "ar-aging" || activeReport === "ap-aging" || activeReport === "cashflow") && (
                <div className="bg-card rounded-lg border border-border p-8 text-center">
                  <p className="text-xs text-muted-foreground">
                    {standardReports.find((r) => r.id === activeReport)?.label} report — available in next release.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Custom Reports */}
          {activeSection === "custom" && (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-medium text-foreground">Custom Report Builder</h3>
                  <HelpIcon text="Drag accounts from the available list to build a custom report. Apply dimension filters and save your configuration for reuse." />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1"><Save className="w-3 h-3" /> Save Config</Button>
                  <Button size="sm" className="h-7 text-[11px] gap-1"><Download className="w-3 h-3" /> Generate</Button>
                </div>
              </div>
              <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Available Accounts</p>
                  <div className="border border-border rounded-md divide-y divide-border/50">
                    {customAccounts.map((a) => (
                      <div key={a.code} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/30 cursor-grab">
                        <GripVertical className="w-3 h-3 text-muted-foreground" />
                        <span className="font-mono text-muted-foreground">{a.code}</span>
                        <span className="text-foreground">{a.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Report Columns</p>
                  <div className="border border-dashed border-border rounded-md p-4 min-h-[200px] flex items-center justify-center">
                    <p className="text-xs text-muted-foreground text-center">Drag accounts here to add columns</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Dimension Filters</p>
                  {customDimensions.map((d) => (
                    <div key={d.id}>
                      <label className="text-[11px] font-medium text-foreground block mb-1">{d.label}</label>
                      <select className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs">
                        <option>All</option>
                        <option>Filter 1</option>
                        <option>Filter 2</option>
                      </select>
                    </div>
                  ))}
                  <div>
                    <label className="text-[11px] font-medium text-foreground block mb-1">Date Range</label>
                    <div className="flex gap-2">
                      <Input type="date" className="h-8 text-xs flex-1" defaultValue="2025-01-01" />
                      <Input type="date" className="h-8 text-xs flex-1" defaultValue="2025-12-31" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Saved Reports */}
          {activeSection === "saved" && (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">Saved Reports</h3>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input placeholder="Search..." value={searchSaved} onChange={(e) => setSearchSaved(e.target.value)} className="pl-8 h-8 w-48 text-xs" />
                </div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Report Name</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Created</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {savedReports.filter((r) => r.name.toLowerCase().includes(searchSaved.toLowerCase())).map((r, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-2.5 text-foreground font-medium">{r.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.type}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.created}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2.5 text-right"><Button variant="ghost" size="sm" className="h-6 text-[11px]">Open</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Scheduled Reports */}
          {activeSection === "scheduled" && (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-medium text-foreground">Scheduled Reports</h3>
                  <HelpIcon text="Automate report generation and delivery." />
                </div>
                <Button size="sm" className="h-7 text-[11px] gap-1"><Plus className="w-3 h-3" /> Add Schedule</Button>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Report</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Frequency</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Next Run</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Recipients</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledReports.map((r, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-2.5 text-foreground font-medium">{r.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.frequency}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.nextRun}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.recipients}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
};

export default Reports;
