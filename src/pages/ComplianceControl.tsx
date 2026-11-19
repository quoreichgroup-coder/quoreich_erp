import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Kpis } from "@/components/GrcWidgets";
import { useControls, useIssues } from "@/hooks/use-grc";
import { isOverdue, SEVERITY } from "@/lib/grc";

/* Conformité → Contrôle : contrôles déficients, jamais testés, tests échus, constats en retard ou graves. */
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

export default function ComplianceControl() {
  const { data: controls = [] } = useControls();
  const { data: issues = [] } = useIssues();
  const active = controls.filter((c) => c.is_active);
  const code = new Map(controls.map((c) => [c.id, c.control_code]));
  const deficient = active.filter((c) => c.status === "deficient" || c.status === "partially_effective");
  const never = active.filter((c) => c.status === "not_tested");
  const due = active.filter((c) => isOverdue(c.next_review_at, today()));
  const open = issues.filter((i) => i.status !== "closed");
  const late = open.filter((i) => isOverdue(i.due_date, today()));
  const grave = open.filter((i) => i.severity === "high" || i.severity === "critical");
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Gouvernance" }, { label: "Conformité", href: "/compliance" }, { label: "Contrôle" }]} />
      <GuidanceBanner title="Contrôle de la conformité" description="Ce qui doit être testé ou remédié, d'après les fréquences et les échéances des contrôles et constats." />
      <h1 className="text-lg font-semibold">Conformité — Contrôle</h1>
      <Kpis items={[["Contrôles déficients ou partiels", deficient.length, deficient.length > 0], ["Jamais testés", never.length], ["Tests échus", due.length, due.length > 0],
        ["Constats en retard", late.length, late.length > 0], ["Constats graves ouverts", grave.length, grave.length > 0]]} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Liste testId="cc-deficient" titre="Contrôles déficients ou partiellement efficaces" lignes={deficient.map((c) => [c.control_code, c.title, c.last_tested_at?.slice(0, 10) ?? ""])} />
        <Liste testId="cc-due" titre="Tests échus" lignes={due.map((c) => [c.control_code, c.title, c.next_review_at ?? ""])} />
        <Liste testId="cc-never" titre="Contrôles jamais testés" lignes={never.map((c) => [c.control_code, c.title, ""])} />
        <Liste testId="cc-late" titre="Constats en retard de remédiation" lignes={late.map((i) => [code.get(i.control_id) ?? "", i.title, i.due_date ?? ""])} />
        <Liste testId="cc-grave" titre="Constats graves ouverts" lignes={grave.map((i) => [code.get(i.control_id) ?? "", i.title, SEVERITY[i.severity][1]])} />
      </div>
    </PageShell>
  );
}
