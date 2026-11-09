import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Lock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";
import { useMyRiskRoles } from "@/hooks/use-risk-data";
import { canDo, actionTooltip } from "@/lib/risk-roles";

const radarData = [
  { dimension: "Credit Risk", value: 75 }, { dimension: "Market Risk", value: 68 },
  { dimension: "Liquidity Risk", value: 82 }, { dimension: "Operational Risk", value: 55 },
  { dimension: "Compliance Risk", value: 72 }, { dimension: "Cyber Risk", value: 70 },
];

const riskByCategory = [
  { category: "Financial", count: 3, avgScore: 75 },
  { category: "Operational", count: 3, avgScore: 68 },
  { category: "Compliance", count: 1, avgScore: 72 },
];

export default function RiskReporting() {
  const perms = useMyRiskRoles();
  const canExport = canDo(perms, "export");
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Risk Management", href: "/risk" }, { label: "Reporting" }]} />
      <GuidanceBanner title="Risk Reporting" description="Risk score evolution, stress testing, radar analysis, and category breakdowns." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Risk Reporting</h1>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport} aria-label={actionTooltip(perms, "export", "Exporter PDF")} title={actionTooltip(perms, "export", "Exporter PDF")}>
          {canExport ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Export PDF
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Risk Radar</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <Radar name="Risk Score" dataKey="value" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.2} />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Risk by Category</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={riskByCategory}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                <Bar dataKey="avgScore" name="Avg Score" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="count" name="Count" fill="hsl(var(--chart-3))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
