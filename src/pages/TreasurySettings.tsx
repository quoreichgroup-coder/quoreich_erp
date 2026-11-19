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
import { useTreasuryRequireAccount, useTreasurySettingsRow } from "@/hooks/use-treasury-accounts";
import { TreasuryRolesPanel } from "@/components/TreasuryRolesPanel";

const tabs = [
  { id: "general", label: "Général", icon: Settings },
  { id: "glposting", label: "Comptabilisation", icon: BookOpen },
  { id: "reconciliation", label: "Rapprochement et alertes", icon: Bell },
  { id: "roles", label: "Rôles", icon: Users },
];

export default function TreasurySettings() {
  const [activeTab, setActiveTab] = useState("general");

  return (
    <PageShell>
      <Breadcrumb items={[
        { label: "Finance" },
        { label: "Trésorerie", href: "/treasury" },
        { label: "Paramètres" },
      ]} />

      <GuidanceBanner title="Paramètres de trésorerie" description="Règlements, comptabilisation, rapprochement bancaire et alertes. Les limites (solde minimum, maximum, découvert) se fixent par compte dans Trésorerie → Données de base." />

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

      {activeTab === "reconciliation" && <TreasuryReconciliationSettings />}

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

/* Rapprochement bancaire et alertes (V70, V71) : réglages enregistrés dans treasury_settings, appliqués par la base. */
function TreasuryReconciliationSettings() {
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("treasury.settings");
  const { query, save } = useTreasurySettingsRow();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const row = query.data ?? {};
  const val = (k: string) => draft[k] ?? (row[k] == null ? "" : String(row[k]));
  const fields: { key: string; label: string; help: string }[] = [
    { key: "match_amount_tolerance", label: "Tolérance de montant au rapprochement (XOF)", help: "Écart accepté entre une ligne de relevé et un mouvement" },
    { key: "match_date_window_days", label: "Fenêtre de dates au rapprochement (jours)", help: "Écart de dates accepté" },
    { key: "unreconciled_alert_days", label: "Alerte sur mouvement non rapproché après (jours)", help: "Vide = pas d'alerte" },
    { key: "low_cash_threshold", label: "Seuil global de trésorerie basse (XOF)", help: "Vide = pas de seuil global ; les seuils par compte restent dans les données de base" },
  ];
  return (
    <section aria-label="Rapprochement et alertes" className="bg-card border border-border rounded-lg p-5 space-y-4 max-w-2xl">
      <h3 className="text-sm font-semibold text-foreground">Rapprochement et alertes</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`tre-${f.key}`} className="text-xs">{f.label}</Label>
            <Input id={`tre-${f.key}`} type="number" className="h-9 text-xs" disabled={!canEdit} value={val(f.key)}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
            <p className="text-[10px] text-muted-foreground">{f.help}</p>
          </div>
        ))}
      </div>
      <label className="flex items-start gap-3 text-xs">
        <Switch aria-label="Contrôle de continuité des relevés" disabled={!canEdit} checked={draft.statement_continuity_check != null ? draft.statement_continuity_check === "true" : row.statement_continuity_check !== false}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, statement_continuity_check: String(v) }))} />
        <span>Contrôle de continuité des relevés<span className="block text-muted-foreground">Le solde d'ouverture d'un relevé doit égaler la clôture du précédent.</span></span>
      </label>
      <Button size="sm" className="text-xs" disabled={!canEdit || save.isPending || Object.keys(draft).length === 0}
        onClick={() => save.mutate(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, k === "statement_continuity_check" ? v === "true" : v === "" ? null : Number(v)])), { onSuccess: () => setDraft({}) })}>
        Enregistrer
      </Button>
      {!canEdit && <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Modifier les paramètres de trésorerie » est requis.</p>}
    </section>
  );
}
