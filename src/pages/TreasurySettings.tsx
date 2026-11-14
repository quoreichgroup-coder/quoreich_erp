import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Building2, Bell, Globe, ShieldCheck, BookOpen, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { PostingAccountsPanel } from "@/components/PostingAccountsPanel";
import { Switch } from "@/components/ui/switch";
import { useMyAccess } from "@/hooks/use-my-access";
import { useTreasuryRequireAccount } from "@/hooks/use-treasury-accounts";
import { TreasuryRolesPanel } from "@/components/TreasuryRolesPanel";

const tabs = [
  { id: "general", label: "Général", icon: Settings },
  { id: "glposting", label: "Comptabilisation", icon: BookOpen },
  { id: "banks", label: "Bank Integration", icon: Building2 },
  { id: "alerts", label: "Alerts & Thresholds", icon: Bell },
  { id: "fx", label: "FX Policy", icon: Globe },
  { id: "controls", label: "Controls", icon: ShieldCheck },
  { id: "roles", label: "Rôles RBAC", icon: Users },
];

export default function TreasurySettings() {
  const [activeTab, setActiveTab] = useState("general");

  return (
    <PageShell>
      <Breadcrumb items={[
        { label: "Finance" },
        { label: "Treasury", href: "/treasury" },
        { label: "Settings" },
      ]} />

      <GuidanceBanner title="Treasury Settings" description="Configure bank integrations, alert thresholds, FX policies and control parameters." />

      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && <TreasuryGeneralSettings />}

      {activeTab === "glposting" && (
        <div className="max-w-3xl space-y-2">
          <p className="text-xs text-muted-foreground">Comptes utilisés quand un règlement ne cite aucun compte de trésorerie (sinon : le compte comptable du compte de trésorerie, Données de base).</p>
          <PostingAccountsPanel modules={["TRE"]} />
        </div>
      )}

      {activeTab === "banks" && (
        <div className="bg-card border border-border rounded-lg p-5 space-y-4 max-w-2xl">
          <h3 className="text-sm font-semibold text-foreground">Bank Integration</h3>
          {[
            { bank: "SGBS", protocol: "SWIFT MT940", status: "Connected", lastSync: "2025-02-15 14:00" },
            { bank: "BOA", protocol: "SWIFT MT940", status: "Connected", lastSync: "2025-02-15 13:00" },
          ].map(b => (
            <div key={b.bank} className="flex items-center justify-between py-3 border-b border-border last:border-0">
              <div>
                <div className="text-xs font-medium text-foreground">{b.bank}</div>
                <div className="text-[10px] text-muted-foreground">{b.protocol} · Last sync: {b.lastSync}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-success font-medium">{b.status}</span>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]">Configure</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "alerts" && (
        <div className="bg-card border border-border rounded-lg p-5 space-y-4 max-w-2xl">
          <h3 className="text-sm font-semibold text-foreground">Alert Thresholds</h3>
          {[
            { alert: "Low Balance Warning", threshold: "< 10M XOF", channel: "Email + In-app" },
            { alert: "Large Transaction", threshold: "> 50M XOF", channel: "In-app" },
            { alert: "FX Exposure Limit", threshold: "> 80% utilization", channel: "Email" },
            { alert: "Unreconciled > 48h", threshold: "48 hours", channel: "Email" },
          ].map((a, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div>
                <div className="text-xs font-medium text-foreground">{a.alert}</div>
                <div className="text-[10px] text-muted-foreground">Threshold: {a.threshold} · {a.channel}</div>
              </div>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]">Edit</Button>
            </div>
          ))}
        </div>
      )}

      {activeTab === "fx" && (
        <div className="bg-card border border-border rounded-lg p-5 space-y-5 max-w-2xl">
          <h3 className="text-sm font-semibold text-foreground">FX Policy</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label className="text-xs">Hedging Policy</Label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs">
                <option>Conservative (80%)</option><option>Moderate (50%)</option><option>None</option>
              </select></div>
            <div className="space-y-1.5"><Label className="text-xs">Max Single FX Transaction (EUR)</Label>
              <Input defaultValue="100000" className="h-9 text-xs" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Rate Source</Label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs">
                <option>BCEAO Official</option><option>Market Mid</option>
              </select></div>
            <div className="space-y-1.5"><Label className="text-xs">Auto-revaluation</Label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs">
                <option>Monthly</option><option>Daily</option><option>Disabled</option>
              </select></div>
          </div>
          <Button size="sm" className="text-xs">Save Changes</Button>
        </div>
      )}

      {activeTab === "controls" && (
        <div className="bg-card border border-border rounded-lg p-5 space-y-4 max-w-2xl">
          <h3 className="text-sm font-semibold text-foreground">Treasury Controls</h3>
          {[
            { control: "Dual Authorization for Payments > 20M XOF", status: "Enabled" },
            { control: "4-Eye Principle for FX Operations", status: "Enabled" },
            { control: "Automated Reconciliation Matching", status: "Enabled" },
            { control: "Daily Position Reporting", status: "Enabled" },
          ].map((c, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="text-xs font-medium text-foreground">{c.control}</div>
              <span className="text-[10px] text-success font-medium">{c.status}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === "roles" && <TreasuryRolesPanel />}
    </PageShell>
  );
}

/* Paramètres de trésorerie réels (V70) : compte de trésorerie obligatoire sur les règlements. */
function TreasuryGeneralSettings() {
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("treasury.settings");
  const { query, save } = useTreasuryRequireAccount();
  return (
    <section aria-label="Règlements et trésorerie" className="bg-card border border-border rounded-lg p-5 space-y-3 max-w-2xl">
      <h3 className="text-sm font-semibold text-foreground">Règlements et trésorerie</h3>
      <label className="flex items-start gap-3 text-xs">
        <Switch aria-label="Compte de trésorerie obligatoire" checked={!!query.data} disabled={!canEdit || save.isPending || query.isLoading} onCheckedChange={(v) => save.mutate(v)} />
        <span>Compte de trésorerie obligatoire sur les règlements, acomptes et remboursements
          <span className="block text-muted-foreground">Désactivé : sans compte choisi ni compte par défaut du type, l'écriture passe sur le rôle Banque, Caisse ou Monnaie électronique du paramétrage comptable, sans mouvement de trésorerie.</span></span>
      </label>
      {!canEdit && <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Modifier les paramètres de trésorerie » est requis.</p>}
    </section>
  );
}
