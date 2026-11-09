import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Clock, ShieldCheck } from "lucide-react";
import { useMyRiskRoles } from "@/hooks/use-risk-data";
import { maskAmount } from "@/lib/risk-roles";

const mitigationPlans = [
  { risk: "FX Exposure", plan: "Quarterly hedging review", sla: "30 days", progress: 80, status: "On Track", owner: "Treasury" },
  { risk: "Credit Default", plan: "Monthly credit scoring", sla: "15 days", progress: 65, status: "On Track", owner: "AR" },
  { risk: "Liquidity Shortfall", plan: "Reserve fund establishment", sla: "45 days", progress: 25, status: "At Risk", owner: "Treasury" },
  { risk: "Regulatory Compliance", plan: "Compliance gap analysis", sla: "60 days", progress: 50, status: "On Track", owner: "Compliance" },
  { risk: "Vendor Concentration", plan: "Secondary vendor program", sla: "90 days", progress: 30, status: "Delayed", owner: "Procurement" },
];

export default function RiskControl() {
  const perms = useMyRiskRoles();
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Risk Management", href: "/risk" }, { label: "Control" }]} />
      <GuidanceBanner title="Risk Control" description="Mitigation plan tracking, SLA monitoring, and escalation management." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Risk Control</h1>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><ShieldCheck className="w-3.5 h-3.5" />On Track</div>
          <div className="text-xl font-bold text-success">{mitigationPlans.filter(p => p.status === "On Track").length}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertTriangle className="w-3.5 h-3.5" />At Risk</div>
          <div className="text-xl font-bold text-amber-600">{mitigationPlans.filter(p => p.status === "At Risk").length}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Clock className="w-3.5 h-3.5" />Delayed</div>
          <div className="text-xl font-bold text-destructive">{mitigationPlans.filter(p => p.status === "Delayed").length}</div>
        </CardContent></Card>
      </div>

      <Card className="border-border">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Mitigation Plans</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {mitigationPlans.map((p, i) => (
            <div key={i} className="flex items-center gap-4 p-3 rounded-lg border border-border">
              <div className="flex-1">
                <div className="text-xs font-medium">{p.risk}</div>
                <div className="text-[10px] text-muted-foreground">{p.plan}</div>
              </div>
              <div className="w-24"><Progress value={p.progress} className="h-1.5" /><div className="text-[10px] text-muted-foreground mt-0.5">{p.progress}%</div></div>
              <div className="text-xs text-muted-foreground">SLA: {p.sla}</div>
              <Badge className={`text-[10px] ${p.status === "On Track" ? "bg-success/15 text-success border-success/20" : p.status === "At Risk" ? "bg-amber-500/15 text-amber-700 border-amber-500/20" : "bg-destructive/15 text-destructive border-destructive/20"}`} variant="outline">{p.status}</Badge>
              <div className="text-[10px] text-muted-foreground">{maskAmount(perms, p.owner)}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </PageShell>
  );
}
