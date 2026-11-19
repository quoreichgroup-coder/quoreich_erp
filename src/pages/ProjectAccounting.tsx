import { Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { PROJECT_STATUS, projectIndicators } from "@/lib/projects";

/* Projets → Tableau de bord : portefeuille des projets en cours, consommé contre budget, marge réalisée. */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });

export default function ProjectAccounting() {
  const { data: projects = [], isLoading } = useProjects();
  const open = projects.filter((p) => ["active", "on_hold", "planned"].includes(p.status));
  const sum = (k: "budget_costs" | "actual_costs" | "committed" | "actual_revenue") => open.reduce((t, p) => t + p[k], 0);
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Projets" }]} />
      <GuidanceBanner title="Projets" description="Portefeuille des projets en cours : budget, réalisé et engagé lus dans la comptabilité, marge réalisée." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Projets — Tableau de bord</h1>
        <Button asChild size="sm"><Link to="/projects/master-data">Gérer les projets</Link></Button>
      </div>
      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="project-kpis">
            {[["Projets en cours", String(open.length)], ["Budget de charges", fmt(sum("budget_costs"))], ["Réalisé", fmt(sum("actual_costs"))], ["Engagé", fmt(sum("committed"))],
              ["Produits réalisés", fmt(sum("actual_revenue"))]].map(([l, v]) => (
              <div key={l} className="bg-card border border-border rounded-lg p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div><div className="text-lg font-semibold">{v}</div></div>
            ))}
          </div>
          <div className="card-elevated overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Projet</th><th className="text-left">Statut</th><th className="text-right">Budget</th><th className="text-right">Réalisé + engagé</th>
                <th className="text-left pl-3 w-48">Consommé</th><th className="text-right pr-3">Marge réalisée</th></tr></thead>
              <tbody>
                {open.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Aucun projet en cours.</td></tr>}
                {open.map((p) => {
                  const i = projectIndicators(p);
                  return (
                    <tr key={p.id} className="border-t border-border/50">
                      <td className="p-2"><Link className="text-primary underline" to={`/projects/transactions?project=${p.id}`}>{p.project_code}</Link> {p.name}</td>
                      <td><StatusBadge status={PROJECT_STATUS[p.status][0]} label={PROJECT_STATUS[p.status][1]} /></td>
                      <td className="text-right tabular-nums">{fmt(p.budget_costs)}</td><td className="text-right tabular-nums">{fmt(i.consumed)}</td>
                      <td className="pl-3">{i.consumedPct == null ? <span className="text-muted-foreground">sans budget</span> : (
                        <div className="flex items-center gap-2"><div className="flex-1 h-1.5 bg-muted rounded-full"><div className={`h-1.5 rounded-full ${i.consumedPct > 100 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.min(100, i.consumedPct)}%` }} /></div>
                          <span className="tabular-nums w-12 text-right">{i.consumedPct} %</span></div>)}</td>
                      <td className={`text-right tabular-nums pr-3 ${i.margin < 0 ? "text-destructive" : ""}`}>{fmt(i.margin)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageShell>
  );
}
