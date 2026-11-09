import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Settings, BookOpen, Calculator, Link, Wrench, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { GLPostingConfigPanel, defaultGLPostingSettings } from "@/components/GLPostingConfig";
import { FixedAssetsRolesPanel } from "@/components/FixedAssetsRolesPanel";

const tabs = [
  { id: "general", label: "General", icon: Settings },
  { id: "roles", label: "Rôles & Audit", icon: Shield },
  { id: "glposting", label: "GL Posting", icon: BookOpen },
  { id: "depreciation", label: "Depreciation", icon: Calculator },
  { id: "glmapping", label: "GL Mapping", icon: Link },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
];

const depreciationMethods = [
  { method: "Linear (Straight-Line)", formula: "(Cost - Residual) / Useful Life", default: true },
  { method: "Declining Balance", formula: "NBV × Rate%", default: false },
  { method: "Exceptional (Impairment)", formula: "Manual entry — requires L3 approval", default: false },
];

const glMapping = [
  { label: "IT Equipment", asset: "1600-IT", dep: "6810-IT", accDep: "1600-IT-AD" },
  { label: "Vehicles", asset: "1500-VEH", dep: "6815-VEH", accDep: "1500-VEH-AD" },
  { label: "Furniture", asset: "1400-FUR", dep: "6812-FUR", accDep: "1400-FUR-AD" },
  { label: "Building Equip.", asset: "1300-BLD", dep: "6811-BLD", accDep: "1300-BLD-AD" },
  { label: "Right-of-Use (Lease)", asset: "1700-ROU", dep: "6820-ROU", accDep: "1700-ROU-AD" },
];

const postingRules = [
  "Acquisition: Debit Asset, Credit Bank/Vendor",
  "Depreciation: Debit Expense, Credit Acc. Dep.",
  "Disposal: Debit Acc. Dep. + Bank, Credit Asset ± Gain/Loss",
  "Revaluation: Debit Asset, Credit Revaluation Reserve",
  "Finance Lease: Debit ROU Asset, Credit Lease Liability",
  "Exceptional Dep.: Debit Exceptional Expense, Credit Acc. Dep.",
];

const maintenanceCycles = [
  { cycle: "Monthly", assets: 2 }, { cycle: "Quarterly", assets: 1 },
  { cycle: "Semi-Annual", assets: 1 }, { cycle: "Annual", assets: 0 },
];

export default function AssetsSettings() {
  const [activeTab, setActiveTab] = useState("general");

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Fixed Assets", href: "/assets" }, { label: "Settings" }]} />
      <GuidanceBanner title="Fixed Assets Settings" description="Configure depreciation methods, GL account mapping, posting rules, and maintenance cycles." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Asset Settings</h1>

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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Depreciation Methods</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              {depreciationMethods.map(m => (
                <div key={m.method} className="flex items-center gap-3 p-3 rounded-lg border border-border text-xs">
                  <div className="flex-1">
                    <div className="font-medium text-foreground">{m.method}</div>
                    <div className="text-muted-foreground font-mono mt-0.5">{m.formula}</div>
                  </div>
                  {m.default && <Badge variant="default" className="text-[10px]">Default</Badge>}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Posting Rules</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 space-y-2 text-xs text-muted-foreground">
              {postingRules.map((r, i) => (
                <div key={i} className="flex items-start gap-2"><ArrowRight className="w-3 h-3 mt-0.5 text-primary shrink-0" />{r}</div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "roles" && <FixedAssetsRolesPanel />}

      {activeTab === "glposting" && (
        <div className="max-w-3xl">
          <GLPostingConfigPanel config={defaultGLPostingSettings.Assets} />
        </div>
      )}

      {activeTab === "depreciation" && (
        <Card className="border-border max-w-2xl">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Depreciation Methods</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {depreciationMethods.map(m => (
              <div key={m.method} className="flex items-center gap-3 p-3 rounded-lg border border-border text-xs">
                <div className="flex-1">
                  <div className="font-medium text-foreground">{m.method}</div>
                  <div className="text-muted-foreground font-mono mt-0.5">{m.formula}</div>
                </div>
                {m.default && <Badge variant="default" className="text-[10px]">Default</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeTab === "glmapping" && (
        <Card className="border-border max-w-2xl">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">GL Account Mapping</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {glMapping.map(m => (
              <div key={m.label} className="p-2.5 bg-muted/20 border border-border rounded space-y-1.5">
                <div className="text-xs font-medium">{m.label}</div>
                <div className="grid grid-cols-2 gap-1 text-[11px]">
                  <span className="text-muted-foreground">Asset</span><span className="font-mono">{m.asset}</span>
                  <span className="text-muted-foreground">Dep. Exp.</span><span className="font-mono">{m.dep}</span>
                  <span className="text-muted-foreground">Acc. Dep.</span><span className="font-mono">{m.accDep}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeTab === "maintenance" && (
        <Card className="border-border max-w-md">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Maintenance Cycles</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {maintenanceCycles.map(c => (
              <div key={c.cycle} className="flex items-center justify-between p-2 border border-border rounded text-xs">
                <span className="font-medium">{c.cycle}</span>
                <Badge variant="outline" className="text-[10px]">{c.assets} assets</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
