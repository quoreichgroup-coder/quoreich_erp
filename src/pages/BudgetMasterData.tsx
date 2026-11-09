import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Plus } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useBudgets, useBudgetLines, useMyBudgetRoles } from "@/hooks/use-budget-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/budget-roles";

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function BudgetMasterData() {
  const perms = useMyBudgetRoles();
  const canCreate = canDo(perms, "create_budget");
  const canExport = canDo(perms, "export");
  const createTip = actionTooltip(perms, "create_budget", "Nouvelle ligne budgétaire");
  const exportTip = actionTooltip(perms, "export", "Exporter");
  const [budgetFilter, setBudgetFilter] = useState("all");
  const { data: budgets = [], isLoading: budgetsLoading } = useBudgets();
  const { data: allLines = [], isLoading: linesLoading } = useBudgetLines();

  // Enrich lines with budget info
  const enrichedLines = useMemo(() => {
    return allLines.map(l => {
      const budget = budgets.find(b => b.id === l.budget_id);
      const util = Number(l.planned_amount) > 0 ? Math.round((Number(l.actual_amount) / Number(l.planned_amount)) * 100) : 0;
      const status = util > 100 ? "Over Budget" : util > 90 ? "At Risk" : "On Track";
      return {
        ...l,
        budgetName: budget?.name || "—",
        fiscalYear: budget?.fiscal_year || "—",
        planned: Number(l.planned_amount),
        actual: Number(l.actual_amount),
        forecast: Math.round(Number(l.planned_amount) * 1.02),
        utilization: util,
        status,
      };
    });
  }, [allLines, budgets]);

  const filtered = budgetFilter === "all" ? enrichedLines : enrichedLines.filter(l => l.budget_id === budgetFilter);

  const table = useTableFeatures({
    data: filtered,
    pageSize: 15,
    searchableKeys: ["department", "budgetName", "period"],
    filterConfigs: [
      { key: "status", label: "Status", options: ["On Track", "Over Budget", "At Risk"] },
    ],
  });

  const loading = budgetsLoading || linesLoading;

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Budget & Forecast", href: "/budget" }, { label: "Master Data" }]} />
      <GuidanceBanner title="Budget Master Data" description="Budget lines by department and entity, envelope configuration, and allocation management." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Budget Lines</h1>
        <div className="flex gap-2">
          <Select value={budgetFilter} onValueChange={setBudgetFilter}>
            <SelectTrigger className="h-8 text-xs w-48"><SelectValue placeholder="All Budgets" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Budgets</SelectItem>
              {budgets.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name} ({b.fiscal_year})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="gap-1.5" disabled={!canCreate} aria-label={createTip} title={createTip}><Plus className="w-3.5 h-3.5" />New Budget Line</Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport} aria-label={exportTip} title={exportTip}><Download className="w-3.5 h-3.5" />Export</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Chargement…</div>
      ) : (
        <Card className="border-border"><CardContent className="p-0">
          <FilterBar search={table.search} onSearch={table.setSearch} filters={table.filters} onFilter={table.setFilter} onClear={table.clearFilters} filterConfigs={table.filterConfigs} activeCount={table.activeFilterCount} searchPlaceholder="Rechercher…" />
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <SortableHead label="Department" sortKey="department" sort={table.sort} onSort={table.toggleSort} />
                <SortableHead label="Budget" sortKey="budgetName" sort={table.sort} onSort={table.toggleSort} />
                <SortableHead label="Period" sortKey="period" sort={table.sort} onSort={table.toggleSort} />
                <SortableHead label="Planned" sortKey="planned" sort={table.sort} onSort={table.toggleSort} className="text-right" />
                <SortableHead label="Actual" sortKey="actual" sort={table.sort} onSort={table.toggleSort} className="text-right" />
                <SortableHead label="Forecast" sortKey="forecast" sort={table.sort} onSort={table.toggleSort} className="text-right" />
                <SortableHead label="Utilization" sortKey="utilization" sort={table.sort} onSort={table.toggleSort} />
                <SortableHead label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.pagedData.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">Aucune ligne budgétaire trouvée.</TableCell></TableRow>
              ) : table.pagedData.map((d, i) => (
                <TableRow key={d.id || i} className="text-xs">
                  <TableCell className="font-medium">{d.department || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{d.budgetName}</TableCell>
                  <TableCell className="font-mono">{d.period}</TableCell>
                  <TableCell className="text-right font-mono">{maskAmount(perms, d.planned)}</TableCell>
                  <TableCell className="text-right font-mono">{maskAmount(perms, d.actual)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{maskAmount(perms, d.forecast)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={Math.min(d.utilization, 100)} className="h-1.5 w-16" />
                      <span className={`text-[10px] ${d.utilization > 100 ? "text-destructive font-medium" : ""}`}>{d.utilization}%</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-[10px] ${d.status === "On Track" ? "bg-success/15 text-success border-success/20" : d.status === "Over Budget" ? "bg-destructive/15 text-destructive border-destructive/20" : "bg-amber-500/15 text-amber-700 border-amber-500/20"}`} variant="outline">{d.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
        </CardContent></Card>
      )}
    </PageShell>
  );
}
