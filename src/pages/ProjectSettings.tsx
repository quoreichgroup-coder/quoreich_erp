import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, BookOpen, Calculator, Link, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { GLPostingConfigPanel, defaultGLPostingSettings } from "@/components/GLPostingConfig";
import { ProjectRolesPanel } from "@/components/ProjectRolesPanel";

const tabs = [
  { id: "general", label: "General", icon: Settings },
  { id: "glposting", label: "GL Posting", icon: BookOpen },
  { id: "costs", label: "Cost Categories", icon: Calculator },
  { id: "glrules", label: "GL Rules", icon: Link },
  { id: "roles", label: "Rôles & RBAC", icon: Shield },
];

const costCategories = [
  { category: "Labor", glAccount: "6100-PRJ", rate: "Hourly", defaultRate: "85 XOF K/h" },
  { category: "Materials", glAccount: "6200-PRJ", rate: "Per Unit", defaultRate: "—" },
  { category: "Overhead", glAccount: "6300-PRJ", rate: "% of Labor", defaultRate: "18%" },
  { category: "Subcontracting", glAccount: "6400-PRJ", rate: "Fixed", defaultRate: "—" },
];

const glPostingRules = [
  { event: "Cost Recognition", debit: "6xxx-PRJ (by category)", credit: "2100-AP / 5100-BANK" },
  { event: "Revenue Recognition", debit: "1200-AR", credit: "4100-PRJ" },
  { event: "WIP Adjustment", debit: "1500-WIP", credit: "4200-WIP-REV" },
  { event: "Project Closure", debit: "4100-PRJ", credit: "3100-RETAINED" },
];

export default function ProjectSettings() {
  const [activeTab, setActiveTab] = useState("general");

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Projects", href: "/projects" }, { label: "Settings" }]} />
      <GuidanceBanner title="Project Settings" description="Cost categories, hourly rates, GL posting rules, and project configuration." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Project Settings</h1>

      <div className="flex gap-1 border-b border-border mb-4">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-4xl">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Cost Categories</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              {costCategories.map(c => (
                <div key={c.category} className="flex items-center gap-3 p-3 border border-border rounded text-xs">
                  <div className="flex-1">
                    <div className="font-medium">{c.category}</div>
                    <div className="text-muted-foreground">GL: <span className="font-mono">{c.glAccount}</span> · Rate: {c.rate}</div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{c.defaultRate}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">GL Posting Rules</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              {glPostingRules.map((r, i) => (
                <div key={i} className="p-3 border border-border rounded text-xs">
                  <div className="font-medium mb-1">{r.event}</div>
                  <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                    <span>Debit: <span className="font-mono text-foreground">{r.debit}</span></span>
                    <span>Credit: <span className="font-mono text-foreground">{r.credit}</span></span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "glposting" && (
        <div className="max-w-3xl">
          <GLPostingConfigPanel config={defaultGLPostingSettings.Projects} />
        </div>
      )}

      {activeTab === "costs" && (
        <Card className="border-border max-w-2xl">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Cost Categories</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {costCategories.map(c => (
              <div key={c.category} className="flex items-center gap-3 p-3 border border-border rounded text-xs">
                <div className="flex-1">
                  <div className="font-medium">{c.category}</div>
                  <div className="text-muted-foreground">GL: <span className="font-mono">{c.glAccount}</span> · Rate: {c.rate}</div>
                </div>
                <Badge variant="outline" className="text-[10px]">{c.defaultRate}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeTab === "glrules" && (
        <Card className="border-border max-w-2xl">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">GL Posting Rules</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {glPostingRules.map((r, i) => (
              <div key={i} className="p-3 border border-border rounded text-xs">
                <div className="font-medium mb-1">{r.event}</div>
                <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                  <span>Debit: <span className="font-mono text-foreground">{r.debit}</span></span>
                  <span>Credit: <span className="font-mono text-foreground">{r.credit}</span></span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeTab === "roles" && (
        <div className="max-w-6xl">
          <ProjectRolesPanel />
        </div>
      )}
    </PageShell>
  );
}
