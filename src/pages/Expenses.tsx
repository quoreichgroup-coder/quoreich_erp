import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Receipt, Clock, CheckCircle, AlertTriangle, TrendingUp, Users } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { useExpenseKpis } from "@/hooks/use-expense-data";

const fmt = (n: number) => n.toLocaleString("fr-FR");
const COLORS = ["hsl(220, 50%, 40%)", "hsl(150, 50%, 40%)", "hsl(35, 80%, 50%)", "hsl(280, 50%, 50%)", "hsl(0, 60%, 50%)"];

export default function Expenses() {
  const { reports, pending, approved, totalReimbursed, violations } = useExpenseKpis();

  const kpis = [
    { label: "Pending", value: String(pending.length), icon: Clock, color: "text-amber-600", change: `${fmt(pending.reduce((s, r) => s + Number(r.total), 0))} XOF` },
    { label: "Approved", value: String(approved.length), icon: CheckCircle, color: "text-primary", change: `${fmt(totalReimbursed)} XOF` },
    { label: "Total Reports", value: String(reports.length), icon: Receipt, color: "text-success", change: "all time" },
    { label: "Rejections", value: String(violations.length), icon: AlertTriangle, color: "text-destructive", change: "policy violations" },
  ];

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Expenses" }]} />
      <GuidanceBanner title="Expense Management" description="Track expense reports, approvals, and reimbursements — powered by live data." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Expense Overview</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {kpis.map(k => (
          <Card key={k.label} className="border-border">
            <CardContent className="p-3.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{k.label}</span>
                <k.icon className={`w-3.5 h-3.5 ${k.color}`} />
              </div>
              <p className="text-lg font-semibold text-foreground tabular-nums">{k.value}</p>
              <p className="text-[11px] text-muted-foreground">{k.change}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Recent Expense Reports</CardTitle></CardHeader>
        <CardContent className="p-0">
          {reports.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">Aucune note de frais — créez-en une depuis Transactions</div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Report #</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Total (XOF)</th>
                <th className="px-3 py-2 text-center font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-center font-medium text-muted-foreground">Approval</th>
              </tr></thead>
              <tbody>{reports.slice(0, 10).map(r => (
                <tr key={r.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-primary">{r.report_number}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.submission_date}</td>
                  <td className="px-3 py-2 text-right font-mono font-medium">{fmt(Number(r.total))}</td>
                  <td className="px-3 py-2 text-center"><Badge variant="outline" className="text-[10px]">{r.status}</Badge></td>
                  <td className="px-3 py-2 text-center"><Badge variant="outline" className={`text-[10px] ${r.approval_status === "approved" ? "bg-success/15 text-success" : r.approval_status === "rejected" ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-700"}`}>{r.approval_status}</Badge></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
