import { useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, FileText, Lock } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { useAssets } from "@/hooks/use-asset-data";
import { useAssetKpis, useMyFixedAssetRoles } from "@/hooks/use-fixed-assets-data";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { actionTooltip, canDo, maskAmount } from "@/lib/fixed-assets-roles";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";
import { usePersistentState } from "@/hooks/use-persistent-state";

const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

function useDepreciationSeries(from: string, to: string) {
  return useQuery({
    queryKey: ["assets-dep-series", from, to],
    queryFn: async () => {
      let q = supabase.from("depreciation_entries").select("period_date, amount, asset:assets(depreciation_method)");
      if (from) q = q.gte("period_date", from);
      if (to) q = q.lte("period_date", to);
      const { data, error } = await q.order("period_date");
      if (error) throw error;
      return data || [];
    },
  });
}

export default function AssetsReporting() {
  const perms = useMyFixedAssetRoles();
  const { data: kpis } = useAssetKpis();
  const { data: assets = [], isLoading } = useAssets();

  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().slice(0, 10);
  const defaultTo = today.toISOString().slice(0, 10);
  const [from, setFrom] = usePersistentState<string>("fa-rep:from", defaultFrom);
  const [to, setTo] = usePersistentState<string>("fa-rep:to", defaultTo);
  const { data: series = [], isLoading: ls } = useDepreciationSeries(from, to);

  const monthly = useMemo(() => {
    const map = new Map<string, { month: string; linear: number; declining: number; total: number }>();
    (series as any[]).forEach((d) => {
      const m = String(d.period_date).slice(0, 7);
      const cur = map.get(m) || { month: m, linear: 0, declining: 0, total: 0 };
      const amt = Number(d.amount);
      cur.total += amt;
      if (d.asset?.depreciation_method === "declining_balance") cur.declining += amt;
      else cur.linear += amt;
      map.set(m, cur);
    });
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [series]);

  const nbvTrend = useMemo(() => {
    if (!kpis) return [];
    const gross = Number(kpis.gross_value || 0);
    let acc = 0;
    return monthly.map((m) => {
      acc += m.total;
      return { month: m.month, nbv: Math.max(0, gross - acc), accDep: acc };
    });
  }, [monthly, kpis]);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    (assets as any[]).forEach((a) => {
      const k = a.category?.name || "Sans catégorie";
      map.set(k, (map.get(k) || 0) + Number(a.acquisition_cost));
    });
    return [...map.entries()].map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length] }));
  }, [assets]);

  const locationBreakdown = useMemo(() => {
    const map = new Map<string, { cost: number; nbv: number; count: number }>();
    (assets as any[]).forEach((a) => {
      const k = a.location || "Non assigné";
      const cur = map.get(k) || { cost: 0, nbv: 0, count: 0 };
      cur.cost += Number(a.acquisition_cost);
      cur.nbv += Number(a.net_book_value);
      cur.count += 1;
      map.set(k, cur);
    });
    return [...map.entries()].map(([dept, v]) => ({ dept, ...v }));
  }, [assets]);

  const handleExport = () => {
    if (!canDo(perms, "export")) return;
    exportToCSV(
      monthly.map((m) => ({ Mois: m.month, Linéaire: m.linear, Dégressif: m.declining, Total: m.total })),
      [
        { key: "Mois", header: "Mois" },
        { key: "Linéaire", header: "Linéaire (XOF)" },
        { key: "Dégressif", header: "Dégressif (XOF)" },
        { key: "Total", header: "Total (XOF)" },
      ],
      `assets-depreciation-${from}_${to}`,
    );
  };

  const handleExportPDF = () => {
    if (!canDo(perms, "export")) return;
    exportToPDF({
      filename: `assets-depreciation-${from}_${to}.pdf`,
      title: "Reporting Immobilisations — Dotations mensuelles",
      subtitle: `Période : ${from} → ${to}`,
      columns: [
        { key: "month", header: "Mois" },
        { key: "linear", header: "Linéaire (XOF)", format: (r) => maskAmount(perms, (r as any).linear) },
        { key: "declining", header: "Dégressif (XOF)", format: (r) => maskAmount(perms, (r as any).declining) },
        { key: "total", header: "Total (XOF)", format: (r) => maskAmount(perms, (r as any).total) },
      ],
      rows: monthly,
    });
  };

  const exportTooltip = actionTooltip(perms, "export", "Exporter série de dotations");

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Fixed Assets", href: "/assets" }, { label: "Reporting" }]} />
      <GuidanceBanner title="Reporting Immobilisations" description="Dotations SYSCOHADA, VNC, amortissements cumulés par catégorie et localisation." />

      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h1 className="text-lg font-semibold text-foreground">Reporting</h1>
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[140px] text-xs" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[140px] text-xs" />
          <Button size="sm" variant="outline" className="gap-1.5"
            disabled={!canDo(perms, "export") || monthly.length === 0}
            onClick={handleExport}
            aria-label={exportTooltip} title={exportTooltip}>
            {canDo(perms, "export") ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Export CSV
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5"
            disabled={!canDo(perms, "export") || monthly.length === 0}
            onClick={handleExportPDF}
            aria-label={exportTooltip} title={exportTooltip}>
            {canDo(perms, "export") ? <FileText className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Export PDF
          </Button>
        </div>
      </div>

      {(isLoading || ls) ? (
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Skeleton className="h-[320px]" /><Skeleton className="h-[320px]" />
        </div>
      ) : monthly.length === 0 ? (
        <Card className="border-border mb-4"><CardContent className="p-8 text-center text-sm text-muted-foreground">
          Aucune dotation enregistrée pour la période {from} → {to}.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Dotations mensuelles (XOF)</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="linear" name="Linéaire" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="declining" name="Dégressif" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">VNC & Amortissements cumulés</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={nbvTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="nbv" name="VNC" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="accDep" name="Cumul" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Répartition par catégorie</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            {categoryBreakdown.length === 0 ? (
              <div className="text-xs text-muted-foreground py-8 text-center">Aucun actif.</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={categoryBreakdown} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={3}>
                      {categoryBreakdown.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => maskAmount(perms, v) + " XOF"} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 mt-2">
                  {categoryBreakdown.map((c) => (
                    <div key={c.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} /><span className="text-muted-foreground">{c.name}</span></div>
                      <span className="font-mono font-medium">{maskAmount(perms, c.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-border col-span-2">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Synthèse par localisation</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            {locationBreakdown.length === 0 ? (
              <div className="text-xs text-muted-foreground py-8 text-center">Aucune donnée.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-[11px] font-semibold">Localisation</TableHead>
                    <TableHead className="text-[11px] font-semibold text-right">Actifs</TableHead>
                    <TableHead className="text-[11px] font-semibold text-right">Coût</TableHead>
                    <TableHead className="text-[11px] font-semibold text-right">VNC</TableHead>
                    <TableHead className="text-[11px] font-semibold">% Amorti</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locationBreakdown.map((d) => (
                    <TableRow key={d.dept} className="text-xs">
                      <TableCell className="font-medium">{d.dept}</TableCell>
                      <TableCell className="text-right">{d.count}</TableCell>
                      <TableCell className="text-right font-mono">{maskAmount(perms, d.cost)}</TableCell>
                      <TableCell className="text-right font-mono">{maskAmount(perms, d.nbv)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={d.cost > 0 ? ((d.cost - d.nbv) / d.cost) * 100 : 0} className="h-1.5 w-16" />
                          <span className="text-[10px]">{d.cost > 0 ? Math.round(((d.cost - d.nbv) / d.cost) * 100) : 0}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
