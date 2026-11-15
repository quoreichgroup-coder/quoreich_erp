import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { ExportButtons } from "@/components/ExportButtons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMyAccess } from "@/hooks/use-my-access";
import { useAnalyticsSetup } from "@/hooks/use-analytics-setup";
import {
  useBudgetableAccounts, useBudgetControlSettings, useBudgetList, useBudgetScenarios, useBudgetStatus, useDeleteBudgetScenario, useSaveBudgetScenario,
  DEFAULT_BUDGET_SETTINGS, type BudgetScenario,
} from "@/hooks/use-budget-control";
import { cn } from "@/lib/utils";

/*
 * Budget → Données de base (V79) : budgets de la société (tous exercices), scénarios (paramétrables,
 * désactivables), comptes budgétables (selon les types des paramètres) et sections analytiques. Tout vient de la
 * base ; aucune donnée de démonstration.
 */
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const STATUS: Record<string, [string, string]> = { draft: ["neutral", "Brouillon"], submitted: ["warning", "Soumis"], approved: ["success", "Approuvé"], closed: ["neutral", "Clos"] };
const TYPE_LABEL: Record<string, string> = { expense: "Charges", revenue: "Produits", asset: "Actif", liability: "Passif", equity: "Capitaux propres" };
const TABS = [["budgets", "Budgets"], ["scenarios", "Scénarios"], ["accounts", "Comptes budgétables"], ["sections", "Sections analytiques"]] as const;
const thisYear = String(new Date().getFullYear());

export default function BudgetMasterData() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([t]) => t === params.get("tab")) ? params.get("tab")! : "budgets";
  const permissions = useMyAccess().data?.permissions ?? [];
  const can = { export: permissions.includes("budget.export"), settings: permissions.includes("budget.settings") };
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Budget et prévisions", href: "/budget" }, { label: "Données de base" }]} />
      <GuidanceBanner title="Données de base du budget" description="Budgets de la société, scénarios, comptes budgétables et sections analytiques. Les comptes proposés suivent les types budgétables des paramètres ; les sections se créent dans Paramètres → Analytique." />
      <h1 className="text-lg font-semibold text-foreground mb-3">Données de base du budget</h1>
      <div className="flex gap-1 border-b border-border mb-4 overflow-x-auto" role="tablist">
        {TABS.map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setParams({ tab: v })}
            className={cn("px-3 py-2 text-xs border-b-2 -mb-px whitespace-nowrap", tab === v ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>))}
      </div>
      {tab === "budgets" && <BudgetsTab canExport={can.export} />}
      {tab === "scenarios" && <ScenariosTab canEdit={can.settings} />}
      {tab === "accounts" && <AccountsTab canExport={can.export} />}
      {tab === "sections" && <SectionsTab />}
    </PageShell>
  );
}

