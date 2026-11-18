import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { ExportButtons } from "@/components/ExportButtons";
import { DocumentPrintButtons } from "@/components/DocumentDetail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useMyAccess } from "@/hooks/use-my-access";
import { useGLAccounts } from "@/hooks/use-gl-data";
import {
  useBudgetApprove, useBudgetClose, useBudgetLinesOf, useBudgetList, useBudgetReject, useBudgetReviseLine, useBudgetStatus, useBudgetSubmit,
  useCreateBudgetV73, useDeleteBudgetLine, useSaveBudgetLine, type Budget, type BudgetLine,
  useBudgetControlSettings, useBudgetRevisionDecide, useImportBudgetLines, usePendingBudgetRevisions, useBudgetScenarios, DEFAULT_BUDGET_SETTINGS,
} from "@/hooks/use-budget-control";
import { exportToXLSX } from "@/lib/xlsx";
import { readTableFile, TABLE_FILE_ACCEPT } from "@/lib/table-file";
import { budgetImportRows } from "@/lib/budget-import";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAnalyticsSetup } from "@/hooks/use-analytics-setup";
import { consumptionPct, totals } from "@/lib/budget-forecast";

/*
 * Budget → Transactions (V73, lot B1) : budgets réels (brouillon → soumis → approuvé par une autre
 * personne → clos), lignes compte × période (année ou mois ; un compte couvre ses sous-comptes),
 * révision motivée d'une ligne approuvée, et suivi engagé / réalisé / disponible du budget de contrôle.
 */
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const STATUS: Record<string, [string, string]> = { draft: ["neutral", "Brouillon"], submitted: ["warning", "Soumis"], approved: ["success", "Approuvé"], closed: ["neutral", "Clos"] };
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const periodLabel = (p: string) => (p.length === 4 ? `Année ${p}` : `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`);
const year = String(new Date().getFullYear());

export default function BudgetTransactions() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "availability" ? "availability" : "budgets";
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Budget et prévisions", href: "/budget" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Budgets et contrôle budgétaire" description="Le budget approuvé de l'exercice sert au contrôle : chaque demande d'achat soumise le pré-engage, chaque commande approuvée l'engage, chaque écriture le consomme. Le disponible = budget − pré-engagé − engagé − réalisé, par compte et, si la ligne en porte une, par section analytique ; selon les paramètres, une pièce au-delà est signalée ou bloquée." />
      <div className="flex gap-1 border-b border-border" role="tablist">
        {([["budgets", "Budgets"], ["availability", "Engagé et disponible"]] as const).map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setParams({ tab: v })}
            className={cn("px-3 py-2 text-xs border-b-2 -mb-px", tab === v ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "budgets" ? <BudgetsTab /> : <AvailabilityTab />}
    </PageShell>
  );
}

