import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Target, TrendingUp, TrendingDown, DollarSign, BarChart3, Download, Plus, Calendar, AlertTriangle, Layers, Activity } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line, AreaChart, Area } from "recharts";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useMyBudgetRoles } from "@/hooks/use-budget-data";
import { canDo, actionTooltip } from "@/lib/budget-roles";

// ── Multi-tenant data ──
const tenants = [
  { id: "T-001", name: "QUOREICH CI (Enterprise)" },
  { id: "T-002", name: "QUOREICH SN (Professional)" },
  { id: "T-003", name: "QUOREICH ML (Starter)" },
];

interface BudgetMonth { month: string; actual: number; budget: number; forecast: number; optimistic: number; pessimistic: number; stress: number }

const allBudgetData: Record<string, BudgetMonth[]> = {
  "T-001": [
    { month: "Jan", actual: 12500, budget: 14000, forecast: 13200, optimistic: 14800, pessimistic: 11500, stress: 9800 },
    { month: "Feb", actual: 13800, budget: 14000, forecast: 13800, optimistic: 15200, pessimistic: 12000, stress: 10200 },
    { month: "Mar", actual: 15200, budget: 14500, forecast: 14900, optimistic: 16500, pessimistic: 12800, stress: 10800 },
    { month: "Apr", actual: 14100, budget: 14500, forecast: 14300, optimistic: 16000, pessimistic: 12200, stress: 10500 },
    { month: "May", actual: 16300, budget: 15000, forecast: 15800, optimistic: 17200, pessimistic: 13500, stress: 11200 },
    { month: "Jun", actual: 15800, budget: 15000, forecast: 16000, optimistic: 17800, pessimistic: 13800, stress: 11500 },
    { month: "Jul", actual: 0, budget: 15500, forecast: 16200, optimistic: 18000, pessimistic: 14000, stress: 11800 },
    { month: "Aug", actual: 0, budget: 15500, forecast: 16500, optimistic: 18500, pessimistic: 14200, stress: 12000 },
    { month: "Sep", actual: 0, budget: 16000, forecast: 16800, optimistic: 19000, pessimistic: 14500, stress: 12200 },
    { month: "Oct", actual: 0, budget: 16000, forecast: 17000, optimistic: 19500, pessimistic: 14800, stress: 12500 },
    { month: "Nov", actual: 0, budget: 16500, forecast: 17200, optimistic: 20000, pessimistic: 15000, stress: 12800 },
    { month: "Dec", actual: 0, budget: 17000, forecast: 17500, optimistic: 20500, pessimistic: 15200, stress: 13000 },
  ],
  "T-002": [
    { month: "Jan", actual: 8200, budget: 9000, forecast: 8500, optimistic: 9500, pessimistic: 7500, stress: 6500 },
    { month: "Feb", actual: 8800, budget: 9000, forecast: 8800, optimistic: 9800, pessimistic: 7800, stress: 6800 },
    { month: "Mar", actual: 9500, budget: 9500, forecast: 9200, optimistic: 10500, pessimistic: 8000, stress: 7000 },
    { month: "Apr", actual: 9100, budget: 9500, forecast: 9000, optimistic: 10200, pessimistic: 7700, stress: 6800 },
    { month: "May", actual: 10200, budget: 10000, forecast: 10000, optimistic: 11000, pessimistic: 8500, stress: 7200 },
    { month: "Jun", actual: 9800, budget: 10000, forecast: 10200, optimistic: 11500, pessimistic: 8800, stress: 7500 },
  ],
  "T-003": [
    { month: "Jan", actual: 3200, budget: 3500, forecast: 3300, optimistic: 3800, pessimistic: 2800, stress: 2200 },
    { month: "Feb", actual: 3400, budget: 3500, forecast: 3400, optimistic: 3900, pessimistic: 2900, stress: 2300 },
    { month: "Mar", actual: 3800, budget: 3800, forecast: 3700, optimistic: 4200, pessimistic: 3200, stress: 2500 },
  ],
};

interface VarianceItem { category: string; department: string; budget: number; actual: number; variance: number; pct: number }

