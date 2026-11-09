import { useState } from "react";
import {
  LayoutDashboard, BookOpen, Users, Wallet, BarChart3, Settings,
  Landmark, ArrowDownLeft, ArrowUpRight, ChevronDown, Shield,
  ClipboardList, UserCog, HelpCircle, Blocks, Target,
  FolderKanban, AlertTriangle, ShoppingCart, Package, ShoppingBag, Receipt, Upload,
  UsersRound, History, Handshake,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useActiveModules } from "@/hooks/use-active-modules";

/* ── Types ────────────────────────────────────────────────────────────── */

interface SubItem { title: string; url: string; }
interface ModuleGroup {
  title: string;
  icon: React.ElementType;
  basePath: string;
  subItems: SubItem[];
  moduleKey: string; // maps to tenant_modules.module_name
}

/* ── Sub-pattern helper (French labels) ──────────────────────────────── */

const SUB_FR = (base: string, extras?: SubItem[]) => [
  { title: "Tableau de bord", url: base },
  { title: "Transactions", url: `${base}/transactions` },
  { title: "Données de base", url: `${base}/master-data` },
  { title: "Rapports", url: `${base}/reporting` },
  { title: "Contrôle", url: `${base}/control` },
  { title: "Paramètres", url: `${base}/settings` },
  ...(extras || []),
];

/* ── Finance modules (French) ────────────────────────────────────────── */

const financeModules: ModuleGroup[] = [
  {
    title: "Comptes clients (AR)", icon: ArrowDownLeft, basePath: "/receivables", moduleKey: "Accounts Receivable",
    subItems: [
      { title: "Tableau de bord", url: "/receivables" },
      { title: "Transactions", url: "/receivables/transactions" },
      { title: "Analyse d'âge", url: "/receivables/aging" },
      { title: "Clients", url: "/customers" },
      { title: "Rapports", url: "/receivables/reporting" },
      { title: "Contrôle", url: "/receivables/control" },
      { title: "Paramètres", url: "/receivables/settings" },
    ],
  },
  {
    title: "Comptes fournisseurs (AP)", icon: ArrowUpRight, basePath: "/payables", moduleKey: "Accounts Payable",
    subItems: [
      { title: "Tableau de bord", url: "/payables" },
      { title: "Factures fournisseurs", url: "/payables/transactions" },
      { title: "Planification paiements", url: "/payables/payment-planning" },
      { title: "Fournisseurs", url: "/suppliers" },
      { title: "Rapports", url: "/payables/reporting" },
      { title: "Contrôle", url: "/payables/control" },
      { title: "Paramètres", url: "/payables/settings" },
    ],
  },
  {
    title: "Grand Livre (GL)", icon: BookOpen, basePath: "/journal", moduleKey: "General Ledger",
    subItems: SUB_FR("/journal"),
  },
  {
    title: "Immobilisations", icon: Landmark, basePath: "/assets", moduleKey: "Fixed Assets",
    subItems: SUB_FR("/assets"),
  },
  {
    title: "Trésorerie", icon: Wallet, basePath: "/treasury", moduleKey: "Treasury",
    subItems: SUB_FR("/treasury"),
  },
  {
    title: "Budget & Prévisions", icon: Target, basePath: "/budget", moduleKey: "Budget & Forecast",
    subItems: SUB_FR("/budget"),
  },
  {
    title: "Gestion de projets", icon: FolderKanban, basePath: "/projects", moduleKey: "Project Accounting",
    subItems: SUB_FR("/projects"),
  },
  {
    title: "Approvisionnement", icon: ShoppingCart, basePath: "/procurement", moduleKey: "Procurement",
    subItems: SUB_FR("/procurement"),
  },
  {
    title: "Gestion des stocks", icon: Package, basePath: "/inventory", moduleKey: "Inventory",
    subItems: SUB_FR("/inventory"),
  },
  {
    title: "Commandes de vente", icon: ShoppingBag, basePath: "/sales", moduleKey: "Sales Orders",
    subItems: SUB_FR("/sales"),
  },
  {
    title: "Gestion des dépenses", icon: Receipt, basePath: "/expenses", moduleKey: "Expense Management",
    subItems: SUB_FR("/expenses"),
  },
];

/* ── Collapsible module component ────────────────────────────────────── */

