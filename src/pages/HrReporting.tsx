import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExportButtons } from "@/components/ExportButtons";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Lock, Printer } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { usePayrollRegister, usePayrollRuns, useTenantFiscalYearStart, useMyHrRoles, type PayrollRegisterRow } from "@/hooks/use-hr-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/hr-roles";
import { exportToPDF } from "@/lib/pdf-export";
import { validatePayrollReportRange } from "@/lib/hr-periods";
import { fiscalYearStartPeriod, postedPayrollToDateTotals, sumReportAmounts } from "@/lib/payroll-summary";

const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const EMPTY_REGISTER_ROWS: PayrollRegisterRow[] = [];

export default function HrReporting() {
  const perms = useMyHrRoles();
  const canExport = canDo(perms, "export");
  const canViewAmounts = canDo(perms, "view_sensitive");
  const exportTip = actionTooltip(perms, "export", "Exporter");

  const { data: runs = [], isLoading: lr, isError: runsError, error: runsErrorInfo, refetch: refetchRuns } = usePayrollRuns();
  const fiscalStart = useTenantFiscalYearStart();

  const currentPeriod = new Date().toISOString().slice(0, 7);
  const defaultFrom = fiscalYearStartPeriod(currentPeriod, fiscalStart.data ?? 1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const reportFrom = from || defaultFrom;
  const reportTo = to || currentPeriod;
  const rangeError = validatePayrollReportRange(reportFrom, reportTo);
  const register = usePayrollRegister(reportFrom, reportTo, canViewAmounts && !rangeError);
  const hasDataError = runsError || register.isError || fiscalStart.isError;
  const registerRows = register.data ?? EMPTY_REGISTER_ROWS;

  const filteredRuns = useMemo(
    () => runs.filter((r) => r.status === "posted" && r.period >= reportFrom && r.period <= reportTo),
    [runs, reportFrom, reportTo],
  );

  const monthly = useMemo(() => {
    const map = new Map<string, { period: string; label: string; currency: string | null; gross: number; deductions: number; taxes: number; employerCharges: number; net: number; runs: number }>();
    filteredRuns.forEach((r) => {
      const currency = r.payroll_currency_code?.trim().toUpperCase() || null;
      const key = `${r.period}|${currency ?? "?"}`;
      const cur = map.get(key) || { period: r.period, label: `${r.period} · ${currency ?? "?"}`, currency, gross: 0, deductions: 0, taxes: 0, employerCharges: 0, net: 0, runs: 0 };
      cur.gross += Number(r.gross_total || 0);
      cur.deductions += Number(r.deductions_total || 0);
      cur.taxes += Number(r.taxes_total || 0);
      cur.employerCharges += Number(r.employer_charges_total || 0);
      cur.net += Number(r.net_total || 0);
      cur.runs += 1;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period) || (a.currency ?? "").localeCompare(b.currency ?? ""));
  }, [filteredRuns]);

  const byDept = useMemo(() => {
    const currencyByPeriod = new Map(filteredRuns.map((run) => [run.period, run.payroll_currency_code?.trim().toUpperCase() || null]));
    const m = new Map<string, { dept: string; currency: string | null; employees: Set<string>; gross: number }>();
    registerRows.forEach((row, index) => {
      const dept = row.department === null ? "Affectation historique inconnue" : row.department.trim() || "Non assigné au calcul";
      const currency = row.period ? currencyByPeriod.get(row.period) ?? null : null;
      const key = `${dept}|${currency ?? "?"}`;
      const cur = m.get(key) || { dept, currency, employees: new Set<string>(), gross: 0 };
      cur.employees.add(row.matricule || `ligne-${index}`);
      cur.gross += Number(row.gross || 0);
      m.set(key, cur);
    });
    return Array.from(m.values()).map((row) => ({ ...row, count: row.employees.size }))
      .sort((a, b) => b.gross - a.gross);
  }, [filteredRuns, registerRows]);

  const totalGross = sumReportAmounts(monthly.map((row) => ({ currency: row.currency, amount: row.gross })));
  const totalNet = sumReportAmounts(monthly.map((row) => ({ currency: row.currency, amount: row.net })));
  const toDateTotals = postedPayrollToDateTotals(runs, reportTo, fiscalStart.data ?? 1);
  const { fiscalStartPeriod, mtdGross, mtdNet, ytdGross, ytdNet } = {
    fiscalStartPeriod: toDateTotals.yearStart, ...toDateTotals,
  };
  const currencies = [...new Set(monthly.map((row) => row.currency))];
  const reportCurrency = currencies.length === 1 ? currencies[0] : currencies.length > 1 ? "Devises mixtes" : "—";
  const chartComparable = currencies.length <= 1 && monthly.every((row) => !!row.currency);
  const monthlyExportRows = monthly.map((row) => ({
    period: row.period,
    currency: row.currency ?? "Non enregistrée",
    runs: row.runs,
    gross: canViewAmounts ? row.gross : "Masqué",
    deductions: canViewAmounts ? row.deductions : "Masqué",
    taxes: canViewAmounts ? row.taxes : "Masqué",
    employerCharges: canViewAmounts ? row.employerCharges : "Masqué",
    net: canViewAmounts ? row.net : "Masqué",
  }));
  const monthlyExportColumns = [
    { key: "period", header: "Période", width: 14 },
    { key: "currency", header: "Devise", width: 16 },
    { key: "runs", header: "Cycles comptabilisés", width: 22 },
    { key: "gross", header: "Brut", width: 18 },
    { key: "deductions", header: "Retenues salariales", width: 22 },
    { key: "taxes", header: "Impôts", width: 18 },
    { key: "employerCharges", header: "Charges employeur", width: 22 },
    { key: "net", header: "Net", width: 18 },
  ] as const;
  const departmentExportRows = byDept.map((row) => ({
    department: row.dept,
    currency: row.currency ?? "Non enregistrée",
    employees: row.count,
    gross: row.gross,
  }));
  const departmentExportColumns = [
    { key: "department", header: "Département", width: 28 },
    { key: "currency", header: "Devise", width: 16 },
    { key: "employees", header: "Effectif distinct", width: 20 },
    { key: "gross", header: "Brut comptabilisé", width: 22 },
  ] as const;

  const onExportPdf = () => {
    if (!canExport || rangeError || monthly.length === 0) return;
    exportToPDF<{ period: string; label: string; currency: string | null; runs: number; gross: number; deductions: number; taxes: number; employerCharges: number; net: number }>({
      filename: `hr-register-${reportFrom}-to-${reportTo}`,
      title: `Registre paie ${reportFrom} → ${reportTo}`,
      subtitle: `${monthly.length} période(s) · ${filteredRuns.length} cycle(s)`,
      columns: [
        { key: "period", header: "Période", format: (r) => r.period },
        { key: "currency", header: "Devise", format: (r) => r.currency ?? "Devise non enregistrée" },
        { key: "runs", header: "Cycles", format: (r) => String(r.runs) },
        { key: "gross", header: "Brut", format: (r) => maskAmount(perms, r.gross) },
        { key: "deductions", header: "Retenues salariales", format: (r) => maskAmount(perms, r.deductions) },
        { key: "taxes", header: "Impôts", format: (r) => maskAmount(perms, r.taxes) },
        { key: "employerCharges", header: "Charges employeur", format: (r) => maskAmount(perms, r.employerCharges) },
        { key: "net", header: "Net", format: (r) => maskAmount(perms, r.net) },
      ],
      rows: monthly,
    });
  };

  const onExportDepartmentPdf = () => {
    if (!canExport || !canViewAmounts || rangeError || departmentExportRows.length === 0) return;
    void exportToPDF({
      filename: `hr-departments-${reportFrom}-to-${reportTo}`,
      title: "Paie comptabilisée par département",
      subtitle: `Période ${reportFrom} à ${reportTo} · montants réels des cycles comptabilisés`,
      columns: [
        { key: "department", header: "Département" },
        { key: "currency", header: "Devise" },
        { key: "employees", header: "Effectif distinct" },
        { key: "gross", header: "Brut comptabilisé", format: (row) => fmt(Number(row.gross)) },
      ],
      rows: departmentExportRows,
    });
  };

  const printReport = () => {
    if (!canExport || rangeError || monthly.length === 0) return;
    document.body.classList.add("printing-payroll-report");
    window.onafterprint = () => {
      document.body.classList.remove("printing-payroll-report");
      window.onafterprint = null;
    };
    window.print();
  };

  return (
    <PageShell>
      <style>{`@page {
        size: A4 landscape; margin: 12mm;
        @bottom-right { content: "Page " counter(page) " / " counter(pages); font-size: 8pt; color: #555; }
      }
      @media print {
        body.printing-payroll-report * { visibility: hidden !important; }
        body.printing-payroll-report #payroll-print-report,
        body.printing-payroll-report #payroll-print-report * { visibility: visible !important; }
        body.printing-payroll-report #payroll-print-report { display: block !important; position: absolute; top: 0; left: 0; width: 100%; padding: 0; background: white; color: black; }
        body.printing-payroll-report #payroll-print-report table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; }
        body.printing-payroll-report #payroll-print-report thead { display: table-header-group; }
        body.printing-payroll-report #payroll-print-report tr { break-inside: avoid; }
        body.printing-payroll-report #payroll-print-report th,
        body.printing-payroll-report #payroll-print-report td { border: 1px solid #777; padding: 5px 7px; font-size: 10pt; text-align: left; }
        body.printing-payroll-report #payroll-print-report h1 { font-size: 18pt; }
      }`}</style>
      <section id="payroll-print-report" className="hidden">
        <h1>Registre de paie</h1>
        <p>Période : {reportFrom} à {reportTo} · généré le {new Date().toLocaleString("fr-FR")}</p>
        <h2>Cycles comptabilisés par période et devise</h2>
        <table><thead><tr><th>Période</th><th>Devise</th><th>Cycles</th><th>Brut</th><th>Retenues</th><th>Impôts</th><th>Charges employeur</th><th>Net</th></tr></thead>
          <tbody>{monthly.map((row) => <tr key={row.label}><td>{row.period}</td><td>{row.currency ?? "Non enregistrée"}</td><td>{row.runs}</td><td>{maskAmount(perms, row.gross)}</td><td>{maskAmount(perms, row.deductions)}</td><td>{maskAmount(perms, row.taxes)}</td><td>{maskAmount(perms, row.employerCharges)}</td><td>{maskAmount(perms, row.net)}</td></tr>)}</tbody>
        </table>
        <h2>Brut comptabilisé par département</h2>
        <table><thead><tr><th>Département</th><th>Devise</th><th>Effectif distinct</th><th>Brut comptabilisé</th></tr></thead>
          <tbody>{byDept.map((row) => <tr key={`${row.dept}-${row.currency}`}><td>{row.dept}</td><td>{row.currency ?? "Non enregistrée"}</td><td>{row.count}</td><td>{maskAmount(perms, row.gross)}</td></tr>)}</tbody>
        </table>
      </section>
      <div className="space-y-3 print:hidden">
        <Breadcrumb items={[{ label: "RH / Paie", href: "/hr" }, { label: "Rapports" }]} />
        <GuidanceBanner
          title="Reporting paie"
          description="Cycles comptabilisés et lignes réelles par période et devise; l’affectation analytique est figée lors du calcul."
        />

        <Card>
          <CardContent className="py-2 flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">De</label>
              <Input type="month" value={reportFrom} onChange={(e) => setFrom(e.target.value)} className="h-7 text-xs w-36" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">À</label>
              <Input type="month" value={reportTo} onChange={(e) => setTo(e.target.value)} className="h-7 text-xs w-36" />
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <ExportButtons pdf={false} label="Registre" rows={monthlyExportRows} columns={[...monthlyExportColumns]} filename={`hr-register-${reportFrom}-to-${reportTo}`} sheetName="Registre paie" disabled={!canExport || !!rangeError || hasDataError || lr || register.isLoading} />
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={!canExport || !!rangeError || hasDataError || monthly.length === 0 || lr} title={exportTip} onClick={onExportPdf}>
                {canExport ? <FileText className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} Registre PDF
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={!canExport || !!rangeError || hasDataError || monthly.length === 0 || lr} title={exportTip} onClick={printReport}>
                {canExport ? <Printer className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} Imprimer
              </Button>
            </div>
          </CardContent>
        </Card>
        {rangeError && <p role="alert" className="text-xs text-destructive">{rangeError}</p>}
        {(runsError || register.isError || fiscalStart.isError) && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <span className="text-destructive">Le rapport n’a pas pu charger toutes ses données{runsErrorInfo instanceof Error ? ` : ${runsErrorInfo.message}` : "."}</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { void refetchRuns(); void register.refetch(); void fiscalStart.refetch(); }}>Réessayer</Button>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-2">
          <Kpi label="Périodes" value={fmt(monthly.length)} />
          <Kpi label="Cycles" value={fmt(filteredRuns.length)} />
          <Kpi label={`Brut cumulé · ${reportCurrency}`} value={totalGross === null ? "Non comparable" : maskAmount(perms, totalGross)} />
          <Kpi label={`Net cumulé · ${reportCurrency}`} value={totalNet === null ? "Non comparable" : maskAmount(perms, totalNet)} />
          <Kpi label={`Brut MTD · ${reportTo}`} value={mtdGross === null ? "Non comparable" : maskAmount(perms, mtdGross)} />
          <Kpi label={`Net MTD · ${reportTo}`} value={mtdNet === null ? "Non comparable" : maskAmount(perms, mtdNet)} />
          <Kpi label={`Brut exercice · ${fiscalStartPeriod}–${reportTo}`} value={ytdGross === null ? "Non comparable" : maskAmount(perms, ytdGross)} />
          <Kpi label={`Net exercice · ${fiscalStartPeriod}–${reportTo}`} value={ytdNet === null ? "Non comparable" : maskAmount(perms, ytdNet)} />
        </div>

        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Évolution mensuelle</CardTitle></CardHeader>
          <CardContent className="h-64">
            {lr || register.isLoading ? <Skeleton className="h-full w-full" /> : !canViewAmounts ? (
              <p className="h-full flex items-center justify-center text-xs text-muted-foreground">Les montants sont masqués pour votre rôle.</p>
            ) : monthly.length === 0 ? (
              <p className="h-full flex items-center justify-center text-xs text-muted-foreground">Aucun cycle comptabilisé sur la période.</p>
            ) : !chartComparable ? (
              <p className="h-full flex items-center justify-center text-xs text-muted-foreground">Devises mixtes ou historiques inconnus : utilisez le registre détaillé ci-dessous.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
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
          <CardHeader className="py-2"><CardTitle className="text-xs">Registre par période et devise</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[11px]">Période</TableHead>
                <TableHead className="text-[11px]">Devise</TableHead>
                <TableHead className="text-[11px] text-right">Cycles</TableHead>
                <TableHead className="text-[11px] text-right">Brut</TableHead>
                <TableHead className="text-[11px] text-right">Net</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {monthly.map((row) => <TableRow key={row.label}>
                  <TableCell className="text-xs">{row.period}</TableCell>
                  <TableCell className="text-xs">{row.currency ?? "Non enregistrée"}</TableCell>
                  <TableCell className="text-xs text-right">{row.runs}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{maskAmount(perms, row.gross)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{maskAmount(perms, row.net)}</TableCell>
                </TableRow>)}
                {monthly.length === 0 && <TableRow><TableCell colSpan={5} className="py-5 text-center text-xs text-muted-foreground">Aucun cycle comptabilisé.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2 flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-xs">Brut comptabilisé par département et devise</CardTitle>
            <div className="flex gap-2">
              <ExportButtons pdf={false} label="Départements" rows={departmentExportRows} columns={[...departmentExportColumns]} filename={`hr-departments-${reportFrom}-to-${reportTo}`} sheetName="Départements" disabled={!canExport || !canViewAmounts || !!rangeError || hasDataError || register.isLoading} />
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={!canExport || !canViewAmounts || !!rangeError || hasDataError || departmentExportRows.length === 0 || register.isLoading} title={exportTip} onClick={onExportDepartmentPdf}>
                {canExport ? <FileText className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {register.isLoading ? <Skeleton className="h-32 w-full" /> : !canViewAmounts ? (
              <p className="py-5 text-center text-xs text-muted-foreground">Le droit de consultation des montants est requis pour ce détail.</p>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-[11px]">Département</TableHead>
                  <TableHead className="text-[11px]">Devise</TableHead>
                  <TableHead className="text-[11px] text-right">Effectif distinct</TableHead>
                  <TableHead className="text-[11px] text-right">Brut comptabilisé</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {byDept.map((row) => <TableRow key={`${row.dept}-${row.currency}`}>
                    <TableCell className="text-xs">{row.dept}</TableCell>
                    <TableCell className="text-xs">{row.currency ?? "Non enregistrée"}</TableCell>
                    <TableCell className="text-xs text-right">{row.count}</TableCell>
                    <TableCell className="text-xs text-right font-mono">{maskAmount(perms, row.gross)}</TableCell>
                  </TableRow>)}
                  {byDept.length === 0 && <TableRow><TableCell colSpan={4} className="py-5 text-center text-xs text-muted-foreground">Aucune ligne comptabilisée.</TableCell></TableRow>}
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
