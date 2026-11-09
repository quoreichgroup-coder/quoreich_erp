import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, FileText, Lock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useEmployees, usePayrollRuns, useMyHrRoles } from "@/hooks/use-hr-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/hr-roles";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";

const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

export default function HrReporting() {
  const perms = useMyHrRoles();
  const canExport = canDo(perms, "export");
  const exportTip = actionTooltip(perms, "export", "Exporter");

  const { data: employees = [], isLoading: le } = useEmployees();
  const { data: runs = [], isLoading: lr } = usePayrollRuns();

  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01`);
  const [to, setTo] = useState(`${year}-12`);

  const filteredRuns = useMemo(
    () => runs.filter((r) => r.period >= from && r.period <= to),
    [runs, from, to],
  );

  const monthly = useMemo(() => {
    const map = new Map<string, { period: string; gross: number; net: number; runs: number }>();
    filteredRuns.forEach((r) => {
      const cur = map.get(r.period) || { period: r.period, gross: 0, net: 0, runs: 0 };
      cur.gross += Number(r.gross_total || 0);
      cur.net += Number(r.net_total || 0);
      cur.runs += 1;
      map.set(r.period, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
  }, [filteredRuns]);

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

  const totalGross = monthly.reduce((s, m) => s + m.gross, 0);
  const totalNet = monthly.reduce((s, m) => s + m.net, 0);

  const onExportCsv = () => {
    if (!canExport) return;
    const view = canDo(perms, "view_sensitive");
    exportToCSV(
      monthly.map((m) => ({
        period: m.period,
        runs: m.runs,
        gross: view ? m.gross : 0,
        net: view ? m.net : 0,
      })),
      [
        { key: "period", header: "Période" },
        { key: "runs", header: "Cycles" },
        { key: "gross", header: "Brut" },
        { key: "net", header: "Net" },
      ],
      `hr-register-${from}-to-${to}`,
    );
  };

  const onExportPdf = () => {
    if (!canExport) return;
    exportToPDF<{ period: string; runs: number; gross: number; net: number }>({
      filename: `hr-register-${from}-to-${to}`,
      title: `Registre paie ${from} → ${to}`,
      subtitle: `${monthly.length} période(s) · ${filteredRuns.length} cycle(s)`,
      columns: [
        { key: "period", header: "Période", format: (r) => r.period },
        { key: "runs", header: "Cycles", format: (r) => String(r.runs) },
        { key: "gross", header: "Brut", format: (r) => maskAmount(perms, r.gross) },
        { key: "net", header: "Net", format: (r) => maskAmount(perms, r.net) },
      ],
      rows: monthly,
    });
  };

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "RH / Paie", href: "/hr" }, { label: "Reporting" }]} />
        <GuidanceBanner
          title="Reporting paie"
          description="Registre légal mensuel, masse salariale par département, exports CSV/PDF (gated)."
        />

        <Card>
          <CardContent className="py-2 flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">De</label>
              <Input value={from} onChange={(e) => setFrom(e.target.value)} className="h-7 text-xs w-28" placeholder="2026-01" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">À</label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} className="h-7 text-xs w-28" placeholder="2026-12" />
            </div>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" disabled={!canExport} title={exportTip} onClick={onExportCsv}>
                {canExport ? <Download className="w-3 h-3" /> : <Lock className="w-3 h-3" />} CSV
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" disabled={!canExport} title={exportTip} onClick={onExportPdf}>
                {canExport ? <FileText className="w-3 h-3" /> : <Lock className="w-3 h-3" />} PDF
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Kpi label="Périodes" value={fmt(monthly.length)} />
          <Kpi label="Cycles" value={fmt(filteredRuns.length)} />
          <Kpi label="Brut cumulé" value={maskAmount(perms, totalGross)} />
          <Kpi label="Net cumulé" value={maskAmount(perms, totalNet)} />
        </div>

        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Évolution mensuelle</CardTitle></CardHeader>
          <CardContent className="h-64">
            {lr ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="gross" name="Brut" fill="hsl(var(--chart-1))" />
                  <Bar dataKey="net" name="Net" fill="hsl(var(--chart-2))" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Masse salariale par département</CardTitle></CardHeader>
          <CardContent>
            {le ? <Skeleton className="h-32 w-full" /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">Département</TableHead>
                    <TableHead className="text-[11px] text-right">Effectif</TableHead>
                    <TableHead className="text-[11px] text-right">Masse mensuelle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byDept.map((d) => (
                    <TableRow key={d.dept}>
                      <TableCell className="text-xs">{d.dept}</TableCell>
                      <TableCell className="text-xs text-right">{d.count}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{maskAmount(perms, d.mass)}</TableCell>
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

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