function BudgetsTab({ canExport }: { canExport: boolean }) {
  const { data: budgets = [], isPending } = useBudgetList();
  const { data: scenarios = [] } = useBudgetScenarios();
  const name = new Map(scenarios.map((s) => [s.code, s.name]));
  const [year, setYear] = useState("");
  const shown = budgets.filter((b) => !year || b.fiscal_year === year);
  const years = [...new Set(budgets.map((b) => b.fiscal_year))].sort().reverse();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label className="text-xs" htmlFor="md-year">Exercice</Label>
          <select id="md-year" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Tous</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select></div>
        {canExport && <ExportButtons label="Exporter les budgets" filename="budgets" sheetName="Budgets"
          rows={shown.map((b) => ({ budget: b.name, exercice: b.fiscal_year, scenario: name.get(b.scenario) ?? b.scenario, etat: STATUS[b.status][1], controle: b.is_control ? "oui" : "non", total: b.total_amount }))}
          columns={[{ key: "budget", header: "Budget", width: 30 }, { key: "exercice", header: "Exercice", width: 10 }, { key: "scenario", header: "Scénario", width: 22 },
            { key: "etat", header: "État", width: 12 }, { key: "controle", header: "Budget de contrôle", width: 18 }, { key: "total", header: "Total", width: 16 }]} />}
      </div>
      <div className="card-elevated overflow-x-auto">
        <table className="w-full text-xs" data-testid="md-budgets">
          <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Budget</th><th className="text-left">Exercice</th><th className="text-left">Scénario</th>
            <th className="text-right">Total</th><th className="text-left pl-3">État</th><th /></tr></thead>
          <tbody>
            {isPending ? <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Chargement…</td></tr>
              : shown.length === 0 ? <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Aucun budget.</td></tr>
              : shown.map((b) => (
                <tr key={b.id} data-testid="md-budget-row" className="border-t border-border/50">
                  <td className="p-2 font-medium">{b.name}</td><td>{b.fiscal_year}</td><td>{name.get(b.scenario) ?? b.scenario}</td>
                  <td className="text-right tabular-nums">{fmt(b.total_amount)}</td>
                  <td className="pl-3 space-x-1"><StatusBadge status={STATUS[b.status][0]} label={STATUS[b.status][1]} />{b.is_control && <StatusBadge status="info" label="Contrôle" />}</td>
                  <td className="pr-2 text-right"><Link className="text-primary underline" to={`/budget/transactions?budget=${b.id}`}>Ouvrir</Link></td>
                </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScenariosTab({ canEdit }: { canEdit: boolean }) {
  const { data: scenarios = [], isPending } = useBudgetScenarios();
  const save = useSaveBudgetScenario(), remove = useDeleteBudgetScenario();
  const [edit, setEdit] = useState<BudgetScenario | "new" | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground max-w-3xl">Un budget appartient à un scénario (référence, hypothèse haute, plan à moyen terme…). Le premier scénario actif dans l'ordre est proposé par défaut. Un scénario utilisé se désactive, il ne se supprime pas.</p>
        {canEdit && <Button size="sm" className="h-8 text-xs" onClick={() => setEdit("new")}>Nouveau scénario</Button>}
      </div>
      <div className="card-elevated overflow-x-auto">
        <table className="w-full text-xs" data-testid="md-scenarios">
          <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Code</th><th className="text-left">Libellé</th><th className="text-left">Description</th>
            <th className="text-right">Ordre</th><th className="text-left pl-3">État</th><th /></tr></thead>
          <tbody>
            {isPending ? <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Chargement…</td></tr>
              : scenarios.length === 0 ? <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Aucun scénario : le premier budget en créera un (« Budget de référence »).</td></tr>
              : scenarios.map((s) => (
                <tr key={s.id} data-testid="md-scenario-row" className="border-t border-border/50">
                  <td className="p-2 font-mono">{s.code}</td><td className="font-medium">{s.name}</td><td className="text-muted-foreground">{s.description ?? ""}</td>
                  <td className="text-right tabular-nums">{s.sort_order}</td>
                  <td className="pl-3"><StatusBadge status={s.is_active ? "success" : "neutral"} label={s.is_active ? "Actif" : "Inactif"} /></td>
                  <td className="pr-2 text-right whitespace-nowrap">{canEdit && <>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEdit(s)}>Modifier</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => save.mutate({ ...s, is_active: !s.is_active })}>{s.is_active ? "Désactiver" : "Réactiver"}</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" onClick={() => { if (window.confirm(`Supprimer le scénario « ${s.name} » ?`)) remove.mutate(s.id); }}>Supprimer</Button></>}</td>
                </tr>))}
          </tbody>
        </table>
      </div>
      {!canEdit && <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Modifier les paramètres du contrôle budgétaire » (budget.settings) est requis.</p>}
      {edit && <ScenarioDialog scenario={edit === "new" ? null : edit} pending={save.isPending} onClose={() => setEdit(null)}
        onSave={(v) => save.mutate(v, { onSuccess: () => setEdit(null) })} />}
    </div>
  );
}

function ScenarioDialog({ scenario, pending, onClose, onSave }: { scenario: BudgetScenario | null; pending: boolean; onClose: () => void;
  onSave: (v: { id?: string; code: string; name: string; description: string | null; is_active: boolean; sort_order: number }) => void }) {
  const [f, setF] = useState({ code: scenario?.code ?? "", name: scenario?.name ?? "", description: scenario?.description ?? "", sort_order: String(scenario?.sort_order ?? 0) });
  const codeOk = /^[a-z0-9_]{1,30}$/.test(f.code.trim().toLowerCase());
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">{scenario ? "Modifier le scénario" : "Nouveau scénario"}</DialogTitle>
          <DialogDescription className="text-xs">Code : minuscules, chiffres et _ ; il est repris par les budgets (le modifier les met à jour).</DialogDescription></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="sc-code">Code</Label><Input id="sc-code" className="h-8 text-xs font-mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="sc-name">Libellé</Label><Input id="sc-name" className="h-8 text-xs" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="sc-desc">Description</Label><Input id="sc-desc" className="h-8 text-xs" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="sc-order">Ordre</Label><Input id="sc-order" type="number" className="h-8 text-xs" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} /></div>
        </div>
        {f.code && !codeOk && <p className="text-xs text-destructive">Code invalide.</p>}
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!codeOk || !f.name.trim() || pending}
            onClick={() => onSave({ id: scenario?.id, code: f.code, name: f.name, description: f.description || null, is_active: scenario?.is_active ?? true, sort_order: Number(f.sort_order) || 0 })}>Enregistrer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountsTab({ canExport }: { canExport: boolean }) {
  const { data: settings } = useBudgetControlSettings();
  const types = settings?.budgetable_types ?? DEFAULT_BUDGET_SETTINGS.budgetable_types;
  const { data: accounts = [], isPending } = useBudgetableAccounts();
  const { data: status = [] } = useBudgetStatus(thisYear);
  const budgeted = useMemo(() => new Set(status.map((r) => r.account_code)), [status]);
  const [q, setQ] = useState("");
  const shown = accounts.filter((a) => !q || a.code.startsWith(q) || a.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label className="text-xs" htmlFor="md-acc-search">Rechercher</Label>
          <Input id="md-acc-search" className="h-8 w-56 text-xs" placeholder="Code ou intitulé" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <p className="text-xs text-muted-foreground">Types budgétables : {types.map((t) => TYPE_LABEL[t] ?? t).join(", ")} — <Link className="text-primary underline" to="/budget/settings">Paramètres</Link></p>
        {canExport && <ExportButtons label="Exporter les comptes" filename="comptes-budgetables" sheetName="Comptes"
          rows={shown.map((a) => ({ compte: a.code, intitule: a.name, type: TYPE_LABEL[a.account_type] ?? a.account_type, regroupement: a.is_header ? "oui" : "non", budgete: budgeted.has(a.code) ? "oui" : "non" }))}
          columns={[{ key: "compte", header: "Compte", width: 12 }, { key: "intitule", header: "Intitulé", width: 40 }, { key: "type", header: "Type", width: 16 },
            { key: "regroupement", header: "Regroupement", width: 14 }, { key: "budgete", header: `Au budget de contrôle ${thisYear}`, width: 24 }]} />}
      </div>
      <div className="card-elevated overflow-x-auto">
        <table className="w-full text-xs" data-testid="md-accounts">
          <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Compte</th><th className="text-left">Intitulé</th><th className="text-left">Type</th>
            <th className="text-left">Sens</th><th className="text-left pr-2">Au budget de contrôle {thisYear}</th></tr></thead>
          <tbody>
            {isPending ? <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Chargement…</td></tr>
              : shown.length === 0 ? <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Aucun compte.</td></tr>
              : shown.slice(0, 300).map((a) => (
                <tr key={a.id} data-testid="md-account-row" className="border-t border-border/50">
                  <td className={cn("p-2 font-mono", a.is_header && "font-semibold")}>{a.code}</td><td>{a.name}</td><td>{TYPE_LABEL[a.account_type] ?? a.account_type}</td>
                  <td>{a.normal_balance === "credit" ? "Crédit (produit)" : "Débit (charge)"}</td><td className="pr-2">{budgeted.has(a.code) ? "Oui" : "—"}</td>
                </tr>))}
          </tbody>
        </table>
      </div>
      {shown.length > 300 && <p className="text-[11px] text-muted-foreground">300 premiers comptes affichés sur {shown.length} : affinez la recherche (l'export contient tout).</p>}
    </div>
  );
}

function SectionsTab() {
  const { data: setup, isPending } = useAnalyticsSetup();
  const { data: status = [] } = useBudgetStatus(thisYear);
  const budgeted = useMemo(() => new Set(status.map((r) => r.analytic_value_id).filter(Boolean)), [status]);
  const axes = setup?.axes ?? [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Axes et sections de la société (création et règles : <Link className="text-primary underline" to="/settings?tab=analytics">Paramètres → Analytique</Link>). Une ligne de budget sur une section couvre ses sous-sections.</p>
      {isPending ? <p className="text-xs text-muted-foreground">Chargement…</p> : axes.length === 0 ? <p className="text-xs text-muted-foreground">Aucun axe analytique.</p> : axes.map((a) => (
        <div key={a.id} className="card-elevated p-3" data-testid="md-axis">
          <p className="text-xs font-semibold mb-2">{a.name} <span className="font-mono text-muted-foreground">({a.code})</span>{!a.active && " — inactif"}</p>
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground"><th className="text-left">Section</th><th className="text-left">Parent</th><th className="text-left">État</th><th className="text-left">Au budget de contrôle {thisYear}</th></tr></thead>
            <tbody>{a.values.map((v) => (
              <tr key={v.id} className="border-t border-border/50" data-testid="md-section-row">
                <td className="py-1"><span className="font-mono">{v.code}</span> {v.name}</td>
                <td>{a.values.find((p) => p.id === v.parentId)?.code ?? "—"}</td>
                <td>{v.active ? "Active" : "Inactive"}</td><td>{budgeted.has(v.id) ? "Oui" : "—"}</td>
              </tr>))}</tbody>
          </table>
        </div>))}
    </div>
  );
}
