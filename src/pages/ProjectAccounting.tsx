import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderKanban, DollarSign, TrendingUp, Clock, Download, Plus, AlertTriangle, Calendar } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useProjects, useProjectCosts, useProjectKpis } from "@/hooks/use-project-data";

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function ProjectAccounting() {
  const { projects, costs, active, totalBudget, totalCosts } = useProjectKpis();
  const { isLoading } = useProjects();
  const [selectedProject, setSelectedProject] = useState<any>(null);

  const avgCompletion = projects.length > 0 ? Math.round(projects.reduce((s, p) => s + p.completion_pct, 0) / projects.length) : 0;
  const overBudgetProjects = projects.filter(p => Number(p.total_costs) > Number(p.budget) * 0.9 && p.status !== "completed").length;

  // Build chart data: budget vs costs by project
  const budgetVsCosts = useMemo(() => {
    return projects.filter(p => p.status !== "planning").map(p => ({
      name: p.name.length > 20 ? p.name.slice(0, 20) + "…" : p.name,
      budget: Number(p.budget),
      costs: Number(p.total_costs),
    }));
  }, [projects]);

  // Cost breakdown by category
  const costByCategory = useMemo(() => {
    const map = new Map<string, number>();
    costs.forEach((c: any) => {
      map.set(c.category, (map.get(c.category) || 0) + Number(c.amount));
    });
    return Array.from(map.entries()).map(([category, amount]) => ({ category, amount }));
  }, [costs]);

  const projectsTable = useTableFeatures({
    data: projects,
    pageSize: 10,
    searchableKeys: ["name", "project_code", "client", "project_manager", "department"],
    filterConfigs: [
      { key: "status", label: "Status", options: [...new Set(projects.map(p => p.status))] },
      { key: "department", label: "Department", options: [...new Set(projects.filter(p => p.department).map(p => p.department!))] },
    ],
  });

  if (isLoading) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "Finance" }, { label: "Project Management" }]} />
        <div className="grid grid-cols-5 gap-3 mb-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-96" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Project Management", href: "/projects" }]} />
      <GuidanceBanner title="Project Management" description="Manage projects, budgets, and track costs with GL integration." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Project Management</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" />New Project</Button>
          <Button size="sm" variant="outline" className="gap-1.5"><Download className="w-3.5 h-3.5" />Export</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><FolderKanban className="w-3.5 h-3.5" />Active</div>
          <div className="text-xl font-bold text-foreground">{active.length}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{projects.length} total</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign className="w-3.5 h-3.5" />Budget</div>
          <div className="text-xl font-bold text-foreground">{fmt(totalBudget)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">XOF</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingUp className="w-3.5 h-3.5" />Costs</div>
          <div className="text-xl font-bold text-foreground">{fmt(totalCosts)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{totalBudget > 0 ? Math.round((totalCosts / totalBudget) * 100) : 0}% of budget</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Clock className="w-3.5 h-3.5" />Avg Completion</div>
          <div className="text-xl font-bold text-foreground">{avgCompletion}%</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertTriangle className="w-3.5 h-3.5" />At Risk</div>
          <div className={`text-xl font-bold ${overBudgetProjects > 0 ? "text-destructive" : "text-foreground"}`}>{overBudgetProjects}</div>
          <div className="text-[11px] text-muted-foreground mt-1">budget &gt;90%</div>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="projects">
        <TabsList className="mb-4">
          <TabsTrigger value="projects" className="gap-1.5"><FolderKanban className="w-3.5 h-3.5" />Projects</TabsTrigger>
          <TabsTrigger value="costs" className="gap-1.5"><DollarSign className="w-3.5 h-3.5" />Cost Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="projects">
          <Card className="border-border"><CardContent className="p-0">
            <FilterBar search={projectsTable.search} onSearch={projectsTable.setSearch} filters={projectsTable.filters} onFilter={projectsTable.setFilter} onClear={projectsTable.clearFilters} filterConfigs={projectsTable.filterConfigs} activeCount={projectsTable.activeFilterCount} searchPlaceholder="Rechercher un projet…" />
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SortableHead label="Code" sortKey="project_code" sort={projectsTable.sort} onSort={projectsTable.toggleSort} />
                  <SortableHead label="Project" sortKey="name" sort={projectsTable.sort} onSort={projectsTable.toggleSort} />
                  <SortableHead label="Client" sortKey="client" sort={projectsTable.sort} onSort={projectsTable.toggleSort} />
                  <SortableHead label="Dept" sortKey="department" sort={projectsTable.sort} onSort={projectsTable.toggleSort} />
                  <SortableHead label="Status" sortKey="status" sort={projectsTable.sort} onSort={projectsTable.toggleSort} />
                  <SortableHead label="Budget" sortKey="budget" sort={projectsTable.sort} onSort={projectsTable.toggleSort} className="text-right" />
                  <SortableHead label="Costs" sortKey="total_costs" sort={projectsTable.sort} onSort={projectsTable.toggleSort} className="text-right" />
                  <SortableHead label="Completion" sortKey="completion_pct" sort={projectsTable.sort} onSort={projectsTable.toggleSort} />
                  <SortableHead label="PM" sortKey="project_manager" sort={projectsTable.sort} onSort={projectsTable.toggleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectsTable.pagedData.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">No projects found.</TableCell></TableRow>
                ) : projectsTable.pagedData.map((p: any) => {
                  const costRatio = Number(p.budget) > 0 ? (Number(p.total_costs) / Number(p.budget)) * 100 : 0;
                  return (
                    <TableRow key={p.id} className="text-xs cursor-pointer hover:bg-muted/20" onClick={() => setSelectedProject(p)}>
                      <TableCell className="font-mono text-primary">{p.project_code}</TableCell>
                      <TableCell className="font-medium max-w-[180px] truncate">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.client || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{p.department || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={p.status === "completed" ? "default" : p.status === "active" ? "secondary" : "outline"} className="text-[10px] capitalize">{p.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{fmt(Number(p.budget))}</TableCell>
                      <TableCell className={`text-right font-mono ${costRatio > 90 && p.status !== "completed" ? "text-destructive font-medium" : ""}`}>{fmt(Number(p.total_costs))}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={p.completion_pct} className="h-1.5 w-16" />
                          <span className="text-[10px]">{p.completion_pct}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.project_manager || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PaginationBar page={projectsTable.page} totalPages={projectsTable.totalPages} totalItems={projectsTable.totalItems} pageSize={projectsTable.pageSize} onPageChange={projectsTable.setPage} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="costs">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-border">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Budget vs Costs by Project</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                {budgetVsCosts.length > 0 ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={budgetVsCosts} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" width={140} />
                      <Tooltip formatter={(v: number) => `${fmt(v)} XOF`} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="budget" name="Budget" fill="hsl(var(--chart-2))" radius={[0, 3, 3, 0]} />
                      <Bar dataKey="costs" name="Costs" fill="hsl(var(--chart-1))" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-12">No cost data yet</div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Cost by Category</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                {costByCategory.length > 0 ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={costByCategory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip formatter={(v: number) => `${fmt(v)} XOF`} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                      <Bar dataKey="amount" name="Amount" fill="hsl(var(--chart-3))" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-12">No cost entries</div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Side Panel */}
      <Sheet open={!!selectedProject} onOpenChange={() => setSelectedProject(null)}>
        <SheetContent className="w-[400px] sm:w-[480px]">
          {selectedProject && (
            <>
              <SheetHeader>
                <SheetTitle className="text-sm">{selectedProject.project_code} — {selectedProject.name}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><span className="text-muted-foreground">Client:</span> {selectedProject.client || "—"}</div>
                  <div><span className="text-muted-foreground">PM:</span> {selectedProject.project_manager || "—"}</div>
                  <div><span className="text-muted-foreground">Department:</span> {selectedProject.department || "—"}</div>
                  <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline" className="text-[10px] capitalize">{selectedProject.status}</Badge></div>
                  <div><span className="text-muted-foreground">Start:</span> {selectedProject.start_date || "—"}</div>
                  <div><span className="text-muted-foreground">End:</span> {selectedProject.end_date || "—"}</div>
                  <div><span className="text-muted-foreground">Budget:</span> <span className="font-mono font-medium">{fmt(Number(selectedProject.budget))}</span></div>
                  <div><span className="text-muted-foreground">Costs:</span> <span className="font-mono">{fmt(Number(selectedProject.total_costs))}</span></div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Completion</div>
                  <Progress value={selectedProject.completion_pct} className="h-2" />
                  <div className="text-[10px] text-muted-foreground mt-1">{selectedProject.completion_pct}%</div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
