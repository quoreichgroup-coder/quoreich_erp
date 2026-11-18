import { useMemo } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Wallet, CalendarClock, AlertTriangle, FileText, ArrowRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useEmployees, usePayrollKpis, useMyHrRoles } from "@/hooks/use-hr-data";
import { canDo, maskAmount } from "@/lib/hr-roles";

const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

export default function HrDashboard() {
  const perms = useMyHrRoles();
  const canViewAmounts = canDo(perms, "view_sensitive");
  const kpis = usePayrollKpis();
  const { data: employees = [], isLoading } = useEmployees();

  const byDept = useMemo(() => {
    const m = new Map<string, { dept: string; count: number; mass: number }>();
    employees.filter((e) => e.status === "active").forEach((e) => {
      const d = e.department || "Non assigné";
      const cur = m.get(d) || { dept: d, count: 0, mass: 0 };
      cur.count += 1;
      cur.mass += Number(e.base_salary || 0);
      m.set(d, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.mass - a.mass);
  }, [employees]);

  const monthlyMass = byDept.reduce((s, d) => s + d.mass, 0);
  const hasMixedCurrency = employees.some((e) => e.status === "active" && kpis.currency && e.currency !== kpis.currency);
  const alerts: string[] = [];
  if (!kpis.isError && kpis.upcoming.length > 0) alerts.push(`${kpis.upcoming.length} cycle(s) à approuver/exécuter`);
  const draftRuns = kpis.runs.filter((r) => r.status === "draft").length;
  if (!kpis.isError && draftRuns > 0) alerts.push(`${draftRuns} cycle(s) brouillon en attente`);

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "RH / Paie", href: "/hr" }, { label: "Tableau de bord" }]} />
        <GuidanceBanner
          title="Tableau de bord RH & Paie"
          description="Vue d'ensemble : effectif, masse salariale, cycles à traiter, alertes opérationnelles."
        />

        {kpis.isError && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <span className="text-destructive">Certaines données RH/Paie n’ont pas pu être chargées. Les indicateurs peuvent être incomplets.</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void kpis.refetch()}>Réessayer</Button>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <KpiCard icon={Users} label="Effectif actif" value={kpis.isError ? "—" : fmt(kpis.activeEmployees)} />
          <KpiCard icon={Wallet} label={`Masse salariale mensuelle${kpis.currency ? ` (${kpis.currency})` : ""}`} value={kpis.isError ? "Indisponible" : hasMixedCurrency || !kpis.currency ? "Devises à vérifier" : maskAmount(perms, monthlyMass)} />
          <KpiCard icon={Wallet} label={`Masse salariale exercice${kpis.currency ? ` (${kpis.currency})` : ""}`} value={kpis.isError ? "Indisponible" : kpis.ytdGross == null ? "Non comparable" : maskAmount(perms, kpis.ytdGross)} />
          <KpiCard icon={CalendarClock} label="Cycles à venir" value={kpis.isError ? "—" : fmt(kpis.upcoming.length)} />
        </div>

        {alerts.length > 0 && (
          <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
            <CardContent className="py-2 flex items-center gap-2 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              {alerts.join(" · ")}
              <Button asChild size="sm" variant="ghost" className="ml-auto h-6 text-[11px]">
                <Link to="/hr/transactions">Traiter <ArrowRight className="w-3 h-3 ml-1" /></Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card className="lg:col-span-2">
            <CardHeader className="py-2"><CardTitle className="text-xs">Masse salariale par département</CardTitle></CardHeader>
            <CardContent className="h-64">
              {isLoading || kpis.isLoading ? <Skeleton className="h-full w-full" /> : kpis.isError ? (
                <p className="h-full flex items-center justify-center text-xs text-destructive">Graphique indisponible tant que toutes les données ne sont pas chargées.</p>
              ) : !canViewAmounts ? (
                <p className="h-full flex items-center justify-center text-xs text-muted-foreground">Les montants sont masqués pour votre rôle.</p>
              ) : hasMixedCurrency ? (
                <p className="h-full flex items-center justify-center text-xs text-muted-foreground">Les salariés actifs ne partagent pas la devise de paie configurée.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byDept}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="dept" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="mass" fill="hsl(var(--chart-1))" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-2"><CardTitle className="text-xs">Prochains cycles</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {kpis.isError ? (
                <p className="text-[11px] text-destructive">Échéances indisponibles.</p>
              ) : kpis.upcoming.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Aucun cycle planifié.</p>
              ) : kpis.upcoming.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-[11px] border-b pb-1">
                  <span className="font-mono">{r.period}</span>
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                  <span className="text-muted-foreground">{r.pay_date}</span>
                </div>
              ))}
              <Button asChild size="sm" variant="outline" className="w-full h-7 text-[11px] mt-2">
                <Link to="/hr/payroll"><FileText className="w-3 h-3 mr-1" /> Tous les cycles</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

function KpiCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className="w-3 h-3" /> {label}
        </div>
        <div className="text-lg font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
