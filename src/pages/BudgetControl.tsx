import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShieldCheck, Lock, Download, FileText } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useMyBudgetRoles } from "@/hooks/use-budget-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/budget-roles";

const alerts = [
  { id: "BA-001", type: "Budget Overrun", severity: "critical", message: "Marketing dépasse le budget de 20.8% — révision requise", department: "Marketing", date: "2025-03-08" },
  { id: "BA-002", type: "Budget Overrun", severity: "warning", message: "Operations COGS dépassement de 2.9% — surveiller la tendance", department: "Operations", date: "2025-03-07" },
  { id: "BA-003", type: "Cash Flow", severity: "info", message: "Cash flow net en diminution Q4 — planifier réserves", department: "Treasury", date: "2025-03-06" },
  { id: "BA-004", type: "Forecast Deviation", severity: "warning", message: "IT expenses forecast +8% vs budget — revoir le périmètre", department: "IT", date: "2025-03-05" },
];

const commitments = [
  { department: "IT", committed: 38000, budget: 45000, blocked: false },
  { department: "Marketing", committed: 14500, budget: 12000, blocked: true },
  { department: "Operations", committed: 43200, budget: 42000, blocked: false },
  { department: "HR", committed: 34200, budget: 35000, blocked: false },
];

const cashFlowForecast = [
  { month: "Jul", inflow: 16200, outflow: 14800, net: 1400 },
  { month: "Aug", inflow: 16500, outflow: 15200, net: 1300 },
  { month: "Sep", inflow: 16800, outflow: 15500, net: 1300 },
  { month: "Oct", inflow: 17000, outflow: 15800, net: 1200 },
  { month: "Nov", inflow: 17200, outflow: 16000, net: 1200 },
  { month: "Dec", inflow: 17500, outflow: 16500, net: 1000 },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function BudgetControl() {
  const perms = useMyBudgetRoles();
  const canExport = canDo(perms, "export");
  const canLock = canDo(perms, "lock_period");
  const exportTip = actionTooltip(perms, "export", "Exporter le contrôle");
  const lockTip = actionTooltip(perms, "lock_period", "Verrouiller la période budgétaire");
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Budget & Forecast", href: "/budget" }, { label: "Control" }]} />
      <GuidanceBanner title="Budget Control" description="Budget overrun alerts, commitment tracking, over-budget blocking, and cash flow monitoring." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Budget Control</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!canLock} aria-label={lockTip} title={lockTip}><Lock className="w-3.5 h-3.5" />Verrouiller la période</Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport} aria-label={exportTip} title={exportTip}><Download className="w-3.5 h-3.5" />Export CSV</Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport} aria-label={exportTip} title={exportTip}><FileText className="w-3.5 h-3.5" />Export PDF</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Budget Alerts</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {alerts.map(a => (
              <div key={a.id} className={`flex items-center gap-3 p-3 rounded-lg border text-xs ${a.severity === "critical" ? "bg-destructive/5 border-destructive/20 text-destructive" : a.severity === "warning" ? "bg-amber-500/5 border-amber-500/20 text-amber-700" : "bg-muted/30 border-border text-muted-foreground"}`}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="font-medium">[{a.type}]</span>
                <span className="flex-1">{a.message}</span>
                <Badge variant="outline" className="text-[10px]">{a.department}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Commitment Control</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {commitments.map(c => (
              <div key={c.department} className={`flex items-center gap-3 p-3 rounded-lg border text-xs ${c.blocked ? "bg-destructive/5 border-destructive/20" : "bg-muted/20 border-border"}`}>
                {c.blocked ? <Lock className="w-3.5 h-3.5 text-destructive" /> : <ShieldCheck className="w-3.5 h-3.5 text-success" />}
                <div className="flex-1">
                  <div className="font-medium">{c.department}</div>
                  <div className="text-muted-foreground">{maskAmount(perms, c.committed)} / {maskAmount(perms, c.budget)} K committed</div>
                </div>
                {c.blocked && <Badge variant="destructive" className="text-[10px]">Blocked</Badge>}
                <span className={`font-mono text-[10px] ${c.committed > c.budget ? "text-destructive" : "text-success"}`}>
                  {Math.round((c.committed / c.budget) * 100)}%
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Projected Cash Flow — H2 2025</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={cashFlowForecast}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="inflow" name="Cash Inflow" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="outflow" name="Cash Outflow" fill="hsl(var(--chart-3))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="net" name="Net" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </PageShell>
  );
}
