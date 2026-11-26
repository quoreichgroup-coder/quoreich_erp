import { ExchangeRatesPanel } from "@/components/ExchangeRatesPanel";
import { AttachmentSettingsPanel } from "@/components/AttachmentSettingsPanel";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CalendarDays, BookOpen, Receipt, CreditCard, GitBranch, Users, ShieldCheck,
  Plus, Pencil, Search, ChevronDown, ChevronRight, Trash2, Check, X,
  Clock, AlertTriangle, ArrowUp, Eye, FileText, Download, Play, UserMinus, RefreshCw,
  Zap, Shield, Hash, Bot, Landmark, Layers, Building2, Coins, Paperclip } from "lucide-react";
import { PostingAccountsPanel } from "@/components/PostingAccountsPanel";
import { ModulePostingSettings } from "@/components/AccountSets";
import { AnalyticAxesPanel } from "@/components/AnalyticAxesPanel";
import { TaxCodesPanel } from "@/components/TaxCodesPanel";
import { AuthorizationsPanel } from "@/components/AuthorizationsPanel";
import { AiSchedulesSettings } from "@/components/AiSchedulesSettings";
import { FiscalCalendarPanel } from "@/components/FiscalCalendarPanel";
import { ApprovalCircuitsHub, AuditJournalsHub, ChartOfAccountsHub } from "@/components/SettingsHubs";
import { PaymentTermsTab } from "@/pages/ARSettings";
import { DocumentTemplatesPanel } from "@/components/DocumentTemplatesPanel";
import { useMyAccess } from "@/hooks/use-my-access";
import { canAccessPage } from "@/lib/module-access";
import { useTranslation } from "react-i18next";
import { LanguageSettingsPanel } from "@/components/LanguageSettingsPanel";
import { Languages } from "lucide-react";

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
  { id: "attachments", label: "Pièces jointes", icon: Paperclip },
  { id: "document-templates", label: "Modèles de documents", icon: FileText },
  { id: "languages", label: "Langues et formats", icon: Languages },
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
  const [selectedTab, setActiveTabState] = useState(tabs.some((t) => t.id === requested) ? requested! : "fiscal");
  const { data: access } = useMyAccess();
  const { t } = useTranslation("settings");
  const tabLabel = (tab: (typeof tabs)[number]) => t(`tabs.${tab.id}`, { defaultValue: tab.label });
  const canManageTemplates = access?.permissions.includes("reports.templates") ?? false;
  const visibleTabs = tabs.filter((tab) => canAccessPage(`/settings?tab=${tab.id}`, access));
  const activeTab = visibleTabs.some((tab) => tab.id === selectedTab) ? selectedTab : visibleTabs[0]?.id;
  useEffect(() => {
    if (requested && tabs.some((t) => t.id === requested)) setActiveTabState(requested);
  }, [requested]);
  const setActiveTab = (id: string) => {
    setActiveTabState(id);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("tab", id); return next; }, { replace: true });
  };


  return (
    <PageShell>
      <Breadcrumb items={[{ label: t("page.breadcrumb_admin") }, { label: t("page.title") }]} />
      <GuidanceBanner message={t("page.banner")} />

      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-foreground">{t("page.title")}</h1>
        <HelpIcon text={t("page.help")} />
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Left Navigation */}
        <div className="lg:w-52 shrink-0">
          <div className="lg:hidden">
            <Select value={activeTab ?? ""} onValueChange={setActiveTab}>
              <SelectTrigger aria-label={t("page.section_select")}><SelectValue placeholder={t("page.section_placeholder")} /></SelectTrigger>
              <SelectContent>
                {visibleTabs.map((tab) => <SelectItem key={tab.id} value={tab.id}>{tabLabel(tab)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <nav aria-label={t("page.sections")} className="hidden lg:flex lg:flex-col lg:gap-0.5">
            {visibleTabs.map((tab) => (
              <Button key={tab.id} variant={activeTab === tab.id ? "default" : "ghost"} onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? "page" : undefined}
                className="h-auto min-h-10 w-full justify-start gap-2.5 whitespace-normal px-3 py-2 text-left text-xs">
                <tab.icon className="w-3.5 h-3.5" />
                {tabLabel(tab)}
              </Button>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <div className="min-w-0 flex-1">
          {/* ── Exercices et périodes (calendrier fiscal central, V33) ── */}
          {activeTab === "company" && <CompanyIdentityPanel />}
          {activeTab === "fiscal" && <div className="max-w-6xl"><FiscalCalendarPanel /></div>}
          {activeTab === "currency" && <div className="max-w-5xl"><ExchangeRatesPanel /></div>}
          {activeTab === "attachments" && <div className="max-w-5xl"><AttachmentSettingsPanel /></div>}
          {activeTab === "document-templates" && <DocumentTemplatesPanel />}
          {activeTab === "languages" && <div className="max-w-4xl"><LanguageSettingsPanel /></div>}

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
