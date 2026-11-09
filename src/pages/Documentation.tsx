import { useState, useEffect, useRef } from "react";
import { PageShell } from "@/components/PageShell";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Book, ChevronRight, Search, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";

/* ── Table of contents structure ── */
interface TocItem {
  id: string;
  title: string;
  level: number;
  children?: TocItem[];
}

const tocData: TocItem[] = [
  {
    id: "introduction", title: "Introduction", level: 1, children: [
      { id: "architecture-standardisee", title: "Architecture standardisée", level: 2 },
      { id: "profils-utilisateurs", title: "Profils utilisateurs", level: 2 },
    ]
  },
  {
    id: "prise-en-main", title: "Prise en main", level: 1, children: [
      { id: "navigation", title: "Navigation", level: 2 },
      { id: "structure-des-ecrans", title: "Structure des écrans", level: 2 },
      { id: "actions-communes", title: "Actions communes", level: 2 },
    ]
  },
  {
    id: "tableau-de-bord-cfo", title: "Tableau de bord CFO", level: 1, children: [
      { id: "vue-densemble", title: "Vue d'ensemble", level: 2 },
      { id: "score-de-risque", title: "Score de risque", level: 2 },
      { id: "alertes-critiques", title: "Alertes critiques", level: 2 },
      { id: "gl-posting-engine-cfo", title: "GL Posting Engine", level: 2 },
      { id: "audit-trail-gl", title: "Audit Trail GL", level: 2 },
    ]
  },
  {
    id: "comptes-clients-ar", title: "Comptes Clients (AR)", level: 1, children: [
      { id: "ar-dashboard", title: "Dashboard", level: 2 },
      { id: "ar-transactions", title: "Transactions", level: 2 },
      { id: "ar-aging", title: "Aging Analysis", level: 2 },
      { id: "ar-reporting", title: "Reporting", level: 2 },
      { id: "ar-control", title: "Control", level: 2 },
      { id: "ar-settings", title: "Settings", level: 2 },
    ]
  },
  {
    id: "comptes-fournisseurs-ap", title: "Comptes Fournisseurs (AP)", level: 1, children: [
      { id: "ap-dashboard", title: "Dashboard", level: 2 },
      { id: "ap-transactions", title: "Transactions", level: 2 },
      { id: "ap-payment-planning", title: "Payment Planning", level: 2 },
      { id: "ap-reporting", title: "Reporting", level: 2 },
      { id: "ap-control", title: "Control", level: 2 },
      { id: "ap-settings", title: "Settings", level: 2 },
    ]
  },
  {
    id: "grand-livre-gl", title: "Grand Livre (GL)", level: 1, children: [
      { id: "gl-dashboard", title: "Dashboard", level: 2 },
      { id: "gl-transactions", title: "Transactions", level: 2 },
      { id: "gl-master-data", title: "Master Data", level: 2 },
      { id: "gl-reporting", title: "Reporting", level: 2 },
      { id: "gl-control", title: "Control", level: 2 },
      { id: "gl-settings", title: "Settings", level: 2 },
    ]
  },
  {
    id: "tresorerie", title: "Trésorerie", level: 1, children: [
      { id: "treasury-dashboard", title: "Dashboard", level: 2 },
      { id: "treasury-transactions", title: "Transactions", level: 2 },
      { id: "treasury-master-data", title: "Master Data", level: 2 },
      { id: "treasury-reporting", title: "Reporting", level: 2 },
      { id: "treasury-control", title: "Control", level: 2 },
      { id: "treasury-settings", title: "Settings", level: 2 },
    ]
  },
  {
    id: "immobilisations", title: "Immobilisations", level: 1, children: [
      { id: "assets-dashboard", title: "Dashboard", level: 2 },
      { id: "assets-transactions", title: "Transactions", level: 2 },
      { id: "assets-master-data", title: "Master Data", level: 2 },
      { id: "assets-reporting", title: "Reporting", level: 2 },
      { id: "assets-control", title: "Control", level: 2 },
      { id: "assets-settings", title: "Settings", level: 2 },
    ]
  },
  {
    id: "budget-previsions", title: "Budget & Prévisions", level: 1, children: [
      { id: "budget-dashboard", title: "Dashboard", level: 2 },
      { id: "budget-transactions", title: "Transactions", level: 2 },
      { id: "budget-master-data", title: "Master Data", level: 2 },
      { id: "budget-reporting", title: "Reporting & Scénarios", level: 2 },
      { id: "budget-control", title: "Control", level: 2 },
      { id: "budget-settings", title: "Settings", level: 2 },
    ]
  },
  {
    id: "comptabilite-projet", title: "Comptabilité de Projet", level: 1, children: [
      { id: "project-dashboard", title: "Dashboard", level: 2 },
      { id: "project-transactions", title: "Transactions", level: 2 },
      { id: "project-master-data", title: "Master Data & Kanban", level: 2 },
      { id: "project-reporting", title: "Reporting & Gantt", level: 2 },
      { id: "project-control", title: "Control", level: 2 },
      { id: "project-settings", title: "Settings", level: 2 },
    ]
  },
  {
    id: "achats-procurement", title: "Achats (Procurement)", level: 1, children: [
      { id: "procurement-dashboard", title: "Dashboard", level: 2 },
      { id: "procurement-transactions", title: "Transactions & Workflow", level: 2 },
      { id: "procurement-master-data", title: "Master Data", level: 2 },
      { id: "procurement-reporting", title: "Reporting", level: 2 },
      { id: "procurement-control", title: "Control", level: 2 },
      { id: "procurement-settings", title: "Settings", level: 2 },
    ]
  },
  {
    id: "gestion-risques", title: "Gestion des Risques", level: 1, children: [
      { id: "risk-dashboard", title: "Dashboard", level: 2 },
      { id: "risk-transactions", title: "Transactions", level: 2 },
      { id: "risk-master-data", title: "Master Data", level: 2 },
      { id: "risk-reporting", title: "Reporting", level: 2 },
      { id: "risk-control", title: "Control", level: 2 },
      { id: "risk-settings", title: "Settings", level: 2 },
    ]
  },
  {
    id: "conformite-audit", title: "Conformité & Audit", level: 1, children: [
      { id: "compliance-dashboard", title: "Dashboard", level: 2 },
      { id: "compliance-transactions", title: "Transactions", level: 2 },
      { id: "compliance-master-data", title: "Master Data", level: 2 },
      { id: "compliance-reporting", title: "Reporting", level: 2 },
      { id: "compliance-control", title: "Control", level: 2 },
      { id: "compliance-settings", title: "Settings", level: 2 },
    ]
  },
  {
    id: "centre-de-reporting", title: "Centre de Reporting", level: 1, children: []
  },
  {
    id: "administration", title: "Administration", level: 1, children: [
      { id: "workflow-engine", title: "Moteur de workflow", level: 2 },
      { id: "permissions", title: "Matrice de permissions", level: 2 },
      { id: "audit-conformite", title: "Audit & Conformité", level: 2 },
    ]
  },
  {
    id: "module-manager", title: "Gestionnaire de Modules", level: 1, children: [
      { id: "tenant-selector", title: "Sélecteur de tenant", level: 2 },
      { id: "license-management", title: "Gestion des licences", level: 2 },
      { id: "module-dependencies", title: "Dépendances modules", level: 2 },
    ]
  },
  { id: "faq", title: "FAQ", level: 1, children: [] },
];

