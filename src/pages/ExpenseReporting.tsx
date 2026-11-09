import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Button } from "@/components/ui/button";
import { Download, Lock } from "lucide-react";
import { useMyExpenseRoles } from "@/hooks/use-expense-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/expense-roles";

const fmt = (n: number) => n.toLocaleString("fr-FR");

const spendByDept = [
  { department: "IT", total: 4250000, count: 18 },
  { department: "Sales", total: 3800000, count: 22 },
  { department: "HR", total: 2100000, count: 12 },
  { department: "Finance", total: 1200000, count: 8 },
  { department: "Operations", total: 1650000, count: 15 },
];

const topSpenders = [
  { employee: "A. Koné", department: "IT", total: 2850000, submissions: 12, avgAmount: 237500, compliance: 92 },
  { employee: "B. Coulibaly", department: "Sales", total: 2400000, submissions: 15, avgAmount: 160000, compliance: 88 },
  { employee: "D. Ouattara", department: "HR", total: 1800000, submissions: 8, avgAmount: 225000, compliance: 100 },
  { employee: "C. Bamba", department: "Finance", total: 950000, submissions: 6, avgAmount: 158333, compliance: 100 },
];

const cycleMetrics = [
  { metric: "Avg Submission to Approval", value: "2.1 days", target: "2 days", status: "Warning" },
  { metric: "Avg Approval to Reimbursement", value: "3.5 days", target: "5 days", status: "Met" },
  { metric: "Total Cycle Time", value: "5.6 days", target: "7 days", status: "Met" },
  { metric: "Policy Compliance Rate", value: "94%", target: "95%", status: "Warning" },
];

export default function ExpenseReporting() {
  const perms = useMyExpenseRoles();
  const canExport = canDo(perms, "export");
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Expenses", href: "/expenses" }, { label: "Reporting" }]} />
      <GuidanceBanner title="Expense Reporting" description="Spend analytics by category, department, employee, and reimbursement cycle metrics." />

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Expense Reports</h1>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport}
          aria-label={actionTooltip(perms, "export", "Exporter")}
          title={actionTooltip(perms, "export", "Exporter")}>
          {canExport ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Exporter
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Spend by Department</CardTitle></CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={spendByDept} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000000).toFixed(1)}M`} />
                  <YAxis type="category" dataKey="department" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))" }} formatter={(v: number) => `${fmt(v)} XOF`} />
                  <Bar dataKey="total" fill="hsl(220, 50%, 40%)" radius={[0, 4, 4, 0]} name="Total Spend" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Reimbursement Cycle Metrics</CardTitle></CardHeader>
          <CardContent className="p-4 pt-2 space-y-3">
            {cycleMetrics.map(m => (
              <div key={m.metric} className="flex items-center justify-between p-2.5 rounded-lg border border-border text-xs">
                <span className="font-medium">{m.metric}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono">{m.value}</span>
                  <span className="text-muted-foreground">/ {m.target}</span>
                  <Badge variant={m.status === "Met" ? "outline" : "secondary"} className="text-[10px]">{m.status}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Top Spenders</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Employee", "Department", "Submissions", "Total (XOF)", "Avg Amount", "Compliance"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>{topSpenders.map(s => (
              <tr key={s.employee} className="border-b border-border hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{s.employee}</td>
                <td className="px-3 py-2 text-muted-foreground">{s.department}</td>
                <td className="px-3 py-2 text-right font-mono">{s.submissions}</td>
                <td className="px-3 py-2 text-right font-mono font-medium">{fmt(s.total)}</td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmt(s.avgAmount)}</td>
                <td className="px-3 py-2"><Badge variant={s.compliance >= 95 ? "outline" : "secondary"} className="text-[10px]">{s.compliance}%</Badge></td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent>
      </Card>
    </PageShell>
  );
}
