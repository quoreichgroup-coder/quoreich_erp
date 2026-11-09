import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Copy, TrendingUp, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMyExpenseRoles } from "@/hooks/use-expense-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/expense-roles";

const policyViolations = [
  { id: "EXP-2025-008", employee: "A. Koné", category: "Travel", amount: 375000, violation: "Per diem exceeds destination rate (Dakar: max 75K/day × 5 = 375K but no receipts)", severity: "Critical", date: "2025-03-08" },
  { id: "EXP-2025-004", employee: "A. Koné", category: "Transport", amount: 35000, violation: "Taxi expense > 25K without pre-approval", severity: "Warning", date: "2025-03-04" },
  { id: "EXP-2025-009", employee: "C. Bamba", category: "Meals", amount: 92000, violation: "5th meal expense this week (policy max: 4)", severity: "Warning", date: "2025-03-07" },
];

const duplicateSuspects = [
  { expense1: "EXP-2025-001", expense2: "EXP-2025-010", employee: "A. Koné", amount: 850000, description: "Flight ABJ→DKR", similarity: 95, date: "2025-03-01" },
  { expense1: "EXP-2025-007", expense2: "EXP-2025-011", employee: "D. Ouattara", amount: 180000, description: "Team lunch", similarity: 88, date: "2025-03-07" },
];

const budgetOverruns = [
  { department: "IT", budgetAlloc: 15000000, spent: 14250000, utilization: 95, remaining: 750000, status: "Warning" },
  { department: "Sales", budgetAlloc: 12000000, spent: 11800000, utilization: 98, remaining: 200000, status: "Critical" },
  { department: "HR", budgetAlloc: 8000000, spent: 5100000, utilization: 64, remaining: 2900000, status: "OK" },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function ExpenseControl() {
  const perms = useMyExpenseRoles();
  const canApprove = canDo(perms, "approve_report");
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Expenses", href: "/expenses" }, { label: "Control" }]} />
      <GuidanceBanner title="Expense Control" description="Policy violation detection, duplicate expense alerts, and department budget overrun monitoring." />

      <h1 className="text-lg font-semibold text-foreground">Expense Control</h1>

      {/* Policy Violations */}
      <Card className="border-border">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-destructive" />Policy Violations</CardTitle></CardHeader>
        <CardContent className="p-4 pt-2 space-y-2.5">
          {policyViolations.map(v => (
            <div key={v.id} className={`p-3 rounded-lg border ${v.severity === "Critical" ? "border-destructive/30 bg-destructive/5" : "border-amber-500/30 bg-amber-50/5"}`}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-primary">{v.id}</span>
                  <span className="text-xs font-medium">{v.employee}</span>
                  <Badge variant="outline" className="text-[10px]">{v.category}</Badge>
                </div>
                <Badge variant={v.severity === "Critical" ? "destructive" : "secondary"} className="text-[10px]">{v.severity}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground">{v.violation}</div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs font-mono">{maskAmount(perms, v.amount)} XOF</span>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" disabled={!canApprove}
                  aria-label={actionTooltip(perms, "approve_report", "Revoir")}
                  title={actionTooltip(perms, "approve_report", "Revoir")}>
                  {canApprove ? "Review" : <><Lock className="w-3 h-3 mr-1" />Review</>}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Duplicate Detection */}
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm flex items-center gap-2"><Copy className="w-4 h-4 text-amber-600" />Duplicate Detection</CardTitle></CardHeader>
          <CardContent className="p-4 pt-2 space-y-2.5">
            {duplicateSuspects.map((d, i) => (
              <div key={i} className="p-3 rounded-lg border border-amber-500/30 bg-amber-50/5 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{d.employee}</span>
                  <Badge variant="secondary" className="text-[10px]">{d.similarity}% match</Badge>
                </div>
                <div className="text-muted-foreground">{d.description} — {fmt(d.amount)} XOF</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  <span className="font-mono">{d.expense1}</span> ↔ <span className="font-mono">{d.expense2}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Budget Overruns */}
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" />Department Budget Utilization</CardTitle></CardHeader>
          <CardContent className="p-4 pt-2 space-y-3">
            {budgetOverruns.map(b => (
              <div key={b.department} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{b.department}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{fmt(b.spent)} / {fmt(b.budgetAlloc)}</span>
                    <Badge variant={b.status === "Critical" ? "destructive" : b.status === "Warning" ? "secondary" : "outline"} className="text-[10px]">{b.utilization}%</Badge>
                  </div>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${b.status === "Critical" ? "bg-destructive" : b.status === "Warning" ? "bg-amber-500" : "bg-success"}`} style={{ width: `${Math.min(b.utilization, 100)}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
