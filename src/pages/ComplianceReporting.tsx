import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Download, Lock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useMyComplianceRoles } from "@/hooks/use-compliance-data";
import { canDo, actionTooltip } from "@/lib/compliance-roles";

const complianceTrend = [
  { quarter: "Q1 2024", effectiveness: 58, findings: 8 },
  { quarter: "Q2 2024", effectiveness: 63, findings: 6 },
  { quarter: "Q3 2024", effectiveness: 70, findings: 5 },
  { quarter: "Q4 2024", effectiveness: 72, findings: 4 },
  { quarter: "Q1 2025", effectiveness: 67, findings: 4 },
];

const gapAnalysis = [
  { area: "Journal Entry Controls", coverage: 95, gaps: 1, status: "Good" },
  { area: "Access Management", coverage: 88, gaps: 2, status: "Adequate" },
  { area: "Bank Reconciliation", coverage: 70, gaps: 3, status: "Needs Work" },
  { area: "Revenue Recognition", coverage: 92, gaps: 1, status: "Good" },
  { area: "Lease Accounting", coverage: 45, gaps: 4, status: "Critical" },
  { area: "Procurement Controls", coverage: 60, gaps: 3, status: "Needs Work" },
];

export default function ComplianceReporting() {
  const perms = useMyComplianceRoles();
  const canExport = canDo(perms, "export");
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Compliance", href: "/compliance" }, { label: "Reporting" }]} />
      <GuidanceBanner title="Compliance Reporting" description="Audit reports, compliance trends, and gap analysis." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Compliance Reporting</h1>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport} aria-label={actionTooltip(perms, "export", "Exporter PDF")} title={actionTooltip(perms, "export", "Exporter PDF")}>
          {canExport ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Export PDF
        </Button>
      </div>

      <Card className="border-border mb-4">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Compliance Effectiveness Trend</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={complianceTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="quarter" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
              <Bar dataKey="effectiveness" name="Effectiveness %" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="findings" name="Open Findings" fill="hsl(var(--chart-3))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Gap Analysis</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {gapAnalysis.map(g => (
            <div key={g.area} className="flex items-center gap-4 p-3 rounded-lg border border-border">
              <div className="flex-1"><div className="text-xs font-medium">{g.area}</div></div>
              <div className="w-28"><Progress value={g.coverage} className="h-1.5" /><div className="text-[10px] text-muted-foreground mt-0.5">{g.coverage}% coverage</div></div>
              <div className="text-xs text-muted-foreground">{g.gaps} gaps</div>
              <Badge className={`text-[10px] ${g.status === "Good" ? "bg-success/15 text-success border-success/20" : g.status === "Critical" ? "bg-destructive/15 text-destructive border-destructive/20" : "bg-amber-500/15 text-amber-700 border-amber-500/20"}`} variant="outline">{g.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </PageShell>
  );
}
