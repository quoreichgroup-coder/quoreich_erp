import { useState, useMemo } from "react";
import { useTenantId } from "@/hooks/use-tenant";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApprovalThresholdsEditor } from "@/components/ApprovalThresholdsEditor";
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

  const { data: queue = [] } = useAPPendingApprovals();
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

  const slaBreaches = queue.filter((v) => v.sla_hours != null && v.elapsed_hours > v.sla_hours).length;
  const criticalBudgets = budgetAlerts.filter((b) => b.severity === "critical").length;
  const pendingCount = queue.length;

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
        <div className="bg-card border border-border rounded-lg" data-testid="ap-validation-queue">
          <div className="p-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Factures en attente d'approbation</h3>
            <div className="flex items-center gap-2">
              <div className="relative w-52">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                <Input placeholder="N° de facture, fournisseur…" aria-label="Rechercher une facture" className="pl-8 h-8 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Button asChild size="sm" variant="outline" className="h-8 text-xs"><Link to="/payables/transactions?tab=approvals">Approuver ou rejeter</Link></Button>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Facture", "Fournisseur", "Montant", "Niveau en cours", "Approbateur", "Soumise le", "Délai", "État"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {queue.filter((v) => `${v.invoice_number} ${v.supplier}`.toLowerCase().includes(search.toLowerCase())).map((v) => {
                const pct = v.sla_hours ? Math.round((v.elapsed_hours / v.sla_hours) * 100) : null;
                const breached = pct != null && pct > 100;
                return (
                  <tr key={v.id} data-testid="ap-validation-row" className={cn("border-b border-border hover:bg-muted/20", breached && "bg-destructive/5")}>
                    <td className="px-3 py-2 font-medium text-primary">{v.invoice_number}</td>
                    <td className="px-3 py-2">{v.supplier}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(v.amount)}</td>
                    <td className="px-3 py-2"><StatusBadge status="info" label={v.level_label} /></td>
                    <td className="px-3 py-2">{v.approver_label}</td>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(v.created_at).toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-2 w-32">
                      {pct == null ? <span className="text-muted-foreground">{v.elapsed_hours} h (pas de délai cible)</span> : (
                        <div className="flex items-center gap-1.5">
                          <Progress value={Math.min(pct, 100)} className={cn("h-1.5", breached ? "[&>div]:bg-destructive" : pct >= 75 ? "[&>div]:bg-warning" : "")} />
                          <span className={cn("text-[10px] tabular-nums", breached ? "text-destructive font-semibold" : "text-muted-foreground")}>{v.elapsed_hours}h/{v.sla_hours}h</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={breached ? "error" : "warning"} label={breached ? "Délai dépassé" : "En attente"} /></td>
                  </tr>
                );
              })}
              {queue.length === 0 && (
                <tr><td colSpan={8} className="text-center text-muted-foreground py-6">Aucune facture en attente d'approbation</td></tr>
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

      {activeTab === "thresholds" && <ApprovalThresholdsEditor kind="ap" />}
    </PageShell>
  );
}

/** File réelle (V41) : niveau en cours de chaque facture soumise, délai écoulé contre le délai cible du seuil. */
function useAPPendingApprovals() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["ap-pending-approvals", tenantId],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async () => {
      const db = supabase as any;
      const [a, t] = await Promise.all([
        db.from("ap_invoice_approvals").select("id, invoice_id, level_order, level_label, approver_label, amount, created_at, status,"
          + " invoice:ap_invoices(invoice_number, approval_status, supplier:suppliers(name))").eq("tenant_id", tenantId).eq("status", "pending").order("level_order"),
        db.from("ap_approval_thresholds").select("level, sla_hours").eq("tenant_id", tenantId),
      ]);
      if (a.error) throw a.error;
      if (t.error) throw t.error;
      const sla = new Map<string, number>((t.data ?? []).map((r: any) => [r.level, Number(r.sla_hours)]));
      const seen = new Set<string>();
      return (a.data ?? []).filter((r: any) => r.invoice?.approval_status === "submitted" && !seen.has(r.invoice_id) && seen.add(r.invoice_id)).map((r: any) => ({
        id: r.id as string, invoice_number: r.invoice?.invoice_number ?? "", supplier: r.invoice?.supplier?.name ?? "", amount: Number(r.amount),
        level_label: r.level_label as string, approver_label: r.approver_label as string, created_at: r.created_at as string,
        elapsed_hours: Math.max(0, Math.round((Date.now() - new Date(r.created_at).getTime()) / 3600000)),
        sla_hours: sla.get(r.level_label) ?? null,
      }));
    },
  });
}
