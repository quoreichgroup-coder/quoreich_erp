import { useState, useEffect } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, CreditCard, FileText, Bell, Globe, Percent, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { GLPostingConfigPanel, defaultGLPostingSettings } from "@/components/GLPostingConfig";
import {
  useAPGeneralSettings,
  useUpdateAPGeneralSettings,
  useAPNumberingSeries,
  useUpdateAPNumberingSeries,
  useAPPaymentMethods,
  useUpsertAPPaymentMethod,
  useAPWithholdingRates,
  useUpsertAPWithholdingRate,
  useAPNotificationRules,
} from "@/hooks/use-ap-data";

const tabs = [
  { id: "general", label: "Général", icon: Settings },
  { id: "glposting", label: "Imputation GL", icon: BookOpen },
  { id: "payment", label: "Modes de paiement", icon: CreditCard },
  { id: "numbering", label: "Numérotation", icon: FileText },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "withholding", label: "Retenue à la source", icon: Percent },
  { id: "currency", label: "Devises", icon: Globe },
];

export default function APSettings() {
  const [activeTab, setActiveTab] = useState("general");

  const { data: general } = useAPGeneralSettings();
  const updateGeneral = useUpdateAPGeneralSettings();
  const [form, setForm] = useState<any>({});
  useEffect(() => { if (general) setForm(general); }, [general]);

  const { data: methods = [] } = useAPPaymentMethods();
  const upsertMethod = useUpsertAPPaymentMethod();

  const { data: numbering = [] } = useAPNumberingSeries();
  const updateSeries = useUpdateAPNumberingSeries();

  const { data: withholding = [] } = useAPWithholdingRates();
  const upsertWithholding = useUpsertAPWithholdingRate();

  const { data: notifications = [] } = useAPNotificationRules();

  return (
    <PageShell>
      <Breadcrumb items={[
        { label: "Finance" },
        { label: "Comptes Fournisseurs", href: "/payables" },
        { label: "Paramètres" },
      ]} />

      <GuidanceBanner
        title="Paramètres du module AP"
        description="Configurez les modes de paiement, la numérotation, les retenues à la source et les notifications. Toutes les valeurs sont persistées en base."
      />

      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && (
        <div className="bg-card border border-border rounded-lg p-5 space-y-5 max-w-2xl">
          <h3 className="text-sm font-semibold text-foreground">Paramètres généraux</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label className="text-xs">Mode de paiement par défaut</Label>
              <select value={form.default_payment_method || ""} onChange={(e) => setForm({ ...form, default_payment_method: e.target.value })}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs">
                {methods.map((m: any) => <option key={m.code} value={m.code}>{m.label}</option>)}
              </select></div>
            <div className="space-y-1.5"><Label className="text-xs">Devise par défaut</Label>
              <select value={form.default_currency || "XOF"} onChange={(e) => setForm({ ...form, default_currency: e.target.value })}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs">
                <option>XOF</option><option>EUR</option><option>USD</option>
              </select></div>
            <div className="space-y-1.5"><Label className="text-xs" htmlFor="ap-po-required">Bon de commande requis</Label>
              <select id="ap-po-required" value={form.po_required || "mandatory"} onChange={(e) => setForm({ ...form, po_required: e.target.value })}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs">
                <option value="mandatory">Oui — Obligatoire</option>
                <option value="optional">Optionnel</option>
                <option value="none">Non</option>
              </select></div>
            <div className="space-y-1.5"><Label className="text-xs" htmlFor="ap-three-way">Rapprochement à 3 voies</Label>
              <select id="ap-three-way" value={form.three_way_match ? "true" : "false"} onChange={(e) => setForm({ ...form, three_way_match: e.target.value === "true" })}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs">
                <option value="true">Activé</option><option value="false">Désactivé</option>
              </select></div>
            <div className="space-y-1.5"><Label className="text-xs">Escompte paiement anticipé (%)</Label>
              <Input type="number" step="0.1" value={form.early_payment_discount_pct ?? ""} onChange={(e) => setForm({ ...form, early_payment_discount_pct: Number(e.target.value) })} className="h-9 text-xs" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Fenêtre escompte (jours)</Label>
              <Input type="number" value={form.discount_window_days ?? ""} onChange={(e) => setForm({ ...form, discount_window_days: Number(e.target.value) })} className="h-9 text-xs" /></div>
          </div>
          <Button size="sm" className="text-xs" onClick={() => updateGeneral.mutate(form)} disabled={updateGeneral.isPending}>Enregistrer</Button>
        </div>
      )}

      {activeTab === "glposting" && (
        <div className="max-w-3xl">
          <GLPostingConfigPanel config={defaultGLPostingSettings.AP} />
        </div>
      )}

      {activeTab === "payment" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">Modes de paiement</h3>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Code", "Libellé", "Défaut", "Actif", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {methods.map((p: any) => (
                <tr key={p.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono">{p.code}</td>
                  <td className="px-3 py-2 font-medium">{p.label}</td>
                  <td className="px-3 py-2">{p.is_default ? "✓" : "—"}</td>
                  <td className="px-3 py-2">{p.is_active ? <span className="text-success">●</span> : <span className="text-muted-foreground">●</span>}</td>
                  <td className="px-3 py-2">
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                      onClick={() => upsertMethod.mutate({ ...p, is_active: !p.is_active })}>
                      {p.is_active ? "Désactiver" : "Activer"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "numbering" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Numérotation des documents</h3></div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Type", "Préfixe", "Format", "Prochain N°", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {numbering.map((n: any) => (
                <tr key={n.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{n.doc_type}</td>
                  <td className="px-3 py-2 font-mono">{n.prefix}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{n.format}</td>
                  <td className="px-3 py-2">
                    <Input className="h-7 text-xs w-24 font-mono" type="number" defaultValue={n.next_number}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== n.next_number) updateSeries.mutate({ id: n.id, next_number: v });
                      }} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-[10px]">Reset {n.reset_frequency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="bg-card border border-border rounded-lg p-5 space-y-3 max-w-2xl">
          <h3 className="text-sm font-semibold text-foreground">Règles de notification</h3>
          {notifications.map((n: any) => (
            <div key={n.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div>
                <div className="text-xs font-medium text-foreground">{n.event}</div>
                <div className="text-[10px] text-muted-foreground">{n.channel} → {n.recipients}</div>
              </div>
              <span className={cn("text-[10px] px-2 py-0.5 rounded", n.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
                {n.is_active ? "Actif" : "Inactif"}
              </span>
            </div>
          ))}
          {notifications.length === 0 && <p className="text-xs text-muted-foreground">Aucune règle</p>}
        </div>
      )}

      {activeTab === "withholding" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">Taux de retenue à la source</h3>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Catégorie", "Taux (%)", "Compte GL", "Actif", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {withholding.map((w: any) => (
                <tr key={w.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{w.category}</td>
                  <td className="px-3 py-2">{w.rate_pct}%</td>
                  <td className="px-3 py-2 font-mono">{w.gl_account}</td>
                  <td className="px-3 py-2">{w.is_active ? <span className="text-success">●</span> : <span className="text-muted-foreground">●</span>}</td>
                  <td className="px-3 py-2">
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                      onClick={() => upsertWithholding.mutate({ ...w, is_active: !w.is_active })}>
                      {w.is_active ? "Désactiver" : "Activer"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "currency" && (
        <div className="bg-card border border-border rounded-lg p-5 space-y-4 max-w-2xl">
          <h3 className="text-sm font-semibold text-foreground">Devises</h3>
          <p className="text-xs text-muted-foreground">La devise de base ({form.default_currency || "XOF"}) est définie dans l'onglet Général. Les taux de conversion sont gérés au niveau Trésorerie.</p>
        </div>
      )}
    </PageShell>
  );
}
