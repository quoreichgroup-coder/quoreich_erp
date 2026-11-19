import { Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Kpis } from "@/components/GrcWidgets";
import { useControls, useFrameworks, useIssues } from "@/hooks/use-grc";
import { complianceRate, CONTROL_STATUS, isOverdue, type ControlStatus } from "@/lib/grc";

/* Conformité → Tableau de bord : taux de conformité par référentiel, état des contrôles, constats ouverts, tests à faire. */
const today = () => new Date().toISOString().slice(0, 10);

export default function ComplianceModule() {
  const { data: frameworks = [], isLoading } = useFrameworks();
  const { data: controls = [] } = useControls();
  const { data: issues = [] } = useIssues();
  const active = controls.filter((c) => c.is_active);
  const rate = complianceRate(controls);
  const openIssues = issues.filter((i) => i.status !== "closed");
  const statuses: ControlStatus[] = ["effective", "partially_effective", "deficient", "not_tested", "not_applicable"];
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Gouvernance" }, { label: "Conformité" }]} />
      <GuidanceBanner title="Conformité et contrôle interne" description="Référentiels de la société, contrôles testés périodiquement ; un test non concluant ouvre un constat suivi jusqu'à sa remédiation." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Conformité — Tableau de bord</h1>
        <Button asChild size="sm"><Link to="/compliance/transactions">Tests et constats</Link></Button>
      </div>
      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <>
          <Kpis testId="compliance-kpis" items={[
            ["Taux de conformité", rate == null ? "—" : `${rate.toLocaleString("fr-FR")} %`],
            ["Contrôles actifs", active.length],
            ["Contrôles déficients", active.filter((c) => c.status === "deficient").length, true],
            ["Tests échus", active.filter((c) => isOverdue(c.next_review_at, today())).length],
            ["Constats ouverts", openIssues.length, openIssues.length > 0],
          ]} />
          <div className="card-elevated overflow-x-auto">
            <table className="w-full text-xs" data-testid="compliance-frameworks-summary">
              <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Référentiel</th>{statuses.map((s) => <th key={s} className="text-right">{CONTROL_STATUS[s][1]}</th>)}
                <th className="text-right pr-3">Conformité</th></tr></thead>
              <tbody>
                {frameworks.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucun référentiel : les créer dans Données de base.</td></tr>}
                {frameworks.map((f) => {
                  const mine = controls.filter((c) => c.framework_id === f.id && c.is_active);
                  const r = complianceRate(mine);
                  return (
                    <tr key={f.id} className="border-t border-border/50"><td className="p-2">{f.name}{f.version ? ` (${f.version})` : ""}</td>
                      {statuses.map((s) => <td key={s} className="text-right tabular-nums">{mine.filter((c) => c.status === s).length || ""}</td>)}
                      <td className="text-right tabular-nums pr-3 font-medium">{r == null ? "—" : `${r.toLocaleString("fr-FR")} %`}</td></tr>
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
