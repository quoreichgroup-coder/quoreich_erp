import { useState, useMemo } from "react";
import { useRealtimeInvalidation } from "@/hooks/use-realtime-invalidation";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useDashboardKpis } from "@/hooks/use-dashboard-data";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { TopNav } from "@/components/TopNav";
import { RevenueChart } from "@/components/RevenueChart";
import { RecentTransactions } from "@/components/RecentTransactions";
import { UpcomingPayments } from "@/components/UpcomingPayments";
import { AiInsights } from "@/components/AiInsights";
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
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

// ── Consolidated KPIs ──────────────────────────────────────────────────────

// KPIs are now fetched from real data via useDashboardKpis()

// ── Multi-Entity Overview ──────────────────────────────────────────────────

const entityOverview = [
  { entity: "QUOREICH CI", cash: 78500000, nwc: 31200000, dso: 35, dpo: 42, risk: "Low" },
  { entity: "QUOREICH SN", cash: 23250000, nwc: 11180000, dso: 44, dpo: 51, risk: "Medium" },
];

// ── Critical Alerts ──────────────────────────────────────────────────────

const criticalAlerts = [
  { severity: "high", text: "Cash forecast breaches minimum liquidity in W13 (Pessimistic scenario)", module: "Treasury", action: "Review Forecast" },
  { severity: "high", text: "3 supplier invoices past SLA — auto-escalation triggered", module: "AP", action: "View Workflows" },
  { severity: "medium", text: "QUOREICH SN: DSO increased to 44 days (+5 vs target)", module: "AR", action: "Aging Report" },
  { severity: "medium", text: "2 bank reconciliation items unmatched > 7 days", module: "Treasury", action: "Reconcile" },
  { severity: "low", text: "Period P02 closing deadline in 5 days", module: "GL", action: "Close Period" },
];

// ── Risk Indicator ──────────────────────────────────────────────────────

