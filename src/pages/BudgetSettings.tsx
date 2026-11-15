import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, BookOpen, Calendar, AlertTriangle, Users, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { GLPostingConfigPanel, defaultGLPostingSettings } from "@/components/GLPostingConfig";
import { BudgetRolesPanel } from "@/components/BudgetRolesPanel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useMyAccess } from "@/hooks/use-my-access";
import { useBudgetControlSettings, useSaveBudgetControlSettings } from "@/hooks/use-budget-control";

const tabs = [
  { id: "general", label: "Contrôle budgétaire", icon: Settings },
  { id: "glposting", label: "GL Posting", icon: BookOpen },
  { id: "periods", label: "Fiscal Periods", icon: Calendar },
  { id: "alerts", label: "Alert Thresholds", icon: AlertTriangle },
  { id: "approval", label: "Approval Rules", icon: Users },
  { id: "roles", label: "Rôles & RBAC", icon: ShieldCheck },
];

const fiscalPeriods = [
  { period: "2025-H1", start: "2025-01-01", end: "2025-06-30", status: "Active" },
  { period: "2025-H2", start: "2025-07-01", end: "2025-12-31", status: "Planned" },
  { period: "2025-FY", start: "2025-01-01", end: "2025-12-31", status: "Active" },
];

const alertThresholds = [
  { rule: "Budget utilization > 90%", action: "Warning alert", level: "Warning" },
  { rule: "Budget utilization > 100%", action: "Block new commitments", level: "Critical" },
  { rule: "Forecast deviation > 10%", action: "Notify CFO", level: "Warning" },
  { rule: "Cash flow net < 0", action: "Emergency alert to Treasury", level: "Critical" },
];

const approvalRules = [
  { type: "Budget Revision", threshold: "< 5% of envelope", approver: "Department Head" },
  { type: "Budget Revision", threshold: "5-15% of envelope", approver: "CFO" },
  { type: "Budget Revision", threshold: "> 15% of envelope", approver: "Board" },
  { type: "Emergency Budget", threshold: "Any amount", approver: "CFO + CEO" },
];

export default function BudgetSettings() {
  const [activeTab, setActiveTab] = useState("general");

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Budget & Forecast", href: "/budget" }, { label: "Settings" }]} />
      <GuidanceBanner title="Budget Settings" description="Fiscal periods, currencies, alert thresholds, and approval rules configuration." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Budget Settings</h1>

      <div className="flex gap-1 border-b border-border mb-4">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && <BudgetControlSettingsCard />}

      {activeTab === "glposting" && (
        <div className="max-w-3xl">
          <GLPostingConfigPanel config={defaultGLPostingSettings.Budget} />
        </div>
      )}

      {activeTab === "periods" && (
        <Card className="border-border max-w-2xl">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Fiscal Periods</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {fiscalPeriods.map(p => (
              <div key={p.period} className="flex items-center justify-between p-3 border border-border rounded text-xs">
                <div><div className="font-medium">{p.period}</div><div className="text-muted-foreground">{p.start} → {p.end}</div></div>
                <Badge variant={p.status === "Active" ? "default" : "outline"} className="text-[10px]">{p.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeTab === "alerts" && (
        <Card className="border-border max-w-2xl">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Alert Thresholds</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {alertThresholds.map((t, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border border-border rounded text-xs">
                <Badge variant={t.level === "Critical" ? "destructive" : "secondary"} className="text-[10px]">{t.level}</Badge>
                <div className="flex-1"><div className="font-medium">{t.rule}</div><div className="text-muted-foreground">{t.action}</div></div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeTab === "approval" && (
        <Card className="border-border max-w-2xl">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Approval Rules</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {approvalRules.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border border-border rounded text-xs">
                <Badge variant="outline" className="text-[10px]">{r.type}</Badge>
                <div className="flex-1 text-muted-foreground">{r.threshold}</div>
                <div className="font-medium">{r.approver}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeTab === "roles" && (
        <div className="max-w-6xl">
          <BudgetRolesPanel />
        </div>
      )}
    </PageShell>
  );
}

/* Contrôle budgétaire (V73) : mode (désactivé / avertissement / blocage) et niveau (année / mois). */
function BudgetControlSettingsCard() {
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("budget.settings");
  const { data } = useBudgetControlSettings();
  const save = useSaveBudgetControlSettings();
  const [f, setF] = useState<{ control_mode: string; control_level: string } | null>(null);
  const v = f ?? data ?? { control_mode: "off", control_level: "year" };
  return (
    <Card className="border-border max-w-2xl">
      <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Contrôle budgétaire</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0 space-y-3 text-xs">
        <p className="text-muted-foreground">Contrôle à la soumission et à l'approbation des commandes, et à la soumission des factures fournisseurs sans commande, contre le budget de contrôle approuvé de l'exercice : disponible = budget − engagé − réalisé.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="bc-mode">Mode</Label>
            <select id="bc-mode" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={v.control_mode} disabled={!canEdit} onChange={(e) => setF({ ...v, control_mode: e.target.value })}>
              <option value="off">Désactivé</option><option value="warn">Avertir (la pièce passe, le dépassement est signalé)</option><option value="block">Bloquer (dépassement autorisé par un habilité)</option>
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="bc-level">Niveau</Label>
            <select id="bc-level" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={v.control_level} disabled={!canEdit} onChange={(e) => setF({ ...v, control_level: e.target.value })}>
              <option value="year">Annuel (budget de l'exercice)</option><option value="month">Mensuel (lignes du mois)</option>
            </select></div>
        </div>
        {canEdit ? <Button size="sm" className="h-8 text-xs" disabled={!f || save.isPending} onClick={() => save.mutate(v, { onSuccess: () => setF(null) })}>Enregistrer</Button>
          : <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Modifier les paramètres du contrôle budgétaire » est requis.</p>}
      </CardContent>
    </Card>
  );
}
