import { useState } from "react";
import { ModulePostingSettings } from "@/components/AccountSets";
import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, Coins, Settings2, ShieldCheck, UsersRound } from "lucide-react";
import { PayrollSettingsCard } from "@/components/PayrollSettingsCard";
import { PayrollRuleVersionsPanel } from "@/components/PayrollRuleVersionsPanel";
import { HrMovementSettingsCard } from "@/components/HrMovementSettingsCard";
import { HrPayrollComponentsCard } from "@/components/HrPayrollComponentsCard";
import { HrEmployeeNumberSettingsCard } from "@/components/HrEmployeeNumberSettingsCard";
import { useMyHrRoles } from "@/hooks/use-hr-data";
import { useMyAccess } from "@/hooks/use-my-access";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";

export default function HrSettings() {
  const perms = useMyHrRoles();
  const { data: access } = useMyAccess();
  const [activeTab, setActiveTab] = useState("payroll");
  const tabs = [
    { id: "payroll", label: "Règles de paie", icon: Settings2 },
    { id: "components", label: "Rubriques", icon: Coins },
    { id: "posting", label: "Comptabilisation", icon: Coins },
    { id: "numbering", label: "Matricules", icon: BadgeCheck },
    { id: "movements", label: "Référentiels et mouvements", icon: UsersRound },
    { id: "rights", label: "Droits et rôles", icon: ShieldCheck },
  ];
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "RH / Paie" }, { label: "Paramètres" }]} />
      <GuidanceBanner
        title="Paramètres RH / Paie"
        description="Configurez ici les règles de paie de la société. Les rôles, autorisations et attributions sont centralisés dans les Paramètres d’administration."
      />

      <div className="flex gap-1 border-b border-border overflow-x-auto" role="tablist" aria-label="Paramètres RH / Paie">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <tab.icon className="h-3.5 w-3.5" />{tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="mt-4 space-y-4">
        {activeTab === "payroll" && <><PayrollRuleVersionsPanel /><PayrollSettingsCard /></>}
        {activeTab === "components" && <HrPayrollComponentsCard />}
        {activeTab === "posting" && <ModulePostingSettings modules={["PAY"]} extra={
          <p className="text-xs text-muted-foreground">Un compte propre à une rubrique (prime, retenue…) se règle sur la rubrique, onglet « Rubriques » ; sinon le rôle ci-dessus s'applique.</p>} />}
        {activeTab === "numbering" && <HrEmployeeNumberSettingsCard canManage={(access?.permissions ?? []).includes("hr.manage_employee_number_settings")} />}
        {activeTab === "movements" && <HrMovementSettingsCard canManage={!!perms.canManageMovementSettings} />}
        {activeTab === "rights" && <section className="rounded-lg border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <h2 className="text-sm font-medium">Rôles et droits RH</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Gérez les rôles système ou sur mesure, les droits du catalogue et les utilisateurs dans l’administration centrale.
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
            <Link to="/settings?tab=roles">Ouvrir les rôles et autorisations <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Button>
        </section>}
      </div>
    </PageShell>
  );
}
