import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, Calendar, AlertTriangle, Users, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { BudgetRolesPanel } from "@/components/BudgetRolesPanel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useMyAccess } from "@/hooks/use-my-access";
import { useFiscalCalendar } from "@/hooks/use-fiscal-calendar";
import { FISCAL_YEAR_STATUS_LABELS } from "@/lib/fiscal-calendar";
import { ANNUAL_SPREAD_LABELS, FORECAST_METHOD_LABELS, type AnnualSpread, type ForecastMethod } from "@/lib/budget-forecast";

const ACCOUNT_TYPES: [string, string][] = [["expense", "Charges"], ["revenue", "Produits"], ["asset", "Actif (immobilisations…)"], ["liability", "Passif"], ["equity", "Capitaux propres"]];
import { useBudgetControlSettings, useSaveBudgetControlSettings, DEFAULT_BUDGET_SETTINGS, type BudgetControlSettings } from "@/hooks/use-budget-control";

const tabs = [
  { id: "general", label: "Contrôle budgétaire", icon: Settings },
  { id: "alerts", label: "Alertes", icon: AlertTriangle },
  { id: "approval", label: "Approbation et révisions", icon: Users },
  { id: "periods", label: "Exercices", icon: Calendar },
  { id: "roles", label: "Rôles et droits", icon: ShieldCheck },
];

/*
 * Paramètres du budget (V78) : chaque onglet lit et écrit la base — plus de tableaux de démonstration.
 * Le budget ne passe aucune écriture comptable : l'onglet « GL Posting » a disparu. Les exercices sont ceux du
 * calendrier fiscal central (Paramètres → Calendrier fiscal). Écriture : droit budget.settings.
 */
