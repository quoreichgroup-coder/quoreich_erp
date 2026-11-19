import { Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { HeatMap, Kpis, Score } from "@/components/GrcWidgets";
import { useRiskActions, useRisks, useRiskSettings } from "@/hooks/use-grc";
import { aboveAppetite, heatMap, isOverdue, netScore, RISK_STATUS, riskLevel } from "@/lib/grc";

/* Risques → Tableau de bord : cartes de chaleur inhérente et résiduelle, risques au-delà de l'appétence, revues et actions échues. */
const today = () => new Date().toISOString().slice(0, 10);

export default function RiskManagement() {
  const { data: risks = [], isLoading } = useRisks();
  const { data: actions = [] } = useRiskActions();
  const { data: settings } = useRiskSettings();
  const s = settings!;
  const open = risks.filter((r) => r.status !== "closed");
  const top = [...open].sort((a, b) => netScore(b) - netScore(a)).slice(0, 10);
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Gouvernance" }, { label: "Risques" }]} />
      <GuidanceBanner title="Gestion des risques" description="Registre des risques coté sur l'échelle de la société : risque inhérent, puis résiduel après contrôles, traitement et actions." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Risques — Tableau de bord</h1>
        <Button asChild size="sm"><Link to="/risk/transactions">Registre des risques</Link></Button>
      </div>
      {isLoading || !settings ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <>
          <Kpis testId="risk-kpis" items={[
            ["Risques ouverts", open.length],
            ["Critiques (score retenu)", open.filter((r) => riskLevel(netScore(r), s) === "critical").length, true],
            ["Au-delà de l'appétence", s.appetite_score == null ? "non paramétrée" : open.filter((r) => aboveAppetite(r, s)).length, true],
            ["Revues échues", open.filter((r) => isOverdue(r.review_date, today())).length],
            ["Actions en retard", actions.filter((a) => a.status === "open" && isOverdue(a.due_date, today())).length],
          ]} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <HeatMap testId="heatmap-inherent" title="Risque inhérent" settings={s} matrix={heatMap(risks, s.scale_max, false)} />
            <HeatMap testId="heatmap-residual" title="Risque résiduel (après contrôles)" settings={s} matrix={heatMap(risks, s.scale_max, true)} />
          </div>
          <div className="card-elevated overflow-x-auto">
            <h2 className="text-xs font-semibold p-2">Principaux risques</h2>
            <table className="w-full text-xs">
              <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Code</th><th className="text-left">Risque</th><th className="text-left">Catégorie</th>
                <th className="text-right">Inhérent</th><th className="text-right">Résiduel</th><th className="text-left pl-3">Statut</th><th className="text-left">Revue</th></tr></thead>
              <tbody>
                {top.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucun risque ouvert.</td></tr>}
                {top.map((r) => (
                  <tr key={r.id} className="border-t border-border/50">
                    <td className="p-2 font-mono">{r.risk_code}</td><td>{r.title}</td><td>{r.category}</td>
                    <td className="text-right"><Score score={r.risk_score} settings={s} /></td><td className="text-right"><Score score={r.residual_score} settings={s} /></td>
                    <td className="pl-3"><StatusBadge status={RISK_STATUS[r.status][0]} label={RISK_STATUS[r.status][1]} /></td>
                    <td className={isOverdue(r.review_date, today()) ? "text-destructive" : ""}>{r.review_date ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageShell>
  );
}
