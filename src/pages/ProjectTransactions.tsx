import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Plus, BookOpen } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { useProjectCosts, useProjects, useMyProjectRoles } from "@/hooks/use-project-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/project-roles";
import { Lock } from "lucide-react";

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function ProjectTransactions() {
  const { data: costs = [], isLoading: loadingCosts } = useProjectCosts();
  const { data: projects = [], isLoading: loadingProjects } = useProjects();
  const perms = useMyProjectRoles();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "posting" ? "posting" : "documents";
  const isLoading = loadingCosts || loadingProjects;

  const rows = useMemo(() => {
    const projMap = new Map(projects.map((p: any) => [p.id, p]));
    return costs.map((c: any) => {
      const proj = projMap.get(c.project_id) as any;
      return {
        id: c.id.slice(0, 8).toUpperCase(),
        date: c.cost_date,
        project: proj?.project_code || "—",
        projectName: proj?.name || "—",
        category: c.category,
        description: c.description || "—",
        amount: Number(c.amount),
        glAccount: (c.gl_account as any)?.code || "—",
      };
    });
  }, [costs, projects]);

  const table = useTableFeatures({
    data: rows,
    pageSize: 10,
    searchableKeys: ["id", "project", "description", "category"],
    filterConfigs: [
      { key: "category", label: "Category", options: [...new Set(rows.map(r => r.category))] },
      { key: "project", label: "Project", options: [...new Set(rows.map(r => r.project))] },
    ],
  });

  if (isLoading) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "Finance" }, { label: "Projects" }, { label: "Transactions" }]} />
        <Skeleton className="h-96" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Projects", href: "/projects" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Project Transactions" description="Cost entries by project, linked to GL." />

      {/* Une pièce par onglet, comme Approvisionnement (standard de présentation des modules). */}
      <Tabs value={tab} onValueChange={(v) => setSearchParams((sp) => { sp.set("tab", v); return sp; }, { replace: true })}>
        <TabsList className="h-auto flex-wrap justify-start mb-4">
          <TabsTrigger value="documents">Coûts de projet</TabsTrigger>
          <TabsTrigger value="posting">Comptabilisation</TabsTrigger>
        </TabsList>
        <TabsContent value="documents">

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Coûts de projet</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5"
            disabled={!canDo(perms, "post_cost")}
            aria-label={actionTooltip(perms, "post_cost", "Enregistrer un nouveau coût")}
            title={actionTooltip(perms, "post_cost", "Enregistrer un nouveau coût")}>
            {canDo(perms, "post_cost") ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}New Entry
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5"
            disabled={!canDo(perms, "export")}
            aria-label={actionTooltip(perms, "export", "Exporter en CSV")}
            title={actionTooltip(perms, "export", "Exporter en CSV")}>
            {canDo(perms, "export") ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Export
          </Button>
        </div>
      </div>

      <Card className="border-border"><CardContent className="p-0">
        <FilterBar search={table.search} onSearch={table.setSearch} filters={table.filters} onFilter={table.setFilter} onClear={table.clearFilters} filterConfigs={table.filterConfigs} activeCount={table.activeFilterCount} searchPlaceholder="Rechercher…" />
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <SortableHead label="ID" sortKey="id" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Date" sortKey="date" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Project" sortKey="project" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Name" sortKey="projectName" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Category" sortKey="category" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Description" sortKey="description" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Amount" sortKey="amount" sort={table.sort} onSort={table.toggleSort} className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pagedData.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No project costs recorded yet.</TableCell></TableRow>
            ) : table.pagedData.map((t: any) => (
              <TableRow key={t.id} className="text-xs">
                <TableCell className="font-mono text-primary">{t.id}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{t.date}</TableCell>
                <TableCell className="font-mono">{t.project}</TableCell>
                <TableCell className="font-medium max-w-[160px] truncate">{t.projectName}</TableCell>
                <TableCell className="text-muted-foreground">{t.category}</TableCell>
                <TableCell className="font-medium max-w-[180px] truncate">{t.description}</TableCell>
                <TableCell className="text-right font-mono">{maskAmount(perms, t.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
      </CardContent></Card>

        </TabsContent>
        <TabsContent value="posting">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Comptabilisation — comptabilité de projets</h2>
        </div>
        <GLPostingKPIsLive module="Projects" />
        <GLBatchHistoryLive module="Projects" />
      </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