const riskScore = 72; // out of 100

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
      description: "Compensating entries created in GL",
    });
  };

  return (
    <>
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">GL Posting Engine — Consolidated Overview</h3>
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
                <th className="text-center px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Pending</th>
                <th className="text-center px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Posted</th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Total Posted (XOF)</th>
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
              Post All Pending GL Batches
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs space-y-2">
              <p>You are about to post <span className="font-medium text-foreground">{pending.length + validated.length} batches</span> to the General Ledger:</p>
              <div className="bg-muted/50 rounded p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pending batches:</span>
                  <span className="font-medium text-foreground">{pending.length} — {fmt(pendingTotal)} XOF</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Validated batches:</span>
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
            <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              className="text-xs bg-success hover:bg-success"
              onClick={handlePostAll}
            >
              <CheckCircle className="w-3 h-3 mr-1" /> Confirm & Post All
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
  const { data: paymentsRaw = [] } = useQuery({
    queryKey: ["cash-trend-payments"],
    queryFn: async () => {
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
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("fr-FR", { month: "short" });
      const monthPayments = paymentsRaw.filter(p => p.payment_date.startsWith(key));
      const arIn = monthPayments.filter(p => p.payment_type === "ar_receipt").reduce((s, p) => s + Number(p.amount), 0);
      const apOut = monthPayments.filter(p => p.payment_type === "ap_payment").reduce((s, p) => s + Number(p.amount), 0);
      cumulative += (arIn - apOut);
      months.push({ month: label, current: cumulative / 1000, prevYear: 0 });
    }
    return months;
  }, [paymentsRaw]);

  const consolidatedKpis = [
    { title: "AR Outstanding", value: f(kpis?.totalAROutstanding || 0), sub: "XOF", change: `${kpis?.arInvoiceCount || 0} invoices`, trend: "up" as const, prevYear: `${kpis?.customerCount || 0} clients`, icon: CreditCard },
    { title: "AP Outstanding", value: f(kpis?.totalAPOutstanding || 0), sub: "XOF", change: `${kpis?.apInvoiceCount || 0} invoices`, trend: "up" as const, prevYear: `${kpis?.supplierCount || 0} suppliers`, icon: CreditCard },
    { title: "DSO", value: String(kpis?.dso || 0), sub: "days", change: "calculated", trend: "up" as const, prevYear: "—", icon: BarChart3 },
    { title: "DPO", value: String(kpis?.dpo || 0), sub: "days", change: "calculated", trend: "up" as const, prevYear: "—", icon: BarChart3 },
    { title: "AR Collected (month)", value: f(kpis?.arPaidThisMonth || 0), sub: "XOF", change: "this month", trend: "up" as const, prevYear: "—", icon: DollarSign },
    { title: "AP Paid (month)", value: f(kpis?.apPaidThisMonth || 0), sub: "XOF", change: "this month", trend: "up" as const, prevYear: "—", icon: DollarSign },
  ];

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <DashboardSidebar />
        <div className="flex-1 flex flex-col">
          <TopNav />
          <main className="flex-1 p-4 lg:p-6 space-y-5 overflow-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold text-foreground">CFO Dashboard — Consolidated View</h1>
                <p className="text-xs text-muted-foreground">QUOREICH Group · Fiscal Year 2025–2026 · Period ending February 2026</p>
              </div>
              <div className="flex items-center gap-2">
                <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border",
                  riskScore >= 70 ? "border-success/30 bg-success/5" :
                  riskScore >= 40 ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5"
                )}>
                  <Activity className={cn("w-3.5 h-3.5",
                    riskScore >= 70 ? "text-success" : riskScore >= 40 ? "text-primary" : "text-destructive"
                  )} />
                  <span className="text-xs font-medium text-foreground">Risk Score: {riskScore}/100</span>
                  <span className={cn("text-[10px] font-medium",
                    riskScore >= 70 ? "text-success" : riskScore >= 40 ? "text-primary" : "text-destructive"
                  )}>{riskScore >= 70 ? "Healthy" : riskScore >= 40 ? "Moderate" : "Critical"}</span>
                </div>
              </div>
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
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1">
                      {kpi.trend === "up" ? (
                        <TrendingUp className="w-3 h-3 text-success" />
                      ) : (
                        <TrendingDown className="w-3 h-3 text-destructive" />
                      )}
                      <span className={cn("text-[11px] font-medium", kpi.trend === "up" ? "text-success" : "text-destructive")}>
                        {kpi.change}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">N-1: {kpi.prevYear}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Cash Position Trend + Alerts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Cash Trend Chart */}
              <div className="lg:col-span-2 bg-card rounded-lg border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Cash Position — N vs N-1</h3>
                    <p className="text-[11px] text-muted-foreground">Consolidated group position (in thousands XOF)</p>
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
                      <Area type="monotone" dataKey="current" fill="hsl(220 50% 22% / 0.1)" stroke="hsl(220, 50%, 22%)" strokeWidth={2} name="FY 2025-2026" dot={false} />
                      <Area type="monotone" dataKey="prevYear" fill="hsl(220 14% 88% / 0.3)" stroke="hsl(220, 14%, 70%)" strokeWidth={1.5} strokeDasharray="4 3" name="FY 2024-2025" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Critical Alerts */}
              <div className="bg-card rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                  <h3 className="text-sm font-medium text-foreground">Critical Alerts</h3>
                  <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full font-medium ml-auto">
                    {criticalAlerts.filter(a => a.severity === "high").length} high
                  </span>
                </div>
                <div className="divide-y divide-border/50 max-h-[260px] overflow-y-auto">
                  {criticalAlerts.map((alert, i) => (
                    <div key={i} className="px-4 py-2.5 hover:bg-muted/20 transition-colors">
                      <div className="flex items-start gap-2">
                        <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0",
                          alert.severity === "high" ? "bg-destructive" :
                          alert.severity === "medium" ? "bg-primary" : "bg-muted-foreground"
                        )} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-foreground leading-relaxed">{alert.text}</p>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{alert.module}</span>
                            <button className="text-[10px] text-primary font-medium flex items-center gap-0.5 hover:underline">
                              {alert.action} <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Multi-Entity Summary */}
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-medium text-foreground">Multi-Entity Consolidated Overview</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Entity</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Cash Position</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">NWC</th>
                    <th className="text-center px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">DSO</th>
                    <th className="text-center px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">DPO</th>
                    <th className="text-center px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Risk</th>
                  </tr></thead>
                  <tbody>
                    {entityOverview.map(e => (
                      <tr key={e.entity} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-medium text-foreground">{e.entity}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmt(e.cash)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmt(e.nwc)}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums">{e.dso}d</td>
                        <td className="px-4 py-2.5 text-center tabular-nums">{e.dpo}d</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium",
                            e.risk === "Low" ? "bg-success/10 text-success" :
                            e.risk === "Medium" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                          )}>{e.risk}</span>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/30 font-medium">
                      <td className="px-4 py-2.5 text-foreground">Consolidated</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmt(entityOverview.reduce((s, e) => s + e.cash, 0))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmt(entityOverview.reduce((s, e) => s + e.nwc, 0))}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums">38d</td>
                      <td className="px-4 py-2.5 text-center tabular-nums">45d</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-success/10 text-success">Low</span>
                      </td>
                    </tr>
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
            <AiInsights />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Index;
