import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Plus, BookOpen, Receipt } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { useMyExpenseRoles } from "@/hooks/use-expense-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/expense-roles";
import { Lock } from "lucide-react";

const fmt = (n: number) => n.toLocaleString("fr-FR");

const expenses = [
  { id: "EXP-2025-001", date: "2025-03-01", employee: "A. Koné", department: "IT", category: "Travel", description: "Flight ABJ→DKR — client visit", amount: 850000, receipt: true, status: "Reimbursed", approver: "M. Diallo", glEntry: "DR 6100 / CR 2010" },
  { id: "EXP-2025-002", date: "2025-03-02", employee: "B. Coulibaly", department: "Sales", category: "Meals", description: "Client dinner — SONATEL", amount: 125000, receipt: true, status: "Approved", approver: "S. Koné", glEntry: "DR 6150 / CR 2010" },
  { id: "EXP-2025-003", date: "2025-03-03", employee: "D. Ouattara", department: "HR", category: "Training", description: "Certification exam fee", amount: 450000, receipt: true, status: "Manager Approval", approver: "-", glEntry: "Pending" },
  { id: "EXP-2025-004", date: "2025-03-04", employee: "A. Koné", department: "IT", category: "Transport", description: "Taxi charges — 5 trips", amount: 35000, receipt: false, status: "Submitted", approver: "-", glEntry: "Pending" },
  { id: "EXP-2025-005", date: "2025-03-05", employee: "C. Bamba", department: "Finance", category: "Office Supplies", description: "Printer cartridges x3", amount: 95000, receipt: true, status: "Accounting Review", approver: "M. Diallo", glEntry: "Pending" },
  { id: "EXP-2025-006", date: "2025-03-06", employee: "B. Coulibaly", department: "Sales", category: "Travel", description: "Hotel 3 nights — Dakar", amount: 1200000, receipt: true, status: "Draft", approver: "-", glEntry: "Pending" },
  { id: "EXP-2025-007", date: "2025-03-07", employee: "D. Ouattara", department: "HR", category: "Meals", description: "Team lunch — quarterly review", amount: 180000, receipt: true, status: "Reimbursed", approver: "S. Koné", glEntry: "DR 6150 / CR 2010" },
  { id: "EXP-2025-008", date: "2025-03-08", employee: "A. Koné", department: "IT", category: "Travel", description: "Per diem — 5 days Dakar", amount: 375000, receipt: false, status: "Policy Violation", approver: "-", glEntry: "Blocked" },
];

const statusColor = (s: string) => {
  switch (s) {
    case "Reimbursed": return "bg-success/15 text-success border-success/20";
    case "Approved": return "bg-blue-500/15 text-blue-700 border-blue-500/20";
    case "Manager Approval": case "Accounting Review": return "bg-amber-500/15 text-amber-700 border-amber-500/20";
    case "Submitted": return "bg-purple-500/15 text-purple-700 border-purple-500/20";
    case "Draft": return "bg-muted text-muted-foreground";
    case "Policy Violation": return "bg-destructive/15 text-destructive border-destructive/20";
    default: return "bg-muted text-muted-foreground";
  }
};

export default function ExpenseTransactions() {
  const perms = useMyExpenseRoles();
  const canCreate = canDo(perms, "create_report");
  const canExport = canDo(perms, "export");
  const table = useTableFeatures({
    data: expenses,
    pageSize: 10,
    searchableKeys: ["id", "employee", "description"],
    filterConfigs: [
      { key: "status", label: "Status", options: ["Draft", "Submitted", "Manager Approval", "Accounting Review", "Approved", "Reimbursed", "Policy Violation"] },
      { key: "category", label: "Category", options: ["Travel", "Meals", "Transport", "Office Supplies", "Training"] },
      { key: "department", label: "Department", options: ["IT", "Sales", "HR", "Finance"] },
    ],
  });

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Expenses", href: "/expenses" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Expense Transactions" description="Employee expense submissions with lifecycle: Draft → Submitted → Manager Approval → Accounting Review → Approved → Reimbursed." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Expense Submissions</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" disabled={!canCreate}
            aria-label={actionTooltip(perms, "create_report", "Nouvelle note de frais")}
            title={actionTooltip(perms, "create_report", "Nouvelle note de frais")}>
            {canCreate ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}New Expense
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport}
            aria-label={actionTooltip(perms, "export", "Exporter")}
            title={actionTooltip(perms, "export", "Exporter")}>
            {canExport ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Export
          </Button>
        </div>
      </div>

      <Card className="border-border"><CardContent className="p-0">
        <FilterBar search={table.search} onSearch={table.setSearch} filters={table.filters} onFilter={table.setFilter} onClear={table.clearFilters} filterConfigs={table.filterConfigs} activeCount={table.activeFilterCount} searchPlaceholder="Search expenses…" />
        <Table><TableHeader><TableRow className="bg-muted/30">
          <SortableHead label="ID" sortKey="id" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Date" sortKey="date" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Employee" sortKey="employee" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Dept" sortKey="department" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Category" sortKey="category" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Description" sortKey="description" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Amount (XOF)" sortKey="amount" sort={table.sort} onSort={table.toggleSort} className="text-right" />
          <SortableHead label="Receipt" sortKey="receipt" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="GL" sortKey="glEntry" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
        </TableRow></TableHeader>
        <TableBody>{table.pagedData.map(e => (
          <TableRow key={e.id} className="text-xs">
            <TableCell className="font-mono text-primary">{e.id}</TableCell>
            <TableCell>{e.date}</TableCell>
            <TableCell className="font-medium">{e.employee}</TableCell>
            <TableCell className="text-muted-foreground">{e.department}</TableCell>
            <TableCell><Badge variant="outline" className="text-[10px]">{e.category}</Badge></TableCell>
            <TableCell className="max-w-[180px] truncate">{e.description}</TableCell>
            <TableCell className="text-right font-mono">{maskAmount(perms, e.amount)}</TableCell>
            <TableCell>{e.receipt ? <Receipt className="w-3.5 h-3.5 text-success" /> : <span className="text-muted-foreground text-[10px]">None</span>}</TableCell>
            <TableCell className="font-mono text-[10px] text-muted-foreground">{e.glEntry}</TableCell>
            <TableCell><Badge className={`text-[10px] ${statusColor(e.status)}`} variant="outline">{e.status}</Badge></TableCell>
          </TableRow>
        ))}</TableBody></Table>
        <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
      </CardContent></Card>

      <div className="space-y-4 mt-6">
        <div className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-primary" /><h2 className="text-sm font-semibold text-foreground">GL Posting — Expenses</h2></div>
        <GLPostingKPIsLive module="Expenses" />
        <GLBatchHistoryLive module="Expenses" />
      </div>
    </PageShell>
  );
}
