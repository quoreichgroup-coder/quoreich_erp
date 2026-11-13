/**
 * Navigation principale, rangée par processus métier comme les espaces SAP Fiori et les menus
 * Sage X3 : pilotage, ventes (order-to-cash), achats (procure-to-pay), stocks, comptabilité et
 * finance (record-to-report), ressources humaines, gouvernance, puis administration en dernier.
 * Données pures : la barre latérale les affiche, les tests vérifient qu'aucune page ne se perd.
 */
export interface NavItem { title: string; url: string }
export interface NavModule {
  title: string;
  /** Nom d'icône lucide, résolu par la barre latérale. */
  icon: string;
  basePath: string;
  items: NavItem[];
  /** Nom stocké dans tenant_modules.module_name ; absent = toujours affiché. */
  moduleKey?: string;
}
export interface NavLinkEntry { title: string; url: string; icon: string }
export interface NavSection { id: string; label: string; modules?: NavModule[]; links?: NavLinkEntry[] }

const standard = (base: string, extras: NavItem[] = []): NavItem[] => [
  { title: "Tableau de bord", url: base },
  { title: "Transactions", url: `${base}/transactions` },
  { title: "Données de base", url: `${base}/master-data` },
  { title: "Rapports", url: `${base}/reporting` },
  { title: "Contrôle", url: `${base}/control` },
  ...extras,
  { title: "Paramètres", url: `${base}/settings` },
];

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "pilotage", label: "Pilotage",
    links: [
      { title: "Tableau de bord", url: "/", icon: "LayoutDashboard" },
      { title: "Cockpit CFO", url: "/cockpit", icon: "Gauge" },
      { title: "Cockpit consolidé", url: "/cockpit/consolidated", icon: "Building2" },
      { title: "Alertes", url: "/alerts", icon: "Bell" },
      { title: "Centre de rapports", url: "/reports", icon: "BarChart3" },
    ],
  },
  {
    id: "ventes", label: "Ventes et clients",
    modules: [
      {
        title: "CRM", icon: "Handshake", basePath: "/crm",
        items: [
          { title: "Tableau de bord", url: "/crm" },
          { title: "Contacts", url: "/crm/contacts" },
          { title: "Opportunités", url: "/crm/opportunities" },
          { title: "Rappels", url: "/crm/reminders" },
          { title: "Rapports", url: "/crm/reporting" },
          { title: "Contrôle", url: "/crm/control" },
          { title: "Paramètres", url: "/crm/settings" },
        ],
      },
      { title: "Commandes de vente", icon: "ShoppingBag", basePath: "/sales", moduleKey: "Sales Orders", items: standard("/sales") },
      {
        title: "Comptes clients", icon: "ArrowDownLeft", basePath: "/receivables", moduleKey: "Accounts Receivable",
        items: [
          { title: "Tableau de bord", url: "/receivables" },
          { title: "Factures et encaissements", url: "/receivables/transactions" },
          { title: "Analyse d'âge", url: "/receivables/aging" },
          { title: "Clients", url: "/customers" },
          { title: "Rapports", url: "/receivables/reporting" },
          { title: "Contrôle", url: "/receivables/control" },
          { title: "Paramètres", url: "/receivables/settings" },
        ],
      },
    ],
  },
  {
    id: "achats", label: "Achats et fournisseurs",
    modules: [
      { title: "Approvisionnement", icon: "ShoppingCart", basePath: "/procurement", moduleKey: "Procurement", items: standard("/procurement") },
      {
        title: "Comptes fournisseurs", icon: "ArrowUpRight", basePath: "/payables", moduleKey: "Accounts Payable",
        items: [
          { title: "Tableau de bord", url: "/payables" },
          { title: "Factures fournisseurs", url: "/payables/transactions" },
          { title: "Planification des paiements", url: "/payables/payment-planning" },
          { title: "Fournisseurs", url: "/suppliers" },
          { title: "Rapports", url: "/payables/reporting" },
          { title: "Contrôle", url: "/payables/control" },
          { title: "Paramètres", url: "/payables/settings" },
        ],
      },
      { title: "Notes de frais", icon: "Receipt", basePath: "/expenses", moduleKey: "Expense Management", items: standard("/expenses") },
    ],
  },
  {
    id: "stocks", label: "Stocks",
    modules: [
      { title: "Gestion des stocks", icon: "Package", basePath: "/inventory", moduleKey: "Inventory", items: standard("/inventory") },
    ],
  },
  {
    id: "finance", label: "Comptabilité et finance",
    modules: [
      { title: "Grand livre", icon: "BookOpen", basePath: "/journal", moduleKey: "General Ledger", items: standard("/journal") },
      { title: "Trésorerie", icon: "Wallet", basePath: "/treasury", moduleKey: "Treasury", items: standard("/treasury") },
      { title: "Immobilisations", icon: "Landmark", basePath: "/assets", moduleKey: "Fixed Assets", items: standard("/assets") },
      { title: "Budget et prévisions", icon: "Target", basePath: "/budget", moduleKey: "Budget & Forecast", items: standard("/budget") },
      {
        title: "Projets", icon: "FolderKanban", basePath: "/projects", moduleKey: "Project Accounting",
        items: standard("/projects", [{ title: "Historique des rôles", url: "/audit/projects" }]),
      },
    ],
  },
  {
    id: "rh", label: "Ressources humaines",
    modules: [
      {
        title: "RH et paie", icon: "UsersRound", basePath: "/hr",
        items: [
          { title: "Tableau de bord", url: "/hr" },
          { title: "Saisie de paie", url: "/hr/transactions" },
          { title: "Cycles de paie", url: "/hr/payroll" },
          { title: "Employés", url: "/hr/employees" },
          { title: "Rapports", url: "/hr/reporting" },
          { title: "Contrôle", url: "/hr/control" },
          { title: "Historique des rôles", url: "/audit/hr" },
          { title: "Paramètres", url: "/hr/settings" },
        ],
      },
    ],
  },
  {
    id: "gouvernance", label: "Gouvernance",
    modules: [
      { title: "Conformité", icon: "Shield", basePath: "/compliance", moduleKey: "Compliance", items: standard("/compliance") },
      { title: "Risques", icon: "AlertTriangle", basePath: "/risk", moduleKey: "Risk Management", items: standard("/risk") },
    ],
    links: [
      { title: "Audit et journaux", url: "/settings?tab=audit", icon: "ClipboardList" },
      { title: "Historique IA", url: "/ai/history", icon: "History" },
    ],
  },
  {
    id: "administration", label: "Administration",
    links: [
      { title: "Paramètres de la société", url: "/settings", icon: "Settings" },
      { title: "Exercices et périodes", url: "/settings?tab=fiscal", icon: "CalendarDays" },
      { title: "Rôles et autorisations", url: "/settings?tab=roles", icon: "UserCog" },
      { title: "Gestion des modules", url: "/admin/modules", icon: "Blocks" },
      { title: "Import de données", url: "/admin/import", icon: "Upload" },
      { title: "Documentation", url: "/docs", icon: "HelpCircle" },
    ],
  },
];