function BudgetsTab() {
  const { user } = useAuth();
  const { data: access } = useMyAccess();
  const p = access?.permissions ?? [];
  const can = { manage: p.includes("budget.manage"), approve: p.includes("budget.approve"), export: p.includes("budget.export") };
  const { data: budgets = [], isPending } = useBudgetList();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get("budget"));
  const [creating, setCreating] = useState(false);
  const budget = budgets.find((b) => b.id === selected) ?? budgets[0] ?? null;
  const { data: scenarios = [] } = useBudgetScenarios();
  const scenarioName = new Map(scenarios.map((s) => [s.code, s.name]));
  if (isPending) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{budgets.length} budget(s)</p>
        {can.manage && <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5" /> Nouveau budget</Button>}
      </div>
      <div className="card-elevated overflow-x-auto">
        <table className="w-full text-xs" data-testid="budgets">
          <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Budget</th><th className="text-left">Exercice</th><th className="text-left">Scénario</th><th className="text-right">Total</th><th className="text-left pl-3">État</th></tr></thead>
          <tbody>
            {budgets.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Aucun budget : créez celui de l'exercice.</td></tr>}
            {budgets.map((b) => (
              <tr key={b.id} data-testid="budget-row" onClick={() => setSelected(b.id)} className={cn("border-t border-border/50 cursor-pointer hover:bg-muted/30", budget?.id === b.id && "bg-primary/5")}>
                <td className="p-2 font-medium">{b.name}</td><td>{b.fiscal_year}</td><td>{scenarioName.get(b.scenario) ?? b.scenario}</td><td className="text-right tabular-nums">{fmt(b.total_amount)}</td>
                <td className="pl-3 space-x-1"><StatusBadge status={STATUS[b.status][0]} label={STATUS[b.status][1]} />{b.is_control && <StatusBadge status="info" label="Contrôle" />}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
      {budget && <BudgetDetail budget={budget} can={can} userId={user?.id ?? ""} />}
      {creating && <CreateBudgetDialog onClose={() => setCreating(false)} onCreated={(id) => { setSelected(id); setCreating(false); }} />}
    </div>
  );
}

function CreateBudgetDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const create = useCreateBudgetV73();
  const { data: scenarios = [] } = useBudgetScenarios();
  const active = scenarios.filter((s) => s.is_active);
  const [f, setF] = useState({ name: `Budget ${year}`, fiscal_year: year, scenario: "" });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">Nouveau budget</DialogTitle><DialogDescription className="text-xs">Créé en brouillon ; saisissez ses lignes puis soumettez-le.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="bg-name">Nom du budget</Label><Input id="bg-name" className="h-8 text-xs" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="bg-year">Exercice</Label><Input id="bg-year" className="h-8 text-xs" maxLength={4} value={f.fiscal_year} onChange={(e) => setF({ ...f, fiscal_year: e.target.value })} /></div>
          <div className="col-span-3 space-y-1.5"><Label className="text-xs" htmlFor="bg-scenario">Scénario</Label>
            <select id="bg-scenario" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.scenario} onChange={(e) => setF({ ...f, scenario: e.target.value })}>
              <option value="">{active[0] ? `Par défaut (${active[0].name})` : "Par défaut"}</option>
              {active.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
            <p className="text-[10px] text-muted-foreground">Scénarios : Budget → Données de base.</p></div>
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!f.name.trim() || !/^\d{4}$/.test(f.fiscal_year) || create.isPending} onClick={() => create.mutate({ ...f, scenario: f.scenario || undefined }, { onSuccess: onCreated })}>Créer le budget</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Code de section relu par l'import : « CODE », ou « AXE/CODE » si le code existe sur plusieurs axes. */
function useSectionCodes() {
  const { data: setup } = useAnalyticsSetup();
  return useMemo(() => {
    const all = (setup?.axes ?? []).flatMap((a) => a.values.map((v) => ({ axis: a.code, id: v.id, code: v.code })));
    const count = new Map<string, number>();
    for (const v of all) count.set(v.code.toUpperCase(), (count.get(v.code.toUpperCase()) ?? 0) + 1);
    return new Map(all.map((v) => [v.id, (count.get(v.code.toUpperCase()) ?? 0) > 1 ? `${v.axis}/${v.code}` : v.code]));
  }, [setup]);
}

function BudgetDetail({ budget, can, userId }: { budget: Budget; can: { manage: boolean; approve: boolean; export: boolean }; userId: string }) {
  const { data: lines = [] } = useBudgetLinesOf(budget.id);
  const { data: gl = [] } = useGLAccounts();
  const byId = useMemo(() => new Map((gl as any[]).map((g) => [g.id, g])), [gl]);
  const { data: setup } = useAnalyticsSetup();
  const sectionLabel = useMemo(() => new Map((setup?.axes ?? []).flatMap((a) => a.values.map((v) => [v.id, `${v.code} ${v.name}`] as [string, string]))), [setup]);
  const submit = useBudgetSubmit(), approve = useBudgetApprove(), reject = useBudgetReject(), close = useBudgetClose(), del = useDeleteBudgetLine();
  const [edit, setEdit] = useState<BudgetLine | "new" | null>(null);
  const [revise, setRevise] = useState<BudgetLine | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const sectionCode = useSectionCodes();
  const importLines = useImportBudgetLines();
  const { data: settings } = useBudgetControlSettings();
  const { data: pending = [] } = usePendingBudgetRevisions(budget.status === "approved" ? budget.id : null);
  const decide = useBudgetRevisionDecide();
  const [refusing, setRefusing] = useState<string | null>(null);
  // Révision : directe pour l'approbateur ; demande possible pour le préparateur si les paramètres l'organisent.
  const canRevise = can.approve || (can.manage && !!settings?.revision_second_person);
  const draft = budget.status === "draft";
  const modele = () => {
    const types = settings?.budgetable_types ?? DEFAULT_BUDGET_SETTINGS.budgetable_types;
    const accounts = (gl as any[]).filter((g) => g.is_active && types.includes(g.account_type)).sort((a, b) => a.code.localeCompare(b.code));
    const rows = lines.length
      ? lines.map((l) => ({ compte: byId.get(l.gl_account_id)?.code ?? "", intitule: byId.get(l.gl_account_id)?.name ?? "",
          section: l.analytic_value_id ? sectionCode.get(l.analytic_value_id) ?? "" : "", periode: l.period, montant: l.planned_amount as number | string, commentaire: "" }))
      : accounts.map((g) => ({ compte: g.code, intitule: g.name, section: "", periode: budget.fiscal_year, montant: "" as number | string, commentaire: "" }));
    exportToXLSX(rows, [{ key: "compte", header: "Compte", width: 12 }, { key: "intitule", header: "Intitulé", width: 40 }, { key: "section", header: "Section", width: 16 },
      { key: "periode", header: "Période", width: 12 }, { key: "montant", header: "Montant", width: 16 }, { key: "commentaire", header: "Commentaire", width: 30 }],
      `modele-budget-${budget.fiscal_year}`, "Budget");
  };
  const importer = async (file: File | undefined) => {
    if (!file) return;
    try {
      const t = await readTableFile(file);
      const r = budgetImportRows(t.records, t.headers, budget.fiscal_year, true);
      if (r.missing.length) { toast.error(`Colonne(s) introuvable(s) : ${r.missing.join(", ")}. Partir du modèle de budget.`); return; }
      if (!r.rows.length) { toast.error("Aucune ligne avec un montant dans le fichier"); return; }
      if (lines.length && !window.confirm(`Les ${lines.length} ligne(s) du budget seront remplacées par les ${r.rows.length} ligne(s) du fichier. Continuer ?`)) return;
      importLines.mutate({ budget: budget.id, rows: r.rows });
    } catch (e) { toast.error((e as Error).message); }
  };
  const own = userId === budget.created_by || userId === budget.submitted_by;
  return (
    <section aria-label="Détail du budget" className="card-elevated p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div><h2 className="text-sm font-semibold">{budget.name} — exercice {budget.fiscal_year}</h2>
          <p className="text-xs text-muted-foreground" data-testid="budget-summary">{STATUS[budget.status][1]}{budget.is_control ? " · budget de contrôle" : ""} · {lines.length} ligne(s) · total {fmt(budget.total_amount)}</p>
          {budget.status === "submitted" && own && can.approve && <p className="text-[11px] text-muted-foreground">Vous avez préparé ce budget : une autre personne doit l'approuver.</p>}</div>
        <div className="flex gap-2 flex-wrap">
          {can.export && <DocumentPrintButtons testId="budget-print" disabled={lines.length === 0} build={() => ({
            title: `Budget ${budget.name}`, fileName: `budget-${budget.fiscal_year}-${budget.name}`, amountInWords: false,
            subtitle: `Exercice ${budget.fiscal_year} · ${STATUS[budget.status][1]}${budget.is_control ? " · budget de contrôle" : ""}`,
            header: [["Exercice", budget.fiscal_year], ["Statut", STATUS[budget.status][1]], ["Budget de contrôle", budget.is_control ? "Oui" : "Non"],
              ["Approuvé le", budget.approved_at ? new Date(budget.approved_at).toLocaleDateString("fr-FR") : "—"]],
            columns: [{ label: "Compte" }, { label: "Intitulé" }, { label: "Section" }, { label: "Période" }, { label: "Montant", align: "right" }],
            rows: lines.map((l) => [byId.get(l.gl_account_id)?.code ?? "", byId.get(l.gl_account_id)?.name ?? "",
              l.analytic_value_id ? sectionLabel.get(l.analytic_value_id) ?? "" : "Toutes", periodLabel(l.period), fmt(l.planned_amount)]),
            footer: [["Total des lignes", fmt(lines.reduce((t, l) => t + l.planned_amount, 0)), true]],
            notes: "Un compte couvre ses sous-comptes ; une ligne de section couvre ses sous-sections.",
            signatures: ["Préparé par", "Approuvé par"],
          })} />}
          {can.export && <ExportButtons label="Exporter le budget" filename={`budget-${budget.fiscal_year}`} sheetName="Budget"
            rows={lines.map((l) => ({ compte: byId.get(l.gl_account_id)?.code ?? "", intitule: byId.get(l.gl_account_id)?.name ?? "",
              section: l.analytic_value_id ? sectionCode.get(l.analytic_value_id) ?? "" : "", periode: l.period, montant: l.planned_amount }))}
            columns={[{ key: "compte", header: "Compte", width: 12 }, { key: "intitule", header: "Intitulé", width: 40 }, { key: "section", header: "Section", width: 16 },
              { key: "periode", header: "Période", width: 12 }, { key: "montant", header: "Montant", width: 16 }]} />}
          {draft && can.manage && <>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={modele}>Modèle de budget (Excel)</Button>
            <label className="inline-flex items-center h-8 px-3 rounded-md border border-input bg-background text-xs cursor-pointer hover:bg-muted/50">
              {importLines.isPending ? "Import…" : "Importer le budget"}
              <input type="file" className="sr-only" accept={TABLE_FILE_ACCEPT} aria-label="Importer le budget (Excel ou CSV)"
                onChange={(e) => { void importer(e.target.files?.[0]); e.target.value = ""; }} />
            </label></>}
          {draft && can.manage && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEdit("new")}>Ajouter une ligne</Button>}
          {draft && can.manage && <Button size="sm" className="h-8 text-xs" disabled={submit.isPending || lines.length === 0} onClick={() => submit.mutate(budget.id)}>Soumettre</Button>}
          {budget.status === "submitted" && can.approve && !own && <>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setRejecting(true)}>Renvoyer</Button>
            <Button size="sm" className="h-8 text-xs" disabled={approve.isPending} onClick={() => approve.mutate(budget.id)}>Approuver</Button></>}
          {budget.status === "approved" && can.approve && <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={close.isPending} onClick={() => close.mutate(budget.id)}>Clore</Button>}
        </div>
      </div>
      <table className="w-full text-xs" data-testid="budget-lines">
        <thead><tr className="text-muted-foreground border-b border-border"><th className="text-left p-1">Compte</th><th className="text-left">Section</th><th className="text-left">Période</th><th className="text-right">Montant</th><th /></tr></thead>
        <tbody>
          {lines.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">Aucune ligne.</td></tr>}
          {lines.map((l) => (
            <tr key={l.id} data-testid="budget-line" className="border-b border-border/50">
              <td className="p-1"><span className="font-mono">{byId.get(l.gl_account_id)?.code}</span> {byId.get(l.gl_account_id)?.name}</td>
              <td>{l.analytic_value_id ? sectionLabel.get(l.analytic_value_id) ?? "—" : "Toutes"}</td><td>{periodLabel(l.period)}</td>
              <td className="text-right tabular-nums">{fmt(l.planned_amount)}</td>
              <td className="pl-2 text-right whitespace-nowrap">
                {draft && can.manage && <><Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEdit(l)}>Modifier</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => del.mutate(l.id)}>Supprimer</Button></>}
                {budget.status === "approved" && canRevise && !pending.some((r) => r.line_id === l.id) &&
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setRevise(l)}>Réviser</Button>}
                {pending.filter((r) => r.line_id === l.id).map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1" data-testid="budget-revision-pending">
                    <span className="text-[10px] text-warning" title={r.reason}>Révision demandée : {fmt(r.old_amount)} → {fmt(r.new_amount)}</span>
                    {can.approve && r.created_by !== userId && <>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-success" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: true })}>Valider</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" onClick={() => setRefusing(r.id)}>Refuser</Button></>}
                    {r.created_by === userId && <span className="text-[10px] text-muted-foreground">(vous : une autre personne valide)</span>}
                  </span>))}
              </td>
            </tr>))}
        </tbody>
      </table>
      {edit && <LineDialog budget={budget} line={edit === "new" ? null : edit} gl={gl as any[]} onClose={() => setEdit(null)} />}
      {revise && <ReviseDialog line={revise} label={byId.get(revise.gl_account_id)?.code ?? ""} onClose={() => setRevise(null)} />}
      {refusing && <ReasonDialog title="Refuser la demande de révision" action="Refuser" onClose={() => setRefusing(null)}
        onConfirm={(r) => decide.mutate({ id: refusing, approve: false, comment: r }, { onSuccess: () => setRefusing(null) })} />}
      {rejecting && <ReasonDialog title="Renvoyer le budget en brouillon" action="Renvoyer" onClose={() => setRejecting(false)} onConfirm={(r) => reject.mutate({ id: budget.id, reason: r }, { onSuccess: () => setRejecting(false) })} />}
    </section>
  );
}

