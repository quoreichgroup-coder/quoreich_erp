import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Clock, AlertTriangle, Eye, ShieldCheck, CheckCircle, Search, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAPApprovalQueue,
  useResolveAPApproval,
  useAPApprovalThresholds,
  useAPAuditTrail,
} from "@/hooks/use-ap-data";
import { DEFAULT_BUDGET_SETTINGS, useBudgetControlSettings, useBudgetStatus } from "@/hooks/use-budget-control";
import { consumed, consumptionPct } from "@/lib/budget-forecast";

const tabs = [
  { id: "validation", label: "File de validation", icon: Clock },
  { id: "budget", label: "Alertes budget", icon: Wallet },
  { id: "audit", label: "Piste d'audit", icon: Eye },
  { id: "thresholds", label: "Seuils d'approbation", icon: ShieldCheck },
];

const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR");

export default function APControl() {
  const [activeTab, setActiveTab] = useState("validation");
  const [search, setSearch] = useState("");

  const { data: queue = [] } = useAPApprovalQueue();
  const resolve = useResolveAPApproval();
  const { data: thresholds = [] } = useAPApprovalThresholds();
  const { data: audit = [] } = useAPAuditTrail(100);
  // Budget de contrôle de l'exercice en cours (charges) : consommé = pré-engagé + engagé + réalisé ; seuil d'alerte
  // des paramètres du budget (dépassement = disponible négatif).
  const { data: budgetRows = [] } = useBudgetStatus(String(new Date().getFullYear()));
  const { data: budgetSettings } = useBudgetControlSettings();
  const alertPct = budgetSettings?.alert_threshold_pct ?? DEFAULT_BUDGET_SETTINGS.alert_threshold_pct;
  const budgetAlerts = useMemo(() => {
    return budgetRows.filter((r) => r.nature === "expense").map((r) => {
      const pct = Math.round(consumptionPct(r) ?? 0);
      const severity = r.available < 0 ? "critical" : pct >= alertPct ? "warning" : "info";
      return { id: r.line_id, category: `${r.account_code} ${r.account_name}${r.analytic_code ? ` · ${r.analytic_code}` : ""}`, budget: r.planned, spent: consumed(r), pct, remaining: r.available, severity };
    });
  }, [budgetRows, alertPct]);

  const slaBreaches = queue.filter((v: any) => v.elapsed_hours > v.sla_hours).length;
  const criticalBudgets = budgetAlerts.filter((b) => b.severity === "critical").length;
  const pendingCount = queue.filter((v: any) => v.status === "pending" || v.status === "escalated").length;

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Comptes Fournisseurs", href: "/payables" }, { label: "Contrôle & Validation" }]} />
      <GuidanceBanner title="Contrôle AP" description="File d'approbation multi-niveaux, alertes budget, piste d'audit et seuils SLA — 100% pilotés par la base." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "En attente", value: String(pendingCount), icon: Clock, color: "text-amber-600" },
          { label: "Dépassements SLA", value: String(slaBreaches), icon: AlertTriangle, color: slaBreaches > 0 ? "text-destructive" : "text-success" },
          { label: "Alertes budget", value: String(criticalBudgets), icon: Wallet, color: criticalBudgets > 0 ? "text-destructive" : "text-success" },
          { label: "Audit (24h)", value: String(audit.filter((a: any) => Date.now() - new Date(a.created_at).getTime() < 86400000).length), icon: CheckCircle, color: "text-success" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-card border border-border rounded-lg p-3 flex items-center gap-2.5">
            <kpi.icon className={cn("w-4 h-4", kpi.color)} />
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</div>
              <div className="text-lg font-semibold text-foreground">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "validation" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">File d'approbation multi-niveaux</h3>
            <div className="relative w-52">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="Rechercher…" className="pl-8 h-8 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Document", "Type", "Montant (XOF)", "Niveau", "Demandeur", "Date", "SLA", "Statut", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {queue
                .filter((v: any) => v.doc_number.toLowerCase().includes(search.toLowerCase()))
                .map((v: any) => {
                  const slaPct = Math.round((v.elapsed_hours / v.sla_hours) * 100);
                  const breached = v.elapsed_hours > v.sla_hours;
                  return (
                    <tr key={v.id} className={cn("border-b border-border hover:bg-muted/20", breached && "bg-destructive/5")}>
                      <td className="px-3 py-2 font-medium text-primary">{v.doc_number}</td>
                      <td className="px-3 py-2">{v.doc_type}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(v.amount)}</td>
                      <td className="px-3 py-2"><StatusBadge status={v.level?.startsWith("L4") ? "error" : v.level?.startsWith("L3") ? "warning" : "info"} label={v.level} /></td>
                      <td className="px-3 py-2">{v.requester}</td>
                      <td className="px-3 py-2 text-muted-foreground">{v.request_date}</td>
                      <td className="px-3 py-2 w-28">
                        <div className="flex items-center gap-1.5">
                          <Progress value={Math.min(slaPct, 100)} className={cn("h-1.5", breached ? "[&>div]:bg-destructive" : slaPct >= 75 ? "[&>div]:bg-amber-500" : "")} />
                          <span className={cn("text-[10px] tabular-nums", breached ? "text-destructive font-semibold" : "text-muted-foreground")}>{v.elapsed_hours}h/{v.sla_hours}h</span>
                        </div>
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={v.status === "approved" ? "success" : v.status === "rejected" ? "error" : breached ? "error" : "info"} label={v.status} /></td>
                      <td className="px-3 py-2 flex gap-1">
                        {v.status === "pending" && (
                          <>
                            <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={resolve.isPending}
                              onClick={() => resolve.mutate({ id: v.id, decision: "approved" })}>Approuver</Button>
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" disabled={resolve.isPending}
                              onClick={() => resolve.mutate({ id: v.id, decision: "rejected" })}>Rejeter</Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {queue.length === 0 && (
                <tr><td colSpan={9} className="text-center text-muted-foreground py-6">Aucune validation en attente</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "budget" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Utilisation du budget par poste</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30">
                {["Ligne de budget", "Budget (XOF)", "Consommé (XOF)", "Utilisation", "Disponible", "État"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {budgetAlerts.map(b => (
                  <tr key={b.id} className={cn("border-b border-border hover:bg-muted/20", b.severity === "critical" && "bg-destructive/5")}>
                    <td className="px-3 py-2 font-medium">{b.category}</td>
                    <td className="px-3 py-2 font-mono text-right">{fmt(b.budget)}</td>
                    <td className="px-3 py-2 font-mono text-right">{fmt(b.spent)}</td>
                    <td className="px-3 py-2 w-36">
                      <div className="flex items-center gap-2">
                        <Progress value={Math.min(b.pct, 100)} className={cn("h-1.5", b.severity === "critical" ? "[&>div]:bg-destructive" : b.severity === "warning" ? "[&>div]:bg-warning" : "")} />
                        <span className={cn("text-[10px] font-semibold tabular-nums", b.severity === "critical" ? "text-destructive" : b.severity === "warning" ? "text-warning" : "text-muted-foreground")}>{b.pct}%</span>
                      </div>
                    </td>
                    <td className={cn("px-3 py-2 font-mono text-right", b.remaining < 0 && "text-destructive")}>{fmt(b.remaining)}</td>
                    <td className="px-3 py-2"><StatusBadge status={b.severity === "critical" ? "error" : b.severity === "warning" ? "warning" : "success"} label={b.severity === "critical" ? "Dépassement" : b.severity === "warning" ? `Seuil (${alertPct} %)` : "Dans le budget"} /></td>
                  </tr>
                ))}
                {budgetAlerts.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-muted-foreground py-6">Aucun budget de contrôle approuvé pour l'exercice en cours</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "audit" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Piste d'audit AP</h3></div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Horodatage", "Utilisateur", "Action", "Document", "Détail"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {audit.map((a: any) => (
                <tr key={a.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-muted-foreground">{new Date(a.created_at).toLocaleString("fr-FR")}</td>
                  <td className="px-3 py-2 font-medium">{a.user_name}</td>
                  <td className="px-3 py-2"><StatusBadge status="info" label={a.action} /></td>
                  <td className="px-3 py-2 font-mono">{a.batch_id}</td>
                  <td className="px-3 py-2 text-muted-foreground">{a.details}</td>
                </tr>
              ))}
              {audit.length === 0 && (
                <tr><td colSpan={5} className="text-center text-muted-foreground py-6">Aucune entrée d'audit</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "thresholds" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Seuils d'approbation</h3></div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Niveau", "Montant max (XOF)", "Approbateur", "SLA", "Types de documents"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {thresholds.map((t: any) => (
                <tr key={t.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{t.level}</td>
                  <td className="px-3 py-2 font-mono">{t.max_amount ? fmt(t.max_amount) : "Illimité"}</td>
                  <td className="px-3 py-2">{t.approver}</td>
                  <td className="px-3 py-2">{t.sla_hours}h</td>
                  <td className="px-3 py-2 text-muted-foreground">{t.doc_types}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