const allVarianceItems: Record<string, VarianceItem[]> = {
  "T-001": [
    { category: "Revenue", department: "Sales", budget: 85000, actual: 87700, variance: 2700, pct: 3.2 },
    { category: "COGS", department: "Operations", budget: 42000, actual: 43200, variance: -1200, pct: -2.9 },
    { category: "Salaries", department: "HR", budget: 35000, actual: 34200, variance: 800, pct: 2.3 },
    { category: "Operating Expenses", department: "Administration", budget: 28000, actual: 26800, variance: 1200, pct: 4.3 },
    { category: "Depreciation", department: "Finance", budget: 8500, actual: 8200, variance: 300, pct: 3.5 },
    { category: "Marketing", department: "Marketing", budget: 12000, actual: 14500, variance: -2500, pct: -20.8 },
    { category: "IT Expenses", department: "IT", budget: 15000, actual: 16200, variance: -1200, pct: -8.0 },
    { category: "Interest Expense", department: "Finance", budget: 3200, actual: 3400, variance: -200, pct: -6.3 },
    { category: "Tax", department: "Finance", budget: 4500, actual: 4100, variance: 400, pct: 8.9 },
  ],
  "T-002": [
    { category: "Revenue", department: "Sales", budget: 55000, actual: 55600, variance: 600, pct: 1.1 },
    { category: "COGS", department: "Operations", budget: 28000, actual: 29100, variance: -1100, pct: -3.9 },
    { category: "Operating Expenses", department: "Admin", budget: 18000, actual: 17200, variance: 800, pct: 4.4 },
    { category: "Salaries", department: "HR", budget: 22000, actual: 22500, variance: -500, pct: -2.3 },
  ],
  "T-003": [
    { category: "Revenue", department: "Sales", budget: 18000, actual: 17500, variance: -500, pct: -2.8 },
    { category: "Operating Expenses", department: "Admin", budget: 8000, actual: 7800, variance: 200, pct: 2.5 },
  ],
};

interface EntityBudget { entity: string; budget: number; actual: number; utilization: number; forecast: number; variance: number }

const entityBudgets: EntityBudget[] = [
  { entity: "QUOREICH CI", budget: 185000, actual: 173500, utilization: 94, forecast: 192000, variance: 11500 },
  { entity: "QUOREICH SN", budget: 123000, actual: 114400, utilization: 93, forecast: 128000, variance: 8600 },
  { entity: "QUOREICH ML", budget: 42000, actual: 38500, utilization: 92, forecast: 44000, variance: 3500 },
];

interface DeptBudget { department: string; budget: number; actual: number; forecast: number; status: string }

const departmentBudgets: Record<string, DeptBudget[]> = {
  "T-001": [
    { department: "IT", budget: 45000, actual: 42200, forecast: 47500, status: "On Track" },
    { department: "Finance", budget: 28000, actual: 26800, forecast: 28500, status: "On Track" },
    { department: "Operations", budget: 42000, actual: 43200, forecast: 44000, status: "Over Budget" },
    { department: "HR", budget: 35000, actual: 34200, forecast: 35500, status: "On Track" },
    { department: "Marketing", budget: 12000, actual: 14500, forecast: 16000, status: "Over Budget" },
    { department: "Sales", budget: 18000, actual: 16800, forecast: 18200, status: "On Track" },
    { department: "Administration", budget: 5000, actual: 4200, forecast: 5000, status: "Under Budget" },
  ],
  "T-002": [
    { department: "IT", budget: 32000, actual: 28500, forecast: 33000, status: "On Track" },
    { department: "Operations", budget: 28000, actual: 29100, forecast: 30000, status: "Over Budget" },
    { department: "HR", budget: 22000, actual: 22500, forecast: 23000, status: "At Risk" },
  ],
  "T-003": [
    { department: "Operations", budget: 8000, actual: 7800, forecast: 8500, status: "On Track" },
    { department: "Administration", budget: 4000, actual: 3200, forecast: 4000, status: "Under Budget" },
  ],
};