function CollapsibleModule({ module }: { module: ModuleGroup }) {
  const location = useLocation();
  const isActive = location.pathname.startsWith(module.basePath) ||
    module.subItems.some((s) => s.url === location.pathname);
  const [open, setOpen] = useState(isActive);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium tracking-wide transition-colors",
          "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
          isActive && "text-sidebar-foreground"
        )}
      >
        <module.icon className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 text-left">{module.title}</span>
        <ChevronDown className={cn("w-3 h-3 shrink-0 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="ml-5 border-l border-sidebar-border pl-3 py-0.5">
          {module.subItems.map((item) => (
            <NavLink
              key={item.url}
              to={item.url}
              end
              className="block px-3 py-1.5 text-[12px] text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 rounded transition-colors"
              activeClassName="text-sidebar-accent-foreground bg-sidebar-accent font-medium"
            >
              {item.title}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Global nav items (French) ───────────────────────────────────────── */

const complianceModule: ModuleGroup = {
  title: "Conformité", icon: Shield, basePath: "/compliance", moduleKey: "Compliance",
  subItems: SUB_FR("/compliance"),
};

const riskModule: ModuleGroup = {
  title: "Gestion des risques", icon: AlertTriangle, basePath: "/risk", moduleKey: "Risk Management",
  subItems: SUB_FR("/risk"),
};

const hrModule: ModuleGroup = {
  title: "RH / Paie", icon: UsersRound, basePath: "/hr", moduleKey: "HR & Payroll",
  subItems: [
    { title: "Tableau de bord", url: "/hr" },
    { title: "Saisie paie", url: "/hr/transactions" },
    { title: "Cycles de paie", url: "/hr/payroll" },
    { title: "Employés", url: "/hr/employees" },
    { title: "Reporting", url: "/hr/reporting" },
    { title: "Contrôle", url: "/hr/control" },
    { title: "Historique des rôles", url: "/audit/hr" },
    { title: "Paramètres RH", url: "/hr/settings" },
  ],
};

const crmModule: ModuleGroup = {
  title: "CRM", icon: Handshake, basePath: "/crm", moduleKey: "CRM",
  subItems: [
    { title: "Tableau de bord", url: "/crm" },
    { title: "Contacts", url: "/crm/contacts" },
    { title: "Opportunités", url: "/crm/opportunities" },
    { title: "Rappels", url: "/crm/reminders" },
    { title: "Rapports", url: "/crm/reporting" },
    { title: "Contrôle", url: "/crm/control" },
    { title: "Paramètres", url: "/crm/settings" },
  ],
};

const simpleGlobalNav = [
  { title: "Centre de rapports", url: "/reports", icon: BarChart3 },
  { title: "Gestion des modules", url: "/admin/modules", icon: Blocks },
  { title: "Import de données", url: "/admin/import", icon: Upload },
  { title: "Historique rôles Projets", url: "/audit/projects", icon: History },
  { title: "Audit & Journaux", url: "/settings?tab=audit", icon: ClipboardList },
  { title: "Administration", url: "/settings", icon: Settings },
  { title: "Utilisateurs & Rôles", url: "/settings?tab=roles", icon: UserCog },
  { title: "Documentation", url: "/docs", icon: HelpCircle },
];

/* ── Main sidebar ────────────────────────────────────────────────────── */

export function DashboardSidebar() {
  const { data: activeModules, isLoading } = useActiveModules();
  const hasActiveModules = activeModules && activeModules.length > 0;

  // Filter finance modules: show all if no modules configured (fresh tenant), otherwise filter
  const visibleFinance = hasActiveModules
    ? financeModules.filter((m) => activeModules.includes(m.moduleKey))
    : financeModules;

  const showCompliance = !hasActiveModules || activeModules.includes("Compliance");
  const showRisk = !hasActiveModules || activeModules.includes("Risk Management");

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar">
      <div className="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-border">
        <div className="w-7 h-7 bg-sidebar-accent-foreground rounded flex items-center justify-center">
          <BarChart3 className="w-3.5 h-3.5 text-sidebar-background" />
        </div>
        <span className="font-semibold text-sm text-sidebar-primary tracking-wide">QUOREICH</span>
      </div>

      <SidebarContent className="pt-3 space-y-0">
        {/* Dashboard */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to="/" end className="flex items-center gap-3 px-4 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors" activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium">
                    <LayoutDashboard className="w-4 h-4 shrink-0" /><span>Tableau de bord</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to="/cockpit" className="flex items-center gap-3 px-4 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors" activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium">
                    <BarChart3 className="w-4 h-4 shrink-0" /><span>CFO Cockpit</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Finance modules */}
        {visibleFinance.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] uppercase tracking-widest font-semibold px-4 mb-1">Finance</SidebarGroupLabel>
            <SidebarGroupContent>
              {visibleFinance.map((mod) => <CollapsibleModule key={mod.basePath} module={mod} />)}
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Global */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] uppercase tracking-widest font-semibold px-4 mb-1">Général</SidebarGroupLabel>
          <SidebarGroupContent>
            {showCompliance && <CollapsibleModule module={complianceModule} />}
            {showRisk && <CollapsibleModule module={riskModule} />}
            <CollapsibleModule module={hrModule} />
            <CollapsibleModule module={crmModule} />
            <SidebarMenu>
              {simpleGlobalNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} className="flex items-center gap-3 px-4 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors" activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium">
                      <item.icon className="w-4 h-4 shrink-0" /><span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <div className="mt-auto p-4 border-t border-sidebar-border">
        <div className="text-[11px] text-sidebar-foreground/40">AF 2025–2026 · v3.0.0</div>
      </div>
    </Sidebar>
  );
}