/**
 * Modules visibles : tous si la société n'a configuré aucun module (nouvelle société), sinon
 * ceux qu'elle a activés ; un module sans clé reste toujours visible.
 */
export function visibleModules(modules: NavModule[] | undefined, active: string[] | undefined): NavModule[] {
  if (!modules) return [];
  if (!active || active.length === 0) return modules;
  return modules.filter((m) => !m.moduleKey || active.includes(m.moduleKey));
}

/** Onglets de /settings qui ont leur propre lien dans la navigation. */
const LINKED_SETTINGS_TABS = new Set(
  NAV_SECTIONS.flatMap((sec) => sec.links ?? [])
    .map((l) => l.url.split("?"))
    .filter(([path, query]) => path === "/settings" && query)
    .map(([, query]) => new URLSearchParams(query).get("tab"))
    .filter((t): t is string => Boolean(t)),
);

/**
 * Lien actif : même chemin et, si le lien vise un onglet (?tab=…), même onglet. « Paramètres
 * de la société » reste actif sur les onglets de /settings qui n'ont pas leur propre lien.
 */
export function isLinkActive(url: string, pathname: string, search: string): boolean {
  const [path, query] = url.split("?");
  if (path !== pathname) return false;
  const want = new URLSearchParams(query ?? "").get("tab");
  const have = new URLSearchParams(search).get("tab");
  if (want) return want === have;
  return !have || !LINKED_SETTINGS_TABS.has(have);
}
