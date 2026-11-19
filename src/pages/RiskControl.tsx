import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Loader2 } from "lucide-react";
import { Kpis } from "@/components/GrcWidgets";
import { useRiskActions, useRiskControlLinks, useRisks, useRiskSettings } from "@/hooks/use-grc";
import { aboveAppetite, isOverdue, netScore } from "@/lib/grc";

/* Risques → Contrôle : ce qui demande une décision (au-delà de l'appétence sans traitement, jamais évalués, revues et actions échues, sans contrôle). */
const today = () => new Date().toISOString().slice(0, 10);

function Liste({ titre, lignes, testId }: { titre: string; lignes: [string, string, string][]; testId: string }) {
  return (
    <div className="card-elevated" data-testid={testId}>
      <h2 className="text-xs font-semibold p-2">{titre} ({lignes.length})</h2>
      {lignes.length === 0 ? <p className="text-xs text-muted-foreground px-2 pb-3">Rien à signaler.</p> : (
        <table className="w-full text-xs"><tbody>
          {lignes.map(([a, b, c], i) => <tr key={i} className="border-t border-border/50"><td className="p-2 font-mono w-24">{a}</td><td>{b}</td><td className="text-right pr-3 text-muted-foreground">{c}</td></tr>)}
        </tbody></table>
      )}
    </div>
  );
}

export default function RiskControl() {
  const { data: risks = [], isLoading } = useRisks();
  const { data: actions = [] } = useRiskActions();
  const { data: links = [] } = useRiskControlLinks();
  const { data: s } = useRiskSettings();
  if (isLoading || !s) return <PageShell><div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div></PageShell>;
  const open = risks.filter((r) => r.status !== "closed");
  const code = new Map(risks.map((r) => [r.id, r.risk_code]));
  const appetite = open.filter((r) => aboveAppetite(r, s) && r.status !== "treating");
  const never = open.filter((r) => !r.last_assessed_at);
  const reviews = open.filter((r) => isOverdue(r.review_date, today()));
  const late = actions.filter((a) => a.status === "open" && isOverdue(a.due_date, today()));
  const uncovered = open.filter((r) => r.last_assessed_at && !links.some((l) => l.risk_id === r.id));
  const accepted = risks.filter((r) => r.status === "accepted");
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Gouvernance" }, { label: "Risques", href: "/risk" }, { label: "Contrôle" }]} />
      <GuidanceBanner title="Contrôle des risques" description="Points à traiter selon l'appétence et la revue périodique paramétrées par la société." />
      <h1 className="text-lg font-semibold">Risques — Contrôle</h1>
      <Kpis items={[["Au-delà de l'appétence sans traitement", appetite.length, appetite.length > 0], ["Jamais évalués", never.length], ["Revues échues", reviews.length, reviews.length > 0],
        ["Actions en retard", late.length, late.length > 0], ["Évalués sans contrôle", uncovered.length]]} />
      {s.appetite_score == null && <p className="text-xs text-muted-foreground">Appétence non paramétrée : la renseigner dans les paramètres pour signaler les risques à traiter.</p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Liste testId="risk-control-appetite" titre="Au-delà de l'appétence, sans traitement" lignes={appetite.map((r) => [r.risk_code, r.title, `score ${netScore(r)} > ${s.appetite_score}`])} />
        <Liste testId="risk-control-reviews" titre="Revues échues" lignes={reviews.map((r) => [r.risk_code, r.title, r.review_date ?? ""])} />
        <Liste testId="risk-control-actions" titre="Actions en retard" lignes={late.map((a) => [code.get(a.risk_id) ?? "", a.title, a.due_date ?? ""])} />
        <Liste testId="risk-control-never" titre="Jamais évalués" lignes={never.map((r) => [r.risk_code, r.title, r.created_at.slice(0, 10)])} />
        <Liste testId="risk-control-uncovered" titre="Évalués sans contrôle rattaché" lignes={uncovered.map((r) => [r.risk_code, r.title, ""])} />
        <Liste testId="risk-control-accepted" titre="Risques acceptés (motif)" lignes={accepted.map((r) => [r.risk_code, r.title, r.status_reason ?? ""])} />
      </div>
    </PageShell>
  );
}
