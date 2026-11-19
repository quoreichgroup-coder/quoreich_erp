import { useState, useMemo } from "react";
import { useRealtimeInvalidation } from "@/hooks/use-realtime-invalidation";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useDashboardKpis } from "@/hooks/use-dashboard-data";
import { useERPAlerts } from "@/hooks/use-alerts-data";
import { useAccessibleTenants, useConsolidatedCfoKpis } from "@/hooks/use-consolidated-cfo";
import { useFiscalCalendar } from "@/hooks/use-fiscal-calendar";
import { useNavigate } from "react-router-dom";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { TopNav } from "@/components/TopNav";
import { RevenueChart } from "@/components/RevenueChart";
import { RecentTransactions } from "@/components/RecentTransactions";
import { UpcomingPayments } from "@/components/UpcomingPayments";
import { AiInsightsPanel } from "@/components/AiInsightsPanel";
import { TrendingUp, TrendingDown, AlertTriangle, ArrowRight, DollarSign, CreditCard, BarChart3, Shield, Activity, BookOpen, Clock, CheckCircle, XCircle, Play, History, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { GLAuditHistory, type GLBatch } from "@/components/GLPostingConfig";
import { useGLBatchesByModule } from "@/hooks/use-gl-batches";
import { useGLAuditLogs } from "@/hooks/use-gl-audit";
import { StatusBadge } from "@/components/StatusBadge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, isApiEnabled } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

// ── Consolidated KPIs ──────────────────────────────────────────────────────

// KPIs are now fetched from real data via useDashboardKpis()

// ── Cash Position Trend (12 months) ─────────────────────────────────────

// Cash trend is computed from real payment data inside the component

const fmt = (n: number) => n.toLocaleString("fr-FR");

// ── GL Posting Overview for CFO Dashboard ─────────────────────────────────

function GLPostingOverview() {
  const [postAllConfirm, setPostAllConfirm] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const { data: batchesByModule, batches: allBatches } = useGLBatchesByModule();
  const { data: auditTrail = [] } = useGLAuditLogs();

  const pending = allBatches.filter(b => b.status === "Pending");
  const validated = allBatches.filter(b => b.status === "Validated");
  const postedToday = allBatches.filter(b => b.status === "Posted" && b.date >= "2026-03-07");
  const rejected = allBatches.filter(b => b.status === "Rejected");

  const moduleStats = Object.entries(batchesByModule).map(([mod, batches]) => ({
    module: mod,
    pending: batches.filter(b => b.status === "Pending").length,
    posted: batches.filter(b => b.status === "Posted").length,
    total: batches.reduce((s, b) => s + (b.status === "Posted" ? b.totalDebit : 0), 0),
  }));

  const pendingTotal = pending.reduce((s, b) => s + b.totalDebit, 0);
  const validatedTotal = validated.reduce((s, b) => s + b.totalDebit, 0);

  const handlePostAll = () => {
    setPostAllConfirm(false);
    toast.success(`${pending.length + validated.length} batches posted to GL`, {
      description: `Total: ${fmt(pendingTotal + validatedTotal)} XOF across ${new Set([...pending, ...validated].map(b => b.module)).size} modules`,
    });
  };

  const handleRollback = (batchId: string) => {
    toast.success(`Batch ${batchId} rolled back`, {
      description: "Écritures de contrepassation créées",
    });
  };

  return (
    <>
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">Comptabilisation — vue d'ensemble</h3>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-amber-600" />
              <span className="text-[10px] font-medium text-amber-600">{pending.length} pending</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-medium text-primary">{validated.length} validated</span>
            </div>
            {rejected.length > 0 && (
              <div className="flex items-center gap-1.5">
                <XCircle className="w-3 h-3 text-destructive" />
                <span className="text-[10px] font-medium text-destructive">{rejected.length} rejected</span>
              </div>
            )}
            <Button 
              size="sm" 
              variant="outline" 
              className="h-7 text-[10px] gap-1"
              onClick={() => setShowAudit(!showAudit)}
            >
              <History className="w-3 h-3" /> {showAudit ? "Hide Audit" : "Audit Trail"}
            </Button>
            {(pending.length + validated.length) > 0 && (
              <Button 
                size="sm" 
                className="h-7 text-[10px] gap-1 bg-success hover:bg-success"
                onClick={() => setPostAllConfirm(true)}
              >
                <Play className="w-3 h-3" /> Post All Pending ({pending.length + validated.length})
              </Button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Module</th>
                <th className="text-center px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">En attente</th>
                <th className="text-center px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Comptabilisé</th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Total comptabilisé (XOF)</th>
              </tr>
            </thead>
            <tbody>
              {moduleStats.map(m => (
                <tr key={m.module} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium text-foreground">{m.module}</td>
                  <td className="px-4 py-2 text-center">
                    {m.pending > 0 ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">{m.pending}</span>
                    ) : <span className="text-muted-foreground">0</span>}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success font-medium">{m.posted}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-mono">{fmt(m.total)}</td>
                </tr>
              ))}
              <tr className="bg-muted/30 font-medium">
                <td className="px-4 py-2 text-foreground">Total</td>
                <td className="px-4 py-2 text-center">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">{pending.length}</span>
                </td>
                <td className="px-4 py-2 text-center">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success font-medium">
                    {allBatches.filter(b => b.status === "Posted").length}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-mono">
                  {fmt(allBatches.filter(b => b.status === "Posted").reduce((s, b) => s + b.totalDebit, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Trail Section */}
      {showAudit && (
        <GLAuditHistory 
          batches={allBatches} 
          auditTrail={auditTrail}
          onRollback={handleRollback}
        />
      )}

      {/* Post All Confirmation Dialog */}
      <AlertDialog open={postAllConfirm} onOpenChange={setPostAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm flex items-center gap-2">
              <Play className="w-4 h-4 text-success" />
              Comptabiliser tous les lots en attente
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs space-y-2">
              <p>Vous allez comptabiliser <span className="font-medium text-foreground">{pending.length + validated.length} batches</span> au grand livre :</p>
              <div className="bg-muted/50 rounded p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lots en attente :</span>
                  <span className="font-medium text-foreground">{pending.length} — {fmt(pendingTotal)} XOF</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lots validés :</span>
                  <span className="font-medium text-foreground">{validated.length} — {fmt(validatedTotal)} XOF</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
                  <span className="font-medium text-foreground">Total:</span>
                  <span className="font-semibold text-success">{fmt(pendingTotal + validatedTotal)} XOF</span>
                </div>
              </div>
              <p className="text-muted-foreground">This action will create GL journal entries across all affected modules. Entries can be reversed via audit rollback if needed.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Annuler</AlertDialogCancel>
            <AlertDialogAction 
              className="text-xs bg-success hover:bg-success"
              onClick={handlePostAll}
            >
              <CheckCircle className="w-3 h-3 mr-1" /> Confirmer et tout comptabiliser
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const Index = () => {
  useRealtimeInvalidation();
  const { data: kpis } = useDashboardKpis();
  const navigate = useNavigate();
  const { data: alerts = [] } = useERPAlerts();
  const { data: calendar } = useFiscalCalendar();
  const today = new Date().toISOString().slice(0, 10);
  const fiscalYear = calendar?.years.find((y) => y.start_date <= today && today <= y.end_date);
  const { data: tenants = [] } = useAccessibleTenants();
  const { data: entities = [] } = useConsolidatedCfoKpis(tenants.map((t) => t.id));
  const severityRank: Record<string, number> = { critical: 0, error: 1, high: 1, warning: 2, medium: 2, info: 3, low: 3 };
  const topAlerts = [...alerts].sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) || b.created_at.localeCompare(a.created_at)).slice(0, 8);
  const highAlerts = alerts.filter((a) => (severityRank[a.severity] ?? 9) <= 1).length;
  const { data: paymentsRaw = [] } = useQuery({
    queryKey: ["cash-trend-payments"],
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<any[]>("/api/v1/pilotage/payments");
      const { data, error } = await supabase
        .from("payments")
        .select("amount, payment_date, payment_type")
        .order("payment_date");
      if (error) throw error;
      return data || [];
    },
  });
  const f = (n: number) => n.toLocaleString("fr-FR");

  // Build cash trend from real payments (cumulative net: AR receipts - AP payments)
  const cashTrend = useMemo(() => {
    const now = new Date();
    const months: { month: string; current: number; prevYear: number }[] = [];
    let cumulative = 0;
    let cumulativePrev = 0;
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("fr-FR", { month: "short" });
      const prevKey = `${d.getFullYear() - 1}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const net = (k: string) => paymentsRaw.filter(p => p.payment_date.startsWith(k)).reduce((s, p) =>
        s + (p.payment_type === "ar_receipt" ? Number(p.amount) : p.payment_type === "ap_payment" ? -Number(p.amount) : 0), 0);
      cumulative += net(key);
      cumulativePrev += net(prevKey);
      months.push({ month: label, current: cumulative / 1000, prevYear: cumulativePrev / 1000 });
    }
    return months;
  }, [paymentsRaw]);

  const consolidatedKpis = [
    { title: "Créances clients", value: f(kpis?.totalAROutstanding || 0), sub: "XOF", detail: `${kpis?.arInvoiceCount || 0} factures · ${kpis?.customerCount || 0} clients`, icon: CreditCard },
    { title: "Dettes fournisseurs", value: f(kpis?.totalAPOutstanding || 0), sub: "XOF", detail: `${kpis?.apInvoiceCount || 0} factures · ${kpis?.supplierCount || 0} fournisseurs`, icon: CreditCard },
    { title: "Délai clients (DSO)", value: String(kpis?.dso || 0), sub: "jours", detail: "encours / chiffre facturé × 365", icon: BarChart3 },
    { title: "Délai fournisseurs (DPO)", value: String(kpis?.dpo || 0), sub: "jours", detail: "encours / achats facturés × 365", icon: BarChart3 },
    { title: "Encaissé ce mois", value: f(kpis?.arPaidThisMonth || 0), sub: "XOF", detail: "règlements clients", icon: DollarSign },
    { title: "Payé ce mois", value: f(kpis?.apPaidThisMonth || 0), sub: "XOF", detail: "règlements fournisseurs", icon: DollarSign },
  ];

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <DashboardSidebar />
        <div className="flex-1 flex flex-col">
          <TopNav />
          <main className="flex-1 p-4 lg:p-6 space-y-5 overflow-auto">
            {/* Header */}
            <div>
              <h1 className="text-lg font-semibold text-foreground">Tableau de bord</h1>
              <p className="text-xs text-muted-foreground">
                {fiscalYear ? `Exercice ${fiscalYear.code} (${fiscalYear.start_date} → ${fiscalYear.end_date})` : "Aucun exercice en cours : définissez-le dans Paramètres → Exercices et périodes"}
              </p>
            </div>

            {/* Consolidated KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              {consolidatedKpis.map((kpi) => (
                <div key={kpi.title} className="bg-card rounded-lg border border-border p-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{kpi.title}</span>
                    <kpi.icon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="text-lg font-semibold text-foreground tabular-nums">
                    {kpi.value} <span className="text-[10px] font-normal text-muted-foreground">{kpi.sub}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{kpi.detail}</div>
                </div>
              ))}
            </div>

            {/* Cash Position Trend + Alerts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Cash Trend Chart */}
              <div className="lg:col-span-2 bg-card rounded-lg border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Trésorerie nette cumulée — 12 mois et année précédente</h3>
                    <p className="text-[11px] text-muted-foreground">Encaissements clients − paiements fournisseurs, en milliers de XOF (société courante)</p>
                  </div>
                </div>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cashTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 88%)" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(220 10% 46%)" />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(220 10% 46%)" tickFormatter={(v) => `${(v / 1000).toFixed(0)}M`} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(220 14% 88%)" }}
                        formatter={(v: number) => [`${fmt(v * 1000)} XOF`]} />
                      <Area type="monotone" dataKey="current" fill="hsl(220 50% 22% / 0.1)" stroke="hsl(220, 50%, 22%)" strokeWidth={2} name="12 derniers mois" dot={false} />
                      <Area type="monotone" dataKey="prevYear" fill="hsl(220 14% 88% / 0.3)" stroke="hsl(220, 14%, 70%)" strokeWidth={1.5} strokeDasharray="4 3" name="Même période, année précédente" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Alertes */}
              <div className="bg-card rounded-lg border border-border overflow-hidden" data-testid="dashboard-alerts">
                <div className="px-4 py-3 border-b border-border flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                  <h3 className="text-sm font-medium text-foreground">Alertes ouvertes</h3>
                  {highAlerts > 0 && (
                    <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full font-medium ml-auto">{highAlerts} critique(s)</span>
                  )}
                </div>
                <div className="divide-y divide-border/50 max-h-[260px] overflow-y-auto">
                  {topAlerts.length === 0 && <p className="px-4 py-6 text-xs text-muted-foreground">Aucune alerte ouverte.</p>}
                  {topAlerts.map((alert) => (
                    <div key={alert.id} className="px-4 py-2.5 hover:bg-muted/20 transition-colors">
                      <div className="flex items-start gap-2">
                        <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0",
                          (severityRank[alert.severity] ?? 9) <= 1 ? "bg-destructive" : (severityRank[alert.severity] ?? 9) === 2 ? "bg-primary" : "bg-muted-foreground")} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-foreground leading-relaxed">{alert.title}</p>
                          {alert.message && <p className="text-[11px] text-muted-foreground">{alert.message}</p>}
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{alert.module}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => navigate("/alerts")} className="w-full px-4 py-2 border-t border-border text-[11px] text-primary font-medium flex items-center justify-center gap-1 hover:underline">
                  Toutes les alertes <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Sociétés accessibles */}
            <div className="bg-card rounded-lg border border-border overflow-hidden" data-testid="dashboard-entities">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">Sociétés accessibles</h3>
                <button onClick={() => navigate("/cockpit/consolidated")} className="text-[11px] text-primary font-medium flex items-center gap-1 hover:underline">
                  Cockpit consolidé <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Société</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Trésorerie</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Créances</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Dettes</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Échu clients</th>
                    <th className="text-center px-4 py-2 font-medium text-muted-foreground">Risques élevés</th>
                  </tr></thead>
                  <tbody>
                    {entities.length === 0 && <tr><td colSpan={6} className="px-4 py-4 text-muted-foreground">Aucune donnée consolidée.</td></tr>}
                    {entities.map((e) => (
                      <tr key={e.tenant_id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-medium text-foreground">{e.tenant_name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(Number(e.cash_on_hand))} {e.currency}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(Number(e.ar_outstanding))}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(Number(e.ap_outstanding))}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(Number(e.ar_overdue))}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums">{e.open_risks_high}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Revenue Charts */}
            <RevenueChart />

            {/* GL Posting Overview */}
            <GLPostingOverview />

            {/* Transactions + Payments */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <RecentTransactions />
              <UpcomingPayments />
            </div>

            {/* AI Insights */}
            <AiInsightsPanel />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Index;
