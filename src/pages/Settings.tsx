import { ExchangeRatesPanel } from "@/components/ExchangeRatesPanel";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { CompanyIdentityPanel } from "@/components/CompanyIdentityPanel";
import { Breadcrumb } from "@/components/Breadcrumb";
import { HelpIcon } from "@/components/HelpIcon";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CalendarDays, BookOpen, Receipt, CreditCard, GitBranch, Users, ShieldCheck,
  Plus, Pencil, Search, ChevronDown, ChevronRight, Trash2, Check, X,
  Clock, AlertTriangle, ArrowUp, Eye, FileText, Download, Play, UserMinus, RefreshCw,
  Zap, Shield, Hash, Bot, Landmark, Layers, Building2, Coins } from "lucide-react";
import { PostingAccountsPanel } from "@/components/PostingAccountsPanel";
import { ModulePostingSettings } from "@/components/AccountSets";
import { AnalyticAxesPanel } from "@/components/AnalyticAxesPanel";
import { TaxCodesPanel } from "@/components/TaxCodesPanel";
import { AuthorizationsPanel } from "@/components/AuthorizationsPanel";
import { AiSchedulesSettings } from "@/components/AiSchedulesSettings";
import { FiscalCalendarPanel } from "@/components/FiscalCalendarPanel";
import { ApprovalCircuitsHub, AuditJournalsHub, ChartOfAccountsHub } from "@/components/SettingsHubs";
import { PaymentTermsTab } from "@/pages/ARSettings";

import { cn } from "@/lib/utils";

// ── Tabs ────────────────────────────────────────────────────────────────────

const tabs = [
  { id: "company", label: "Société", icon: Building2 },
  { id: "fiscal", label: "Exercices et périodes", icon: CalendarDays },
  { id: "accounts", label: "Plan comptable", icon: BookOpen },
  { id: "posting", label: "Comptabilisation", icon: Landmark },
  { id: "analytics", label: "Analytique", icon: Layers },
  { id: "tax", label: "Codes TVA", icon: Receipt },
  { id: "currency", label: "Devises et cours", icon: Coins },
  { id: "payment", label: "Conditions de paiement", icon: CreditCard },
  { id: "workflow", label: "Circuits d'approbation", icon: GitBranch },
  { id: "roles", label: "Rôles et autorisations", icon: Users },
  { id: "audit", label: "Audit et journaux", icon: ShieldCheck },
  { id: "ai", label: "Planification IA", icon: Bot },
];

const Settings = () => {
  // L'onglet suit l'URL (?tab=…) : la barre latérale et les modules y renvoient directement.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState(tabs.some((t) => t.id === requested) ? requested! : "fiscal");
  useEffect(() => {
    if (requested && tabs.some((t) => t.id === requested)) setActiveTabState(requested);
  }, [requested]);
  const setActiveTab = (id: string) => {
    setActiveTabState(id);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("tab", id); return next; }, { replace: true });
  };


  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Paramètres" }]} />
      <GuidanceBanner message="Paramètres centraux de la société : identité, exercices et périodes, plan comptable, comptabilisation, analytique, codes TVA, conditions de paiement, circuits d'approbation, rôles et autorisations, journaux d'audit, planification des analyses IA. Chaque modification exige le droit correspondant." />

      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-foreground">Paramètres</h1>
        <HelpIcon text="La configuration est centralisée ici ; les paramètres propres à un module restent dans son menu « Paramètres »." />
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Left Navigation */}
        <div className="lg:w-52 shrink-0">
          <nav className="space-y-0.5">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors rounded-md ${
                  activeTab === tab.id ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted"
                }`}>
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          {/* ── Exercices et périodes (calendrier fiscal central, V33) ── */}
          {activeTab === "company" && <CompanyIdentityPanel />}
          {activeTab === "fiscal" && <div className="max-w-6xl"><FiscalCalendarPanel /></div>}
          {activeTab === "currency" && <div className="max-w-5xl"><ExchangeRatesPanel /></div>}

          {/* ── Chart of Accounts ── */}
          {activeTab === "posting" && <ModulePostingSettings kinds={["customer", "supplier", "item"]} lock />}

          {activeTab === "analytics" && <div className="max-w-5xl"><AnalyticAxesPanel /></div>}

          {activeTab === "accounts" && <ChartOfAccountsHub />}

          {activeTab === "tax" && <div className="max-w-4xl"><TaxCodesPanel /></div>}

          {activeTab === "payment" && <div className="max-w-4xl"><PaymentTermsTab /></div>}

          {activeTab === "workflow" && <ApprovalCircuitsHub />}

          {activeTab === "roles" && <AuthorizationsPanel />}

          {activeTab === "audit" && <AuditJournalsHub />}

          {activeTab === "ai" && <AiSchedulesSettings />}
        </div>
      </div>
    </PageShell>
  );
};

export default Settings;
