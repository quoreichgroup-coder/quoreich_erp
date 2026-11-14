import { useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, FileDown } from "lucide-react";
import { useCrmOpportunities, useMyCrmRoles } from "@/hooks/use-crm-data";
import { CRM_STAGES, STAGE_LABELS, actionTooltip, maskAmount } from "@/lib/crm-roles";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";

export default function CrmReporting() {
  const perms = useMyCrmRoles();
  const { data: opps = [] } = useCrmOpportunities();

  const funnel = useMemo(() => CRM_STAGES.map((s) => ({
    stage: STAGE_LABELS[s],
    count: opps.filter((o) => o.stage === s).length,
    value: opps.filter((o) => o.stage === s).reduce((acc, o) => acc + Number(o.amount || 0), 0),
    weighted: opps.filter((o) => o.stage === s).reduce((acc, o) => acc + Number(o.amount || 0) * Number(o.probability || 0) / 100, 0),
  })), [opps]);

  const totals = funnel.reduce((a, b) => ({ count: a.count + b.count, value: a.value + b.value, weighted: a.weighted + b.weighted }), { count: 0, value: 0, weighted: 0 });

  function exportCsv() {
    if (!perms.canExport) return;
    exportToCSV(
      funnel.map((f) => ({ stage: f.stage, count: f.count, value: f.value, weighted: Math.round(f.weighted) })),
      [
        { key: "stage", header: "Étape" }, { key: "count", header: "Nb" },
        { key: "value", header: "Valeur totale" }, { key: "weighted", header: "Valeur pondérée" },
      ],
      `crm-funnel-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  function exportPdf() {
    if (!perms.canExport) return;
    exportToPDF({
      filename: `crm-funnel-${new Date().toISOString().slice(0, 10)}.pdf`,
      title: "Funnel CRM",
      subtitle: `Total : ${totals.count} opportunités · ${maskAmount(perms, totals.value)} XOF`,
      columns: [
        { key: "stage", header: "Étape" }, { key: "count", header: "Nb" },
        { key: "value", header: "Valeur", format: (r) => maskAmount(perms, Number((r as { value: number }).value)) },
        { key: "weighted", header: "Pondérée", format: (r) => maskAmount(perms, Math.round(Number((r as { weighted: number }).weighted))) },
      ],
      rows: funnel as unknown as Record<string, unknown>[],
    });
  }

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "CRM", href: "/crm" }, { label: "Rapports" }]} />
        <GuidanceBanner title="Reporting CRM" description="Funnel commercial, prévisions pondérées, exports CSV/PDF gated par RBAC." />

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!perms.canExport} title={actionTooltip(perms, "export", "Exporter CSV")} onClick={exportCsv}>
            <Download className="w-3.5 h-3.5 mr-1" /> CSV
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!perms.canExport} title={actionTooltip(perms, "export", "Exporter PDF")} onClick={exportPdf}>
            <FileDown className="w-3.5 h-3.5 mr-1" /> PDF
          </Button>
        </div>

        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Funnel commercial</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Étape</TableHead>
                  <TableHead className="text-[11px] text-right">Nb</TableHead>
                  <TableHead className="text-[11px] text-right">Valeur totale</TableHead>
                  <TableHead className="text-[11px] text-right">Valeur pondérée</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {funnel.map((f) => (
                  <TableRow key={f.stage} className="text-xs">
                    <TableCell>{f.stage}</TableCell>
                    <TableCell className="text-right">{f.count}</TableCell>
                    <TableCell className="text-right font-mono">{maskAmount(perms, f.value)}</TableCell>
                    <TableCell className="text-right font-mono">{maskAmount(perms, Math.round(f.weighted))}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="text-xs font-semibold border-t-2">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{totals.count}</TableCell>
                  <TableCell className="text-right font-mono">{maskAmount(perms, totals.value)}</TableCell>
                  <TableCell className="text-right font-mono">{maskAmount(perms, Math.round(totals.weighted))}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
