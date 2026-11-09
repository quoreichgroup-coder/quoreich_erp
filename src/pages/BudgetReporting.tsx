import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Download } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useBudgets, useBudgetLines, useMyBudgetRoles } from "@/hooks/use-budget-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/budget-roles";

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function BudgetReporting() {
  const perms = useMyBudgetRoles();
  const canExport = canDo(perms, "export");
  const exportTip = actionTooltip(perms, "export", "Exporter le rapport en PDF");
  const [scenario, setScenario] = useState("base");
  const { data: budgets = [], isLoading: budgetsLoading } = useBudgets();
  const { data: allLines = [], isLoading: linesLoading } = useBudgetLines();

  // Build chart data from budget_lines grouped by period
  const chartData = useMemo(() => {
    if (!allLines.length) return [];
    const byPeriod = new Map<string, { planned: number; actual: number }>();
    allLines.forEach(l => {
      const cur = byPeriod.get(l.period) || { planned: 0, actual: 0 };
      cur.planned += Number(l.planned_amount);
      cur.actual += Number(l.actual_amount);
      byPeriod.set(l.period, cur);
    });
    return Array.from(byPeriod.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, v]) => ({
        month: period,
        actual: v.actual,
        budget: v.planned,
        forecast: Math.round(v.planned * 1.02),
        optimistic: Math.round(v.planned * 1.10),
        pessimistic: Math.round(v.planned * 0.85),
        stress: Math.round(v.planned * 0.70),
      }));
  }, [allLines]);

  // Entity consolidation from budgets
  const entityBudgets = useMemo(() => {
    return budgets.map(b => {
      const lines = allLines.filter(l => l.budget_id === b.id);
      const totalPlanned = lines.reduce((s, l) => s + Number(l.planned_amount), 0);
      const totalActual = lines.reduce((s, l) => s + Number(l.actual_amount), 0);
      const utilization = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
      return {
        entity: `${b.name} (${b.fiscal_year})`,
        budget: totalPlanned,
        actual: totalActual,
        utilization,
        variance: totalPlanned - totalActual,
        scenario: b.scenario,
        status: b.status,
      };
    });
  }, [budgets, allLines]);

  const loading = budgetsLoading || linesLoading;

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Budget & Forecast", href: "/budget" }, { label: "Reporting" }]} />
      <GuidanceBanner title="Budget Reporting" description="Multi-entity consolidation, 4-scenario analysis, variance reports, and export." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Budget Reporting</h1>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport} aria-label={exportTip} title={exportTip}><Download className="w-3.5 h-3.5" />Export PDF</Button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-muted-foreground">Scenario:</span>
        {[{ key: "base", label: "Base" }, { key: "optimistic", label: "Optimistic" }, { key: "pessimistic", label: "Pessimistic" }, { key: "stress", label: "Stress Test" }].map(s => (
          <Button key={s.key} size="sm" variant={scenario === s.key ? "default" : "outline"} className="h-7 text-xs" onClick={() => setScenario(s.key)}>{s.label}</Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Chargement…</div>
      ) : chartData.length === 0 ? (
        <Card className="border-border mb-4"><CardContent className="p-8 text-center text-sm text-muted-foreground">Aucune ligne budgétaire. Créez un budget et ajoutez des lignes pour voir les rapports.</CardContent></Card>
      ) : (
        <Card className="border-border mb-4">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Revenue Forecast — {scenario.charAt(0).toUpperCase() + scenario.slice(1)} Scenario</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={360}>
              <AreaChart data={chartData}>
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
      )}

      <div className="space-y-3">
        <div className="text-sm font-medium">Entity Consolidation</div>
        {entityBudgets.length === 0 && !loading && (
          <div className="text-xs text-muted-foreground">Aucun budget trouvé.</div>
        )}
        {entityBudgets.map(e => (
          <Card key={e.entity} className="border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">{e.entity}</div>
                <Badge className={`text-[10px] ${e.variance >= 0 ? "bg-success/15 text-success border-success/20" : "bg-destructive/15 text-destructive border-destructive/20"}`} variant="outline">
                  {canDo(perms, "view_sensitive") ? `${e.variance >= 0 ? "+" : ""}${fmt(e.variance)} remaining` : "••••• remaining"}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground mb-2">
                <span>Budget: <span className="font-mono text-foreground">{maskAmount(perms, e.budget)}</span></span>
                <span>Actual: <span className="font-mono text-foreground">{maskAmount(perms, e.actual)}</span></span>
                <span>Utilization: <span className="font-mono text-foreground">{e.utilization}%</span></span>
              </div>
              <Progress value={Math.min(e.utilization, 100)} className="h-2" />
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
