import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComplianceRolesPanel } from "@/components/ComplianceRolesPanel";

const frameworks = [
  { name: "SOX (Sarbanes-Oxley)", status: "Active", controls: 4, lastUpdate: "2025-02-25" },
  { name: "IFRS 15 — Revenue Recognition", status: "Active", controls: 1, lastUpdate: "2025-02-10" },
  { name: "IFRS 16 — Leases", status: "Pending Setup", controls: 1, lastUpdate: "—" },
];

const testFrequencies = [
  { frequency: "Continuous", description: "Real-time monitoring", controls: 2 },
  { frequency: "Monthly", description: "Tested every month", controls: 2 },
  { frequency: "Quarterly", description: "Tested every quarter", controls: 1 },
  { frequency: "Semi-Annual", description: "Tested twice per year", controls: 1 },
];

const notifications = [
  { trigger: "Control test failed", channel: "Email", recipients: "Control Owner, Compliance Lead" },
  { trigger: "Finding overdue", channel: "Email + Escalation", recipients: "Assignee, CFO" },
  { trigger: "SoD conflict detected", channel: "Immediate alert", recipients: "IT Security, Compliance" },
  { trigger: "Quarterly compliance summary", channel: "Email", recipients: "Board, CFO" },
];

export default function ComplianceSettings() {
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Compliance", href: "/compliance" }, { label: "Settings" }]} />
      <GuidanceBanner title="Compliance Settings" description="Active frameworks, test frequencies, thresholds, and notification configuration." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Compliance Settings</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Active Frameworks</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {frameworks.map(f => (
              <div key={f.name} className="flex items-center gap-3 p-3 border border-border rounded text-xs">
                <div className="flex-1">
                  <div className="font-medium">{f.name}</div>
                  <div className="text-muted-foreground">{f.controls} controls · Updated: {f.lastUpdate}</div>
                </div>
                <Badge variant={f.status === "Active" ? "default" : "secondary"} className="text-[10px]">{f.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Test Frequencies</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {testFrequencies.map(t => (
              <div key={t.frequency} className="flex items-center justify-between p-3 border border-border rounded text-xs">
                <div><div className="font-medium">{t.frequency}</div><div className="text-muted-foreground">{t.description}</div></div>
                <Badge variant="outline" className="text-[10px]">{t.controls} controls</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border lg:col-span-2">
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

      <section className="mt-6 space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Rôles & RBAC</h2>
        <ComplianceRolesPanel />
      </section>
    </PageShell>
  );
}