function LineDialog({ budget, line, gl, onClose }: { budget: Budget; line: BudgetLine | null; gl: any[]; onClose: () => void }) {
  const save = useSaveBudgetLine();
  const { data: settings } = useBudgetControlSettings();
  const types = settings?.budgetable_types ?? DEFAULT_BUDGET_SETTINGS.budgetable_types;
  const accounts = gl.filter((g) => g.is_active && types.includes(g.account_type)).sort((a, b) => a.code.localeCompare(b.code));
  const [f, setF] = useState({ account: line?.gl_account_id ?? "", period: line?.period ?? budget.fiscal_year, amount: line ? String(line.planned_amount) : "",
    section: line?.analytic_value_id ?? "" });
  const n = Number(f.amount.replace(",", "."));
  const { data: setup } = useAnalyticsSetup();
  const axes = (setup?.axes ?? []).filter((a) => a.active);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-sm">{line ? "Modifier la ligne" : "Nouvelle ligne de budget"}</DialogTitle>
          <DialogDescription className="text-xs">Un compte couvre ses sous-comptes (« 60 » contrôle 601, 604…). Période : l'année, ou un mois si le contrôle est mensuel. Comptes proposés : les types budgétables des paramètres.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3 space-y-1.5"><Label className="text-xs" htmlFor="bl-account">Compte</Label>
            <select id="bl-account" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}>
              <option value="">— choisir —</option>{accounts.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}</select></div>
          {axes.length > 0 && <div className="col-span-3 space-y-1.5"><Label className="text-xs" htmlFor="bl-section">Section analytique</Label>
            <select id="bl-section" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })}>
              <option value="">Toutes les sections (budget général du compte)</option>
              {axes.map((a) => <optgroup key={a.id} label={a.name}>{a.values.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.code} — {v.name}</option>)}</optgroup>)}
            </select>
            <p className="text-[10px] text-muted-foreground">Une section couvre ses sous-sections ; la pièce doit tenir dans le budget général et dans celui de sa section.</p></div>}
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="bl-period">Période</Label>
            <select id="bl-period" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>
              <option value={budget.fiscal_year}>Année {budget.fiscal_year}</option>
              {MONTHS.map((m, i) => <option key={m} value={`${budget.fiscal_year}-${String(i + 1).padStart(2, "0")}`}>{m} {budget.fiscal_year}</option>)}</select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="bl-amount">Montant</Label><Input id="bl-amount" inputMode="decimal" className="h-8 text-xs text-right" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!f.account || !(n >= 0) || f.amount === "" || save.isPending}
            onClick={() => save.mutate({ id: line?.id, budget_id: budget.id, gl_account_id: f.account, period: f.period, planned_amount: n, analytic_value_id: f.section || null }, { onSuccess: onClose })}>Enregistrer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviseDialog({ line, label, onClose }: { line: BudgetLine; label: string; onClose: () => void }) {
  const revise = useBudgetReviseLine();
  const [amount, setAmount] = useState(String(line.planned_amount));
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">Réviser la ligne {label} — {periodLabel(line.period)}</DialogTitle>
          <DialogDescription className="text-xs">Complément ou restitution de budget : l'ancien et le nouveau montant sont conservés avec le motif.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="rv-amount">Nouveau montant</Label><Input id="rv-amount" inputMode="decimal" className="h-8 text-xs text-right" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="rv-reason">Motif</Label><Input id="rv-reason" className="h-8 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!reason.trim() || revise.isPending} onClick={() => revise.mutate({ line: line.id, amount: Number(amount.replace(",", ".")), reason }, { onSuccess: onClose })}>Réviser</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({ title, action, onClose, onConfirm }: { title: string; action: string; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle><DialogDescription className="text-xs">Le motif est obligatoire.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label className="text-xs" htmlFor="rs-reason">Motif</Label><Input id="rs-reason" className="h-8 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Annuler</Button><Button size="sm" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>{action}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AvailabilityTab() {
  const [fy, setFy] = useState(year);
  const { data: rows = [], isFetching, error } = useBudgetStatus(fy);
  const canExport = (useMyAccess().data?.permissions ?? []).includes("budget.export");
  // Totaux sur les lignes non couvertes par une autre (« 60 » et « 601 », ou une section et le budget général, ne s'additionnent pas).
  const total = totals(rows);
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="space-y-1"><Label className="text-xs" htmlFor="av-year">Exercice</Label><Input id="av-year" className="h-8 text-xs w-24" maxLength={4} value={fy} onChange={(e) => setFy(e.target.value)} /></div>
        {canExport && <ExportButtons label="Exporter le suivi" filename={`suivi-budgetaire-${fy}`} sheetName="Suivi budgétaire"
          rows={rows.map((r) => ({ compte: r.account_code, intitule: r.account_name, section: r.analytic_code ? `${r.analytic_code} ${r.analytic_name}` : "Toutes", periode: periodLabel(r.period),
            budget: r.planned, preengage: r.precommitted, engage: r.committed, realise: r.actual, disponible: r.available }))}
          columns={[{ key: "compte", header: "Compte", width: 12 }, { key: "intitule", header: "Intitulé", width: 36 }, { key: "section", header: "Section", width: 24 }, { key: "periode", header: "Période", width: 18 },
            { key: "budget", header: "Budget", width: 16 }, { key: "preengage", header: "Pré-engagé", width: 16 }, { key: "engage", header: "Engagé", width: 16 }, { key: "realise", header: "Réalisé", width: 16 },
            { key: "disponible", header: "Disponible", width: 16 }]} />}
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{(error as Error).message}</p>}
      {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-xs" data-testid="budget-availability">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Compte</th><th className="text-left">Section</th><th className="text-left">Période</th><th className="text-right">Budget</th>
              <th className="text-right">Pré-engagé</th><th className="text-right">Engagé</th><th className="text-right">Réalisé</th><th className="text-right">Disponible</th><th className="text-right pr-2">Consommé</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">Aucun budget de contrôle approuvé pour {fy}.</td></tr>}
              {rows.map((r) => {
                const pct = Math.round(consumptionPct(r) ?? 0);
                return (
                  <tr key={r.line_id} data-testid="budget-availability-row" className="border-t border-border/50">
                    <td className="p-2"><span className="font-mono">{r.account_code}</span> {r.account_name}</td>
                    <td>{r.analytic_code ? `${r.analytic_code} ${r.analytic_name}` : "Toutes"}</td><td>{periodLabel(r.period)}</td>
                    <td className="text-right tabular-nums">{fmt(r.planned)}</td><td className="text-right tabular-nums">{fmt(r.precommitted)}</td>
                    <td className="text-right tabular-nums">{fmt(r.committed)}</td><td className="text-right tabular-nums">{fmt(r.actual)}</td>
                    <td className={cn("text-right tabular-nums font-medium", r.available < 0 && "text-destructive")}>{fmt(r.available)}</td>
                    <td className={cn("text-right tabular-nums pr-2", pct > 100 ? "text-destructive" : pct > 90 ? "text-warning" : "")}>{pct} %</td>
                  </tr>);
              })}
              {rows.length > 0 && <tr className="border-t border-border font-semibold bg-muted/20"><td className="p-2" colSpan={3} title="Lignes non couvertes par une autre ligne">Total (sans double compte)</td>
                <td className="text-right tabular-nums">{fmt(total.planned)}</td><td className="text-right tabular-nums">{fmt(total.precommitted)}</td>
                <td className="text-right tabular-nums">{fmt(total.committed)}</td><td className="text-right tabular-nums">{fmt(total.actual)}</td>
                <td className="text-right tabular-nums">{fmt(total.available)}</td><td /></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
