import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, AlertTriangle, Eye, ShieldCheck, Lock, Loader2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMyTreasuryRoles } from "@/hooks/use-treasury-data";
import { canDo, missingRoleHint } from "@/lib/treasury-roles";
import { currentPeriod, isValidTreasuryPeriod, isPeriodInAllowedRange, DEFAULT_PERIOD_RANGE } from "@/lib/treasury-close";
import { useCloseTreasuryPeriod, useTreasuryCloseHistory, type TreasuryCloseHistoryRow } from "@/hooks/use-treasury-close";
import { useTreasuryIdempotentAudit } from "@/hooks/use-treasury-idempotent-audit";
import { safeExportTreasuryCloseReport } from "@/lib/treasury-close-report";
import { toast } from "sonner";

const tabs = [
  { id: "reconciliation", label: "Bank Reconciliation", icon: CheckCircle },
  { id: "close", label: "Clôture de période", icon: Lock },
  { id: "limits", label: "Limit Monitoring", icon: AlertTriangle },
  { id: "audit", label: "Audit Trail", icon: Eye },
];

const reconciliationItems = [
  { bank: "SGBS — Operating", bookBalance: 145000000, bankStatement: 144800000, diff: 200000, items: 3, status: "in_progress" },
  { bank: "BOA — Reserve", bookBalance: 88000000, bankStatement: 88000000, diff: 0, items: 0, status: "reconciled" },
  { bank: "SGBS — Payroll", bookBalance: 12000000, bankStatement: 12000000, diff: 0, items: 0, status: "reconciled" },
];

const limitMonitoring = [
  { entity: "SGBS Overdraft", type: "Credit Facility", limit: 30000000, used: 0, available: 30000000, utilization: 0 },
  { entity: "SGBS Operating", type: "Min Balance", limit: 5000000, used: 145000000, available: 140000000, utilization: 0 },
  { entity: "FX Exposure — EUR", type: "FX Limit", limit: 100000, used: 45000, available: 55000, utilization: 45 },
];

