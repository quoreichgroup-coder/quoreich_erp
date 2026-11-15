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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useMyAccess } from "@/hooks/use-my-access";
import { useBudgetControlSettings, useSaveBudgetControlSettings, DEFAULT_BUDGET_SETTINGS, type BudgetControlSettings } from "@/hooks/use-budget-control";

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

/* Contrôle budgétaire (V73, V77) : mode, niveau, pré-engagement des demandes d'achat, contrôle par section, seuil d'alerte. */
function BudgetControlSettingsCard() {
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("budget.settings");
  const { data } = useBudgetControlSettings();
  const save = useSaveBudgetControlSettings();
  const [f, setF] = useState<BudgetControlSettings | null>(null);
  const v = f ?? data ?? DEFAULT_BUDGET_SETTINGS;
  const set = (patch: Partial<BudgetControlSettings>) => setF({ ...v, ...patch });
  const threshold = Number(v.alert_threshold_pct);
  const thresholdOk = threshold > 0 && threshold <= 100;
  const toggle = (id: string, label: string, hint: string, key: "precommit_requisitions" | "control_requisitions" | "analytic_control", disabled = false) => (
    <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-2">
      <div><Label className="text-xs" htmlFor={id}>{label}</Label><p className="text-[11px] text-muted-foreground">{hint}</p></div>
      <Switch id={id} checked={v[key]} disabled={!canEdit || disabled} onCheckedChange={(c) => set({ [key]: c } as Partial<BudgetControlSettings>)} />
    </div>
  );
  return (
    <Card className="border-border max-w-2xl" data-testid="budget-control-settings">
      <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Contrôle budgétaire</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0 space-y-3 text-xs">
        <p className="text-muted-foreground">Contrôle à la soumission des demandes d'achat, à la soumission et à l'approbation des commandes, et à la soumission des factures fournisseurs sans commande, contre le budget de contrôle approuvé de l'exercice : disponible = budget − pré-engagé (demandes) − engagé (commandes) − réalisé.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="bc-mode">Mode</Label>
            <select id="bc-mode" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={v.control_mode} disabled={!canEdit} onChange={(e) => set({ control_mode: e.target.value as BudgetControlSettings["control_mode"] })}>
              <option value="off">Désactivé</option><option value="warn">Avertir (la pièce passe, le dépassement est signalé)</option><option value="block">Bloquer (dépassement autorisé par un habilité)</option>
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="bc-level">Niveau</Label>
            <select id="bc-level" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={v.control_level} disabled={!canEdit} onChange={(e) => set({ control_level: e.target.value as BudgetControlSettings["control_level"] })}>
              <option value="year">Annuel (budget de l'exercice)</option><option value="month">Mensuel (lignes du mois)</option>
            </select></div>
        </div>
        {toggle("bc-precommit", "Pré-engager les demandes d'achat", "Une demande soumise ou approuvée, non encore convertie en commande, réserve le budget.", "precommit_requisitions")}
        {toggle("bc-control-pr", "Contrôler les demandes d'achat à la soumission", "Comme une commande : refus ou avertissement selon le mode.", "control_requisitions", !v.precommit_requisitions)}
        {toggle("bc-analytic", "Contrôler les budgets par section analytique", "Une ligne de budget sur une section contrôle les pièces de cette section et de ses sous-sections.", "analytic_control")}
        <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-2">
          <div><Label className="text-xs" htmlFor="bc-threshold">Seuil d'alerte (%)</Label>
            <p className="text-[11px] text-muted-foreground">Écran Contrôle : une ligne consommée (pré-engagé + engagé + réalisé) à ce pourcentage ou plus est signalée.</p></div>
          <Input id="bc-threshold" type="number" min={1} max={100} className="h-8 w-24 text-xs" value={String(v.alert_threshold_pct)} disabled={!canEdit}
            onChange={(e) => set({ alert_threshold_pct: e.target.value === "" ? 0 : Number(e.target.value) })} />
        </div>
        {canEdit ? <Button size="sm" className="h-8 text-xs" disabled={!f || !thresholdOk || save.isPending} onClick={() => save.mutate(v, { onSuccess: () => setF(null) })}>Enregistrer</Button>
          : <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Modifier les paramètres du contrôle budgétaire » est requis.</p>}
      </CardContent>
    </Card>
  );
}
