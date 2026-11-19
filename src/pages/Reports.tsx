import { Link } from "react-router-dom";
import { ArrowRight, BarChart3 } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";

/*
 * Centre de rapports : point d'entrée vers les rapports réels de chaque module (lus dans la base, exportables en
 * Excel / CSV / PDF depuis leur écran). La page affichait auparavant un bilan, un compte de résultat et des rapports
 * planifiés de démonstration.
 */
const GROUPS: { title: string; reports: { to: string; title: string; text: string }[] }[] = [
  {
    title: "Comptabilité et finance",
    reports: [
      { to: "/journal/reporting", title: "États financiers et grand livre", text: "Bilan et compte de résultat SYSCOHADA par rubriques, balance, grand livre, journaux" },
      { to: "/treasury/reporting", title: "Trésorerie", text: "Positions, mouvements, rapprochements" },
      { to: "/budget/reporting", title: "Budget", text: "Budget / réalisé, par section, mensuel, comparaison de versions" },
      { to: "/assets/reporting", title: "Immobilisations", text: "Registre, amortissements, cessions" },
      { to: "/cockpit/consolidated", title: "Consolidation", text: "Indicateurs et tendances des sociétés accessibles" },
    ],
  },
  {
    title: "Ventes et clients",
    reports: [
      { to: "/receivables/aging", title: "Balance âgée clients", text: "Créances par ancienneté" },
      { to: "/receivables/reporting", title: "Comptes clients", text: "Factures, encaissements, avoirs, relevés" },
      { to: "/sales/reporting", title: "Ventes", text: "Devis, commandes, livraisons" },
      { to: "/crm/reporting", title: "CRM", text: "Opportunités et activité commerciale" },
    ],
  },
  {
    title: "Achats et stocks",
    reports: [
      { to: "/payables/reporting", title: "Comptes fournisseurs", text: "Factures, règlements, balance âgée" },
      { to: "/procurement/reporting", title: "Achats", text: "Dépenses par fournisseur et catégorie, délais, respect des dates" },
      { to: "/inventory/reporting", title: "Stocks", text: "Valorisation, mouvements, inventaires" },
      { to: "/expenses/reporting", title: "Notes de frais", text: "Par salarié, catégorie, projet" },
    ],
  },
  {
    title: "Ressources humaines et gouvernance",
    reports: [
      { to: "/hr/reporting", title: "RH et paie", text: "Effectifs, cycles de paie, masse salariale" },
      { to: "/projects/reporting", title: "Projets", text: "Budget, engagé, réalisé par projet" },
      { to: "/compliance/reporting", title: "Conformité", text: "Contrôles, tests, constats" },
      { to: "/risk/reporting", title: "Risques", text: "Registre, cartographie, actions" },
    ],
  },
];

export default function Reports() {
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Pilotage" }, { label: "Centre de rapports" }]} />
      <GuidanceBanner message="Chaque rapport est calculé à partir des données de la société et s'exporte en Excel, CSV ou PDF depuis son écran." />
      <h1 className="text-lg font-semibold text-foreground flex items-center gap-2"><BarChart3 className="w-5 h-5" /> Centre de rapports</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="reports-hub">
        {GROUPS.map((g) => (
          <div key={g.title} className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-sm font-medium text-foreground">{g.title}</div>
            {g.reports.map((r) => (
              <Link key={r.to} to={r.to} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/30 border-b border-border/50 last:border-0">
                <div>
                  <div className="text-sm font-medium text-foreground">{r.title}</div>
                  <div className="text-xs text-muted-foreground">{r.text}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              </Link>
            ))}
          </div>
        ))}
      </div>
    </PageShell>
  );
}
