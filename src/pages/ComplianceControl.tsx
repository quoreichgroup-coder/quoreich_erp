import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useMyComplianceRoles } from "@/hooks/use-compliance-data";
import { maskAmount } from "@/lib/compliance-roles";

const auditFindings = [
  { id: "AUD-2025-001", title: "Missing approval for JE > 10M XOF", severity: "High", status: "Open", dueDate: "2025-03-30", assignee: "A. Koné" },
  { id: "AUD-2025-002", title: "SoD conflict: AP Clerk + Payment Approver", severity: "Critical", status: "In Remediation", dueDate: "2025-03-15", assignee: "M. Diallo" },
  { id: "AUD-2025-003", title: "Unreconciled bank items > 30 days", severity: "Medium", status: "Open", dueDate: "2025-04-15", assignee: "S. Bamba" },
  { id: "AUD-2025-004", title: "Lease classification review incomplete", severity: "Low", status: "Closed", dueDate: "2025-02-28", assignee: "B. Coulibaly" },
];

const sodConflicts = [
  { user: "J. Ouattara", role1: "AP Clerk", role2: "Payment Approver", severity: "Critical", status: "Active" },
  { user: "F. Traoré", role1: "JE Creator", role2: "JE Approver", severity: "High", status: "Mitigated" },
];

export default function ComplianceControl() {
  const perms = useMyComplianceRoles();
  const table = useTableFeatures({
    data: auditFindings, pageSize: 10, searchableKeys: ["title", "id", "assignee"],
    filterConfigs: [
      { key: "severity", label: "Severity", options: ["Critical", "High", "Medium", "Low"] },
      { key: "status", label: "Status", options: ["Open", "In Remediation", "Closed"] },
    ],
  });

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Compliance", href: "/compliance" }, { label: "Control" }]} />
      <GuidanceBanner title="Compliance Control" description="Audit findings, remediation tracking, and Segregation of Duties (SoD) conflicts." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Compliance Control</h1>

      <Card className="border-border mb-4"><CardContent className="p-0">
        <FilterBar search={table.search} onSearch={table.setSearch} filters={table.filters} onFilter={table.setFilter} onClear={table.clearFilters} filterConfigs={table.filterConfigs} activeCount={table.activeFilterCount} searchPlaceholder="Rechercher un finding…" />
        <Table><TableHeader><TableRow className="bg-muted/30">
          <SortableHead label="ID" sortKey="id" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Finding" sortKey="title" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Severity" sortKey="severity" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Due Date" sortKey="dueDate" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Assignee" sortKey="assignee" sort={table.sort} onSort={table.toggleSort} />
        </TableRow></TableHeader>
        <TableBody>{table.pagedData.map(f => (
          <TableRow key={f.id} className="text-xs">
            <TableCell className="font-mono text-primary">{f.id}</TableCell>
            <TableCell className="font-medium">{f.title}</TableCell>
            <TableCell><Badge variant={f.severity === "Critical" || f.severity === "High" ? "destructive" : "outline"} className="text-[10px]">{f.severity}</Badge></TableCell>
            <TableCell><Badge variant={f.status === "Closed" ? "secondary" : "outline"} className="text-[10px]">{f.status}</Badge></TableCell>
            <TableCell className="font-mono text-muted-foreground">{f.dueDate}</TableCell>
            <TableCell className="text-muted-foreground">{maskAmount(perms, f.assignee)}</TableCell>
          </TableRow>
        ))}</TableBody></Table>
        <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
      </CardContent></Card>

      <Card className="border-border">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">SoD Conflicts</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-2">
          {sodConflicts.map((c, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border text-xs ${c.severity === "Critical" ? "bg-destructive/5 border-destructive/20" : "bg-amber-500/5 border-amber-500/20"}`}>
              <div className="flex-1">
                <div className="font-medium">{maskAmount(perms, c.user)}</div>
                <div className="text-muted-foreground">{c.role1} ↔ {c.role2}</div>
              </div>
              <Badge variant={c.severity === "Critical" ? "destructive" : "secondary"} className="text-[10px]">{c.severity}</Badge>
              <Badge variant={c.status === "Active" ? "destructive" : "outline"} className="text-[10px]">{c.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </PageShell>
  );
}
