import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  ShieldCheck, AlertTriangle, Clock, Search, Eye, Lock,
  Bell, Mail, Smartphone, CreditCard, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {
  useARCreditExposure,
  useARNotificationRules, useToggleARNotificationRule,
  useARNotificationLog,
  usePeriodLocks, useTogglePeriodLock,
} from "@/hooks/use-ar-data";
import { useGLAuditLogs } from "@/hooks/use-gl-audit";

const tabs = [
  { id: "credit", label: "Credit Control", icon: CreditCard },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "audit", label: "Audit Trail", icon: Eye },
  { id: "locks", label: "Period Locks", icon: Lock },
];

const PIE_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--destructive))"];
const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function ARControl() {
  const [activeTab, setActiveTab] = useState("credit");
  const [search, setSearch] = useState("");
  const [notifView, setNotifView] = useState<"rules" | "log">("rules");

  const { data: exposures = [], isLoading: loadingExp } = useARCreditExposure();
  const { data: notifRules = [] } = useARNotificationRules();
  const { data: notifLog = [] } = useARNotificationLog(50);
  const { data: locks = [] } = usePeriodLocks("AR");
  const toggleRule = useToggleARNotificationRule();
  const toggleLock = useTogglePeriodLock();

  // Audit trail from GL audit logs (AR-related entries)
  const auditLogs = useGLAuditLogs?.() as any;
  const auditTrail = (auditLogs?.data || []).filter((l: any) => (l.batch_id || "").includes("AR")).slice(0, 50);

  const breachedCount = exposures.filter(c => c.outstanding > c.credit_limit && c.credit_limit > 0).length;
  const highRiskCount = exposures.filter(c => c.risk_score >= 70).length;
  const totalExposure = exposures.reduce((s, c) => s + c.outstanding, 0);

  const segmentPieData = useMemo(() => {
    // Group by risk band as a proxy for segment until customer segments are added
    const buckets = [
      { name: "Faible (<40)", value: 0 },
      { name: "Modéré (40-70)", value: 0 },
      { name: "Élevé (70-90)", value: 0 },
      { name: "Critique (90+)", value: 0 },
    ];
    exposures.forEach(e => {
      if (e.risk_score < 40) buckets[0].value += e.outstanding;
      else if (e.risk_score < 70) buckets[1].value += e.outstanding;
      else if (e.risk_score < 90) buckets[2].value += e.outstanding;
      else buckets[3].value += e.outstanding;
    });
    return buckets.filter(b => b.value > 0);
  }, [exposures]);

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Accounts Receivable", href: "/receivables" }, { label: "Control & Validation" }]} />
      <GuidanceBanner title="AR Control & Validation" description="Contrôle crédit, gestion des notifications, journal d'audit et verrouillage des périodes." />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Credit Breaches", value: String(breachedCount), icon: AlertTriangle, color: "text-destructive" },
          { label: "High Risk Clients", value: String(highRiskCount), icon: ShieldCheck, color: "text-destructive" },
          { label: "Total Exposure (XOF)", value: fmt(totalExposure), icon: CreditCard, color: "text-primary" },
          { label: "Active Notif Rules", value: String(notifRules.filter(r => r.is_active).length), icon: Bell, color: "text-primary" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-card border border-border rounded-lg p-3 flex items-center gap-2.5">
            <kpi.icon className={cn("w-4 h-4", kpi.color)} />
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</div>
              <div className="text-lg font-semibold text-foreground tabular-nums">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* CREDIT CONTROL */}
      {activeTab === "credit" && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-card border border-border rounded-lg">
            <div className="p-3 border-b border-border flex justify-between items-center">
              <h3 className="text-sm font-semibold text-foreground">Client Credit Exposure</h3>
              <div className="relative w-48">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                <Input placeholder="Search client…" className="pl-8 h-8 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border bg-muted/30">
                  {["Customer", "Credit Limit", "Outstanding", "Usage", "Overdue", "DSO", "Risk Score"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {loadingExp ? (
                    <tr><td colSpan={7} className="p-6 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></td></tr>
                  ) : exposures.length === 0 ? (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucun client</td></tr>
                  ) : exposures.filter(c => !search || c.customer_name.toLowerCase().includes(search.toLowerCase())).map(c => {
                    const usage = c.credit_limit > 0 ? Math.round((c.outstanding / c.credit_limit) * 100) : 0;
                    const breached = c.credit_limit > 0 && c.outstanding > c.credit_limit;
                    return (
                      <tr key={c.customer_id} className={cn("border-b border-border hover:bg-muted/20", breached && "bg-destructive/5")}>
                        <td className="px-3 py-2 font-medium">{c.customer_name}</td>
                        <td className="px-3 py-2 font-mono text-right">{fmt(c.credit_limit)}</td>
                        <td className={cn("px-3 py-2 font-mono text-right", breached && "text-destructive font-semibold")}>{fmt(c.outstanding)}</td>
                        <td className="px-3 py-2 w-28">
                          {c.credit_limit > 0 ? (
                            <div className="flex items-center gap-2">
                              <Progress value={Math.min(usage, 100)} className={cn("h-1.5", usage >= 100 ? "[&>div]:bg-destructive" : usage >= 80 ? "[&>div]:bg-amber-500" : "")} />
                              <span className={cn("text-[10px] font-medium tabular-nums", usage >= 100 ? "text-destructive" : usage >= 80 ? "text-amber-600" : "text-muted-foreground")}>{usage}%</span>
                            </div>
                          ) : <span className="text-[10px] text-muted-foreground">—</span>}
                        </td>
                        <td className={cn("px-3 py-2 font-mono text-right", c.overdue > 0 && "text-destructive")}>{c.overdue > 0 ? fmt(c.overdue) : "—"}</td>
                        <td className={cn("px-3 py-2 text-center", c.dso > 60 ? "text-destructive" : c.dso > 45 ? "text-amber-600" : "")}>{c.dso}j</td>
                        <td className="px-3 py-2">
                          <div className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full",
                            c.risk_score >= 80 ? "bg-destructive/10 text-destructive" :
                            c.risk_score >= 50 ? "bg-amber-500/10 text-amber-700" :
                            "bg-success/10 text-success"
                          )}>{c.risk_score}/100</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Exposition par niveau de risque</h3>
            <div className="h-48">
              {segmentPieData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Pas de données</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={segmentPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={35}
                      label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={false}>
                      {segmentPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${fmt(v)} XOF`} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICATIONS */}
      {activeTab === "notifications" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button size="sm" variant={notifView === "rules" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setNotifView("rules")}>Notification Rules</Button>
            <Button size="sm" variant={notifView === "log" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setNotifView("log")}>Notification Log</Button>
          </div>
          {notifView === "rules" && (
            <div className="bg-card border border-border rounded-lg">
              <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Automated Notification Rules</h3></div>
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border bg-muted/30">
                  {["Trigger Condition", "Channel", "Recipients", "Status", "Last Triggered", "Count", "Actions"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {notifRules.length === 0 ? (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucune règle — configurez dans Settings → Notifications</td></tr>
                  ) : notifRules.map(r => (
                    <tr key={r.id} className="border-b border-border hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{r.trigger_condition}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {r.channel.includes("email") && <Mail className="w-3 h-3 text-muted-foreground" />}
                          {r.channel.includes("sms") && <Smartphone className="w-3 h-3 text-muted-foreground" />}
                          <span className="text-muted-foreground">{r.channel}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.recipients}</td>
                      <td className="px-3 py-2"><StatusBadge status={r.is_active ? "success" : "warning"} label={r.is_active ? "active" : "paused"} /></td>
                      <td className="px-3 py-2 text-muted-foreground">{r.last_triggered_at ? new Date(r.last_triggered_at).toLocaleDateString("fr-FR") : "—"}</td>
                      <td className="px-3 py-2 text-center font-mono">{r.trigger_count}</td>
                      <td className="px-3 py-2">
                        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => toggleRule.mutate({ id: r.id, is_active: !r.is_active })}>{r.is_active ? "Pause" : "Resume"}</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {notifView === "log" && (
            <div className="bg-card border border-border rounded-lg">
              <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Recent Notifications</h3></div>
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border bg-muted/30">
                  {["Timestamp", "Customer", "Channel", "Detail", "Status"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {notifLog.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Aucune notification envoyée</td></tr>
                  ) : notifLog.map(n => (
                    <tr key={n.id} className="border-b border-border hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-muted-foreground">{new Date(n.sent_at).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-2 font-medium">{n.customer_name || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {n.channel.includes("email") && <Mail className="w-3 h-3 text-muted-foreground" />}
                          {n.channel.includes("sms") && <Smartphone className="w-3 h-3 text-muted-foreground" />}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">{n.detail}</td>
                      <td className="px-3 py-2"><StatusBadge status="success" label={n.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* AUDIT */}
      {activeTab === "audit" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">AR Audit Trail</h3></div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Timestamp", "User", "Action", "Batch", "Detail"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {auditTrail.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Aucune entrée d'audit AR</td></tr>
              ) : auditTrail.map((a: any) => (
                <tr key={a.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-muted-foreground">{new Date(a.created_at).toLocaleString("fr-FR")}</td>
                  <td className="px-3 py-2 font-medium">{a.user_name}</td>
                  <td className="px-3 py-2"><StatusBadge status={a.action === "Posted" ? "success" : a.action === "Rejected" ? "error" : "info"} label={a.action} /></td>
                  <td className="px-3 py-2 font-mono">{a.batch_id}</td>
                  <td className="px-3 py-2 text-muted-foreground">{a.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PERIOD LOCKS */}
      {activeTab === "locks" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between items-center">
            <h3 className="text-sm font-semibold text-foreground">Period Lock Management — AR</h3>
            <PeriodLockCreate />
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Period", "Status", "Closed By", "Closed At", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {locks.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Aucune période enregistrée</td></tr>
              ) : locks.map(p => (
                <tr key={p.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{p.period}</td>
                  <td className="px-3 py-2"><StatusBadge status={p.status === "closed" ? "success" : "info"} label={p.status} /></td>
                  <td className="px-3 py-2 text-muted-foreground">{p.closed_by || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.closed_at ? new Date(p.closed_at).toLocaleDateString("fr-FR") : "—"}</td>
                  <td className="px-3 py-2">
                    <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => toggleLock.mutate({ period: p.period, module: "AR", close: p.status === "open" })}>
                      {p.status === "open" ? "Close Period" : "Reopen"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}

function PeriodLockCreate() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const toggle = useTogglePeriodLock();
  return (
    <div className="flex gap-2 items-center">
      <Input type="month" className="h-7 text-xs w-36" value={period} onChange={e => setPeriod(e.target.value)} />
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toggle.mutate({ period, module: "AR", close: false })}>+ Add Period</Button>
    </div>
  );
}
