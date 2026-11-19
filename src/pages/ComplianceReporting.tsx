import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { ExportButtons } from "@/components/ExportButtons";
import { useControls, useControlTests, useFrameworks, useGrcPerms, useIssues } from "@/hooks/use-grc";
import { CONTROL_STATUS, FREQUENCY, ISSUE_STATUS, SEVERITY, TEST_RESULT } from "@/lib/grc";

/* Conformité → Rapports : matrice des contrôles, journal des tests et constats, exportables. */
export default function ComplianceReporting() {
  const perms = useGrcPerms();
  const { data: frameworks = [] } = useFrameworks();
  const { data: controls = [] } = useControls();
  const { data: tests = [] } = useControlTests();
  const { data: issues = [] } = useIssues();
  const fw = new Map(frameworks.map((f) => [f.id, f.name]));
  const ctl = new Map(controls.map((c) => [c.id, c]));
  const matrix = controls.map((c) => ({ referentiel: fw.get(c.framework_id) ?? "", code: c.control_code, controle: c.title, processus: c.category ?? "", responsable: c.owner ?? "",
    frequence: c.frequency ? FREQUENCY[c.frequency] : "Ponctuelle", etat: c.is_active ? CONTROL_STATUS[c.status][1] : "Inactif", dernier_test: c.last_tested_at?.slice(0, 10) ?? "",
    echeance: c.next_review_at ?? "", constats_ouverts: issues.filter((i) => i.control_id === c.id && i.status !== "closed").length }));
  const testRows = tests.map((t) => ({ date: t.test_date, code: ctl.get(t.control_id)?.control_code ?? "", controle: ctl.get(t.control_id)?.title ?? "", testeur: t.tester,
    resultat: TEST_RESULT[t.result][1], anomalies: t.findings, constatations: t.notes ?? "" }));
  const issueRows = issues.map((i) => ({ constat: i.title, code: ctl.get(i.control_id)?.control_code ?? "", gravite: SEVERITY[i.severity][1], responsable: i.owner ?? "",
    echeance: i.due_date ?? "", etat: ISSUE_STATUS[i.status][1], remediation: i.closure_notes ?? "", cloture: i.closed_at?.slice(0, 10) ?? "" }));
  const cols = (headers: Record<string, string>) => Object.keys(headers).map((key) => ({ key, header: headers[key] }));
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Gouvernance" }, { label: "Conformité", href: "/compliance" }, { label: "Rapports" }]} />
      <GuidanceBanner title="Rapports de conformité" description="Matrice des contrôles avec leur dernier test, journal des tests et constats : la piste d'audit du contrôle interne." />
      <h1 className="text-lg font-semibold">Conformité — Rapports</h1>
      {!perms.complianceExport && <p className="text-xs text-muted-foreground">Droit « compliance.export » requis pour exporter.</p>}
      {perms.complianceExport && (
        <div className="grid gap-3 md:grid-cols-3">
          {([["Matrice des contrôles", matrix, "matrice-des-controles", { referentiel: "Référentiel", code: "Code", controle: "Contrôle", processus: "Processus", responsable: "Responsable",
              frequence: "Fréquence", etat: "État", dernier_test: "Dernier test", echeance: "Échéance", constats_ouverts: "Constats ouverts" }],
            ["Journal des tests", testRows, "journal-des-tests", { date: "Date", code: "Code", controle: "Contrôle", testeur: "Testeur", resultat: "Résultat", anomalies: "Anomalies", constatations: "Constatations" }],
            ["Constats", issueRows, "constats-de-conformite", { constat: "Constat", code: "Contrôle", gravite: "Gravité", responsable: "Responsable", echeance: "Échéance", etat: "État",
              remediation: "Remédiation", cloture: "Clôturé le" }]] as const).map(([title, rows, file, headers]) => (
            <div key={file} className="bg-card border border-border rounded-lg p-3 space-y-2">
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="text-xs text-muted-foreground">{rows.length} ligne(s)</p>
              <ExportButtons label={title} rows={rows as unknown as Record<string, unknown>[]} filename={file} columns={cols(headers as Record<string, string>)} />
            </div>
          ))}
        </div>
      )}
      <div className="card-elevated overflow-x-auto">
        <table className="w-full text-xs" data-testid="compliance-matrix">
          <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Référentiel</th><th className="text-left">Code</th><th className="text-left">Contrôle</th><th className="text-left">État</th>
            <th className="text-left">Dernier test</th><th className="text-left">Échéance</th><th className="text-right pr-3">Constats ouverts</th></tr></thead>
          <tbody>
            {matrix.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucun contrôle.</td></tr>}
            {matrix.map((m) => <tr key={`${m.referentiel}-${m.code}`} className="border-t border-border/50"><td className="p-2">{m.referentiel}</td><td className="font-mono">{m.code}</td><td>{m.controle}</td>
              <td>{m.etat}</td><td>{m.dernier_test || "—"}</td><td>{m.echeance || "—"}</td><td className="text-right pr-3 tabular-nums">{m.constats_ouverts || ""}</td></tr>)}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
