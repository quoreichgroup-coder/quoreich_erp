import { useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Plus } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useBudgets, useBudgetLines, useMyBudgetRoles } from "@/hooks/use-budget-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/budget-roles";

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function BudgetTransactions() {
  const perms = useMyBudgetRoles();
  const canCreate = canDo(perms, "create_budget");
  const canExport = canDo(perms, "export");
  const createTip = actionTooltip(perms, "create_budget", "Nouvelle ligne budgétaire");
  const exportTip = actionTooltip(perms, "export", "Exporter les transactions");
  const { data: budgets = [], isLoading: loadingBudgets } = useBudgets();
  const { data: budgetLines = [], isLoading: loadingLines } = useBudgetLines();
  const isLoading = loadingBudgets || loadingLines;


  // Build rows from budget_lines joined with budgets
  const rows = useMemo(() => {
    const budgetMap = new Map(budgets.map((b: any) => [b.id, b]));
    return budgetLines.map((line: any) => {
      const budget = budgetMap.get(line.budget_id) as any;
      return {
        id: line.id.slice(0, 8).toUpperCase(),
        period: line.period,
        department: line.department || "—",
        budgetName: budget?.name || "—",
        scenario: budget?.scenario || "base",
        planned: Number(line.planned_amount),
        actual: Number(line.actual_amount),
        variance: Number(line.variance) || (Number(line.planned_amount) - Number(line.actual_amount)),
        status: budget?.status || "draft",
        glAccount: (line.gl_account as any)?.code || "—",
      };
    });
  }, [budgets, budgetLines]);

  const table = useTableFeatures({
    data: rows,
    pageSize: 10,
    searchableKeys: ["id", "department", "budgetName", "period"],
    filterConfigs: [
      { key: "status", label: "Status", options: [...new Set(rows.map(r => r.status))] },
      { key: "scenario", label: "Scenario", options: [...new Set(rows.map(r => r.scenario))] },
    ],
  });

  if (isLoading) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "Finance" }, { label: "Budget & Forecast" }, { label: "Transactions" }]} />
        <Skeleton className="h-96" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Budget & Forecast", href: "/budget" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Budget Transactions" description="Budget lines, planned vs actual, variance tracking." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Budget Transactions</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" disabled={!canCreate} aria-label={createTip} title={createTip}><Plus className="w-3.5 h-3.5" />New Entry</Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport} aria-label={exportTip} title={exportTip}><Download className="w-3.5 h-3.5" />Export</Button>
        </div>
      </div>

      <Card className="border-border"><CardContent className="p-0">
        <FilterBar search={table.search} onSearch={table.setSearch} filters={table.filters} onFilter={table.setFilter} onClear={table.clearFilters} filterConfigs={table.filterConfigs} activeCount={table.activeFilterCount} searchPlaceholder="Rechercher…" />
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <SortableHead label="ID" sortKey="id" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Period" sortKey="period" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Budget" sortKey="budgetName" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Department" sortKey="department" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="GL Account" sortKey="glAccount" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Planned" sortKey="planned" sort={table.sort} onSort={table.toggleSort} className="text-right" />
              <SortableHead label="Actual" sortKey="actual" sort={table.sort} onSort={table.toggleSort} className="text-right" />
              <SortableHead label="Variance" sortKey="variance" sort={table.sort} onSort={table.toggleSort} className="text-right" />
              <SortableHead label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pagedData.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">No budget lines. Create a budget first.</TableCell></TableRow>
            ) : table.pagedData.map((e: any) => (
              <TableRow key={e.id} className="text-xs">
                <TableCell className="font-mono text-primary">{e.id}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{e.period}</TableCell>
                <TableCell className="font-medium">{e.budgetName}</TableCell>
                <TableCell className="text-muted-foreground">{e.department}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{e.glAccount}</TableCell>
                <TableCell className="text-right font-mono">{maskAmount(perms, e.planned)}</TableCell>
                <TableCell className="text-right font-mono">{maskAmount(perms, e.actual)}</TableCell>
                <TableCell className={`text-right font-mono ${e.variance < 0 ? "text-destructive" : "text-success"}`}>{canDo(perms, "view_sensitive") ? `${e.variance >= 0 ? "+" : ""}${fmt(e.variance)}` : "•••••"}</TableCell>
                <TableCell>
                  <Badge className={`text-[10px] ${e.status === "approved" ? "bg-success/15 text-success border-success/20" : "bg-amber-500/15 text-amber-700 border-amber-500/20"}`} variant="outline">{e.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
      </CardContent></Card>
    </PageShell>
  );
}
