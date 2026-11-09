import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Lock } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useMyProjectRoles } from "@/hooks/use-project-data";
import { canDo, actionTooltip } from "@/lib/project-roles";

const projects = [
  { id: "PRJ-001", name: "ERP Implementation Phase 2", status: "In Progress", budget: 45000, costs: 28500, revenue: 32000, startDate: "2025-01-15", endDate: "2025-08-30", completion: 63, pm: "A. Koné" },
  { id: "PRJ-002", name: "Data Center Migration", status: "In Progress", budget: 32000, costs: 18200, revenue: 22000, startDate: "2025-02-01", endDate: "2025-07-31", completion: 57, pm: "M. Diallo" },
  { id: "PRJ-003", name: "Financial Audit Support", status: "Completed", budget: 12000, costs: 11200, revenue: 15000, startDate: "2024-10-01", endDate: "2025-02-28", completion: 100, pm: "S. Bamba" },
  { id: "PRJ-005", name: "Compliance Framework", status: "In Progress", budget: 18000, costs: 12400, revenue: 14000, startDate: "2025-01-01", endDate: "2025-06-30", completion: 69, pm: "B. Coulibaly" },
  { id: "PRJ-006", name: "Mobile Banking App", status: "In Progress", budget: 52000, costs: 31200, revenue: 38000, startDate: "2025-02-15", endDate: "2025-11-30", completion: 45, pm: "A. Koné" },
];

const costBreakdown = [
  { month: "Jan", labor: 8200, materials: 2100, overhead: 1800 },
  { month: "Feb", labor: 9400, materials: 1800, overhead: 1900 },
  { month: "Mar", labor: 10200, materials: 2400, overhead: 2000 },
  { month: "Apr", labor: 9800, materials: 1600, overhead: 1800 },
  { month: "May", labor: 11500, materials: 2800, overhead: 2100 },
  { month: "Jun", labor: 10800, materials: 2200, overhead: 1950 },
];

const burndownData = [
  { week: "W1", planned: 100, actual: 100 },
  { week: "W4", planned: 88, actual: 90 },
  { week: "W8", planned: 72, actual: 78 },
  { week: "W12", planned: 55, actual: 62 },
  { week: "W16", planned: 38, actual: 48 },
  { week: "W20", planned: 20, actual: 35 },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function ProjectReporting() {
  const perms = useMyProjectRoles();
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Projects", href: "/projects" }, { label: "Reporting" }]} />
      <GuidanceBanner title="Project Reporting" description="P&L by project, Gantt timeline, cost analysis (Labor/Materials/Overhead), and burndown charts." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Project Reporting</h1>
        <Button size="sm" variant="outline" className="gap-1.5"
          disabled={!canDo(perms, "export")}
          aria-label={actionTooltip(perms, "export", "Exporter le rapport en PDF")}
          title={actionTooltip(perms, "export", "Exporter le rapport en PDF")}>
          {canDo(perms, "export") ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Export PDF
        </Button>
      </div>

      {/* Gantt */}
      <Card className="border-border mb-4">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Project Timeline (Gantt View)</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="space-y-2">
            {projects.map(p => {
              const start = new Date(p.startDate).getTime();
              const end = new Date(p.endDate).getTime();
              const minDate = new Date("2024-10-01").getTime();
              const maxDate = new Date("2026-01-01").getTime();
              const range = maxDate - minDate;
              const leftPct = ((start - minDate) / range) * 100;
              const widthPct = ((end - start) / range) * 100;
              return (
                <div key={p.id} className="flex items-center gap-3">
                  <div className="w-48 text-xs truncate font-medium">{p.name}</div>
                  <div className="flex-1 relative h-8 bg-muted/30 rounded">
                    <div className={`absolute top-1 h-6 rounded flex items-center px-2 text-[10px] font-medium text-primary-foreground ${p.status === "Completed" ? "bg-success" : "bg-primary"}`} style={{ left: `${Math.max(0, leftPct)}%`, width: `${Math.min(widthPct, 100 - leftPct)}%` }}>{p.completion}%</div>
                  </div>
                  <div className="w-16 text-[10px] text-muted-foreground text-right">{p.pm}</div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-3 text-[10px] text-muted-foreground border-t border-border pt-2">
            <span>Oct 2024</span><span>Jan 2025</span><span>Apr 2025</span><span>Jul 2025</span><span>Oct 2025</span><span>Jan 2026</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Monthly Cost Breakdown</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={costBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="labor" name="Labor" fill="hsl(var(--chart-1))" stackId="a" />
                <Bar dataKey="materials" name="Materials" fill="hsl(var(--chart-2))" stackId="a" />
                <Bar dataKey="overhead" name="Overhead" fill="hsl(var(--chart-3))" stackId="a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Budget Burndown</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={burndownData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" domain={[0, 100]} />
                <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="planned" name="Planned" stroke="hsl(var(--chart-2))" strokeDasharray="5 5" strokeWidth={2} />
                <Line type="monotone" dataKey="actual" name="Actual" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border col-span-2">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Budget vs Costs by Project</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={projects.filter(p => p.status !== "Planning")} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" width={140} />
                <Tooltip formatter={(v: number) => `${fmt(v)} XOF K`} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="budget" name="Budget" fill="hsl(var(--chart-2))" radius={[0, 3, 3, 0]} />
                <Bar dataKey="costs" name="Costs" fill="hsl(var(--chart-1))" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
