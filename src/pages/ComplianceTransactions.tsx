import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useControls, useControlTests, useFrameworks, useGrcPerms, useIssues, useRecordTest, useUpdateIssue, type Control, type Issue } from "@/hooks/use-grc";
import { CONTROL_STATUS, FREQUENCY, isOverdue, ISSUE_STATUS, SEVERITY, TEST_RESULT, type RiskLevel, type TestResult } from "@/lib/grc";

/* Conformité → Transactions : contrôles à tester (enregistrer un test), journal des tests, constats et leur remédiation. */
const today = () => new Date().toISOString().slice(0, 10);
const sel = "h-8 rounded-md border border-input bg-background px-2 text-xs";

function TestDialog({ control, onClose }: { control: Control; onClose: () => void }) {
  const record = useRecordTest();
  const [f, setF] = useState({ date: today(), result: "pass" as TestResult, findings: "0", notes: "", issue: true, issue_title: "", severity: "medium" as RiskLevel, due: "", owner: "" });
  const failing = f.result === "partial" || f.result === "fail";
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="text-sm">Test du contrôle {control.control_code}</DialogTitle>
          <DialogDescription className="text-xs">{control.title}{control.test_procedure ? ` — procédure : ${control.test_procedure}` : ""}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><label htmlFor="t-date" className="text-xs font-medium">Date du test</label>
            <Input id="t-date" type="date" max={today()} className="h-8 text-xs" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor="t-result" className="text-xs font-medium">Résultat</label>
            <select id="t-result" className={`${sel} w-full`} value={f.result} onChange={(e) => setF({ ...f, result: e.target.value as TestResult })}>
              {(Object.keys(TEST_RESULT) as TestResult[]).map((r) => <option key={r} value={r}>{TEST_RESULT[r][1]}</option>)}</select></div>
          <div className="space-y-1"><label htmlFor="t-findings" className="text-xs font-medium">Anomalies relevées</label>
            <Input id="t-findings" inputMode="numeric" className="h-8 text-xs" value={f.findings} onChange={(e) => setF({ ...f, findings: e.target.value })} /></div>
          <div className="space-y-1 col-span-2"><label htmlFor="t-notes" className="text-xs font-medium">Constatations{failing ? " *" : ""}</label>
            <Input id="t-notes" className="h-8 text-xs" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
          {failing && <>
            <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={f.issue} onChange={(e) => setF({ ...f, issue: e.target.checked })} /> Ouvrir un constat de remédiation</label>
            {f.issue && <>
              <div className="space-y-1 col-span-2"><label htmlFor="t-issue" className="text-xs font-medium">Intitulé du constat *</label>
                <Input id="t-issue" className="h-8 text-xs" value={f.issue_title} onChange={(e) => setF({ ...f, issue_title: e.target.value })} /></div>
              <div className="space-y-1"><label htmlFor="t-sev" className="text-xs font-medium">Gravité</label>
                <select id="t-sev" className={`${sel} w-full`} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as RiskLevel })}>
                  {(["low", "medium", "high", "critical"] as RiskLevel[]).map((s) => <option key={s} value={s}>{SEVERITY[s][1]}</option>)}</select></div>
              <div className="space-y-1"><label htmlFor="t-due" className="text-xs font-medium">Échéance de remédiation</label>
                <Input id="t-due" type="date" className="h-8 text-xs" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></div>
              <div className="space-y-1 col-span-2"><label htmlFor="t-owner" className="text-xs font-medium">Responsable de la remédiation</label>
                <Input id="t-owner" className="h-8 text-xs" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></div>
            </>}
          </>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={record.isPending || (failing && !f.notes.trim()) || (failing && f.issue && !f.issue_title.trim())}
            onClick={() => record.mutate({ control: control.id, date: f.date, result: f.result, findings: Number(f.findings) || 0, notes: f.notes,
              ...(failing && f.issue ? { issue_title: f.issue_title, issue_severity: f.severity, issue_due: f.due, issue_owner: f.owner } : {}) }, { onSuccess: onClose })}>Enregistrer le test</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueDialog({ issue, control, onClose }: { issue: Issue; control?: Control; onClose: () => void }) {
  const perms = useGrcPerms();
  const update = useUpdateIssue();
  const [notes, setNotes] = useState(issue.closure_notes ?? "");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle className="text-sm">Constat — {issue.title}</DialogTitle>
          <DialogDescription className="text-xs">Contrôle {control?.control_code} · gravité {SEVERITY[issue.severity][1]} · {ISSUE_STATUS[issue.status][1]}
            {issue.due_date ? ` · échéance ${issue.due_date}` : ""}</DialogDescription></DialogHeader>
        {issue.description && <p className="text-xs">{issue.description}</p>}
        {issue.status === "closed" ? <p className="text-xs">Remédiation : {issue.closure_notes} (clôturé le {issue.closed_at?.slice(0, 10)})</p> : (
          <div className="space-y-1"><label htmlFor="i-notes" className="text-xs font-medium">Remédiation (mesures prises)</label>
            <Input id="i-notes" className="h-8 text-xs" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Fermer</Button>
          {issue.status === "open" && (perms.complianceManage || perms.complianceTest) &&
            <Button variant="outline" size="sm" disabled={update.isPending} onClick={() => update.mutate({ issue: issue.id, status: "in_progress", notes }, { onSuccess: onClose })}>Passer en cours</Button>}
          {issue.status !== "closed" && perms.complianceClose &&
            <Button size="sm" disabled={!notes.trim() || update.isPending} onClick={() => update.mutate({ issue: issue.id, status: "closed", notes }, { onSuccess: onClose })}>Clôturer le constat</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ComplianceTransactions() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") ?? "controls") as "controls" | "tests" | "issues";
  const perms = useGrcPerms();
  const { data: frameworks = [] } = useFrameworks();
  const { data: controls = [], isLoading } = useControls();
  const { data: tests = [] } = useControlTests();
  const { data: issues = [] } = useIssues();
  const [testing, setTesting] = useState<Control | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const fw = new Map(frameworks.map((f) => [f.id, f.name]));
  const ctl = new Map(controls.map((c) => [c.id, c]));
  const active = controls.filter((c) => c.is_active).sort((a, b) => (a.next_review_at ?? "0000") < (b.next_review_at ?? "0000") ? -1 : 1);
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Gouvernance" }, { label: "Conformité", href: "/compliance" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Tests et constats" description="L'état d'un contrôle vient de son dernier test ; la prochaine échéance suit sa fréquence. Un constat est clôturé par une autre personne que celle qui l'a relevé (paramétrable)." />
      <h1 className="text-lg font-semibold">Conformité — Transactions</h1>
      <div className="flex gap-1 border-b border-border" role="tablist">
        {([["controls", `Contrôles à tester (${active.length})`], ["tests", `Tests (${tests.length})`], ["issues", `Constats (${issues.filter((i) => i.status !== "closed").length} ouverts)`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`px-3 py-1.5 text-xs border-b-2 ${tab === k ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}
            onClick={() => setParams({ tab: k })}>{l}</button>
        ))}
      </div>
      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <div className="card-elevated overflow-x-auto">
          {tab === "controls" && (
            <table className="w-full text-xs">
              <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Code</th><th className="text-left">Contrôle</th><th className="text-left">Référentiel</th><th className="text-left">Fréquence</th>
                <th className="text-left">État</th><th className="text-left">Dernier test</th><th className="text-left">Échéance</th><th /></tr></thead>
              <tbody>
                {active.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Aucun contrôle : les créer dans Données de base.</td></tr>}
                {active.map((c) => (
                  <tr key={c.id} className="border-t border-border/50" data-testid="control-row">
                    <td className="p-2 font-mono">{c.control_code}</td><td>{c.title}</td><td>{fw.get(c.framework_id)}</td><td>{c.frequency ? FREQUENCY[c.frequency] : "—"}</td>
                    <td><StatusBadge status={CONTROL_STATUS[c.status][0]} label={CONTROL_STATUS[c.status][1]} /></td><td>{c.last_tested_at?.slice(0, 10) ?? "—"}</td>
                    <td className={isOverdue(c.next_review_at, today()) ? "text-destructive" : ""}>{c.next_review_at ?? "—"}</td>
                    <td className="text-right pr-2">{perms.complianceTest && <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setTesting(c)}>Enregistrer un test</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "tests" && (
            <table className="w-full text-xs">
              <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Date</th><th className="text-left">Contrôle</th><th className="text-left">Testeur</th><th className="text-left">Résultat</th>
                <th className="text-right">Anomalies</th><th className="text-left pl-3">Constatations</th></tr></thead>
              <tbody>
                {tests.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Aucun test.</td></tr>}
                {tests.map((t) => (
                  <tr key={t.id} className="border-t border-border/50" data-testid="test-row">
                    <td className="p-2">{t.test_date}</td><td><span className="font-mono">{ctl.get(t.control_id)?.control_code}</span> {ctl.get(t.control_id)?.title}</td><td>{t.tester || "—"}</td>
                    <td><StatusBadge status={TEST_RESULT[t.result][0]} label={TEST_RESULT[t.result][1]} /></td><td className="text-right tabular-nums">{t.findings}</td><td className="pl-3">{t.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "issues" && (
            <table className="w-full text-xs">
              <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Constat</th><th className="text-left">Contrôle</th><th className="text-left">Gravité</th><th className="text-left">Responsable</th>
                <th className="text-left">Échéance</th><th className="text-left">État</th></tr></thead>
              <tbody>
                {issues.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Aucun constat.</td></tr>}
                {issues.map((i) => (
                  <tr key={i.id} className="border-t border-border/50 hover:bg-muted/30 cursor-pointer" data-testid="issue-row" onClick={() => setIssue(i)}>
                    <td className="p-2">{i.title}</td><td className="font-mono">{ctl.get(i.control_id)?.control_code}</td>
                    <td><StatusBadge status={SEVERITY[i.severity][0]} label={SEVERITY[i.severity][1]} /></td><td>{i.owner ?? "—"}</td>
                    <td className={i.status !== "closed" && isOverdue(i.due_date, today()) ? "text-destructive" : ""}>{i.due_date ?? "—"}</td>
                    <td><StatusBadge status={ISSUE_STATUS[i.status][0]} label={ISSUE_STATUS[i.status][1]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {testing && <TestDialog control={testing} onClose={() => setTesting(null)} />}
      {issue && <IssueDialog issue={issue} control={ctl.get(issue.control_id)} onClose={() => setIssue(null)} />}
    </PageShell>
  );
}
