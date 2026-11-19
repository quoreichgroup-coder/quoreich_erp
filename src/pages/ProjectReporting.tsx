import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { ExportButtons } from "@/components/ExportButtons";
import { StatusBadge } from "@/components/StatusBadge";
import { Loader2 } from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { PROJECT_STATUS, projectIndicators } from "@/lib/projects";

/* Projets → Rapports : budget, réalisé, engagé, disponible, produits et marges de tous les projets, exportables. */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });

export default function ProjectReporting() {
  const { data: projects = [], isLoading } = useProjects();
  const rows = projects.map((p) => { const i = projectIndicators(p); return { code: p.project_code, intitule: p.name, client: p.customer?.name ?? "", statut: PROJECT_STATUS[p.status][1],
    budget: p.budget_costs, realise: p.actual_costs, engage: p.committed, disponible: i.available, consomme_pct: i.consumedPct ?? "", produits_budget: p.budget_revenue,
    produits: p.actual_revenue, marge: i.margin, marge_budget: i.budgetMargin, p }; });
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Projets", href: "/projects" }, { label: "Rapports" }]} />
      <GuidanceBanner title="Rapports des projets" description="Budget contre réalisé et engagé, produits et marge de chaque projet, calculés sur les écritures et commandes de la société." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Projets — Rapports</h1>
        <ExportButtons label="Exporter le rapport" rows={rows.map(({ p: _p, ...r }) => r)} filename="rapport-projets"
          columns={[{ key: "code", header: "Code" }, { key: "intitule", header: "Intitulé" }, { key: "client", header: "Client" }, { key: "statut", header: "Statut" },
            { key: "budget", header: "Budget charges" }, { key: "realise", header: "Réalisé" }, { key: "engage", header: "Engagé" }, { key: "disponible", header: "Disponible" },
            { key: "consomme_pct", header: "Consommé (%)" }, { key: "produits_budget", header: "Produits budgétés" }, { key: "produits", header: "Produits réalisés" },
            { key: "marge", header: "Marge réalisée" }, { key: "marge_budget", header: "Marge budgétée" }]} />
      </div>
      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-xs" data-testid="project-report">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Projet</th><th className="text-left">Statut</th><th className="text-right">Budget</th><th className="text-right">Réalisé</th>
              <th className="text-right">Engagé</th><th className="text-right">Disponible</th><th className="text-right">Produits</th><th className="text-right">Marge</th><th className="text-right pr-3">Marge budgétée</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Aucun projet.</td></tr>}
              {rows.map((r) => (
                <tr key={r.code} className="border-t border-border/50" data-testid="project-report-row">
                  <td className="p-2"><span className="font-mono">{r.code}</span> {r.intitule}</td><td><StatusBadge status={PROJECT_STATUS[r.p.status][0]} label={r.statut} /></td>
                  <td className="text-right tabular-nums">{fmt(r.budget)}</td><td className="text-right tabular-nums">{fmt(r.realise)}</td><td className="text-right tabular-nums">{fmt(r.engage)}</td>
                  <td className={`text-right tabular-nums ${r.disponible < 0 ? "text-destructive" : ""}`}>{fmt(r.disponible)}</td><td className="text-right tabular-nums">{fmt(r.produits)}</td>
                  <td className={`text-right tabular-nums ${r.marge < 0 ? "text-destructive" : ""}`}>{fmt(r.marge)}</td><td className="text-right tabular-nums pr-3">{fmt(r.marge_budget)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
