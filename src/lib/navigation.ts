/**
 * Navigation principale, rangée par processus métier comme les espaces SAP Fiori et les menus
 * Sage X3 : pilotage, ventes (order-to-cash), achats (procure-to-pay), stocks, comptabilité et
 * finance (record-to-report), ressources humaines, gouvernance, puis administration en dernier.
 * Données pures : la barre latérale les affiche, les tests vérifient qu'aucune page ne se perd.
 */
export interface NavItem {
  title: string;
  url: string;
  /** Autres pages qui allument cette entrée (onglets de Transactions répartis sur plusieurs pages). */
  also?: string[];
}

/**
 * Onglets de la page Transactions quand les pièces d'un module vivent sur plusieurs pages
 * existantes : la barre d'onglets (TransactionTabsBar) les relie, l'entrée « Transactions » du
 * menu reste allumée sur chacune.
 */
export const TRANSACTION_TABS: Record<string, NavItem[]> = {
  "/crm": [
    { title: "Opportunités", url: "/crm/opportunities" },
    { title: "Rappels et activités", url: "/crm/reminders" },
  ],
  "/hr": [
    { title: "Saisie de paie", url: "/hr/transactions" },
    { title: "Cycles de paie", url: "/hr/payroll" },
  ],
};
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

/**
 * Standard de présentation, commun à TOUS les modules (règle du propriétaire, 14 nov. 2026) :
 * Tableau de bord, Transactions, Données de base, Rapports, Contrôle, [pages propres au module],
 * Paramètres — comme Approvisionnement. Une entrée ne porte jamais le nom d'une pièce : les pièces
 * (factures, encaissements, demandes, commandes…) sont des ONGLETS de la page Transactions, les
 * fiches de tiers et référentiels sont dans Données de base. `urls` relie une entrée standard à une
 * page existante dont l'adresse diffère (ex. Données de base des comptes clients → /customers).
 */
const standard = (base: string, extras: NavItem[] = [],
  urls: { transactions?: string; masterData?: string } = {}): NavItem[] => [
  { title: "Tableau de bord", url: base },
  {
    title: "Transactions", url: urls.transactions ?? `${base}/transactions`,
    also: (TRANSACTION_TABS[base] ?? []).map((t) => t.url).filter((u) => u !== (urls.transactions ?? `${base}/transactions`)),
  },
  { title: "Données de base", url: urls.masterData ?? `${base}/master-data` },
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
        // Transactions = opportunités (pipeline) ; Données de base = contacts.
        // Transactions = onglets Opportunités, Rappels et activités ; Données de base = contacts.
        items: standard("/crm", [], { transactions: "/crm/opportunities", masterData: "/crm/contacts" }),
      },
      { title: "Commandes de vente", icon: "ShoppingBag", basePath: "/sales", moduleKey: "Sales Orders", items: standard("/sales") },
      {
        title: "Comptes clients", icon: "ArrowDownLeft", basePath: "/receivables", moduleKey: "Accounts Receivable",
        // Transactions : onglets Factures, Encaissements, Avoirs, Acomptes et crédits ; Données de base = clients.
        items: standard("/receivables", [{ title: "Analyse d'âge", url: "/receivables/aging" }], { masterData: "/customers" }),
      },
    ],
  },
  {
    id: "achats", label: "Achats et fournisseurs",
    modules: [
      { title: "Approvisionnement", icon: "ShoppingCart", basePath: "/procurement", moduleKey: "Procurement", items: standard("/procurement") },
      {
        title: "Comptes fournisseurs", icon: "ArrowUpRight", basePath: "/payables", moduleKey: "Accounts Payable",
        items: standard("/payables", [{ title: "Planification des paiements", url: "/payables/payment-planning" }], { masterData: "/suppliers" }),
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
        // Transactions = onglets Saisie de paie, Cycles de paie ; Données de base = employés.
        items: standard("/hr", [{ title: "Historique des rôles", url: "/audit/hr" }], { masterData: "/hr/employees" }),
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
