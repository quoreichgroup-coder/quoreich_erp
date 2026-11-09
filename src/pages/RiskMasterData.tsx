import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Download, Plus, Lock } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useMyRiskRoles } from "@/hooks/use-risk-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/risk-roles";

const risks = [
  { id: "RSK-001", name: "Foreign Exchange Exposure", category: "Financial", likelihood: "High", impact: "Critical", score: 92, status: "Mitigated", owner: "Treasury", mitigation: "FX hedging program active" },
  { id: "RSK-002", name: "Credit Default - Key Customer", category: "Financial", likelihood: "Medium", impact: "High", score: 75, status: "Monitoring", owner: "AR", mitigation: "Credit limit monitoring" },
  { id: "RSK-003", name: "Liquidity Shortfall Q3", category: "Operational", likelihood: "Low", impact: "Critical", score: 68, status: "Action Required", owner: "Treasury", mitigation: "Reserve fund allocation pending" },
  { id: "RSK-004", name: "Regulatory Non-Compliance", category: "Compliance", likelihood: "Medium", impact: "High", score: 72, status: "Monitoring", owner: "Compliance", mitigation: "Compliance framework review" },
  { id: "RSK-005", name: "Vendor Concentration Risk", category: "Operational", likelihood: "High", impact: "Medium", score: 65, status: "Accepted", owner: "AP", mitigation: "Secondary vendor qualification" },
  { id: "RSK-006", name: "Interest Rate Volatility", category: "Financial", likelihood: "Medium", impact: "Medium", score: 58, status: "Mitigated", owner: "Treasury", mitigation: "Fixed-rate instruments" },
  { id: "RSK-007", name: "Data Breach / Cyber Risk", category: "Operational", likelihood: "Low", impact: "Critical", score: 70, status: "Monitoring", owner: "IT", mitigation: "Security audit program" },
];

export default function RiskMasterData() {
  const perms = useMyRiskRoles();
  const canCreate = canDo(perms, "create_risk");
  const canExport = canDo(perms, "export");
  const table = useTableFeatures({
    data: risks, pageSize: 10, searchableKeys: ["name", "id", "owner", "mitigation"],
    filterConfigs: [
      { key: "category", label: "Category", options: ["Financial", "Operational", "Compliance"] },
      { key: "status", label: "Status", options: ["Mitigated", "Monitoring", "Action Required", "Accepted"] },
    ],
  });

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Risk Management", href: "/risk" }, { label: "Master Data" }]} />
      <GuidanceBanner title="Risk Catalogue" description="Risk register with owners, mitigation strategies, and scoring." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Risk Catalogue</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" disabled={!canCreate} aria-label={actionTooltip(perms, "create_risk", "Ajouter un risque")} title={actionTooltip(perms, "create_risk", "Ajouter un risque")}>
            {canCreate ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Add Risk
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
          <SortableHead label="Risk" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Category" sortKey="category" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Score" sortKey="score" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Owner" sortKey="owner" sort={table.sort} onSort={table.toggleSort} />
          <SortableHead label="Mitigation" sortKey="mitigation" sort={table.sort} onSort={table.toggleSort} />
        </TableRow></TableHeader>
        <TableBody>{table.pagedData.map(r => (
          <TableRow key={r.id} className="text-xs">
            <TableCell className="font-mono text-primary">{r.id}</TableCell>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell><Badge variant="outline" className="text-[10px]">{r.category}</Badge></TableCell>
            <TableCell><div className="flex items-center gap-2"><Progress value={r.score} className="h-1.5 w-12" /><span className={`font-mono ${r.score > 70 ? "text-destructive" : "text-success"}`}>{maskAmount(perms, r.score)}</span></div></TableCell>
            <TableCell><Badge className={`text-[10px] ${r.status === "Action Required" ? "bg-destructive/15 text-destructive border-destructive/20" : r.status === "Mitigated" ? "bg-success/15 text-success border-success/20" : ""}`} variant="outline">{r.status}</Badge></TableCell>
            <TableCell className="text-muted-foreground">{maskAmount(perms, r.owner)}</TableCell>
            <TableCell className="text-muted-foreground max-w-[180px] truncate">{r.mitigation}</TableCell>
          </TableRow>
        ))}</TableBody></Table>
        <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
      </CardContent></Card>
    </PageShell>
  );
}
