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
import { useMyRiskRoles } from "@/hooks/use-risk-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/risk-roles";

const riskEvents = [
  { id: "EVT-001", date: "2025-03-01", risk: "FX Exposure", type: "Incident", impact: "Medium", status: "Resolved", action: "Hedging position adjusted", owner: "Treasury" },
  { id: "EVT-002", date: "2025-02-20", risk: "Credit Default", type: "Near Miss", impact: "High", status: "Monitoring", action: "Customer credit limit reduced", owner: "AR" },
  { id: "EVT-003", date: "2025-02-15", risk: "Data Breach Attempt", type: "Incident", impact: "Critical", status: "Resolved", action: "Firewall rules updated, audit completed", owner: "IT" },
  { id: "EVT-004", date: "2025-03-05", risk: "Vendor Concentration", type: "Corrective Action", impact: "Medium", status: "In Progress", action: "Secondary vendor qualification started", owner: "AP" },
  { id: "EVT-005", date: "2025-03-08", risk: "Regulatory Change", type: "Risk Update", impact: "High", status: "Open", action: "Compliance team assessing impact", owner: "Compliance" },
];

export default function RiskTransactions() {
  const perms = useMyRiskRoles();
  const canCreate = canDo(perms, "create_risk");
  const canExport = canDo(perms, "export");
  const table = useTableFeatures({
    data: riskEvents,
    pageSize: 10,
    searchableKeys: ["risk", "id", "action", "owner"],
    filterConfigs: [
      { key: "type", label: "Type", options: ["Incident", "Near Miss", "Corrective Action", "Risk Update"] },
      { key: "status", label: "Status", options: ["Open", "In Progress", "Monitoring", "Resolved"] },
      { key: "impact", label: "Impact", options: ["Critical", "High", "Medium", "Low"] },
    ],
  });

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Risk Management", href: "/risk" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Risk Events" description="Risk incidents, near misses, corrective actions, and event tracking." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Risk Events & Incidents</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" disabled={!canCreate} aria-label={actionTooltip(perms, "create_risk", "Enregistrer un événement")} title={actionTooltip(perms, "create_risk", "Enregistrer un événement")}>
            {canCreate ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Log Event
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
          <SortableHead label="Risk" sortKey="risk" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Type" sortKey="type" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Impact" sortKey="impact" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Action" sortKey="action" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Owner" sortKey="owner" sort={table.sort} onSort={table.toggleSort} />
        </TableRow></TableHeader>
        <TableBody>{table.pagedData.map(e => (
          <TableRow key={e.id} className="text-xs">
            <TableCell className="font-mono text-primary">{e.id}</TableCell>
            <TableCell className="font-mono text-muted-foreground">{e.date}</TableCell>
            <TableCell className="font-medium">{e.risk}</TableCell>
            <TableCell><Badge variant="outline" className="text-[10px]">{e.type}</Badge></TableCell>
            <TableCell><Badge variant={e.impact === "Critical" ? "destructive" : e.impact === "High" ? "secondary" : "outline"} className="text-[10px]">{e.impact}</Badge></TableCell>
            <TableCell className="max-w-[200px] truncate text-muted-foreground">{e.action}</TableCell>
            <TableCell><Badge className={`text-[10px] ${e.status === "Resolved" ? "bg-success/15 text-success border-success/20" : e.status === "Open" ? "bg-destructive/15 text-destructive border-destructive/20" : "bg-amber-500/15 text-amber-700 border-amber-500/20"}`} variant="outline">{e.status}</Badge></TableCell>
            <TableCell className="text-muted-foreground">{maskAmount(perms, e.owner)}</TableCell>
          </TableRow>
        ))}</TableBody></Table>
        <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
      </CardContent></Card>
    </PageShell>
  );
}
