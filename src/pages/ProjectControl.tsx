import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, DollarSign, ShieldCheck } from "lucide-react";

const alerts = [
  { id: "PA-001", type: "Budget Overrun", severity: "warning", message: "PRJ-006 Mobile Banking App — costs at 60% of budget with only 45% completion", project: "PRJ-006" },
  { id: "PA-002", type: "Delay Risk", severity: "warning", message: "PRJ-001 ERP Implementation — behind schedule, UAT milestone at risk", project: "PRJ-001" },
  { id: "PA-003", type: "GL Reconciliation", severity: "info", message: "3 project cost entries pending GL posting", project: "Multiple" },
  { id: "PA-004", type: "Milestone Overdue", severity: "critical", message: "PRJ-002 Data Migration Wave 1 — due May 15, still in progress", project: "PRJ-002" },
];

const glReconciliation = [
  { check: "All project costs posted to GL", status: "Pass", details: "42 entries verified" },
  { check: "Revenue recognition matches milestones", status: "Pass", details: "3 milestones billed correctly" },
  { check: "WIP balance matches project costs - revenue", status: "Warning", details: "PRJ-006 WIP discrepancy: 1,200 XOF K" },
  { check: "No orphan GL entries (unlinked to projects)", status: "Pass", details: "All entries linked" },
];

export default function ProjectControl() {
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Projects", href: "/projects" }, { label: "Control" }]} />
      <GuidanceBanner title="Project Control" description="Budget overrun alerts, schedule delays, milestone tracking, and GL reconciliation." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Project Control</h1>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertTriangle className="w-3.5 h-3.5" />Active Alerts</div>
          <div className="text-xl font-bold text-foreground">{alerts.length}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign className="w-3.5 h-3.5" />Budget Alerts</div>
          <div className="text-xl font-bold text-amber-600">{alerts.filter(a => a.type === "Budget Overrun").length}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Clock className="w-3.5 h-3.5" />Schedule Delays</div>
          <div className="text-xl font-bold text-destructive">{alerts.filter(a => a.type.includes("Delay") || a.type.includes("Overdue")).length}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><ShieldCheck className="w-3.5 h-3.5" />GL Checks</div>
          <div className="text-xl font-bold text-foreground">{glReconciliation.filter(c => c.status === "Pass").length}/{glReconciliation.length}</div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Project Alerts</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {alerts.map(a => (
              <div key={a.id} className={`flex items-center gap-3 p-3 rounded-lg border text-xs ${a.severity === "critical" ? "bg-destructive/5 border-destructive/20 text-destructive" : a.severity === "warning" ? "bg-amber-500/5 border-amber-500/20 text-amber-700" : "bg-muted/30 border-border text-muted-foreground"}`}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="font-medium">[{a.type}]</span>
                <span className="flex-1">{a.message}</span>
                <Badge variant="outline" className="text-[10px]">{a.project}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">GL Reconciliation</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {glReconciliation.map((c, i) => (
              <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border text-xs ${c.status === "Pass" ? "bg-success/5 border-success/20" : "bg-amber-500/5 border-amber-500/20"}`}>
                <Badge variant={c.status === "Pass" ? "default" : "secondary"} className="text-[10px]">{c.status}</Badge>
                <div className="flex-1"><div className="font-medium">{c.check}</div><div className="text-muted-foreground mt-0.5">{c.details}</div></div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
