import { BankReconciliation } from "@/components/BankReconciliation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { ExportButtons } from "@/components/ExportButtons";
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
import { apiGet, isApiEnabled } from "@/api/client";

const tabs = [
  { id: "reconciliation", label: "Rapprochement bancaire", icon: CheckCircle },
  { id: "close", label: "Clôture de période", icon: Lock },
  { id: "limits", label: "Limites des comptes", icon: AlertTriangle },
  { id: "audit", label: "Piste d'audit", icon: Eye },
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
    void safeExportTreasuryCloseReport(h, (err) => {
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

      {activeTab === "reconciliation" && <BankReconciliation />}

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

      {activeTab === "limits" && <TreasuryLimitsTab />}

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
      <TreasuryAuditTrail />

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

const LIMIT_STATUS: Record<string, [string, string]> = {
  overdraft_exceeded: ["error", "Découvert dépassé"], overdraft_used: ["warning", "En découvert"], below_min: ["warning", "Sous le minimum"],
  above_max: ["info", "Excédent à placer"], ok: ["success", "Dans les limites"], not_monitored: ["neutral", "Non suivi"],
};

/** Limites par compte de trésorerie (V107) : seuils saisis sur le compte, comparés au solde réel. */
function TreasuryLimitsTab() {
  const { data: tenantId } = useTenantId();
  const q = useQuery({
    queryKey: ["treasury-limit-status", tenantId],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<any[]>("/api/v1/treasury/views/limits");
      const { data, error } = await (supabase as any).from("treasury_limit_status").select("*").eq("tenant_id", tenantId).order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const m = (v: unknown) => (v == null ? "—" : fmt(Number(v)));
  return (
    <div className="bg-card border border-border rounded-lg" data-testid="treasury-limits">
      <div className="p-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Limites des comptes de trésorerie</h3>
        <span className="text-[11px] text-muted-foreground">Seuils réglés sur chaque compte (Trésorerie → Données de base) : solde minimal, solde maximal, découvert autorisé.</span>
      </div>
      {q.isLoading ? <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
        : q.isError ? <p className="p-4 text-xs text-destructive" role="alert">{(q.error as Error).message}</p> : (
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border bg-muted/30 text-muted-foreground">
            {["Compte", "Solde", "Minimum", "Maximum", "Découvert autorisé", "Disponible", "Découvert utilisé", "État"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {(q.data ?? []).length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Aucun compte de trésorerie actif.</td></tr>}
            {(q.data ?? []).map((l) => (
              <tr key={l.bank_account_id} data-testid="treasury-limit-row" className="border-b border-border/50">
                <td className="px-3 py-2 font-medium">{l.name} <span className="text-muted-foreground">({l.currency})</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{m(l.balance)}</td><td className="px-3 py-2 text-right tabular-nums">{m(l.min_balance)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m(l.max_balance)}</td><td className="px-3 py-2 text-right tabular-nums">{m(l.overdraft_limit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m(l.available)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.overdraft_used_pct == null ? "—" : `${fmt(Number(l.overdraft_used_pct))} %`}</td>
                <td className="px-3 py-2"><StatusBadge status={LIMIT_STATUS[l.status]?.[0] ?? "info"} label={LIMIT_STATUS[l.status]?.[1] ?? l.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const AUDIT_KIND: Record<string, string> = { movement: "Mouvement", statement: "Relevé", reconciliation: "Rapprochement", close: "Clôture" };

/** Piste d'audit de la trésorerie (V107) : mouvements, relevés importés, rapprochements, clôtures. */
function TreasuryAuditTrail() {
  const { data: tenantId } = useTenantId();
  const [kind, setKind] = useState("");
  const q = useQuery({
    queryKey: ["treasury-audit-trail", tenantId],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<any[]>("/api/v1/treasury/audit-trail");
      const all: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await (supabase as any).from("treasury_audit_trail").select("*").eq("tenant_id", tenantId)
          .order("occurred_at", { ascending: false }).range(from, from + 999);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      const ids = [...new Set(all.map((r) => r.actor_id).filter(Boolean))];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data } = await (supabase as any).from("profiles").select("id, full_name").in("id", ids);
        for (const p of data ?? []) names.set(p.id, p.full_name ?? "");
      }
      return all.map((r) => ({ ...r, actor: r.actor_id ? names.get(r.actor_id) || "—" : "Système" }));
    },
  });
  const rows = (q.data ?? []).filter((r) => !kind || r.kind === kind);
  return (
    <div className="bg-card border border-border rounded-lg" data-testid="treasury-audit-trail">
      <div className="p-3 border-b border-border flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground mr-auto">Piste d'audit de la trésorerie</h3>
        <select aria-label="Type d'événement" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Tous les événements</option>{Object.entries(AUDIT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <ExportButtons label="Exporter la piste d'audit" rows={rows.map((r) => ({ date: new Date(r.occurred_at).toLocaleString("fr-FR"), type: AUDIT_KIND[r.kind] ?? r.kind,
          action: r.action, compte: r.account_name ?? "", montant: r.amount == null ? "" : Number(r.amount), utilisateur: r.actor, detail: r.detail ?? "" }))}
          columns={[{ key: "date", header: "Date" }, { key: "type", header: "Type" }, { key: "action", header: "Action" }, { key: "compte", header: "Compte" },
            { key: "montant", header: "Montant" }, { key: "utilisateur", header: "Utilisateur" }, { key: "detail", header: "Détail" }]} filename="piste-audit-tresorerie" />
      </div>
      {q.isLoading ? <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
        : q.isError ? <p className="p-4 text-xs text-destructive" role="alert">{(q.error as Error).message}</p> : (
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted"><tr className="text-muted-foreground">{["Date", "Type", "Action", "Compte", "Montant", "Utilisateur", "Détail"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucun événement.</td></tr>}
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border/50" data-testid="treasury-audit-row">
                  <td className="px-3 py-1.5 whitespace-nowrap">{new Date(r.occurred_at).toLocaleString("fr-FR")}</td><td>{AUDIT_KIND[r.kind] ?? r.kind}</td>
                  <td>{r.action}</td><td>{r.account_name ?? "—"}</td><td className="text-right tabular-nums pr-2">{r.amount == null ? "" : fmt(Number(r.amount))}</td>
                  <td>{r.actor}</td><td className="text-muted-foreground">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
