import { Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Loader2 } from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { DEFAULT_BUDGET_SETTINGS, useBudgetControlSettings } from "@/hooks/use-budget-control";
import { projectAlerts } from "@/lib/projects";

/*
 * Projets → Contrôle : dépassements de budget (réalisé + engagé), seuil d'alerte atteint (paramètre du
 * contrôle budgétaire de la société), échéances dépassées, projets en cours sans budget.
 */
export default function ProjectControl() {
  const { data: projects = [], isLoading } = useProjects();
  const { data: budgetSettings } = useBudgetControlSettings();
  const alertPct = budgetSettings?.alert_threshold_pct ?? DEFAULT_BUDGET_SETTINGS.alert_threshold_pct;
  const today = new Date().toISOString().slice(0, 10);
  const alerts = projects.flatMap((p) => projectAlerts(p, today, alertPct).map((a) => ({ p, ...a })));
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Projets", href: "/projects" }, { label: "Contrôle" }]} />
      <GuidanceBanner title="Contrôle des projets" description={`Dépassements (réalisé + engagé au-delà du budget), seuil d'alerte de ${alertPct} % (paramètre du contrôle budgétaire), échéances dépassées, projets sans budget.`} />
      <h1 className="text-lg font-semibold">Projets — Contrôle</h1>
      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-xs" data-testid="project-alerts">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Projet</th><th className="text-left">Gravité</th><th className="text-left pr-3">Constat</th></tr></thead>
            <tbody>
              {alerts.length === 0 && <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">Aucune alerte sur les projets en cours.</td></tr>}
              {alerts.map((a, k) => (
                <tr key={k} className="border-t border-border/50" data-testid="project-alert">
                  <td className="p-2"><Link className="text-primary underline" to={`/projects/transactions?project=${a.p.id}`}>{a.p.project_code}</Link> {a.p.name}</td>
                  <td><StatusBadge status={a.level} label={a.level === "error" ? "Dépassement" : "À surveiller"} /></td><td className="pr-3">{a.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
