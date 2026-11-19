import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { ExportButtons } from "@/components/ExportButtons";
import { Loader2 } from "lucide-react";
import { useGrcPerms, useRisks, useRiskSettings } from "@/hooks/use-grc";
import { netScore, RISK_LEVEL, RISK_STATUS, riskLevel, TREATMENT, type RiskLevel } from "@/lib/grc";

/* Risques → Rapports : registre complet exportable, répartition par catégorie et par criticité. */
export default function RiskReporting() {
  const perms = useGrcPerms();
  const { data: risks = [], isLoading } = useRisks();
  const { data: s } = useRiskSettings();
  const rows = risks.map((r) => ({ code: r.risk_code, intitule: r.title, categorie: r.category, responsable: r.owner ?? "", probabilite: r.likelihood, impact: r.impact,
    inherent: r.risk_score, residuel: r.residual_score ?? "", criticite: s ? RISK_LEVEL[riskLevel(netScore(r), s) ?? "low"][1] : "", statut: RISK_STATUS[r.status][1],
    traitement: r.treatment ? TREATMENT[r.treatment] : "", revue: r.review_date ?? "", plan: r.mitigation_plan ?? "" }));
  const open = risks.filter((r) => r.status !== "closed");
  const cats = [...new Set(open.map((r) => r.category))].sort();
  const levels: RiskLevel[] = ["critical", "high", "medium", "low"];
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Gouvernance" }, { label: "Risques", href: "/risk" }, { label: "Rapports" }]} />
      <GuidanceBanner title="Rapports des risques" description="Registre exportable et répartition des risques ouverts par catégorie et criticité (score retenu : résiduel s'il est évalué)." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Risques — Rapports</h1>
        {perms.risksExport && <ExportButtons label="Exporter le registre" rows={rows} filename="registre-des-risques"
          columns={[{ key: "code", header: "Code" }, { key: "intitule", header: "Intitulé" }, { key: "categorie", header: "Catégorie" }, { key: "responsable", header: "Responsable" },
            { key: "probabilite", header: "Probabilité" }, { key: "impact", header: "Impact" }, { key: "inherent", header: "Score inhérent" }, { key: "residuel", header: "Score résiduel" },
            { key: "criticite", header: "Criticité" }, { key: "statut", header: "Statut" }, { key: "traitement", header: "Traitement" }, { key: "revue", header: "Prochaine revue" },
            { key: "plan", header: "Plan de traitement" }]} />}
      </div>
      {isLoading || !s ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-xs" data-testid="risk-report">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Catégorie</th>{levels.map((l) => <th key={l} className="text-right">{RISK_LEVEL[l][1]}</th>)}<th className="text-right pr-3">Total</th></tr></thead>
            <tbody>
              {cats.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Aucun risque ouvert.</td></tr>}
              {cats.map((c) => {
                const mine = open.filter((r) => r.category === c);
                return (
                  <tr key={c} className="border-t border-border/50"><td className="p-2">{c}</td>
                    {levels.map((l) => <td key={l} className="text-right tabular-nums">{mine.filter((r) => riskLevel(netScore(r), s) === l).length || ""}</td>)}
                    <td className="text-right tabular-nums pr-3 font-medium">{mine.length}</td></tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