const cashFlowForecast = [
  { month: "Jul", inflow: 16200, outflow: 14800, net: 1400 },
  { month: "Aug", inflow: 16500, outflow: 15200, net: 1300 },
  { month: "Sep", inflow: 16800, outflow: 15500, net: 1300 },
  { month: "Oct", inflow: 17000, outflow: 15800, net: 1200 },
  { month: "Nov", inflow: 17200, outflow: 16000, net: 1200 },
  { month: "Dec", inflow: 17500, outflow: 16500, net: 1000 },
];

const budgetAlerts = [
  { id: "BA-001", type: "Budget Overrun", severity: "critical", message: "Marketing dépasse le budget de 20.8% — révision requise", department: "Marketing", date: "2025-03-08" },
  { id: "BA-002", type: "Budget Overrun", severity: "warning", message: "Operations COGS dépassement de 2.9% — surveiller la tendance", department: "Operations", date: "2025-03-07" },
  { id: "BA-003", type: "Cash Flow", severity: "info", message: "Cash flow net en diminution Q4 — planifier réserves", department: "Treasury", date: "2025-03-06" },
  { id: "BA-004", type: "Forecast Deviation", severity: "warning", message: "IT expenses forecast +8% vs budget — revoir le périmètre", department: "IT", date: "2025-03-05" },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function BudgetForecast() {
  const perms = useMyBudgetRoles();
  const canCreate = canDo(perms, "create_budget");
  const canExport = canDo(perms, "export");
  const createTip = actionTooltip(perms, "create_budget", "Nouveau budget");
  const exportTip = actionTooltip(perms, "export", "Exporter");
  const [tenant, setTenant] = useState("T-001");
  const [period, setPeriod] = useState("2025-FY");
  const [scenario, setScenario] = useState("base");

  const budgetData = allBudgetData[tenant] || [];
  const varianceItems = allVarianceItems[tenant] || [];
  const deptBudgets = departmentBudgets[tenant] || [];

  const totalBudget = varianceItems.reduce((s, i) => s + Math.abs(i.budget), 0);
  const totalActual = varianceItems.reduce((s, i) => s + Math.abs(i.actual), 0);
  const netVariance = varianceItems.reduce((s, i) => s + i.variance, 0);
  const overBudgetDepts = deptBudgets.filter(d => d.status === "Over Budget").length;

  const varianceTable = useTableFeatures({
    data: varianceItems,
    pageSize: 15,
    searchableKeys: ["category", "department"],
    filterConfigs: [
      { key: "department", label: "Department", options: [...new Set(varianceItems.map(v => v.department))] },
    ],
  });

  const deptTable = useTableFeatures({
    data: deptBudgets,
    pageSize: 15,
    searchableKeys: ["department"],
    filterConfigs: [
      { key: "status", label: "Status", options: ["On Track", "Over Budget", "Under Budget", "At Risk"] },
    ],
  });

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Budget & Forecast", href: "/budget" }]} />
      <GuidanceBanner title="Budget & Forecast" description="Multi-entity budget planning, 4-scenario forecasting, departmental tracking, variance analysis, and cash flow projections." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Budget & Forecast</h1>
        <div className="flex gap-2">
          <Select value={tenant} onValueChange={setTenant}>
            <SelectTrigger className="h-8 text-xs w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="2025-H1">2025 H1</SelectItem>
              <SelectItem value="2025-H2">2025 H2</SelectItem>
              <SelectItem value="2025-FY">2025 Full Year</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" className="gap-1.5" disabled={!canCreate} aria-label={createTip} title={createTip}><Plus className="w-3.5 h-3.5" />New Budget</Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport} aria-label={exportTip} title={exportTip}><Download className="w-3.5 h-3.5" />Export</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Target className="w-3.5 h-3.5" />Total Budget</div>
          <div className="text-xl font-bold text-foreground">{fmt(totalBudget)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">XOF K</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign className="w-3.5 h-3.5" />Actual YTD</div>
          <div className="text-xl font-bold text-foreground">{fmt(totalActual)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">XOF K</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingUp className="w-3.5 h-3.5" />Net Variance</div>
          <div className={`text-xl font-bold ${netVariance >= 0 ? "text-success" : "text-destructive"}`}>
            {netVariance >= 0 ? "+" : ""}{fmt(netVariance)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">XOF K</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><BarChart3 className="w-3.5 h-3.5" />Utilization</div>
          <div className="text-xl font-bold text-foreground">{totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0}%</div>
          <Progress value={totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0} className="mt-2 h-1.5" />
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertTriangle className="w-3.5 h-3.5" />Over Budget</div>
          <div className={`text-xl font-bold ${overBudgetDepts > 0 ? "text-destructive" : "text-foreground"}`}>{overBudgetDepts}</div>
          <div className="text-[11px] text-muted-foreground mt-1">departments</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Layers className="w-3.5 h-3.5" />Entities</div>
          <div className="text-xl font-bold text-foreground">{entityBudgets.length}</div>
          <div className="text-[11px] text-muted-foreground mt-1">consolidated</div>
        </CardContent></Card>
      </div>

      {/* Alerts */}
      {budgetAlerts.length > 0 && tenant === "T-001" && (
        <div className="space-y-2 mb-4">
          {budgetAlerts.slice(0, 2).map(a => (
            <div key={a.id} className={`flex items-center gap-3 p-3 rounded-lg border text-xs ${a.severity === "critical" ? "bg-destructive/5 border-destructive/20 text-destructive" : a.severity === "warning" ? "bg-amber-500/5 border-amber-500/20 text-amber-700" : "bg-muted/30 border-border text-muted-foreground"}`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium">[{a.type}]</span>
              <span className="flex-1">{a.message}</span>
              <Badge variant="outline" className="text-[10px]">{a.department}</Badge>
            </div>
          ))}
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" />Overview</TabsTrigger>
          <TabsTrigger value="scenarios" className="gap-1.5"><Activity className="w-3.5 h-3.5" />Scenarios</TabsTrigger>
          <TabsTrigger value="variance" className="gap-1.5"><TrendingDown className="w-3.5 h-3.5" />Variance Analysis</TabsTrigger>
          <TabsTrigger value="departments" className="gap-1.5"><Layers className="w-3.5 h-3.5" />Departments</TabsTrigger>
          <TabsTrigger value="entities" className="gap-1.5"><Calendar className="w-3.5 h-3.5" />Entity Consolidation</TabsTrigger>
          <TabsTrigger value="cashflow" className="gap-1.5"><DollarSign className="w-3.5 h-3.5" />Cash Flow Forecast</TabsTrigger>
        </TabsList>

        {/* ─── Overview ─── */}
        <TabsContent value="overview">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Actual vs Budget vs Forecast</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={budgetData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="actual" name="Actual" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="budget" name="Budget" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="forecast" name="Forecast" fill="hsl(var(--chart-3))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Scenarios ─── */}
        <TabsContent value="scenarios">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-muted-foreground">Scenario:</span>
            {[{ key: "base", label: "Base" }, { key: "optimistic", label: "Optimistic" }, { key: "pessimistic", label: "Pessimistic" }, { key: "stress", label: "Stress Test" }].map(s => (
              <Button key={s.key} size="sm" variant={scenario === s.key ? "default" : "outline"} className="h-7 text-xs" onClick={() => setScenario(s.key)}>
                {s.label}
              </Button>
            ))}
          </div>
          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Revenue Forecast — {scenario.charAt(0).toUpperCase() + scenario.slice(1)} Scenario</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <ResponsiveContainer width="100%" height={360}>
                <AreaChart data={budgetData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="actual" name="Actual" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.3} strokeWidth={2} />
                  <Area type="monotone" dataKey="budget" name="Budget" stroke="hsl(var(--chart-2))" fill="none" strokeDasharray="5 5" strokeWidth={2} />
                  <Area type="monotone" dataKey={scenario === "base" ? "forecast" : scenario} name={scenario.charAt(0).toUpperCase() + scenario.slice(1)} stroke="hsl(var(--chart-4))" fill="hsl(var(--chart-4))" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-4 gap-3 mt-4">
            {[
              { label: "Optimistic", key: "optimistic" as const, color: "text-success" },
              { label: "Base", key: "forecast" as const, color: "text-primary" },
              { label: "Pessimistic", key: "pessimistic" as const, color: "text-amber-600" },
              { label: "Stress", key: "stress" as const, color: "text-destructive" },
            ].map(s => {
              const total = budgetData.reduce((sum, d) => sum + (d[s.key] || 0), 0);
              const budgetTotal = budgetData.reduce((sum, d) => sum + d.budget, 0);
              const diff = total - budgetTotal;
              return (
                <Card key={s.key} className="border-border">
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground mb-1">{s.label} Forecast</div>
                    <div className={`text-lg font-bold ${s.color}`}>{fmt(total)} K</div>
                    <div className={`text-[11px] mt-1 ${diff >= 0 ? "text-success" : "text-destructive"}`}>
                      {diff >= 0 ? "+" : ""}{fmt(diff)} vs Budget
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ─── Variance Analysis ─── */}
        <TabsContent value="variance">
          <Card className="border-border"><CardContent className="p-0">
            <FilterBar search={varianceTable.search} onSearch={varianceTable.setSearch} filters={varianceTable.filters} onFilter={varianceTable.setFilter} onClear={varianceTable.clearFilters} filterConfigs={varianceTable.filterConfigs} activeCount={varianceTable.activeFilterCount} searchPlaceholder="Rechercher…" />
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SortableHead label="Category" sortKey="category" sort={varianceTable.sort} onSort={varianceTable.toggleSort} />
                  <SortableHead label="Department" sortKey="department" sort={varianceTable.sort} onSort={varianceTable.toggleSort} />
                  <SortableHead label="Budget" sortKey="budget" sort={varianceTable.sort} onSort={varianceTable.toggleSort} className="text-right" />
                  <SortableHead label="Actual" sortKey="actual" sort={varianceTable.sort} onSort={varianceTable.toggleSort} className="text-right" />
                  <SortableHead label="Variance" sortKey="variance" sort={varianceTable.sort} onSort={varianceTable.toggleSort} className="text-right" />
                  <SortableHead label="% Var" sortKey="pct" sort={varianceTable.sort} onSort={varianceTable.toggleSort} className="text-right" />
                  <SortableHead label="Status" sortKey="pct" sort={varianceTable.sort} onSort={varianceTable.toggleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {varianceTable.pagedData.map(item => (
                  <TableRow key={item.category + item.department} className="text-xs">
                    <TableCell className="font-medium">{item.category}</TableCell>
                    <TableCell className="text-muted-foreground">{item.department}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(item.budget)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(item.actual)}</TableCell>
                    <TableCell className={`text-right font-mono font-medium ${item.variance >= 0 ? "text-success" : "text-destructive"}`}>
                      {item.variance >= 0 ? "+" : ""}{fmt(item.variance)}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${item.pct >= 0 ? "text-success" : "text-destructive"}`}>
                      {item.pct >= 0 ? "+" : ""}{item.pct}%
                    </TableCell>
                    <TableCell>
                      {Math.abs(item.pct) > 10 ? (
                        <Badge variant="destructive" className="text-[10px]">⚠ Alert</Badge>
                      ) : item.pct >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5 text-destructive" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar page={varianceTable.page} totalPages={varianceTable.totalPages} totalItems={varianceTable.totalItems} pageSize={varianceTable.pageSize} onPageChange={varianceTable.setPage} />
          </CardContent></Card>
        </TabsContent>

        {/* ─── Departments ─── */}
        <TabsContent value="departments">
          <Card className="border-border"><CardContent className="p-0">
            <FilterBar search={deptTable.search} onSearch={deptTable.setSearch} filters={deptTable.filters} onFilter={deptTable.setFilter} onClear={deptTable.clearFilters} filterConfigs={deptTable.filterConfigs} activeCount={deptTable.activeFilterCount} searchPlaceholder="Rechercher un département…" />
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SortableHead label="Department" sortKey="department" sort={deptTable.sort} onSort={deptTable.toggleSort} />
                  <SortableHead label="Budget" sortKey="budget" sort={deptTable.sort} onSort={deptTable.toggleSort} className="text-right" />
                  <SortableHead label="Actual" sortKey="actual" sort={deptTable.sort} onSort={deptTable.toggleSort} className="text-right" />
                  <SortableHead label="Forecast" sortKey="forecast" sort={deptTable.sort} onSort={deptTable.toggleSort} className="text-right" />
                  <SortableHead label="Utilization" sortKey="actual" sort={deptTable.sort} onSort={deptTable.toggleSort} />
                  <SortableHead label="Status" sortKey="status" sort={deptTable.sort} onSort={deptTable.toggleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {deptTable.pagedData.map(d => {
                  const util = Math.round((d.actual / d.budget) * 100);
                  return (
                    <TableRow key={d.department} className="text-xs">
                      <TableCell className="font-medium">{d.department}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(d.budget)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(d.actual)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{fmt(d.forecast)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={Math.min(util, 100)} className="h-1.5 w-16" />
                          <span className={`text-[10px] ${util > 100 ? "text-destructive font-medium" : ""}`}>{util}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${d.status === "On Track" ? "bg-success/15 text-success border-success/20" : d.status === "Over Budget" ? "bg-destructive/15 text-destructive border-destructive/20" : d.status === "Under Budget" ? "bg-blue-500/15 text-blue-700 border-blue-500/20" : "bg-amber-500/15 text-amber-700 border-amber-500/20"}`} variant="outline">
                          {d.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PaginationBar page={deptTable.page} totalPages={deptTable.totalPages} totalItems={deptTable.totalItems} pageSize={deptTable.pageSize} onPageChange={deptTable.setPage} />
          </CardContent></Card>
        </TabsContent>

        {/* ─── Entity Consolidation ─── */}
        <TabsContent value="entities">
          <div className="space-y-3">
            {entityBudgets.map(e => (
              <Card key={e.entity} className="border-border">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium">{e.entity}</div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{e.utilization}% utilized</Badge>
                      <Badge className={`text-[10px] ${e.variance >= 0 ? "bg-success/15 text-success border-success/20" : "bg-destructive/15 text-destructive border-destructive/20"}`} variant="outline">
                        {e.variance >= 0 ? "+" : ""}{fmt(e.variance)} K remaining
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-xs text-muted-foreground mb-2">
                    <span>Budget: <span className="font-mono text-foreground">{fmt(e.budget)} K</span></span>
                    <span>Actual: <span className="font-mono text-foreground">{fmt(e.actual)} K</span></span>
                    <span>Forecast: <span className="font-mono text-foreground">{fmt(e.forecast)} K</span></span>
                    <span className={e.variance >= 0 ? "text-success" : "text-destructive"}>
                      Variance: {e.variance >= 0 ? "+" : ""}{fmt(e.variance)} K
                    </span>
                  </div>
                  <Progress value={e.utilization} className="h-2" />
                </CardContent>
              </Card>
            ))}

            <Card className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">Consolidated Total</div>
                  <Badge variant="default" className="text-[10px]">Multi-Entity</Badge>
                </div>
                <div className="grid grid-cols-4 gap-4 text-xs">
                  <span>Budget: <span className="font-mono font-medium text-foreground">{fmt(entityBudgets.reduce((s, e) => s + e.budget, 0))} K</span></span>
                  <span>Actual: <span className="font-mono font-medium text-foreground">{fmt(entityBudgets.reduce((s, e) => s + e.actual, 0))} K</span></span>
                  <span>Forecast: <span className="font-mono font-medium text-foreground">{fmt(entityBudgets.reduce((s, e) => s + e.forecast, 0))} K</span></span>
                  <span className="text-success font-medium">
                    Remaining: +{fmt(entityBudgets.reduce((s, e) => s + e.variance, 0))} K
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Cash Flow Forecast ─── */}
        <TabsContent value="cashflow">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Projected Cash Flow — H2 2025</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={cashFlowForecast}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="inflow" name="Cash Inflow" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="outflow" name="Cash Outflow" fill="hsl(var(--chart-3))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="net" name="Net Cash Flow" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