/* ── Helper: sub-page table for standardized modules ── */
const SubPageTable = ({ routes }: { routes: { path: string; name: string; desc: string }[] }) => (
  <div className="rounded-lg border overflow-hidden">
    <table className="w-full text-sm">
      <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Sous-page</th><th className="text-left p-3 font-medium">Route</th><th className="text-left p-3 font-medium">Contenu</th></tr></thead>
      <tbody className="divide-y">
        {routes.map(r => (
          <tr key={r.path}><td className="p-3 font-medium">{r.name}</td><td className="p-3"><code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{r.path}</code></td><td className="p-3 text-muted-foreground">{r.desc}</td></tr>
        ))}
      </tbody>
    </table>
  </div>
);

/* ── Content sections ── */
const sections: { id: string; title: string; content: React.ReactNode }[] = [
  {
    id: "introduction", title: "1. Introduction",
    content: (
      <div className="space-y-4">
        <p className="text-muted-foreground leading-relaxed">
          QUOREICH est un ERP financier d'entreprise conçu pour les organisations de 500+ employés.
          Il couvre l'ensemble du cycle financier : comptes clients, comptes fournisseurs, grand livre,
          trésorerie, immobilisations, budgétisation, comptabilité de projet, achats, gestion des risques,
          conformité et reporting consolidé.
        </p>
        <div id="architecture-standardisee">
          <h3 className="text-lg font-semibold mb-3">Architecture standardisée</h3>
          <p className="text-muted-foreground mb-3">Tous les 10 modules métier suivent une architecture à <strong className="text-foreground">6 sous-pages</strong> :</p>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Sous-page</th><th className="text-left p-3 font-medium">Fonction</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3 font-medium">Dashboard</td><td className="p-3 text-muted-foreground">KPIs, graphiques, alertes proactives, résumé exécutif</td></tr>
                <tr><td className="p-3 font-medium">Transactions</td><td className="p-3 text-muted-foreground">Écritures opérationnelles, workflows d'approbation, écritures GL</td></tr>
                <tr><td className="p-3 font-medium">Master Data</td><td className="p-3 text-muted-foreground">Données de référence, registres, catalogues, configuration</td></tr>
                <tr><td className="p-3 font-medium">Reporting</td><td className="p-3 text-muted-foreground">Analyses, consolidation, scénarios, export (PDF/CSV)</td></tr>
                <tr><td className="p-3 font-medium">Control</td><td className="p-3 text-muted-foreground">Alertes, contrôles de conformité, rapprochement GL, SoD</td></tr>
                <tr><td className="p-3 font-medium">Settings</td><td className="p-3 text-muted-foreground">Configuration du module, seuils, mapping GL</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div id="profils-utilisateurs">
          <h3 className="text-lg font-semibold mb-3">Profils utilisateurs</h3>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Rôle</th><th className="text-left p-3 font-medium">Modules principaux</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3">CFO / Directeur Financier</td><td className="p-3 text-muted-foreground">Dashboard Global, Reporting, Trésorerie, Risques</td></tr>
                <tr><td className="p-3">Contrôleur de Gestion</td><td className="p-3 text-muted-foreground">Grand Livre, Budget, Reporting, Immobilisations</td></tr>
                <tr><td className="p-3">Responsable AR</td><td className="p-3 text-muted-foreground">Comptes Clients, Aging Analysis</td></tr>
                <tr><td className="p-3">Responsable AP</td><td className="p-3 text-muted-foreground">Comptes Fournisseurs, Payment Planning</td></tr>
                <tr><td className="p-3">Trésorier</td><td className="p-3 text-muted-foreground">Trésorerie, Cash Forecast, Rapprochement</td></tr>
                <tr><td className="p-3">Chef de Projet</td><td className="p-3 text-muted-foreground">Comptabilité de Projet, Budget</td></tr>
                <tr><td className="p-3">Risk Officer</td><td className="p-3 text-muted-foreground">Gestion des Risques, Conformité</td></tr>
                <tr><td className="p-3">Responsable Achats</td><td className="p-3 text-muted-foreground">Procurement, Contrats fournisseurs</td></tr>
                <tr><td className="p-3">Administrateur</td><td className="p-3 text-muted-foreground">Administration, Workflow, Permissions, Module Manager</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  },
  {
    id: "prise-en-main", title: "2. Prise en main",
    content: (
      <div className="space-y-6">
        <div id="navigation">
          <h3 className="text-lg font-semibold mb-3">Navigation</h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            L'application utilise une barre latérale (sidebar) à gauche, organisée en deux sections :
          </p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
            <li><strong className="text-foreground">Finance</strong> — AR, AP, GL, Trésorerie, Immobilisations, Budget, Projets</li>
            <li><strong className="text-foreground">Global</strong> — Procurement, Risques, Conformité, Reporting, Administration</li>
          </ul>
          <p className="text-muted-foreground mt-3">
            Chaque module dispose de <strong className="text-foreground">6 sous-menus</strong> : Dashboard, Transactions, Master Data, Reporting, Control, Settings.
          </p>
        </div>
        <div id="structure-des-ecrans">
          <h3 className="text-lg font-semibold mb-3">Structure des écrans</h3>
          <div className="bg-muted/30 border rounded-lg p-4 font-mono text-xs leading-relaxed overflow-x-auto">
            <pre>{`┌──────────────────────────────────────────────────┐
│ Breadcrumb : Finance > Module > Sous-page        │
├──────────────────────────────────────────────────┤
│ Titre de page                    [Actions]        │
├──────────────────────────────────────────────────┤
│ Cartes KPI (indicateurs clés)                     │
├───────┬──────────────────────────┬───────────────┤
│       │                          │               │
│Filtres│   Table de données       │ Panneau       │
│       │   principale             │ contextuel    │
│       │                          │ (détails)     │
│       │                          │               │
├───────┴──────────────────────────┴───────────────┤
│ Pagination                                        │
└──────────────────────────────────────────────────┘`}</pre>
          </div>
        </div>
        <div id="actions-communes">
          <h3 className="text-lg font-semibold mb-3">Actions communes sur les tableaux</h3>
          <ul className="space-y-2 text-muted-foreground">
            <li className="flex items-start gap-2"><span className="text-primary font-bold">•</span><span><strong className="text-foreground">Tri par colonne</strong> : Cliquer sur l'en-tête pour trier (asc/desc).</span></li>
            <li className="flex items-start gap-2"><span className="text-primary font-bold">•</span><span><strong className="text-foreground">Recherche</strong> : Barre de recherche avec filtrage en temps réel.</span></li>
            <li className="flex items-start gap-2"><span className="text-primary font-bold">•</span><span><strong className="text-foreground">Filtres avancés</strong> : Menus déroulants avec badge de filtres actifs.</span></li>
            <li className="flex items-start gap-2"><span className="text-primary font-bold">•</span><span><strong className="text-foreground">Pagination</strong> : Navigation par page avec compteur.</span></li>
            <li className="flex items-start gap-2"><span className="text-primary font-bold">•</span><span><strong className="text-foreground">Export</strong> : Bouton Export (CSV / PDF)</span></li>
            <li className="flex items-start gap-2"><span className="text-primary font-bold">•</span><span><strong className="text-foreground">Drill-down</strong> : Cliquer sur une ligne pour le panneau de détails</span></li>
          </ul>
        </div>
      </div>
    )
  },
  {
    id: "tableau-de-bord-cfo", title: "3. Tableau de bord CFO",
    content: (
      <div className="space-y-6">
        <p className="text-muted-foreground">Accès : <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">/</code></p>
        <div id="vue-densemble">
          <h3 className="text-lg font-semibold mb-3">Vue d'ensemble</h3>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">KPI</th><th className="text-left p-3 font-medium">Signification</th><th className="text-left p-3 font-medium">Interprétation</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3 font-medium">Cash Position</td><td className="p-3 text-muted-foreground">Trésorerie consolidée</td><td className="p-3 text-muted-foreground">Baisse → analyse de trésorerie</td></tr>
                <tr><td className="p-3 font-medium">Net Working Capital</td><td className="p-3 text-muted-foreground">BFR</td><td className="p-3 text-muted-foreground">Positif = bon, négatif = tension</td></tr>
                <tr><td className="p-3 font-medium">DSO</td><td className="p-3 text-muted-foreground">Délai moyen d'encaissement</td><td className="p-3 text-muted-foreground">&lt; 30j excellent, &gt; 60j attention</td></tr>
                <tr><td className="p-3 font-medium">DPO</td><td className="p-3 text-muted-foreground">Délai moyen de paiement</td><td className="p-3 text-muted-foreground">Optimiser sans nuire aux fournisseurs</td></tr>
                <tr><td className="p-3 font-medium">EBITDA</td><td className="p-3 text-muted-foreground">Résultat d'exploitation</td><td className="p-3 text-muted-foreground">Tendance haussière = positif</td></tr>
                <tr><td className="p-3 font-medium">Ratio d'endettement</td><td className="p-3 text-muted-foreground">Dette / Actifs totaux</td><td className="p-3 text-muted-foreground">&lt; 50% sain, &gt; 70% risque</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div id="score-de-risque">
          <h3 className="text-lg font-semibold mb-3">Score de risque</h3>
          <p className="text-muted-foreground mb-2">Le score global (0–100) est calculé à partir de :</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
            <li>Niveau de liquidité</li><li>Vieillissement des créances</li><li>Conformité réglementaire</li><li>Tendance des flux de trésorerie</li>
          </ul>
          <div className="flex gap-4 mt-3">
            <span className="inline-flex items-center gap-1.5 text-sm"><span className="w-3 h-3 rounded-full bg-green-500" /> Faible (0–30)</span>
            <span className="inline-flex items-center gap-1.5 text-sm"><span className="w-3 h-3 rounded-full bg-yellow-500" /> Modéré (31–60)</span>
            <span className="inline-flex items-center gap-1.5 text-sm"><span className="w-3 h-3 rounded-full bg-red-500" /> Élevé (61–100)</span>
          </div>
        </div>
        <div id="alertes-critiques">
          <h3 className="text-lg font-semibold mb-3">Alertes critiques</h3>
          <div className="space-y-2">
            {[{ level: "Critical", color: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400", desc: "Action immédiate requise" },
              { level: "Warning", color: "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400", desc: "Surveillance nécessaire" },
              { level: "Info", color: "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400", desc: "Information à noter" },
            ].map(a => (
              <div key={a.level} className={cn("rounded-lg border px-4 py-2.5 text-sm", a.color)}>
                <strong>{a.level}</strong> — {a.desc}
              </div>
            ))}
          </div>
        </div>
        <div id="gl-posting-engine-cfo">
          <h3 className="text-lg font-semibold mb-3">GL Posting Engine — Vue consolidée</h3>
          <p className="text-muted-foreground mb-3">Le CFO Dashboard intègre un tableau consolidé du moteur de posting GL :</p>
          <div className="rounded-lg border overflow-hidden mb-3">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Colonne</th><th className="text-left p-3 font-medium">Contenu</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3 font-medium">Module</td><td className="p-3 text-muted-foreground">Module source (AR, AP, Treasury, Assets, Budget, Projects, Procurement)</td></tr>
                <tr><td className="p-3 font-medium">Pending</td><td className="p-3 text-muted-foreground">Nombre de lots en attente de posting</td></tr>
                <tr><td className="p-3 font-medium">Posted</td><td className="p-3 text-muted-foreground">Nombre de lots postés au GL</td></tr>
                <tr><td className="p-3 font-medium">Total Posted (XOF)</td><td className="p-3 text-muted-foreground">Montant total posté en devise de base</td></tr>
              </tbody>
            </table>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p><strong className="text-foreground">Post All Pending</strong> — Bouton vert permettant de poster tous les lots en attente. Dialogue de confirmation avec montants détaillés.</p>
            <p><strong className="text-foreground">Audit Trail</strong> — Toggle pour afficher/masquer l'historique d'audit complet.</p>
          </div>
        </div>
        <div id="audit-trail-gl">
          <h3 className="text-lg font-semibold mb-3">Audit Trail GL</h3>
          <p className="text-muted-foreground mb-3">Journal immutable sécurisé par <strong className="text-foreground">chaîne de hachage SHA-256</strong> :</p>
          <div className="rounded-lg border overflow-hidden mb-3">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Champ</th><th className="text-left p-3 font-medium">Description</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3 font-medium">Timestamp</td><td className="p-3 text-muted-foreground">Date et heure de l'action</td></tr>
                <tr><td className="p-3 font-medium">Batch ID</td><td className="p-3 text-muted-foreground">Identifiant unique du lot</td></tr>
                <tr><td className="p-3 font-medium">Action</td><td className="p-3 text-muted-foreground">Created, Submitted, Approved, Rejected, Posted, Cancelled, Reversed, Rollback</td></tr>
                <tr><td className="p-3 font-medium">User</td><td className="p-3 text-muted-foreground">Utilisateur ayant effectué l'action</td></tr>
                <tr><td className="p-3 font-medium">Hash Chain</td><td className="p-3 text-muted-foreground">Hash SHA-256 courant + référence au hash précédent</td></tr>
              </tbody>
            </table>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
            <strong className="text-foreground">Rollback</strong> — Les lots postés peuvent être annulés via le bouton ↩. Un dialogue de confirmation crée des écritures compensatoires au GL. L'action est elle-même auditée.
          </div>
        </div>
      </div>
    )
  },
  {
    id: "comptes-clients-ar", title: "4. Comptes Clients (AR)",
    content: (
      <div className="space-y-6">
        <div id="ar-dashboard"><h3 className="text-lg font-semibold mb-2">4.1 Dashboard</h3><p className="text-muted-foreground">KPIs : Total Receivables, Overdue, DSO, Collection Effectiveness Index. Graphique d'aging par tranche.</p></div>
        <div id="ar-transactions">
          <h3 className="text-lg font-semibold mb-3">4.2 Transactions</h3>
          <p className="text-muted-foreground mb-3">Accès : <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">/receivables/transactions</code></p>
          <div className="grid grid-cols-2 gap-2">
            {[{ s: "Open", d: "En attente de paiement" }, { s: "Partially Paid", d: "Paiement partiel reçu" }, { s: "Paid", d: "Intégralement réglée" }, { s: "Overdue", d: "Échéance dépassée" }].map(x => (
              <div key={x.s} className="rounded-lg border p-3">
                <span className="font-medium text-sm">{x.s}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{x.d}</p>
              </div>
            ))}
          </div>
        </div>
        <div id="ar-aging">
          <h3 className="text-lg font-semibold mb-3">4.3 Aging Analysis</h3>
          <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500" /> Courant (dans les délais)</span>
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-yellow-500" /> Retard modéré (1–60 jours)</span>
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500" /> Retard critique (60+ jours)</span>
          </div>
        </div>
        <div id="ar-reporting"><h3 className="text-lg font-semibold mb-2">4.4 Reporting</h3><p className="text-muted-foreground">Rapports analytiques : aging détaillé, performance des collecteurs, tendances mensuelles.</p></div>
        <div id="ar-control"><h3 className="text-lg font-semibold mb-2">4.5 Control</h3><p className="text-muted-foreground">Workflow d'approbation, gestion des limites de crédit, règles de validation.</p></div>
        <div id="ar-settings"><h3 className="text-lg font-semibold mb-2">4.6 Settings</h3><p className="text-muted-foreground">Configuration du module : règles de relance, paramètres de dunning.</p></div>
      </div>
    )
  },
  {
    id: "comptes-fournisseurs-ap", title: "5. Comptes Fournisseurs (AP)",
    content: (
      <div className="space-y-6">
        <div id="ap-dashboard"><h3 className="text-lg font-semibold mb-2">5.1 Dashboard</h3><p className="text-muted-foreground">KPIs : Total Payable, Overdue, DPO, prévision de décaissement.</p></div>
        <div id="ap-transactions">
          <h3 className="text-lg font-semibold mb-3">5.2 Transactions</h3>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Type</th><th className="text-left p-3 font-medium">Valeurs</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3">Statut de paiement</td><td className="p-3 text-muted-foreground">Pending, Partial, Paid</td></tr>
                <tr><td className="p-3">Statut d'approbation</td><td className="p-3 text-muted-foreground">Pending Approval, Approved, Blocked</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div id="ap-payment-planning">
          <h3 className="text-lg font-semibold mb-3">5.3 Payment Planning</h3>
          <div className="grid grid-cols-2 gap-2">
            {[{ p: "Critical", d: "Paiement urgent", c: "border-red-500/30 bg-red-500/5" },
              { p: "High", d: "Échéance proche", c: "border-orange-500/30 bg-orange-500/5" },
              { p: "Normal", d: "Échéance standard", c: "border-blue-500/30 bg-blue-500/5" },
              { p: "Low", d: "Reportable", c: "border-muted bg-muted/30" },
            ].map(x => (
              <div key={x.p} className={cn("rounded-lg border p-3", x.c)}>
                <span className="font-medium text-sm">{x.p}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{x.d}</p>
              </div>
            ))}
          </div>
        </div>
        <div id="ap-reporting"><h3 className="text-lg font-semibold mb-2">5.4 Reporting</h3><p className="text-muted-foreground">Analytique AP : aging fournisseurs, performance de paiement, tendances.</p></div>
        <div id="ap-control"><h3 className="text-lg font-semibold mb-2">5.5 Control</h3><p className="text-muted-foreground">Workflows d'approbation multi-niveaux, règles de validation.</p></div>
        <div id="ap-settings"><h3 className="text-lg font-semibold mb-2">5.6 Settings</h3><p className="text-muted-foreground">Conditions de paiement, configuration fiscale.</p></div>
      </div>
    )
  },
  {
    id: "grand-livre-gl", title: "6. Grand Livre (GL)",
    content: (
      <div className="space-y-6">
        <div id="gl-dashboard">
          <h3 className="text-lg font-semibold mb-3">6.1 Dashboard / Écritures</h3>
          <p className="text-muted-foreground mb-3">Accès : <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">/journal</code></p>
          <div className="flex gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm rounded-full px-3 py-1 bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30">Balanced</span>
            <span className="inline-flex items-center gap-1.5 text-sm rounded-full px-3 py-1 bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30">Unbalanced</span>
          </div>
        </div>
        <div id="gl-transactions"><h3 className="text-lg font-semibold mb-2">6.2 Transactions</h3><p className="text-muted-foreground">Écritures manuelles et automatiques avec validation en temps réel.</p></div>
        <div id="gl-master-data">
          <h3 className="text-lg font-semibold mb-3">6.3 Plan comptable (Master Data)</h3>
          <div className="grid grid-cols-3 gap-2">
            {[{ t: "Arbre hiérarchique", d: "Actifs, Passifs, Capitaux propres, Produits, Charges" },
              { t: "Tableau de détail", d: "Code, Nom, Type, Compte parent, Devise, Statut" },
              { t: "Configuration", d: "Saisies manuelles, TVA, Centre de coût, Département" },
            ].map(x => (
              <div key={x.t} className="rounded-lg border p-3">
                <span className="font-medium text-sm">{x.t}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{x.d}</p>
              </div>
            ))}
          </div>
        </div>
        <div id="gl-reporting"><h3 className="text-lg font-semibold mb-2">6.4 Reporting</h3><p className="text-muted-foreground">Balance générale, compte de résultat, bilan.</p></div>
        <div id="gl-control"><h3 className="text-lg font-semibold mb-2">6.5 Control</h3><p className="text-muted-foreground">Gestion des périodes, clôture, piste d'audit.</p></div>
        <div id="gl-settings"><h3 className="text-lg font-semibold mb-2">6.6 Settings</h3><p className="text-muted-foreground">Configuration GL, comptes par défaut.</p></div>
      </div>
    )
  },
  {
    id: "tresorerie", title: "7. Trésorerie",
    content: (
      <div className="space-y-6">
        <div id="treasury-dashboard">
          <h3 className="text-lg font-semibold mb-3">7.1 Dashboard</h3>
          <p className="text-muted-foreground">Position de trésorerie consolidée multi-banques, graphique 30 jours.</p>
        </div>
        <div id="treasury-transactions">
          <h3 className="text-lg font-semibold mb-3">7.2 Transactions</h3>
          <p className="text-muted-foreground mb-3">Rapprochement bancaire — interface à 3 colonnes :</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border p-3"><span className="font-medium text-sm">Gauche</span><p className="text-xs text-muted-foreground mt-0.5">Transactions GL</p></div>
            <div className="rounded-lg border p-3"><span className="font-medium text-sm">Centre</span><p className="text-xs text-muted-foreground mt-0.5">Suggestions (score de confiance)</p></div>
            <div className="rounded-lg border p-3"><span className="font-medium text-sm">Droite</span><p className="text-xs text-muted-foreground mt-0.5">Relevé bancaire</p></div>
          </div>
        </div>
        <div id="treasury-master-data"><h3 className="text-lg font-semibold mb-2">7.3 Master Data</h3><p className="text-muted-foreground">Comptes bancaires, contreparties, instruments.</p></div>
        <div id="treasury-reporting">
          <h3 className="text-lg font-semibold mb-3">7.4 Reporting</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
            <li><strong className="text-foreground">4 scénarios</strong> : Optimiste, Base, Pessimiste, Stress</li>
            <li>Prévision 13 semaines avec stress testing</li>
            <li>Forecast vs Actual hebdomadaire</li>
          </ul>
        </div>
        <div id="treasury-control"><h3 className="text-lg font-semibold mb-2">7.5 Control</h3><p className="text-muted-foreground">Contrôles de rapprochement, scoring de confiance.</p></div>
        <div id="treasury-settings"><h3 className="text-lg font-semibold mb-2">7.6 Settings</h3><p className="text-muted-foreground">Paramètres de trésorerie, connectivité bancaire.</p></div>
      </div>
    )
  },
  {
    id: "immobilisations", title: "8. Immobilisations",
    content: (
      <div className="space-y-6">
        <SubPageTable routes={[
          { path: "/assets", name: "Dashboard", desc: "KPIs (VNC, amortissement), répartition par catégorie, alertes" },
          { path: "/assets/transactions", name: "Transactions", desc: "Acquisitions, cessions, réévaluations, GL auto-posting" },
          { path: "/assets/master-data", name: "Master Data", desc: "Registre des actifs, leasing, garanties, maintenance" },
          { path: "/assets/reporting", name: "Reporting", desc: "Tableaux d'amortissement, rapports par catégorie/localisation" },
          { path: "/assets/control", name: "Control", desc: "Alertes fin de vie, intégrité, rapprochement GL" },
          { path: "/assets/settings", name: "Settings", desc: "Méthodes d'amortissement, catégories, mapping GL" },
        ]} />
        <div id="assets-dashboard"><h3 className="text-lg font-semibold mb-2">8.1 Dashboard</h3><p className="text-muted-foreground">KPIs : Valeur Nette Comptable totale, charge d'amortissement, nombre d'actifs. Répartition par catégorie, évolution mensuelle.</p></div>
        <div id="assets-transactions"><h3 className="text-lg font-semibold mb-2">8.2 Transactions</h3><p className="text-muted-foreground">Registre des acquisitions, cessions et réévaluations. Workflow de validation. Journal GL automatique.</p></div>
        <div id="assets-master-data">
          <h3 className="text-lg font-semibold mb-3">8.3 Master Data</h3>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Champ</th><th className="text-left p-3 font-medium">Description</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3 font-medium">Code</td><td className="p-3 text-muted-foreground">Identifiant unique (FA-001)</td></tr>
                <tr><td className="p-3 font-medium">Catégorie</td><td className="p-3 text-muted-foreground">IT Equipment, Vehicles, Furniture, Building Equipment</td></tr>
                <tr><td className="p-3 font-medium">Méthode</td><td className="p-3 text-muted-foreground">Linear ou Declining Balance</td></tr>
                <tr><td className="p-3 font-medium">VNC</td><td className="p-3 text-muted-foreground">Coût − Amortissement cumulé</td></tr>
                <tr><td className="p-3 font-medium">Statut</td><td className="p-3 text-muted-foreground">Active, Fully Depreciated, Disposed, Under Maintenance</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div id="assets-reporting">
          <h3 className="text-lg font-semibold mb-3">8.4 Reporting</h3>
          <div className="space-y-3">
            <div className="rounded-lg border p-4 bg-muted/20">
              <h4 className="font-medium mb-1">Méthode linéaire</h4>
              <code className="text-xs font-mono text-primary">Dotation = (Coût − Valeur résiduelle) / Durée d'utilité</code>
            </div>
            <div className="rounded-lg border p-4 bg-muted/20">
              <h4 className="font-medium mb-1">Méthode dégressive</h4>
              <code className="text-xs font-mono text-primary">Dotation = VNC × Taux dégressif (%)</code>
            </div>
          </div>
        </div>
        <div id="assets-control"><h3 className="text-lg font-semibold mb-2">8.5 Control</h3><p className="text-muted-foreground">Alertes fin de vie, maintenance, garantie. Vérifications d'intégrité. Rapprochement GL.</p></div>
        <div id="assets-settings"><h3 className="text-lg font-semibold mb-2">8.6 Settings</h3><p className="text-muted-foreground">Méthodes d'amortissement, catégories, mapping comptes GL, cycles maintenance.</p></div>
      </div>
    )
  },
  {
    id: "budget-previsions", title: "9. Budget & Prévisions",
    content: (
      <div className="space-y-6">
        <SubPageTable routes={[
          { path: "/budget", name: "Dashboard", desc: "Variance KPIs, Budget vs Actual, alertes dépassement" },
          { path: "/budget/transactions", name: "Transactions", desc: "Écritures budgétaires, révisions, historique" },
          { path: "/budget/master-data", name: "Master Data", desc: "Lignes budgétaires par département/entité" },
          { path: "/budget/reporting", name: "Reporting", desc: "Consolidation multi-entity, 4 scénarios, export" },
          { path: "/budget/control", name: "Control", desc: "Alertes dépassement, blocage over-budget, cash flow" },
          { path: "/budget/settings", name: "Settings", desc: "Périodes fiscales, devises, seuils, approbation" },
        ]} />
        <div id="budget-dashboard">
          <h3 className="text-lg font-semibold mb-3">9.1 Dashboard</h3>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">KPI</th><th className="text-left p-3 font-medium">Description</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3 font-medium">Budget Total</td><td className="p-3 text-muted-foreground">Montant total budgété pour la période</td></tr>
                <tr><td className="p-3 font-medium">Réalisé YTD</td><td className="p-3 text-muted-foreground">Dépenses réelles cumulées</td></tr>
                <tr><td className="p-3 font-medium">Écart Net</td><td className="p-3 text-muted-foreground">Différence budget − réalisé</td></tr>
                <tr><td className="p-3 font-medium">Utilisation</td><td className="p-3 text-muted-foreground">Pourcentage du budget consommé</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div id="budget-transactions"><h3 className="text-lg font-semibold mb-2">9.2 Transactions</h3><p className="text-muted-foreground">Écritures budgétaires, révisions, historique des modifications avec piste d'audit.</p></div>
        <div id="budget-master-data"><h3 className="text-lg font-semibold mb-2">9.3 Master Data</h3><p className="text-muted-foreground">Lignes budgétaires par département et entité. Configuration des enveloppes. Règles d'allocation.</p></div>
        <div id="budget-reporting">
          <h3 className="text-lg font-semibold mb-3">9.4 Reporting & Scénarios</h3>
          <p className="text-muted-foreground mb-2">4 scénarios de prévision :</p>
          <div className="grid grid-cols-2 gap-2">
            {[{ s: "Optimistic", d: "Hypothèses favorables" }, { s: "Base", d: "Scénario central" }, { s: "Pessimistic", d: "Hypothèses défavorables" }, { s: "Stress Test", d: "Conditions extrêmes" }].map(x => (
              <div key={x.s} className="rounded-lg border p-3">
                <span className="font-medium text-sm">{x.s}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{x.d}</p>
              </div>
            ))}
          </div>
        </div>
        <div id="budget-control"><h3 className="text-lg font-semibold mb-2">9.5 Control</h3><p className="text-muted-foreground">Alertes dépassement, contrôle des engagements, blocage automatique si over-budget.</p></div>
        <div id="budget-settings"><h3 className="text-lg font-semibold mb-2">9.6 Settings</h3><p className="text-muted-foreground">Périodes fiscales, devises, seuils d'alerte, règles d'approbation.</p></div>
      </div>
    )
  },
  {
    id: "comptabilite-projet", title: "10. Comptabilité de Projet",
    content: (
      <div className="space-y-6">
        <SubPageTable routes={[
          { path: "/projects", name: "Dashboard", desc: "KPIs marge/WIP/completion, burndown charts" },
          { path: "/projects/transactions", name: "Transactions", desc: "Coûts/revenus par projet, liens GL/AP/AR" },
          { path: "/projects/master-data", name: "Master Data", desc: "Registre projets, équipes, jalons, Kanban" },
          { path: "/projects/reporting", name: "Reporting", desc: "P&L par projet, Gantt, analyse Labor/Materials/Overhead" },
          { path: "/projects/control", name: "Control", desc: "Alertes budget, retards, rapprochement GL" },
          { path: "/projects/settings", name: "Settings", desc: "Catégories coûts, taux horaires, règles GL" },
        ]} />
        <div id="project-dashboard"><h3 className="text-lg font-semibold mb-2">10.1 Dashboard</h3><p className="text-muted-foreground">KPIs : Projets Actifs, Revenu Total, Coûts Totaux, Marge Moyenne. Burndown budgétaire.</p></div>
        <div id="project-transactions"><h3 className="text-lg font-semibold mb-2">10.2 Transactions</h3><p className="text-muted-foreground">Écritures de coûts et revenus par projet. Liens avec GL, AP et AR.</p></div>
        <div id="project-master-data">
          <h3 className="text-lg font-semibold mb-3">10.3 Master Data & Kanban</h3>
          <p className="text-muted-foreground mb-3">Registre des projets avec Kanban board pour le suivi visuel.</p>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Colonne</th><th className="text-left p-3 font-medium">Description</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3 font-medium">Projet</td><td className="p-3 text-muted-foreground">Nom et identifiant</td></tr>
                <tr><td className="p-3 font-medium">Client</td><td className="p-3 text-muted-foreground">Client associé</td></tr>
                <tr><td className="p-3 font-medium">Revenu</td><td className="p-3 text-muted-foreground">Montant des revenus</td></tr>
                <tr><td className="p-3 font-medium">Coûts</td><td className="p-3 text-muted-foreground">Montant des dépenses</td></tr>
                <tr><td className="p-3 font-medium">Marge %</td><td className="p-3 text-muted-foreground">Pourcentage de marge</td></tr>
                <tr><td className="p-3 font-medium">Statut</td><td className="p-3 text-muted-foreground">Active, Completed, On Hold</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div id="project-reporting"><h3 className="text-lg font-semibold mb-2">10.4 Reporting & Gantt</h3><p className="text-muted-foreground">P&L par projet, Gantt timeline, analyse Labor vs Materials vs Overhead.</p></div>
        <div id="project-control"><h3 className="text-lg font-semibold mb-2">10.5 Control</h3><p className="text-muted-foreground">Alertes dépassement budget par projet, suivi des retards, rapprochement GL.</p></div>
        <div id="project-settings"><h3 className="text-lg font-semibold mb-2">10.6 Settings</h3><p className="text-muted-foreground">Catégories de coûts, taux horaires, règles de comptabilisation GL.</p></div>
      </div>
    )
  },
  {
    id: "achats-procurement", title: "11. Achats (Procurement)",
    content: (
      <div className="space-y-6">
        <SubPageTable routes={[
          { path: "/procurement", name: "Dashboard", desc: "KPIs spend/PO/SLA, spend analytics" },
          { path: "/procurement/transactions", name: "Transactions", desc: "Réquisitions + POs, workflow L1-L4" },
          { path: "/procurement/master-data", name: "Master Data", desc: "Fournisseurs, contrats, SLA monitoring" },
          { path: "/procurement/reporting", name: "Reporting", desc: "Top fournisseurs, coût par catégorie, délais" },
          { path: "/procurement/control", name: "Control", desc: "Alertes budget, retards, conformité, audit" },
          { path: "/procurement/settings", name: "Settings", desc: "Niveaux approbation, seuils, mapping GL" },
        ]} />
        <div id="procurement-dashboard"><h3 className="text-lg font-semibold mb-2">11.1 Dashboard</h3><p className="text-muted-foreground">KPIs : Total Spend, Open POs, SLA Compliance, Contract Utilization.</p></div>
        <div id="procurement-transactions">
          <h3 className="text-lg font-semibold mb-3">11.2 Transactions & Workflow</h3>
          <p className="text-muted-foreground mb-3">Workflow d'approbation L1-L4 :</p>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Niveau</th><th className="text-left p-3 font-medium">Seuil</th><th className="text-left p-3 font-medium">Approbateur</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3 font-medium">L1</td><td className="p-3 text-muted-foreground">&lt; 5 000</td><td className="p-3 text-muted-foreground">Chef de département</td></tr>
                <tr><td className="p-3 font-medium">L2</td><td className="p-3 text-muted-foreground">5 000 – 25 000</td><td className="p-3 text-muted-foreground">Responsable financier</td></tr>
                <tr><td className="p-3 font-medium">L3</td><td className="p-3 text-muted-foreground">25 000 – 100 000</td><td className="p-3 text-muted-foreground">CFO</td></tr>
                <tr><td className="p-3 font-medium">L4</td><td className="p-3 text-muted-foreground">&gt; 100 000</td><td className="p-3 text-muted-foreground">Comité de direction</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div id="procurement-master-data"><h3 className="text-lg font-semibold mb-2">11.3 Master Data</h3><p className="text-muted-foreground">Répertoire fournisseurs, contrats avec suivi d'utilisation, SLA monitoring.</p></div>
        <div id="procurement-reporting"><h3 className="text-lg font-semibold mb-2">11.4 Reporting</h3><p className="text-muted-foreground">Top fournisseurs par dépense, coût par catégorie, délais moyens.</p></div>
        <div id="procurement-control"><h3 className="text-lg font-semibold mb-2">11.5 Control</h3><p className="text-muted-foreground">Alertes budget, retards livraison, contrôles de conformité, piste d'audit.</p></div>
        <div id="procurement-settings"><h3 className="text-lg font-semibold mb-2">11.6 Settings</h3><p className="text-muted-foreground">Niveaux d'approbation, seuils, catégories, mapping GL.</p></div>
      </div>
    )
  },
  {
    id: "gestion-risques", title: "12. Gestion des Risques",
    content: (
      <div className="space-y-6">
        <SubPageTable routes={[
          { path: "/risk", name: "Dashboard", desc: "KPIs score/critiques, radar chart, heat map" },
          { path: "/risk/transactions", name: "Transactions", desc: "Événements de risque, incidents, actions correctives" },
          { path: "/risk/master-data", name: "Master Data", desc: "Catalogue risques, propriétaires, mitigation" },
          { path: "/risk/reporting", name: "Reporting", desc: "Évolution scores, stress testing, rapports" },
          { path: "/risk/control", name: "Control", desc: "Suivi mitigation, alertes SLA, escalades" },
          { path: "/risk/settings", name: "Settings", desc: "Matrices impact/probabilité, seuils, notifications" },
        ]} />
        <div id="risk-dashboard"><h3 className="text-lg font-semibold mb-2">12.1 Dashboard</h3><p className="text-muted-foreground">KPIs : Risques Totaux, Critiques/Élevés, Score Moyen, % Mitigés. Radar chart et heat map.</p></div>
        <div id="risk-transactions"><h3 className="text-lg font-semibold mb-2">12.2 Transactions</h3><p className="text-muted-foreground">Registre des événements de risque, incidents, actions correctives.</p></div>
        <div id="risk-master-data">
          <h3 className="text-lg font-semibold mb-3">12.3 Master Data</h3>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Colonne</th><th className="text-left p-3 font-medium">Description</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3 font-medium">Risque</td><td className="p-3 text-muted-foreground">Nom et description</td></tr>
                <tr><td className="p-3 font-medium">Catégorie</td><td className="p-3 text-muted-foreground">Financial, Operational, Compliance</td></tr>
                <tr><td className="p-3 font-medium">Probabilité</td><td className="p-3 text-muted-foreground">Low, Medium, High</td></tr>
                <tr><td className="p-3 font-medium">Impact</td><td className="p-3 text-muted-foreground">Low, Medium, High, Critical</td></tr>
                <tr><td className="p-3 font-medium">Score</td><td className="p-3 text-muted-foreground">Probabilité × Impact (0–100)</td></tr>
                <tr><td className="p-3 font-medium">Propriétaire</td><td className="p-3 text-muted-foreground">Responsable de la mitigation</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div id="risk-reporting"><h3 className="text-lg font-semibold mb-2">12.4 Reporting</h3><p className="text-muted-foreground">Évolution des scores, stress testing, rapports par catégorie et entité.</p></div>
        <div id="risk-control"><h3 className="text-lg font-semibold mb-2">12.5 Control</h3><p className="text-muted-foreground">Suivi des plans de mitigation, alertes SLA, gestion des escalades.</p></div>
        <div id="risk-settings"><h3 className="text-lg font-semibold mb-2">12.6 Settings</h3><p className="text-muted-foreground">Matrices impact/probabilité, seuils, catégories, règles de notification.</p></div>
      </div>
    )
  },
  {
    id: "conformite-audit", title: "13. Conformité & Audit Interne",
    content: (
      <div className="space-y-6">
        <SubPageTable routes={[
          { path: "/compliance", name: "Dashboard", desc: "KPIs effectiveness/findings, tendances" },
          { path: "/compliance/transactions", name: "Transactions", desc: "Log tests de contrôle, résultats, historique" },
          { path: "/compliance/master-data", name: "Master Data", desc: "Catalogue contrôles, frameworks SOX/IFRS" },
          { path: "/compliance/reporting", name: "Reporting", desc: "Rapports audit, gap analysis, tendances" },
          { path: "/compliance/control", name: "Control", desc: "Findings, remédiation, conflits SoD" },
          { path: "/compliance/settings", name: "Settings", desc: "Frameworks actifs, fréquences, seuils" },
        ]} />
        <div id="compliance-dashboard"><h3 className="text-lg font-semibold mb-2">13.1 Dashboard</h3><p className="text-muted-foreground">KPIs : Efficacité des contrôles (%), Constats ouverts. Tendances de conformité.</p></div>
        <div id="compliance-transactions"><h3 className="text-lg font-semibold mb-2">13.2 Transactions</h3><p className="text-muted-foreground">Log des exécutions de tests de contrôle, résultats, historique.</p></div>
        <div id="compliance-master-data"><h3 className="text-lg font-semibold mb-2">13.3 Master Data</h3><p className="text-muted-foreground">Catalogue contrôles internes, référentiels (SOX, IFRS, ISO 27001), mapping responsables.</p></div>
        <div id="compliance-reporting"><h3 className="text-lg font-semibold mb-2">13.4 Reporting</h3><p className="text-muted-foreground">Rapports d'audit, tendances conformité, gap analysis, progression des remédiations.</p></div>
        <div id="compliance-control">
          <h3 className="text-lg font-semibold mb-3">13.5 Control</h3>
          <p className="text-muted-foreground mb-3">Registre des constats d'audit avec suivi de remédiation et détection SoD.</p>
          <div className="grid grid-cols-2 gap-2">
            {[{ s: "Critical", c: "border-red-500/30 bg-red-500/5" }, { s: "High", c: "border-orange-500/30 bg-orange-500/5" },
              { s: "Medium", c: "border-yellow-500/30 bg-yellow-500/5" }, { s: "Low", c: "border-blue-500/30 bg-blue-500/5" }].map(x => (
              <div key={x.s} className={cn("rounded-lg border p-2.5 text-center text-sm font-medium", x.c)}>{x.s}</div>
            ))}
          </div>
        </div>
        <div id="compliance-settings"><h3 className="text-lg font-semibold mb-2">13.6 Settings</h3><p className="text-muted-foreground">Référentiels actifs, fréquences de test, seuils, notifications.</p></div>
      </div>
    )
  },
  {
    id: "centre-de-reporting", title: "14. Centre de Reporting",
    content: (
      <div className="space-y-6">
        <p className="text-muted-foreground">Accès : <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">/reports</code></p>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Rapport</th><th className="text-left p-3 font-medium">Description</th></tr></thead>
            <tbody className="divide-y">
              <tr><td className="p-3 font-medium">Bilan</td><td className="p-3 text-muted-foreground">Actifs / Passifs / Capitaux propres avec comparatif N-1</td></tr>
              <tr><td className="p-3 font-medium">Compte de résultat</td><td className="p-3 text-muted-foreground">Produits vs Charges avec graphique trimestriel</td></tr>
              <tr><td className="p-3 font-medium">Balance générale</td><td className="p-3 text-muted-foreground">Débit / Crédit avec indicateur d'équilibre</td></tr>
              <tr><td className="p-3 font-medium">Balance analytique</td><td className="p-3 text-muted-foreground">Par centre de coût, département, projet ou région</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-sm">
          Fonctionnalités : Filtres globaux, versioning (Actual/Budget/Forecast), consolidation multi-entité, export PDF/Excel/Print.
        </p>
      </div>
    )
  },
  {
    id: "administration", title: "15. Administration",
    content: (
      <div className="space-y-6">
        <p className="text-muted-foreground">Accès : <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">/settings</code></p>
        <div id="workflow-engine">
          <h3 className="text-lg font-semibold mb-3">Moteur de workflow</h3>
          <ul className="space-y-1.5 text-muted-foreground ml-2">
            <li className="flex items-start gap-2"><span className="text-primary">•</span>Conditions multi-variables (montant, devise, centre de coût, département)</li>
            <li className="flex items-start gap-2"><span className="text-primary">•</span>Combinateurs AND / OR pour logique complexe</li>
            <li className="flex items-start gap-2"><span className="text-primary">•</span>Délégation temporaire d'approbateurs</li>
            <li className="flex items-start gap-2"><span className="text-primary">•</span>Escalade conditionnelle selon SLA</li>
            <li className="flex items-start gap-2"><span className="text-primary">•</span>Simulation dry-run avant activation</li>
          </ul>
        </div>
        <div id="permissions">
          <h3 className="text-lg font-semibold mb-3">Matrice de permissions (RBAC)</h3>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Permission</th><th className="text-left p-3 font-medium">Description</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3 font-medium">Read</td><td className="p-3 text-muted-foreground">Consulter les données</td></tr>
                <tr><td className="p-3 font-medium">Create</td><td className="p-3 text-muted-foreground">Créer de nouveaux enregistrements</td></tr>
                <tr><td className="p-3 font-medium">Edit</td><td className="p-3 text-muted-foreground">Modifier des enregistrements existants</td></tr>
                <tr><td className="p-3 font-medium">Validate</td><td className="p-3 text-muted-foreground">Approuver / rejeter</td></tr>
                <tr><td className="p-3 font-medium">Delete</td><td className="p-3 text-muted-foreground">Supprimer (avec traçabilité)</td></tr>
                <tr><td className="p-3 font-medium">Export</td><td className="p-3 text-muted-foreground">Exporter les données</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground mt-2 text-sm"><strong className="text-foreground">Détection SoD</strong> : Identification automatique des conflits de séparation des tâches.</p>
        </div>
        <div id="audit-conformite">
          <h3 className="text-lg font-semibold mb-3">Audit & Conformité</h3>
          <p className="text-muted-foreground">Journal d'audit inviolable avec horodatage, adresse IP, chaîne de hachage SHA-256.</p>
        </div>
      </div>
    )
  },
  {
    id: "module-manager", title: "16. Gestionnaire de Modules",
    content: (
      <div className="space-y-6">
        <p className="text-muted-foreground">Accès : <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">/admin/modules</code></p>
        <div id="tenant-selector">
          <h3 className="text-lg font-semibold mb-3">Sélecteur de tenant</h3>
          <p className="text-muted-foreground">Basculer entre entités pour voir l'état des modules et licences.</p>
        </div>
        <div id="license-management">
          <h3 className="text-lg font-semibold mb-3">Gestion des licences</h3>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Module</th><th className="text-left p-3 font-medium">Starter</th><th className="text-left p-3 font-medium">Professional</th><th className="text-left p-3 font-medium">Enterprise</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="p-3">Grand Livre</td><td className="p-3">✅</td><td className="p-3">✅</td><td className="p-3">✅</td></tr>
                <tr><td className="p-3">Comptes Clients</td><td className="p-3">✅</td><td className="p-3">✅</td><td className="p-3">✅</td></tr>
                <tr><td className="p-3">Comptes Fournisseurs</td><td className="p-3">✅</td><td className="p-3">✅</td><td className="p-3">✅</td></tr>
                <tr><td className="p-3">Trésorerie</td><td className="p-3">❌</td><td className="p-3">✅</td><td className="p-3">✅</td></tr>
                <tr><td className="p-3">Immobilisations</td><td className="p-3">❌</td><td className="p-3">✅</td><td className="p-3">✅</td></tr>
                <tr><td className="p-3">Budget & Prévisions</td><td className="p-3">❌</td><td className="p-3">✅</td><td className="p-3">✅</td></tr>
                <tr><td className="p-3">Comptabilité de Projet</td><td className="p-3">❌</td><td className="p-3">❌</td><td className="p-3">✅</td></tr>
                <tr><td className="p-3">Gestion des Risques</td><td className="p-3">❌</td><td className="p-3">❌</td><td className="p-3">✅</td></tr>
                <tr><td className="p-3">Conformité</td><td className="p-3">❌</td><td className="p-3">❌</td><td className="p-3">✅</td></tr>
                <tr><td className="p-3">Achats</td><td className="p-3">❌</td><td className="p-3">✅</td><td className="p-3">✅</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div id="module-dependencies">
          <h3 className="text-lg font-semibold mb-3">Dépendances entre modules</h3>
          <ul className="space-y-1.5 text-muted-foreground ml-2">
            <li><strong className="text-foreground">AR / AP</strong> → nécessite GL</li>
            <li><strong className="text-foreground">Trésorerie</strong> → nécessite GL</li>
            <li><strong className="text-foreground">Immobilisations</strong> → nécessite GL</li>
            <li><strong className="text-foreground">Budget</strong> → nécessite GL</li>
            <li><strong className="text-foreground">Comptabilité de Projet</strong> → nécessite GL + AR + AP</li>
            <li><strong className="text-foreground">Achats</strong> → nécessite AP</li>
            <li><strong className="text-foreground">Risques / Conformité</strong> → autonomes</li>
          </ul>
        </div>
      </div>
    )
  },
  {
    id: "faq", title: "17. FAQ",
    content: (
      <div className="space-y-4">
        {[
          { q: "Comment changer de module ?", a: "Utilisez la sidebar. Cliquez sur le module pour déplier ses 6 sous-menus (Dashboard, Transactions, Master Data, Reporting, Control, Settings)." },
          { q: "Comment exporter des données ?", a: "Chaque tableau a un bouton Export en haut à droite. Formats : CSV et PDF." },
          { q: "Comment filtrer les données ?", a: "Utilisez la barre de filtres au-dessus du tableau. Les filtres sont cumulatifs (AND). Un badge indique les filtres actifs." },
          { q: "Comment trier les données ?", a: "Cliquez sur l'en-tête d'une colonne. Flèche ▲/▼ = direction du tri." },
          { q: "Que signifient les couleurs ?", a: "🟢 Vert = positif (payé, équilibré). 🟡 Jaune = attention (retard modéré). 🔴 Rouge = action urgente (critique, bloqué)." },
          { q: "Comment fonctionne le score de risque ?", a: "Score 0–100 calculé à partir de : liquidité, aging, conformité, tendance des flux." },
          { q: "Comment activer un module ?", a: "Accédez à /admin/modules, sélectionnez le tenant, cliquez Activate. Le système vérifie licences et dépendances." },
          { q: "Où trouver les sous-pages d'un module ?", a: "Chaque module a 6 sous-pages dans la sidebar : Dashboard, Transactions, Master Data, Reporting, Control, Settings." },
          { q: "Comment fonctionne le workflow d'approbation Procurement ?", a: "4 niveaux (L1-L4) basés sur le montant. L1 < 5K, L2 5-25K, L3 25-100K, L4 > 100K." },
          { q: "Quels scénarios budgétaires sont disponibles ?", a: "4 scénarios : Optimistic, Base, Pessimistic et Stress Test, chacun avec des hypothèses distinctes." },
        ].map(faq => (
          <div key={faq.q} className="rounded-lg border p-4">
            <h4 className="font-medium text-sm mb-1">{faq.q}</h4>
            <p className="text-sm text-muted-foreground">{faq.a}</p>
          </div>
        ))}
      </div>
    )
  },
];

/* ── Main component ── */
const Documentation = () => {
  const [activeSection, setActiveSection] = useState("introduction");
  const [tocSearch, setTocSearch] = useState("");
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0.1 }
    );

    sectionRefs.current.forEach((element) => {
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id: string) => {
    const element = sectionRefs.current.get(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const filterToc = (items: TocItem[]): TocItem[] => {
    if (!tocSearch) return items;
    const lower = tocSearch.toLowerCase();
    return items.filter(item => {
      const matchSelf = item.title.toLowerCase().includes(lower);
      const matchChild = item.children?.some(c => c.title.toLowerCase().includes(lower));
      return matchSelf || matchChild;
    });
  };

  return (
    <PageShell>
      <div className="flex gap-8 max-w-7xl mx-auto">
        {/* ── Table of Contents (sticky sidebar) ── */}
        <aside className="hidden lg:block w-72 flex-shrink-0">
          <div className="sticky top-6">
            <div className="flex items-center gap-2 mb-4">
              <Book className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-lg">Documentation</h2>
            </div>
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Rechercher…"
                value={tocSearch}
                onChange={(e) => setTocSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
            <ScrollArea className="h-[calc(100vh-12rem)]">
              <nav className="space-y-0.5 pr-2">
                {filterToc(tocData).map((item) => (
                  <div key={item.id}>
                    <button
                      onClick={() => scrollToSection(item.id)}
                      className={cn(
                        "w-full text-left text-sm px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5",
                        activeSection === item.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      <ChevronRight className={cn("h-3 w-3 transition-transform", activeSection === item.id && "rotate-90")} />
                      {item.title}
                    </button>
                    {item.children && item.children.length > 0 && (
                      <div className="ml-5 space-y-0.5 mt-0.5">
                        {item.children
                          .filter(c => !tocSearch || c.title.toLowerCase().includes(tocSearch.toLowerCase()))
                          .map((child) => (
                          <button
                            key={child.id}
                            onClick={() => scrollToSection(child.id)}
                            className={cn(
                              "w-full text-left text-xs px-2.5 py-1 rounded transition-colors",
                              activeSection === child.id
                                ? "text-primary font-medium"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {child.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </nav>
            </ScrollArea>
            <div className="mt-4 pt-4 border-t">
              <a href="/docs" target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1.5">
                <ExternalLink className="h-3 w-3" /> Voir le Markdown source
              </a>
              <p className="text-xs text-muted-foreground mt-2">QUOREICH ERP v4.0.0</p>
            </div>
          </div>
        </aside>

        {/* ── Content ── */}
        <main className="flex-1 min-w-0">
          <div className="space-y-12 pb-24">
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                ref={(el) => { if (el) sectionRefs.current.set(section.id, el); }}
                className="scroll-mt-6"
              >
                <h2 className="text-2xl font-bold mb-6 pb-2 border-b">{section.title}</h2>
                {section.content}
              </section>
            ))}
          </div>
        </main>
      </div>
    </PageShell>
  );
};

export default Documentation;
