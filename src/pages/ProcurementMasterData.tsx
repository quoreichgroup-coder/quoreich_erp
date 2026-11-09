import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Plus } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";

const contracts = [
  { id: "CTR-001", supplier: "Dell Technologies", type: "Framework", value: 250000, start: "2024-01-01", end: "2026-12-31", status: "Active", utilization: 68, slaScore: 94, deliveryOnTime: 92, category: "IT Hardware" },
  { id: "CTR-002", supplier: "Total Energies", type: "Service", value: 45000, start: "2024-06-01", end: "2025-12-31", status: "Active", utilization: 82, slaScore: 88, deliveryOnTime: 85, category: "Utilities" },
  { id: "CTR-003", supplier: "Orange Business", type: "Framework", value: 120000, start: "2023-01-01", end: "2025-12-31", status: "Expiring", utilization: 91, slaScore: 96, deliveryOnTime: 98, category: "Telecom" },
  { id: "CTR-004", supplier: "Société Générale", type: "Service", value: 35000, start: "2025-01-01", end: "2027-12-31", status: "Active", utilization: 12, slaScore: 100, deliveryOnTime: 100, category: "Banking" },
  { id: "CTR-005", supplier: "Cisco Systems", type: "Framework", value: 180000, start: "2024-03-01", end: "2026-06-30", status: "Active", utilization: 49, slaScore: 91, deliveryOnTime: 90, category: "IT Network" },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function ProcurementMasterData() {
  const table = useTableFeatures({
    data: contracts,
    pageSize: 10,
    searchableKeys: ["supplier", "id", "category"],
    filterConfigs: [
      { key: "status", label: "Status", options: ["Active", "Expiring"] },
      { key: "type", label: "Type", options: ["Framework", "Service"] },
      { key: "category", label: "Category", options: [...new Set(contracts.map(c => c.category))] },
    ],
  });

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Procurement", href: "/procurement" }, { label: "Master Data" }]} />
      <GuidanceBanner title="Supplier & Contract Management" description="Supplier directory, contracts, SLA monitoring, and performance tracking." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Contracts & SLA</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" />New Contract</Button>
          <Button size="sm" variant="outline" className="gap-1.5"><Download className="w-3.5 h-3.5" />Export</Button>
        </div>
      </div>

      <Card className="border-border"><CardContent className="p-0">
        <FilterBar search={table.search} onSearch={table.setSearch} filters={table.filters} onFilter={table.setFilter} onClear={table.clearFilters} filterConfigs={table.filterConfigs} activeCount={table.activeFilterCount} searchPlaceholder="Rechercher…" />
        <Table>
          <TableHeader><TableRow className="bg-muted/30">
            <SortableHead label="ID" sortKey="id" sort={table.sort} onSort={table.toggleSort} />
            <SortableHead label="Supplier" sortKey="supplier" sort={table.sort} onSort={table.toggleSort} />
            <SortableHead label="Category" sortKey="category" sort={table.sort} onSort={table.toggleSort} />
            <SortableHead label="Value" sortKey="value" sort={table.sort} onSort={table.toggleSort} className="text-right" />
            <SortableHead label="Period" sortKey="start" sort={table.sort} onSort={table.toggleSort} />
            <SortableHead label="Utilization" sortKey="utilization" sort={table.sort} onSort={table.toggleSort} />
            <SortableHead label="SLA" sortKey="slaScore" sort={table.sort} onSort={table.toggleSort} />
            <SortableHead label="On-Time %" sortKey="deliveryOnTime" sort={table.sort} onSort={table.toggleSort} />
            <SortableHead label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
          </TableRow></TableHeader>
          <TableBody>
            {table.pagedData.map(c => (
              <TableRow key={c.id} className="text-xs">
                <TableCell className="font-mono text-primary">{c.id}</TableCell>
                <TableCell className="font-medium">{c.supplier}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{c.category}</Badge></TableCell>
                <TableCell className="text-right font-mono">{fmt(c.value)}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-[10px]">{c.start} → {c.end}</TableCell>
                <TableCell><div className="flex items-center gap-2"><Progress value={c.utilization} className="h-1.5 w-12" /><span className="text-[10px]">{c.utilization}%</span></div></TableCell>
                <TableCell className={`font-mono font-medium ${c.slaScore >= 90 ? "text-success" : "text-amber-600"}`}>{c.slaScore}%</TableCell>
                <TableCell className={`font-mono ${c.deliveryOnTime >= 90 ? "text-success" : "text-amber-600"}`}>{c.deliveryOnTime}%</TableCell>
                <TableCell><Badge className={`text-[10px] ${c.status === "Active" ? "bg-success/15 text-success border-success/20" : "bg-amber-500/15 text-amber-700 border-amber-500/20"}`} variant="outline">{c.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
      </CardContent></Card>
    </PageShell>
  );
}
