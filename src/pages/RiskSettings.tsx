import { PageShell } from "@/components/PageShell";
import { RiskRolesPanel } from "@/components/RiskRolesPanel";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const impactMatrix = [
  { impact: "Critical", financial: "> 100M XOF", operational: "Business stoppage", compliance: "Regulatory sanction" },
  { impact: "High", financial: "50-100M XOF", operational: "Major disruption", compliance: "Audit finding" },
  { impact: "Medium", financial: "10-50M XOF", operational: "Moderate impact", compliance: "Process gap" },
  { impact: "Low", financial: "< 10M XOF", operational: "Minor impact", compliance: "Documentation gap" },
];

const categories = ["Financial", "Operational", "Compliance", "Strategic", "Reputational"];

const notifications = [
  { trigger: "Risk score > 80", channel: "Email + SMS", recipients: "CFO, CRO" },
  { trigger: "New critical incident", channel: "Immediate alert", recipients: "Board, CFO" },
  { trigger: "Mitigation SLA breach", channel: "Email", recipients: "Risk Owner, CRO" },
  { trigger: "Weekly risk summary", channel: "Email", recipients: "All executives" },
];

export default function RiskSettings() {
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Risk Management", href: "/risk" }, { label: "Settings" }]} />
      <GuidanceBanner title="Risk Settings" description="Impact/probability matrices, thresholds, categories, and notification rules." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Risk Settings</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Impact Matrix</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {impactMatrix.map(m => (
              <div key={m.impact} className="p-3 border border-border rounded text-xs">
                <Badge variant={m.impact === "Critical" ? "destructive" : m.impact === "High" ? "secondary" : "outline"} className="text-[10px] mb-2">{m.impact}</Badge>
                <div className="grid grid-cols-3 gap-2 text-muted-foreground">
                  <div><span className="text-[10px]">Financial:</span> <span className="text-foreground">{m.financial}</span></div>
                  <div><span className="text-[10px]">Operational:</span> <span className="text-foreground">{m.operational}</span></div>
                  <div><span className="text-[10px]">Compliance:</span> <span className="text-foreground">{m.compliance}</span></div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Risk Categories</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="flex flex-wrap gap-2">
                {categories.map(c => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Notification Rules</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              {notifications.map((n, i) => (
                <div key={i} className="flex items-center gap-3 p-2 border border-border rounded text-xs">
                  <div className="flex-1"><div className="font-medium">{n.trigger}</div><div className="text-muted-foreground">{n.channel}</div></div>
                  <span className="text-muted-foreground">{n.recipients}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <section className="mt-6 space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Rôles & RBAC</h2>
        <RiskRolesPanel />
      </section>
    </PageShell>
  );
}