const auditTrail = [
  { ts: "2025-02-15 16:00", user: "Treasury Mgr", action: "Reconciliation", detail: "BOA Reserve — fully reconciled" },
  { ts: "2025-02-15 14:30", user: "Treasury Mgr", action: "Transfer", detail: "INT-TRF-0015 — 20M XOF SGBS→BOA" },
  { ts: "2025-02-14 11:00", user: "CFO", action: "FX Approval", detail: "FX-002 Forward USD/XOF 50K approved" },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function TreasuryControl() {
  const [activeTab, setActiveTab] = useState("reconciliation");
  const perms = useMyTreasuryRoles();
  const canClose = canDo(perms, "close_period");
  const [period, setPeriod] = useState<string>(currentPeriod());
  const closeMut = useCloseTreasuryPeriod();
  const { data: history = [], isLoading: histLoading } = useTreasuryCloseHistory(24);

  const alreadyClosed = useMemo(
    () => history.some((h) => h.period === period && h.status === "completed"),
    [history, period],
  );
  const periodEmpty = period.trim().length === 0;
  const periodValid = !periodEmpty && isValidTreasuryPeriod(period);
  const periodInRange = periodValid && isPeriodInAllowedRange(period);
  const validationError = !canClose
    ? missingRoleHint("close_period")
    : periodEmpty
      ? "Renseignez une période au format AAAA-MM (ex. 2025-04)."
      : !periodValid
        ? `Période « ${period} » invalide — format attendu AAAA-MM avec un mois entre 01 et 12.`
        : !periodInRange
          ? `Période « ${period } » hors plage autorisée — fenêtre permise : ${DEFAULT_PERIOD_RANGE.maxPastMonths} mois passés à ${DEFAULT_PERIOD_RANGE.maxFutureMonths} mois futur.`
          : alreadyClosed
            ? "Période déjà clôturée — l'opération serait idempotente."
            : "";
  const disabledReason = validationError || (closeMut.isPending ? "Clôture en cours…" : "");
  const canSubmit = canClose && periodValid && periodInRange && !alreadyClosed && !closeMut.isPending;

  const handleExportReport = (h: TreasuryCloseHistoryRow) => {
    safeExportTreasuryCloseReport(h, (err) => {
      // Stable toast id → sonner replaces the existing toast on bursts instead
      // of stacking N duplicates. Buttons remain enabled and re-clickable.
      toast.error("Impossible de générer le rapport PDF", {
        id: "treasury-pdf-error",
        description: err.message || "Erreur inattendue — l'historique reste accessible.",
      });
    });
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (canSubmit) closeMut.mutate(period);
  };

  return (
    <PageShell>
      <Breadcrumb items={[
        { label: "Finance" },
        { label: "Treasury", href: "/treasury" },
        { label: "Control" },
      ]} />

      <GuidanceBanner title="Treasury Control" description="Bank reconciliation, limit monitoring and audit trail for treasury operations." />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { label: "Accounts Reconciled", value: "2/3", icon: CheckCircle, color: "text-success" },
          { label: "Open Items", value: "3", icon: AlertTriangle, color: "text-amber-600" },
          { label: "Limit Breaches", value: "0", icon: ShieldCheck, color: "text-success" },
        ].map(kpi => (
          <div key={kpi.label} className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
            <kpi.icon className={cn("w-5 h-5", kpi.color)} />
            <div>
              <div className="text-xs text-muted-foreground">{kpi.label}</div>
              <div className="text-lg font-semibold text-foreground">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "reconciliation" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Bank Reconciliation Status</h3></div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Bank Account", "Book Balance", "Statement", "Difference", "Open Items", "Status", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {reconciliationItems.map(r => (
                <tr key={r.bank} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{r.bank}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.bookBalance)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.bankStatement)}</td>
                  <td className={cn("px-3 py-2 text-right font-mono", r.diff > 0 ? "text-amber-600" : "")}>{fmt(r.diff)}</td>
                  <td className="px-3 py-2 text-center">{r.items}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status === "reconciled" ? "success" : "warning"} label={r.status.replace("_", " ")} /></td>
                  <td className="px-3 py-2">
                    {r.status !== "reconciled" && <Button size="sm" variant="outline" className="h-6 text-[10px]">Reconcile</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "close" && (
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-lg p-4 space-y-3" data-testid="treasury-close-card">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Clôture de période Trésorerie</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Verrouille la période sélectionnée pour la Trésorerie, génère un instantané des soldes/rapprochements
              et inscrit l'opération dans l'audit. L'opération est idempotente.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="treasury-close-period" className="text-xs">Période (AAAA-MM)</Label>
                <Input
                  id="treasury-close-period"
                  data-testid="treasury-close-period"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value.trim())}
                  placeholder="2025-01"
                  className={cn("h-8 w-36 text-sm", validationError && !canSubmit && "border-destructive")}
                  disabled={closeMut.isPending}
                  aria-invalid={!periodValid}
                  aria-describedby="treasury-close-hint"
                />
              </div>
              <Button
                size="sm"
                type="submit"
                data-testid="treasury-close-button"
                disabled={!canSubmit}
                aria-busy={closeMut.isPending}
                title={disabledReason}
              >
                {closeMut.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Clôture en cours…</>
                ) : (
                  <><Lock className="w-3.5 h-3.5 mr-1.5" /> Clôturer la période</>
                )}
              </Button>
            </form>
            {closeMut.isPending && (
              <div
                role="status"
                aria-live="polite"
                data-testid="treasury-close-progress"
                className="flex items-center gap-2 text-[11px] text-primary"
              >
                <Loader2 className="w-3 h-3 animate-spin" />
                Snapshot des soldes et rapprochements en cours… écriture audit en cours.
              </div>
            )}
            {!closeMut.isPending && validationError && (
              <div
                role="alert"
                data-testid="treasury-close-error"
                className={cn(
                  "text-[11px]",
                  !canClose || !periodValid || !periodInRange ? "text-destructive" : "text-muted-foreground",
                )}
                id="treasury-close-hint"
              >
                {validationError}
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-lg">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Historique des clôtures</h3>
              {histLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
            </div>
            <table className="w-full text-xs" data-testid="treasury-close-history">
              <thead><tr className="border-b border-border bg-muted/30">
                {["Période", "Statut", "Soldes (XOF)", "Comptes", "Rapprochements", "Clôturée le", "Par", "Rapport"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {history.length === 0 && !histLoading && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Aucune clôture enregistrée.</td></tr>
                )}
                {history.map((h: TreasuryCloseHistoryRow) => (
                  <tr key={h.id} className="border-b border-border hover:bg-muted/20" data-testid={`treasury-close-row-${h.period}`}>
                    <td className="px-3 py-2 font-mono">{h.period}</td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        status={h.status === "completed" ? "success" : h.status === "failed" ? "destructive" : "warning"}
                        label={h.status}
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(Number(h.total_balance ?? 0))}</td>
                    <td className="px-3 py-2 text-center">{h.accounts_count}</td>
                    <td className="px-3 py-2 text-center">{h.reconciliations_count}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{new Date(h.closed_at).toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-2">{h.closed_by_name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px]"
                        data-testid={`treasury-close-report-${h.period}`}
                        onClick={() => handleExportReport(h)}
                        title="Générer un mini-rapport PDF pour cette clôture"
                      >
                        <FileText className="w-3 h-3 mr-1" /> PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "limits" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Limit Monitoring</h3></div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Entity", "Type", "Limit", "Used", "Available", "Utilization"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {limitMonitoring.map(l => (
                <tr key={l.entity} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{l.entity}</td>
                  <td className="px-3 py-2">{l.type}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(l.limit)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(l.used)}</td>
                  <td className="px-3 py-2 text-right font-mono text-success">{fmt(l.available)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full"><div className={cn("h-1.5 rounded-full", l.utilization > 80 ? "bg-destructive" : l.utilization > 50 ? "bg-amber-500" : "bg-success")} style={{ width: `${l.utilization}%` }} /></div>
                      <span className="text-[10px] text-muted-foreground w-8 text-right">{l.utilization}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "audit" && (
        <TreasuryAuditTab history={history} />
      )}
    </PageShell>
  );
}

function TreasuryAuditTab({ history }: { history: TreasuryCloseHistoryRow[] }) {
  const { data: idem = [], isLoading } = useTreasuryIdempotentAudit(50);
  const findHistory = (period: string | null) =>
    period ? history.find((h) => h.period === period) : undefined;

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-lg">
        <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Treasury Audit Trail</h3></div>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border bg-muted/30">
            {["Timestamp", "User", "Action", "Detail"].map(h => (
              <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {auditTrail.map((a, i) => (
              <tr key={i} className="border-b border-border hover:bg-muted/20">
                <td className="px-3 py-2 font-mono text-muted-foreground">{a.ts}</td>
                <td className="px-3 py-2 font-medium">{a.user}</td>
                <td className="px-3 py-2"><StatusBadge status="info" label={a.action} /></td>
                <td className="px-3 py-2 text-muted-foreground">{a.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-card border border-border rounded-lg" data-testid="treasury-idempotent-panel">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Clôtures idempotentes (retries)</h3>
          {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border bg-muted/30">
            {["Quand", "Acteur", "Tenant", "Période", "Bornes", "Entrée réutilisée"].map(h => (
              <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {idem.length === 0 && !isLoading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucune tentative idempotente enregistrée.</td></tr>
            )}
            {idem.map((row) => {
              const reused = findHistory(row.period);
              return (
                <tr key={row.id} className="border-b border-border hover:bg-muted/20" data-testid={`treasury-idempotent-row-${row.period ?? row.id}`}>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{new Date(row.created_at).toLocaleString("fr-FR")}</td>
                  <td className="px-3 py-2 font-mono">{row.actor_id.slice(0, 8)}…</td>
                  <td className="px-3 py-2 font-mono" title={row.tenant_id} data-testid={`treasury-idempotent-tenant-${row.period ?? row.id}`}>
                    {row.tenant_id.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2 font-mono">{row.period ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground" data-testid={`treasury-idempotent-bounds-${row.period ?? row.id}`}>
                    {row.period_start && row.period_end ? `${row.period_start} → ${row.period_end}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {reused ? (
                      <span className="font-mono text-muted-foreground" title={`Clôturée le ${new Date(reused.closed_at).toLocaleString("fr-FR")}`}>
                        #{reused.id.slice(0, 8)} — {reused.status}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">non visible dans l'historique récent</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
