import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Download, Plus, Lock } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useMyComplianceRoles } from "@/hooks/use-compliance-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/compliance-roles";

const controls = [
  { id: "CTL-001", name: "Journal Entry Approval", framework: "SOX", category: "Financial Reporting", status: "Effective", frequency: "Continuous", owner: "A. Koné" },
  { id: "CTL-002", name: "Segregation of Duties", framework: "SOX", category: "Access Control", status: "Effective", frequency: "Monthly", owner: "M. Diallo" },
  { id: "CTL-003", name: "Bank Reconciliation", framework: "SOX", category: "Treasury", status: "Needs Improvement", frequency: "Monthly", owner: "S. Bamba" },
  { id: "CTL-004", name: "Revenue Recognition", framework: "IFRS 15", category: "Financial Reporting", status: "Effective", frequency: "Quarterly", owner: "K. Touré" },
  { id: "CTL-005", name: "Lease Accounting", framework: "IFRS 16", category: "Fixed Assets", status: "Not Tested", frequency: "Semi-Annual", owner: "B. Coulibaly" },
  { id: "CTL-006", name: "Vendor Payment Approval", framework: "SOX", category: "Procurement", status: "Deficiency", frequency: "Continuous", owner: "A. Koné" },
];

export default function ComplianceMasterData() {
  const perms = useMyComplianceRoles();
  const canCreate = canDo(perms, "create_control");
  const canExport = canDo(perms, "export");
  const table = useTableFeatures({
    data: controls, pageSize: 10, searchableKeys: ["name", "id", "owner"],
    filterConfigs: [
      { key: "framework", label: "Framework", options: ["SOX", "IFRS 15", "IFRS 16"] },
      { key: "status", label: "Status", options: ["Effective", "Needs Improvement", "Not Tested", "Deficiency"] },
      { key: "category", label: "Category", options: [...new Set(controls.map(c => c.category))] },
    ],
  });

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Compliance", href: "/compliance" }, { label: "Master Data" }]} />
      <GuidanceBanner title="Controls Catalogue" description="Internal controls inventory with frameworks (SOX/IFRS), ownership, and test frequency." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Controls Catalogue</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" disabled={!canCreate} aria-label={actionTooltip(perms, "create_control", "Créer un contrôle")} title={actionTooltip(perms, "create_control", "Créer un contrôle")}>
            {canCreate ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Add Control
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
          <SortableHead label="Control" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Framework" sortKey="framework" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Category" sortKey="category" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Frequency" sortKey="frequency" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Owner" sortKey="owner" sort={table.sort} onSort={table.toggleSort} />
        </TableRow></TableHeader>
        <TableBody>{table.pagedData.map(c => (
          <TableRow key={c.id} className="text-xs">
            <TableCell className="font-mono text-primary">{c.id}</TableCell>
            <TableCell className="font-medium">{c.name}</TableCell>
            <TableCell><Badge variant="outline" className="text-[10px]">{c.framework}</Badge></TableCell>
            <TableCell className="text-muted-foreground">{c.category}</TableCell>
            <TableCell className="text-muted-foreground">{c.frequency}</TableCell>
            <TableCell><Badge className={`text-[10px] ${c.status === "Effective" ? "bg-success/15 text-success border-success/20" : c.status === "Deficiency" ? "bg-destructive/15 text-destructive border-destructive/20" : c.status === "Needs Improvement" ? "bg-amber-500/15 text-amber-700 border-amber-500/20" : ""}`} variant={c.status === "Not Tested" ? "secondary" : "outline"}>{c.status}</Badge></TableCell>
            <TableCell className="text-muted-foreground">{maskAmount(perms, c.owner)}</TableCell>
          </TableRow>
        ))}</TableBody></Table>
        <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
      </CardContent></Card>
    </PageShell>
  );
}
