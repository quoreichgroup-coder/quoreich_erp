import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { ExportButtons } from "@/components/ExportButtons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBudgetAlertDocuments, useBudgetControlSettings, useBudgetRevisionsOfYear, useBudgetStatus } from "@/hooks/use-budget-control";
import { budgetAlerts } from "@/lib/budget-forecast";
import { cn } from "@/lib/utils";
import { useMyAccess } from "@/hooks/use-my-access";

/*
 * Contrôle budgétaire (V77) : lignes en dépassement ou au seuil d'alerte paramétré, pièces d'achat passées
 * en dépassement (avertissement ou dérogation motivée), révisions de l'exercice. Tout vient de la base.
 */
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const MODE: Record<string, string> = { off: "désactivé", warn: "avertissement", block: "blocage" };
const DOC_STATUS: Record<string, string> = {
  draft: "Brouillon", pending_approval: "En approbation", approved: "Approuvée", rejected: "Rejetée", cancelled: "Annulée", converted: "Convertie",
  ordered: "Commandée", partially_received: "Reçue en partie", received: "Reçue",
};
const periodLabel = (p: string) => (p.length === 4 ? `Année ${p}` : `${p.slice(5, 7)}/${p.slice(0, 4)}`);

function Kpi({ id, label, value, tone }: { id: string; label: string; value: string; tone?: string }) {
  return (
    <div className="card-elevated p-3" data-testid={`budget-control-kpi-${id}`}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

export default function BudgetControl() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const validYear = /^\d{4}$/.test(year);
  const status = useBudgetStatus(validYear ? year : "");
  const docs = useBudgetAlertDocuments(year);
  const revisions = useBudgetRevisionsOfYear(year);
  const { data: settings } = useBudgetControlSettings();
  const threshold = settings?.alert_threshold_pct ?? 90;
  const alerts = useMemo(() => budgetAlerts(status.data ?? [], threshold), [status.data, threshold]);
  const over = alerts.filter((a) => a.level === "over").length;
  const overridden = (docs.data ?? []).filter((d) => d.overrideReason).length;
  const canExport = (useMyAccess().data?.permissions ?? []).includes("budget.export");
  const REV_STATUS: Record<string, string> = { pending: "En attente", applied: "Appliquée", rejected: "Refusée" };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Budget et prévisions", href: "/budget" }, { label: "Contrôle" }]} />
      <GuidanceBanner title="Contrôle budgétaire"
        description="Lignes du budget de contrôle en dépassement ou proches de leur limite, demandes et commandes passées malgré un dépassement (mode avertissement, ou dérogation motivée par un habilité), et révisions de l'exercice." />
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Contrôle budgétaire {validYear ? year : ""}</h1>
          <p className="text-xs text-muted-foreground" data-testid="budget-control-mode">
            Contrôle {MODE[settings?.control_mode ?? "off"]}, {settings?.control_level === "month" ? "mensuel" : "annuel"}
            {settings?.precommit_requisitions === false ? ", sans pré-engagement des demandes" : ", demandes d'achat pré-engagées"}
            {settings?.analytic_control === false ? ", sections analytiques non contrôlées" : ""} · seuil d'alerte {threshold} % ·{" "}
            <Link className="text-primary underline" to="/budget/settings">Paramètres</Link>
          </p>
        </div>
        <div className="space-y-1"><Label className="text-xs" htmlFor="bc-year">Exercice</Label>
          <Input id="bc-year" className="h-8 w-24 text-xs" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.trim())} /></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi id="over" label="Lignes en dépassement" value={String(over)} tone={over > 0 ? "text-destructive" : undefined} />
        <Kpi id="threshold" label={`Lignes au seuil (≥ ${threshold} %)`} value={String(alerts.length - over)} tone={alerts.length - over > 0 ? "text-warning" : undefined} />
        <Kpi id="documents" label="Pièces passées en dépassement" value={String(docs.data?.length ?? 0)} />
        <Kpi id="overrides" label="Dont dérogations motivées" value={String(overridden)} />
      </div>

      <Card className="border-border mb-4">
        <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">Lignes en alerte</CardTitle>
          {canExport && <ExportButtons label="Exporter" filename={`alertes-budgetaires-${year}`} sheetName="Alertes"
            rows={alerts.map((a) => ({ compte: a.row.account_code, intitule: a.row.account_name, section: a.row.analytic_code ? `${a.row.analytic_code} ${a.row.analytic_name}` : "Toutes",
              periode: periodLabel(a.row.period), budget: a.row.planned, consomme: a.row.precommitted + a.row.committed + a.row.actual, disponible: a.row.available,
              taux: a.pct ?? "", alerte: a.level === "over" ? "Dépassement" : "Seuil atteint" }))}
            columns={[{ key: "compte", header: "Compte", width: 12 }, { key: "intitule", header: "Intitulé", width: 34 }, { key: "section", header: "Section", width: 22 },
              { key: "periode", header: "Période", width: 14 }, { key: "budget", header: "Budget", width: 15 }, { key: "consomme", header: "Consommé", width: 15 },
              { key: "disponible", header: "Disponible", width: 15 }, { key: "taux", header: "Taux (%)", width: 10 }, { key: "alerte", header: "Alerte", width: 16 }]} />}
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {status.error && <p className="text-xs text-destructive p-3" role="alert">{(status.error as Error).message}</p>}
          {status.isPending && validYear ? <Loader2 className="w-4 h-4 animate-spin m-3" /> : (
            <table className="w-full text-xs" data-testid="budget-alerts">
              <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Compte</th><th className="text-left">Section</th><th className="text-left">Période</th>
                <th className="text-right">Budget</th><th className="text-right">Pré-engagé</th><th className="text-right">Engagé</th><th className="text-right">Réalisé</th>
                <th className="text-right">Disponible</th><th className="text-right">Taux</th><th className="text-left pl-3 pr-2">Alerte</th></tr></thead>
              <tbody>
                {alerts.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-muted-foreground">
                  {(status.data ?? []).length === 0 ? `Aucun budget de contrôle approuvé pour ${year}.` : `Aucune ligne en dépassement ni au seuil de ${threshold} %.`}</td></tr>}
                {alerts.map(({ row: r, pct, level }) => (
                  <tr key={r.line_id} data-testid="budget-alert-row" className="border-t border-border/50">
                    <td className="p-2"><span className="font-mono">{r.account_code}</span> {r.account_name}</td><td>{r.analytic_code ? `${r.analytic_code} ${r.analytic_name}` : "Toutes"}</td>
                    <td>{periodLabel(r.period)}</td><td className="text-right tabular-nums">{fmt(r.planned)}</td><td className="text-right tabular-nums">{fmt(r.precommitted)}</td>
                    <td className="text-right tabular-nums">{fmt(r.committed)}</td><td className="text-right tabular-nums">{fmt(r.actual)}</td>
                    <td className={cn("text-right tabular-nums font-medium", r.available < 0 && "text-destructive")}>{fmt(r.available)}</td>
                    <td className="text-right tabular-nums">{pct == null ? "—" : `${pct.toLocaleString("fr-FR")} %`}</td>
                    <td className={cn("pl-3 pr-2 whitespace-nowrap", level === "over" ? "text-destructive" : "text-warning")}>{level === "over" ? "Dépassement" : "Seuil atteint"}</td>
                  </tr>))}
              </tbody>
            </table>)}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Demandes et commandes passées en dépassement</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {docs.error && <p className="text-xs text-destructive p-3" role="alert">{(docs.error as Error).message}</p>}
            <table className="w-full text-xs" data-testid="budget-alert-documents">
              <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Pièce</th><th className="text-left">Date</th><th className="text-right">Montant</th>
                <th className="text-left pl-3">État</th><th className="text-left pr-2">Dérogation</th></tr></thead>
              <tbody>
                {(docs.data ?? []).length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Aucune pièce passée en dépassement.</td></tr>}
                {(docs.data ?? []).map((d) => (
                  <tr key={d.id} data-testid="budget-alert-document" className="border-t border-border/50 align-top" title={d.warning}>
                    <td className="p-2">{d.docType === "PR" ? "Demande" : "Commande"} <span className="font-mono">{d.number}</span>
                      <p className="text-[10px] text-muted-foreground">{d.warning}</p></td>
                    <td>{new Date(d.date).toLocaleDateString("fr-FR")}</td><td className="text-right tabular-nums">{fmt(d.amount)}</td>
                    <td className="pl-3">{DOC_STATUS[d.status] ?? d.status}</td>
                    <td className="pr-2">{d.overrideReason ? `« ${d.overrideReason} »` : "Mode avertissement"}</td>
                  </tr>))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Révisions de l'exercice</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {revisions.error && <p className="text-xs text-destructive p-3" role="alert">{(revisions.error as Error).message}</p>}
            <table className="w-full text-xs" data-testid="budget-revisions">
              <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Date</th><th className="text-left">Ligne</th><th className="text-right">Avant</th>
                <th className="text-right">Après</th><th className="text-left pl-3">État</th><th className="text-left pl-3 pr-2">Motif</th></tr></thead>
              <tbody>
                {(revisions.data ?? []).length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Aucune révision.</td></tr>}
                {(revisions.data ?? []).map((r) => (
                  <tr key={r.id} data-testid="budget-revision-row" className="border-t border-border/50">
                    <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("fr-FR")}</td>
                    <td>{r.account}{r.section ? ` · ${r.section}` : ""} · {periodLabel(r.period)}</td>
                    <td className="text-right tabular-nums">{fmt(r.old_amount)}</td><td className="text-right tabular-nums">{fmt(r.new_amount)}</td>
                    <td className={cn("pl-3 whitespace-nowrap", r.status === "pending" && "text-warning", r.status === "rejected" && "text-destructive")}>{REV_STATUS[r.status] ?? r.status}</td>
                    <td className="pl-3 pr-2">{r.reason}{r.decision_comment ? ` — décision : ${r.decision_comment}` : ""}</td>
                  </tr>))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
