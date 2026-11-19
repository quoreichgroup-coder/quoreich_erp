import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Settings, BookOpen, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModulePostingSettings, PostingPendingNotice } from "@/components/AccountSets";
import { FixedAssetsRolesPanel } from "@/components/FixedAssetsRolesPanel";
import { AssetCategoriesPanel, AssetSettingsCard } from "@/components/AssetAccountingPanels";

const tabs = [
  { id: "general", label: "Catégories et amortissements", icon: Settings },
  { id: "roles", label: "Rôles et audit", icon: Shield },
  { id: "glposting", label: "Comptabilisation", icon: BookOpen },
];

/*
 * Paramètres des immobilisations (V75) : catégories avec leurs comptes, méthode (linéaire / dégressif) et
 * coefficients dégressifs, prorata du premier mois — tout est réel et modifiable dans le premier onglet.
 * Les onglets de démonstration (méthodes, correspondances, cycles de maintenance) ont disparu : la
 * maintenance n'est pas gérée aujourd'hui.
 */
export default function AssetsSettings() {
  const [activeTab, setActiveTab] = useState("general");

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Immobilisations", href: "/assets" }, { label: "Paramètres" }]} />
      <GuidanceBanner title="Paramètres des immobilisations" description="Catégories, comptes, méthodes d'amortissement et règles de comptabilisation." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Paramètres des immobilisations</h1>

      <div className="flex gap-1 border-b border-border mb-4">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && <div className="space-y-4"><AssetCategoriesPanel /><AssetSettingsCard /></div>}

      {activeTab === "roles" && <FixedAssetsRolesPanel />}

      {activeTab === "glposting" && <ModulePostingSettings modules={["FA"]} extra={
        <p className="text-xs text-muted-foreground">Comptes d'immobilisation, d'amortissement et de dotation : par catégorie, onglet « Catégories et amortissements » (comme la classe d'immobilisation SAP).</p>} />}

    </PageShell>
  );
}
