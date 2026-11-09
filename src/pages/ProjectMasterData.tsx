import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Plus, Users, Lock } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useMyProjectRoles } from "@/hooks/use-project-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/project-roles";

const projects = [
  { id: "PRJ-001", name: "ERP Implementation Phase 2", client: "QUOREICH CI", status: "In Progress", budget: 45000, costs: 28500, completion: 63, pm: "A. Koné", startDate: "2025-01-15", endDate: "2025-08-30", department: "IT" },
  { id: "PRJ-002", name: "Data Center Migration", client: "QUOREICH SN", status: "In Progress", budget: 32000, costs: 18200, completion: 57, pm: "M. Diallo", startDate: "2025-02-01", endDate: "2025-07-31", department: "IT" },
  { id: "PRJ-003", name: "Financial Audit Support", client: "External", status: "Completed", budget: 12000, costs: 11200, completion: 100, pm: "S. Bamba", startDate: "2024-10-01", endDate: "2025-02-28", department: "Finance" },
  { id: "PRJ-005", name: "Compliance Framework Setup", client: "QUOREICH CI", status: "In Progress", budget: 18000, costs: 12400, completion: 69, pm: "B. Coulibaly", startDate: "2025-01-01", endDate: "2025-06-30", department: "Legal" },
  { id: "PRJ-006", name: "Mobile Banking App", client: "External", status: "In Progress", budget: 52000, costs: 31200, completion: 45, pm: "A. Koné", startDate: "2025-02-15", endDate: "2025-11-30", department: "IT" },
];

const tasks = [
  { id: "TSK-002", projectId: "PRJ-001", title: "AR/AP Data Migration", assignee: "S. Bamba", status: "In Progress", priority: "High", dueDate: "2025-04-15", milestone: false },
  { id: "TSK-003", projectId: "PRJ-001", title: "UAT Sign-off", assignee: "B. Coulibaly", status: "To Do", priority: "Critical", dueDate: "2025-07-15", milestone: true },
  { id: "TSK-006", projectId: "PRJ-002", title: "Data Migration Wave 1", assignee: "M. Diallo", status: "In Progress", priority: "High", dueDate: "2025-05-15", milestone: false },
  { id: "TSK-007", projectId: "PRJ-002", title: "Cutover Weekend", assignee: "M. Diallo", status: "To Do", priority: "Critical", dueDate: "2025-06-30", milestone: true },
  { id: "TSK-010", projectId: "PRJ-006", title: "Backend API Development", assignee: "A. Koné", status: "In Progress", priority: "High", dueDate: "2025-06-30", milestone: false },
];

const KANBAN_COLS = ["To Do", "In Progress", "Done"];
const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function ProjectMasterData() {
  const perms = useMyProjectRoles();
  const table = useTableFeatures({
    data: projects,
    pageSize: 10,
    searchableKeys: ["name", "id", "client", "pm"],
    filterConfigs: [
      { key: "status", label: "Status", options: ["In Progress", "Completed", "Planning"] },
      { key: "department", label: "Department", options: [...new Set(projects.map(p => p.department))] },
    ],
  });

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Projects", href: "/projects" }, { label: "Master Data" }]} />
      <GuidanceBanner title="Project Master Data" description="Project register, teams, milestones, and Kanban board." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Projects & Teams</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5"
            disabled={!canDo(perms, "create_project")}
            aria-label={actionTooltip(perms, "create_project", "Créer un projet")}
            title={actionTooltip(perms, "create_project", "Créer un projet")}>
            {canDo(perms, "create_project") ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}New Project
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5"
            disabled={!canDo(perms, "export")}
            aria-label={actionTooltip(perms, "export", "Exporter en CSV")}
            title={actionTooltip(perms, "export", "Exporter en CSV")}>
            {canDo(perms, "export") ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Export
          </Button>
        </div>
      </div>

      <Card className="border-border mb-4"><CardContent className="p-0">
        <FilterBar search={table.search} onSearch={table.setSearch} filters={table.filters} onFilter={table.setFilter} onClear={table.clearFilters} filterConfigs={table.filterConfigs} activeCount={table.activeFilterCount} searchPlaceholder="Rechercher un projet…" />
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <SortableHead label="ID" sortKey="id" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Project" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Client" sortKey="client" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Budget" sortKey="budget" sort={table.sort} onSort={table.toggleSort} className="text-right" />
              <SortableHead label="Completion" sortKey="completion" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="PM" sortKey="pm" sort={table.sort} onSort={table.toggleSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pagedData.map(p => (
              <TableRow key={p.id} className="text-xs">
                <TableCell className="font-mono text-primary">{p.id}</TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-muted-foreground">{p.client}</TableCell>
                <TableCell><Badge variant={p.status === "Completed" ? "default" : p.status === "In Progress" ? "secondary" : "outline"} className="text-[10px]">{p.status}</Badge></TableCell>
                <TableCell className="text-right font-mono">{maskAmount(perms, p.budget)}</TableCell>
                <TableCell><div className="flex items-center gap-2"><Progress value={p.completion} className="h-1.5 w-16" /><span className="text-[10px]">{p.completion}%</span></div></TableCell>
                <TableCell className="text-muted-foreground">{p.pm}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
      </CardContent></Card>

      <div className="text-sm font-medium mb-3">Task Kanban Board</div>
      <div className="grid grid-cols-3 gap-4">
        {KANBAN_COLS.map(col => {
          const colTasks = tasks.filter(t => t.status === col);
          return (
            <Card key={col} className="border-border">
              <CardHeader className="p-3 pb-2"><div className="flex items-center justify-between"><CardTitle className="text-sm">{col}</CardTitle><Badge variant="outline" className="text-[10px]">{colTasks.length}</Badge></div></CardHeader>
              <CardContent className="p-3 pt-0 space-y-2 min-h-[150px]">
                {colTasks.map(t => (
                  <div key={t.id} className={`p-3 rounded-lg border border-border bg-background ${t.milestone ? "border-l-2 border-l-primary" : ""}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono text-muted-foreground">{t.projectId}</span>
                      <Badge variant={t.priority === "Critical" ? "destructive" : "secondary"} className="text-[9px]">{t.priority}</Badge>
                    </div>
                    <div className="text-xs font-medium mb-1">{t.title}</div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />{t.assignee}</span>
                      <span>{t.dueDate}</span>
                    </div>
                    {t.milestone && <Badge variant="default" className="text-[9px] mt-1.5">⚑ Milestone</Badge>}
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
}