export default function BudgetSettings() {
  const [params, setParams] = useSearchParams();
  const activeTab = tabs.some((t) => t.id === params.get("tab")) ? params.get("tab")! : "general";
  const setActiveTab = (id: string) => setParams({ tab: id });

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Budget et prévisions", href: "/budget" }, { label: "Paramètres" }]} />
      <GuidanceBanner title="Paramètres du budget" description="Contrôle budgétaire, seuil d'alerte, approbation des révisions, exercices et droits du module. Chaque réglage est propre à la société et désactivable." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Paramètres du budget</h1>

      <div className="flex gap-1 border-b border-border mb-4 overflow-x-auto" role="tablist">
        {tabs.map(t => (
          <button key={t.id} role="tab" aria-selected={activeTab === t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && <BudgetControlSettingsCard />}
      {activeTab === "alerts" && <BudgetAlertSettingsCard />}
      {activeTab === "approval" && <BudgetApprovalSettingsCard />}
      {activeTab === "periods" && <BudgetFiscalYearsCard />}
      {activeTab === "roles" && (
        <div className="max-w-6xl space-y-3">
          <p className="text-xs text-muted-foreground max-w-3xl">Les actions du module sont ouvertes par les droits du catalogue (budget.manage, budget.approve, budget.override, budget.forecast, budget.export, budget.settings) : attribuez-les à n'importe quel rôle, y compris sur mesure, depuis <Link className="text-primary underline" to="/settings?tab=roles">Paramètres → Rôles et autorisations</Link>. Ci-dessous, les rôles système du module et leurs titulaires.</p>
          <BudgetRolesPanel />
        </div>
      )}
    </PageShell>
  );
}

function useBudgetSettingsForm() {
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("budget.settings");
  const { data } = useBudgetControlSettings();
  const save = useSaveBudgetControlSettings();
  const [f, setF] = useState<BudgetControlSettings | null>(null);
  const v = f ?? data ?? DEFAULT_BUDGET_SETTINGS;
  return { canEdit, save, f, setF, v, set: (patch: Partial<BudgetControlSettings>) => setF({ ...v, ...patch }) };
}

const readOnly = <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Modifier les paramètres du contrôle budgétaire » (budget.settings) est requis.</p>;

function BudgetAlertSettingsCard() {
  const { canEdit, save, f, setF, v, set } = useBudgetSettingsForm();
  const threshold = Number(v.alert_threshold_pct);
  const ok = threshold > 0 && threshold <= 100;
  return (
    <Card className="border-border max-w-2xl" data-testid="budget-alert-settings">
      <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Alertes</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0 space-y-3 text-xs">
        <p className="text-muted-foreground">Une ligne est <strong>en dépassement</strong> quand son disponible devient négatif (toujours signalé), et <strong>au seuil</strong> quand pré-engagé + engagé + réalisé atteignent ce pourcentage du budget. Le même seuil classe l'atterrissage prévu « proche du budget » dans les prévisions. Écran : Budget → Contrôle.</p>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="bc-threshold">Seuil d'alerte (%)</Label>
            <Input id="bc-threshold" type="number" min={1} max={100} className="h-8 w-24 text-xs" value={String(v.alert_threshold_pct)} disabled={!canEdit}
              onChange={(e) => set({ alert_threshold_pct: e.target.value === "" ? 0 : Number(e.target.value) })} /></div>
          {!ok && <p className="text-destructive">Entre 1 et 100 %.</p>}
        </div>
        {canEdit ? <Button size="sm" className="h-8 text-xs" disabled={!f || !ok || save.isPending} onClick={() => save.mutate(v, { onSuccess: () => setF(null) })}>Enregistrer</Button> : readOnly}
      </CardContent>
    </Card>
  );
}

function BudgetApprovalSettingsCard() {
  const { canEdit, save, f, setF, v, set } = useBudgetSettingsForm();
  const t = Number(v.revision_threshold_pct);
  return (
    <Card className="border-border max-w-2xl" data-testid="budget-approval-settings">
      <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Approbation et révisions</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0 space-y-3 text-xs">
        <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
          <li>Un budget est préparé et soumis avec le droit « Préparer les budgets », puis approuvé avec « Approuver et réviser les budgets » par <strong>une autre personne</strong> que celle qui l'a préparé ou soumis (toujours).</li>
          <li>Un seul budget approuvé sert au contrôle par exercice ; ses lignes sont figées et ne changent que par révision motivée, conservée avec l'ancien et le nouveau montant.</li>
          <li>Un dépassement en mode blocage ne passe qu'avec le droit « Autoriser un dépassement de budget », motif obligatoire.</li>
        </ul>
        <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-2">
          <div><Label className="text-xs" htmlFor="bc-revision-2p">Révisions validées par une autre personne</Label>
            <p className="text-[11px] text-muted-foreground">Activé : au-delà du seuil, une révision devient une demande (préparateur ou approbateur) qu'un autre approbateur valide ou refuse. Désactivé : l'approbateur révise directement.</p></div>
          <Switch id="bc-revision-2p" checked={v.revision_second_person} disabled={!canEdit} onCheckedChange={(c) => set({ revision_second_person: c })} />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div><Label className="text-xs" htmlFor="bc-revision-threshold">Seuil de la demande (% d'écart)</Label>
            <p className="text-[11px] text-muted-foreground">Écart entre le nouveau et l'ancien montant de la ligne ; 0 = toute révision est une demande.</p></div>
          <Input id="bc-revision-threshold" type="number" min={0} className="h-8 w-24 text-xs" value={String(v.revision_threshold_pct)} disabled={!canEdit || !v.revision_second_person}
            onChange={(e) => set({ revision_threshold_pct: e.target.value === "" ? 0 : Number(e.target.value) })} />
        </div>
        {canEdit ? <Button size="sm" className="h-8 text-xs" disabled={!f || !(t >= 0) || save.isPending} onClick={() => save.mutate(v, { onSuccess: () => setF(null) })}>Enregistrer</Button> : readOnly}
      </CardContent>
    </Card>
  );
}

function BudgetFiscalYearsCard() {
  const { data, isPending, error } = useFiscalCalendar();
  const years = data?.years ?? [];
  return (
    <Card className="border-border max-w-2xl" data-testid="budget-fiscal-years">
      <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Exercices</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0 space-y-2 text-xs">
        <p className="text-muted-foreground">Un budget porte sur un exercice (année civile « AAAA ») ; ses lignes sont annuelles ou mensuelles. Les exercices, leurs périodes et leur clôture se gèrent dans le calendrier fiscal central : <Link className="text-primary underline" to="/settings?tab=fiscal">Paramètres → Calendrier fiscal</Link>.</p>
        {error && <p className="text-destructive" role="alert">{(error as Error).message}</p>}
        {isPending ? <p className="text-muted-foreground">Chargement…</p> : years.length === 0
          ? <p className="text-muted-foreground">Aucun exercice défini : les budgets se contrôlent par année civile.</p>
          : years.map((y) => (
            <div key={y.id} className="flex items-center justify-between p-3 border border-border rounded" data-testid="budget-fiscal-year">
              <div><div className="font-medium">{y.code}</div><div className="text-muted-foreground">{new Date(y.start_date).toLocaleDateString("fr-FR")} → {new Date(y.end_date).toLocaleDateString("fr-FR")}</div></div>
              <Badge variant={y.status === "open" ? "default" : "outline"} className="text-[10px]">{FISCAL_YEAR_STATUS_LABELS[y.status]}</Badge>
            </div>))}
      </CardContent>
    </Card>
  );
}

/* Contrôle budgétaire (V73, V77) : mode, niveau, pré-engagement des demandes d'achat, contrôle par section, seuil d'alerte. */
function BudgetControlSettingsCard() {
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("budget.settings");
  const { data } = useBudgetControlSettings();
  const save = useSaveBudgetControlSettings();
  const [f, setF] = useState<BudgetControlSettings | null>(null);
  const v = f ?? data ?? DEFAULT_BUDGET_SETTINGS;
  const set = (patch: Partial<BudgetControlSettings>) => setF({ ...v, ...patch });
  const toggle = (id: string, label: string, hint: string, key: "precommit_requisitions" | "control_requisitions" | "analytic_control", disabled = false) => (
    <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-2">
      <div><Label className="text-xs" htmlFor={id}>{label}</Label><p className="text-[11px] text-muted-foreground">{hint}</p></div>
      <Switch id={id} checked={v[key]} disabled={!canEdit || disabled} onCheckedChange={(c) => set({ [key]: c } as Partial<BudgetControlSettings>)} />
    </div>
  );
  return (
    <Card className="border-border max-w-2xl" data-testid="budget-control-settings">
      <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Contrôle budgétaire</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0 space-y-3 text-xs">
        <p className="text-muted-foreground">Contrôle à la soumission des demandes d'achat, à la soumission et à l'approbation des commandes, et à la soumission des factures fournisseurs sans commande, contre le budget de contrôle approuvé de l'exercice : disponible = budget − pré-engagé (demandes) − engagé (commandes) − réalisé.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="bc-mode">Mode</Label>
            <select id="bc-mode" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={v.control_mode} disabled={!canEdit} onChange={(e) => set({ control_mode: e.target.value as BudgetControlSettings["control_mode"] })}>
              <option value="off">Désactivé</option><option value="warn">Avertir (la pièce passe, le dépassement est signalé)</option><option value="block">Bloquer (dépassement autorisé par un habilité)</option>
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="bc-level">Niveau</Label>
            <select id="bc-level" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={v.control_level} disabled={!canEdit} onChange={(e) => set({ control_level: e.target.value as BudgetControlSettings["control_level"] })}>
              <option value="year">Annuel (budget de l'exercice)</option><option value="month">Mensuel (lignes du mois)</option>
            </select></div>
        </div>
        {toggle("bc-precommit", "Pré-engager les demandes d'achat", "Une demande soumise ou approuvée, non encore convertie en commande, réserve le budget.", "precommit_requisitions")}
        {toggle("bc-control-pr", "Contrôler les demandes d'achat à la soumission", "Comme une commande : refus ou avertissement selon le mode.", "control_requisitions", !v.precommit_requisitions)}
        {toggle("bc-analytic", "Contrôler les budgets par section analytique", "Une ligne de budget sur une section contrôle les pièces de cette section et de ses sous-sections.", "analytic_control")}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-border/60 pt-2">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="bc-method">Méthode d'atterrissage (prévisions)</Label>
            <select id="bc-method" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={v.forecast_method} disabled={!canEdit}
              onChange={(e) => set({ forecast_method: e.target.value as ForecastMethod })}>
              {(Object.keys(FORECAST_METHOD_LABELS) as ForecastMethod[]).map((k) => <option key={k} value={k}>{FORECAST_METHOD_LABELS[k]}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="bc-spread">Répartition mensuelle des lignes annuelles</Label>
            <select id="bc-spread" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={v.annual_spread} disabled={!canEdit}
              onChange={(e) => set({ annual_spread: e.target.value as AnnualSpread })}>
              {(Object.keys(ANNUAL_SPREAD_LABELS) as AnnualSpread[]).map((k) => <option key={k} value={k}>{ANNUAL_SPREAD_LABELS[k]}</option>)}
            </select></div>
        </div>
        <fieldset className="border-t border-border/60 pt-2 space-y-1.5">
          <legend className="text-xs font-medium">Types de comptes budgétables</legend>
          <p className="text-[11px] text-muted-foreground">Comptes proposés et admis par la base dans les budgets, les imports et les prévisions (ex. immobilisations pour un budget d'investissement).</p>
          <div className="flex flex-wrap gap-3">
            {ACCOUNT_TYPES.map(([t, l]) => (
              <label key={t} className="inline-flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={v.budgetable_types.includes(t)} disabled={!canEdit}
                  onChange={(e) => set({ budgetable_types: e.target.checked ? [...v.budgetable_types, t] : v.budgetable_types.filter((x) => x !== t) })} />{l}
              </label>))}
          </div>
          {v.budgetable_types.length === 0 && <p className="text-[11px] text-destructive">Au moins un type.</p>}
        </fieldset>
        {canEdit ? <Button size="sm" className="h-8 text-xs" disabled={!f || v.budgetable_types.length === 0 || save.isPending} onClick={() => save.mutate(v, { onSuccess: () => setF(null) })}>Enregistrer</Button>
          : <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Modifier les paramètres du contrôle budgétaire » est requis.</p>}
      </CardContent>
    </Card>
  );
}
