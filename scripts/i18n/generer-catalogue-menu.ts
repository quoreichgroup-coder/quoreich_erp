/**
 * Génère src/i18n/locales/{fr,en}/nav.json depuis src/lib/navigation.ts.
 * Le français est le libellé du menu (source) ; l'anglais vient du glossaire ci-dessous. Un libellé
 * sans traduction fait échouer la génération (pas de clé brute ni de mélange silencieux).
 *   npx tsx scripts/i18n/generer-catalogue-menu.ts
 */
import { writeFileSync } from "node:fs";
import { NAV_SECTIONS, TRANSACTION_TABS } from "../../src/lib/navigation";
import { navItemKey, navModuleKey, navSectionKey } from "../../src/i18n/nav-keys";

export const NAV_EN: Record<string, string> = {
  "Pilotage": "Performance", "Tableau de bord": "Dashboard", "Cockpit CFO": "CFO cockpit",
  "Cockpit consolidé": "Consolidated cockpit", "Alertes": "Alerts", "Centre de rapports": "Report centre",
  "Ventes et clients": "Sales and customers", "CRM": "CRM", "Transactions": "Transactions",
  "Données de base": "Master data", "Rapports": "Reports", "Contrôle": "Control", "Paramètres": "Settings",
  "Commandes de vente": "Sales orders", "Comptes clients": "Accounts receivable", "Analyse d'âge": "Ageing analysis",
  "Achats et fournisseurs": "Purchasing and suppliers", "Approvisionnement": "Procurement",
  "Comptes fournisseurs": "Accounts payable", "Planification des paiements": "Payment planning",
  "Notes de frais": "Expense reports", "Stocks": "Inventory", "Gestion des stocks": "Inventory management",
  "Comptabilité et finance": "Accounting and finance", "Grand livre": "General ledger",
  "Plans et référentiels": "Charts and frameworks", "Trésorerie": "Treasury", "Immobilisations": "Fixed assets",
  "Budget et prévisions": "Budget and forecasts", "Projets": "Projects", "Historique des rôles": "Role history",
  "Ressources humaines": "Human resources", "RH et paie": "HR and payroll", "Mon espace RH": "My HR space",
  "Gouvernance": "Governance", "Conformité": "Compliance", "Risques": "Risks", "Audit et journaux": "Audit and logs",
  "Historique IA": "AI history", "Administration": "Administration", "Paramètres de la société": "Company settings",
  "Exercices et périodes": "Fiscal years and periods", "Rôles et autorisations": "Roles and permissions",
  "Gestion des modules": "Module management", "Import de données": "Data import", "Documentation": "Documentation",
  "Opportunités": "Opportunities", "Rappels et activités": "Reminders and activities", "Saisie de paie": "Payroll entry",
  "Cycles de paie": "Payroll runs", "Temps et absences": "Time and absences", "Paiement des salaires": "Salary payments",
};

export function navCatalog(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of NAV_SECTIONS) {
    out[navSectionKey(s.id)] = s.label;
    for (const m of s.modules ?? []) {
      out[navModuleKey(m.basePath)] = m.title;
      for (const i of m.items) out[navItemKey(i.url)] = i.title;
    }
    for (const l of s.links ?? []) out[navItemKey(l.url)] = l.title;
  }
  for (const tabs of Object.values(TRANSACTION_TABS)) for (const t of tabs) out[navItemKey(t.url)] = t.title;
  return out;
}

function nest(flat: Record<string, string>) {
  const out: Record<string, Record<string, string>> = {};
  for (const [key, value] of Object.entries(flat).sort(([a], [b]) => a.localeCompare(b))) {
    const [group, ...rest] = key.split(".");
    (out[group] ??= {})[rest.join(".")] = value;
  }
  return out;
}

if (process.argv[1]?.endsWith("generer-catalogue-menu.ts")) {
  const fr = navCatalog();
  const missing = [...new Set(Object.values(fr))].filter((t) => !NAV_EN[t]);
  if (missing.length) throw new Error(`Libellés de menu sans traduction anglaise : ${missing.join(", ")}`);
  const en = Object.fromEntries(Object.entries(fr).map(([k, v]) => [k, NAV_EN[v]]));
  writeFileSync("src/i18n/locales/fr/nav.json", JSON.stringify(nest(fr), null, 2) + "\n");
  writeFileSync("src/i18n/locales/en/nav.json", JSON.stringify(nest(en), null, 2) + "\n");
  console.log(`${Object.keys(fr).length} entrées de menu écrites (fr, en).`);
}
