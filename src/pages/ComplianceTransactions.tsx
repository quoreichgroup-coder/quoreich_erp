import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Plus, Lock } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useMyComplianceRoles } from "@/hooks/use-compliance-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/compliance-roles";

const testLogs = [
  { id: "TST-001", date: "2025-02-15", control: "CTL-001 — Journal Entry Approval", framework: "SOX", tester: "A. Koné", result: "Pass", findings: 0, duration: "2h" },
  { id: "TST-002", date: "2025-02-20", control: "CTL-002 — Segregation of Duties", framework: "SOX", tester: "M. Diallo", result: "Pass", findings: 0, duration: "3h" },
  { id: "TST-003", date: "2025-01-30", control: "CTL-003 — Bank Reconciliation", framework: "SOX", tester: "S. Bamba", result: "Partial Pass", findings: 2, duration: "4h" },
  { id: "TST-004", date: "2025-02-10", control: "CTL-004 — Revenue Recognition", framework: "IFRS 15", tester: "K. Touré", result: "Pass", findings: 0, duration: "2.5h" },
  { id: "TST-005", date: "2025-02-25", control: "CTL-006 — Vendor Payment Approval", framework: "SOX", tester: "A. Koné", result: "Fail", findings: 3, duration: "3h" },
];

export default function ComplianceTransactions() {
  const perms = useMyComplianceRoles();
  const canRun = canDo(perms, "run_test");
  const canExport = canDo(perms, "export");
  const table = useTableFeatures({
    data: testLogs, pageSize: 10, searchableKeys: ["control", "id", "tester"],
    filterConfigs: [
      { key: "framework", label: "Framework", options: ["SOX", "IFRS 15", "IFRS 16"] },
      { key: "result", label: "Result", options: ["Pass", "Partial Pass", "Fail"] },
    ],
  });

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Compliance", href: "/compliance" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Control Test Logs" description="Control testing results, findings, and historical test records." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Control Test Logs</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" disabled={!canRun} aria-label={actionTooltip(perms, "run_test", "Lancer un test")} title={actionTooltip(perms, "run_test", "Lancer un test")}>
            {canRun ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}New Test
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport} aria-label={actionTooltip(perms, "export", "Exporter")} title={actionTooltip(perms, "export", "Exporter")}>
            {canExport ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Export
          </Button>
        </div>
      </div>

      <Card className="border-border"><CardContent className="p-0">
        <FilterBar search={table.search} onSearch={table.setSearch} filters={table.filters} onFilter={table.setFilter} onClear={table.clearFilters} filterConfigs={table.filterConfigs} activeCount={table.activeFilterCount} searchPlaceholder="Rechercher…" />
        <Table><TableHeader><TableRow className="bg-muted/30">
          <SortableHead label="ID" sortKey="id" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Date" sortKey="date" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Control" sortKey="control" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Framework" sortKey="framework" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Tester" sortKey="tester" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Result" sortKey="result" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Findings" sortKey="findings" sort={table.sort} onSort={table.toggleSort} className="text-right" />
          <SortableHead label="Duration" sortKey="duration" sort={table.sort} onSort={table.toggleSort} />
        </TableRow></TableHeader>
        <TableBody>{table.pagedData.map(t => (
          <TableRow key={t.id} className="text-xs">
            <TableCell className="font-mono text-primary">{t.id}</TableCell>
            <TableCell className="font-mono text-muted-foreground">{t.date}</TableCell>
            <TableCell className="font-medium max-w-[200px] truncate">{t.control}</TableCell>
            <TableCell><Badge variant="outline" className="text-[10px]">{t.framework}</Badge></TableCell>
            <TableCell className="text-muted-foreground">{maskAmount(perms, t.tester)}</TableCell>
            <TableCell><Badge className={`text-[10px] ${t.result === "Pass" ? "bg-success/15 text-success border-success/20" : t.result === "Fail" ? "bg-destructive/15 text-destructive border-destructive/20" : "bg-amber-500/15 text-amber-700 border-amber-500/20"}`} variant="outline">{t.result}</Badge></TableCell>
            <TableCell className="text-right">{maskAmount(perms, t.findings)}</TableCell>
            <TableCell className="text-muted-foreground">{t.duration}</TableCell>
          </TableRow>
        ))}</TableBody></Table>
        <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
      </CardContent></Card>
    </PageShell>
  );
}
