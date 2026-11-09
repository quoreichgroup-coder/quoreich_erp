import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Plus, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ClipboardEdit, BookOpen, Lock } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { useMyInventoryRoles } from "@/hooks/use-inventory-data";
import { actionTooltip, canDo } from "@/lib/inventory-roles";
import { exportToCSV } from "@/lib/csv-export";
import { toast } from "sonner";

const fmt = (n: number) => n.toLocaleString("fr-FR");

const goodsReceipts = [
  { id: "GR-2025-001", date: "2025-03-01", poRef: "PO-2025-001", supplier: "Dell Technologies", product: "Serveurs Dell R760", qty: 5, unit: "Unit", warehouse: "WH-ABJ-01", unitCost: 25000000, totalCost: 125000000, status: "Complete", glEntry: "DR 1200 / CR 2010" },
  { id: "GR-2025-002", date: "2025-03-03", poRef: "PO-2025-002", supplier: "Office Depot", product: "Mobilier bureau", qty: 20, unit: "Set", warehouse: "WH-ABJ-01", unitCost: 160000, totalCost: 3200000, status: "Partial", glEntry: "DR 1200 / CR 2010" },
  { id: "GR-2025-003", date: "2025-03-05", poRef: "PO-2025-003", supplier: "SecuTrain Africa", product: "Formation sécurité", qty: 1, unit: "Service", warehouse: "N/A", unitCost: 7500000, totalCost: 7500000, status: "Complete", glEntry: "DR 6200 / CR 2010" },
  { id: "GR-2025-004", date: "2025-03-08", poRef: "PO-2025-004", supplier: "Cisco Systems", product: "Switch Catalyst 9300", qty: 10, unit: "Unit", warehouse: "WH-ABJ-02", unitCost: 8900000, totalCost: 89000000, status: "Pending", glEntry: "Pending" },
];

const goodsIssues = [
  { id: "GI-2025-001", date: "2025-03-02", soRef: "SO-2025-001", customer: "SONATEL", product: "Module Controller X1", qty: 15, unit: "Unit", warehouse: "WH-DKR-01", unitCost: 1200000, totalCost: 18000000, status: "Complete", glEntry: "DR 5000 / CR 1200" },
  { id: "GI-2025-002", date: "2025-03-04", soRef: "SO-2025-003", customer: "Orange CI", product: "Cable fibre optique", qty: 500, unit: "m", warehouse: "WH-ABJ-01", unitCost: 12000, totalCost: 6000000, status: "Complete", glEntry: "DR 5000 / CR 1200" },
  { id: "GI-2025-003", date: "2025-03-07", soRef: "SO-2025-005", customer: "MTN CI", product: "Antenne relais", qty: 3, unit: "Unit", warehouse: "WH-ABJ-02", unitCost: 15000000, totalCost: 45000000, status: "Partial", glEntry: "DR 5000 / CR 1200" },
];

const stockTransfers = [
  { id: "ST-2025-001", date: "2025-03-01", fromWH: "WH-ABJ-01", toWH: "WH-DKR-01", product: "Module Controller X1", qty: 20, status: "Complete", initiator: "A. Koné" },
  { id: "ST-2025-002", date: "2025-03-05", fromWH: "WH-ABJ-02", toWH: "WH-ABJ-01", product: "Bearing SKF 6205", qty: 50, status: "In Transit", initiator: "B. Coulibaly" },
  { id: "ST-2025-003", date: "2025-03-08", fromWH: "WH-DKR-01", toWH: "WH-ABJ-02", product: "Safety Gloves L", qty: 200, status: "Pending", initiator: "D. Ouattara" },
];

const adjustments = [
  { id: "ADJ-2025-001", date: "2025-03-03", product: "Copper Wire 2.5mm", warehouse: "WH-ABJ-01", systemQty: 150, physicalQty: 138, variance: -12, reason: "Physical count — shrinkage", glEntry: "DR 5900 / CR 1200", approvedBy: "M. Diallo" },
  { id: "ADJ-2025-002", date: "2025-03-06", product: "Steel Bar 12mm", warehouse: "WH-ABJ-02", systemQty: 35, physicalQty: 40, variance: 5, reason: "Unrecorded receipt found", glEntry: "DR 1200 / CR 5900", approvedBy: "S. Koné" },
];

export default function InventoryTransactions() {
  const grTable = useTableFeatures({ data: goodsReceipts, pageSize: 10, searchableKeys: ["id", "product", "supplier"], filterConfigs: [{ key: "status", label: "Status", options: ["Complete", "Partial", "Pending"] }] });
  const giTable = useTableFeatures({ data: goodsIssues, pageSize: 10, searchableKeys: ["id", "product", "customer"], filterConfigs: [{ key: "status", label: "Status", options: ["Complete", "Partial"] }] });
  const { data: perms } = useMyInventoryRoles();

  const canMove = canDo(perms, "move");
  const canExport = canDo(perms, "export");

  const handleExport = () => {
    if (!canExport) { toast.error(actionTooltip(perms, "export")); return; }
    exportToCSV(
      goodsReceipts as unknown as Record<string, unknown>[],
      [
        { key: "id", header: "GR" }, { key: "date", header: "Date" }, { key: "poRef", header: "PO" },
        { key: "supplier", header: "Supplier" }, { key: "product", header: "Product" },
        { key: "qty", header: "Qty" }, { key: "warehouse", header: "Warehouse" },
        { key: "totalCost", header: "Total Cost" }, { key: "status", header: "Status" },
      ],
      `inventory-movements-${new Date().toISOString().slice(0, 10)}`,
    );
  };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Inventory Control", href: "/inventory" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Inventory Transactions" description="Goods receipts, issues, stock transfers, and inventory adjustments with GL posting integration." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Inventory Transactions</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!canMove}
            aria-disabled={!canMove}
            aria-label={canMove ? "Nouveau mouvement" : actionTooltip(perms, "move")}
            title={actionTooltip(perms, "move", "Créer un mouvement de stock")}
          >
            {canMove ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            New Movement
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={!canExport}
            aria-disabled={!canExport}
            aria-label={canExport ? "Exporter en CSV" : actionTooltip(perms, "export")}
            title={actionTooltip(perms, "export", "Exporter les mouvements en CSV")}
            onClick={handleExport}
          >
            {canExport ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Export
          </Button>
        </div>
      </div>


      <Tabs defaultValue="receipts">
        <TabsList className="mb-4">
          <TabsTrigger value="receipts" className="gap-1.5"><ArrowDownLeft className="w-3.5 h-3.5" />Goods Receipt</TabsTrigger>
          <TabsTrigger value="issues" className="gap-1.5"><ArrowUpRight className="w-3.5 h-3.5" />Goods Issue</TabsTrigger>
          <TabsTrigger value="transfers" className="gap-1.5"><ArrowLeftRight className="w-3.5 h-3.5" />Stock Transfer</TabsTrigger>
          <TabsTrigger value="adjustments" className="gap-1.5"><ClipboardEdit className="w-3.5 h-3.5" />Adjustments</TabsTrigger>
        </TabsList>

        <TabsContent value="receipts">
          <Card className="border-border"><CardContent className="p-0">
            <FilterBar search={grTable.search} onSearch={grTable.setSearch} filters={grTable.filters} onFilter={grTable.setFilter} onClear={grTable.clearFilters} filterConfigs={grTable.filterConfigs} activeCount={grTable.activeFilterCount} searchPlaceholder="Search receipts…" />
            <Table><TableHeader><TableRow className="bg-muted/30">
              <SortableHead label="GR #" sortKey="id" sort={grTable.sort} onSort={grTable.toggleSort} />
              <SortableHead label="Date" sortKey="date" sort={grTable.sort} onSort={grTable.toggleSort} />
              <SortableHead label="PO Ref" sortKey="poRef" sort={grTable.sort} onSort={grTable.toggleSort} />
              <SortableHead label="Supplier" sortKey="supplier" sort={grTable.sort} onSort={grTable.toggleSort} />
              <SortableHead label="Product" sortKey="product" sort={grTable.sort} onSort={grTable.toggleSort} />
              <SortableHead label="Qty" sortKey="qty" sort={grTable.sort} onSort={grTable.toggleSort} className="text-right" />
              <SortableHead label="Warehouse" sortKey="warehouse" sort={grTable.sort} onSort={grTable.toggleSort} />
              <SortableHead label="Total Cost" sortKey="totalCost" sort={grTable.sort} onSort={grTable.toggleSort} className="text-right" />
              <SortableHead label="GL" sortKey="glEntry" sort={grTable.sort} onSort={grTable.toggleSort} />
              <SortableHead label="Status" sortKey="status" sort={grTable.sort} onSort={grTable.toggleSort} />
            </TableRow></TableHeader>
            <TableBody>{grTable.pagedData.map(r => (
              <TableRow key={r.id} className="text-xs">
                <TableCell className="font-mono text-primary">{r.id}</TableCell>
                <TableCell>{r.date}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{r.poRef}</TableCell>
                <TableCell className="font-medium">{r.supplier}</TableCell>
                <TableCell className="max-w-[150px] truncate">{r.product}</TableCell>
                <TableCell className="text-right font-mono">{r.qty} {r.unit}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{r.warehouse}</TableCell>
                <TableCell className="text-right font-mono">{fmt(r.totalCost)}</TableCell>
                <TableCell className="font-mono text-[10px] text-muted-foreground">{r.glEntry}</TableCell>
                <TableCell><Badge className={`text-[10px] ${r.status === "Complete" ? "bg-success/15 text-success border-success/20" : r.status === "Partial" ? "bg-amber-500/15 text-amber-700 border-amber-500/20" : "bg-muted text-muted-foreground"}`} variant="outline">{r.status}</Badge></TableCell>
              </TableRow>
            ))}</TableBody></Table>
            <PaginationBar page={grTable.page} totalPages={grTable.totalPages} totalItems={grTable.totalItems} pageSize={grTable.pageSize} onPageChange={grTable.setPage} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="issues">
          <Card className="border-border"><CardContent className="p-0">
            <FilterBar search={giTable.search} onSearch={giTable.setSearch} filters={giTable.filters} onFilter={giTable.setFilter} onClear={giTable.clearFilters} filterConfigs={giTable.filterConfigs} activeCount={giTable.activeFilterCount} searchPlaceholder="Search issues…" />
            <Table><TableHeader><TableRow className="bg-muted/30">
              <SortableHead label="GI #" sortKey="id" sort={giTable.sort} onSort={giTable.toggleSort} />
              <SortableHead label="Date" sortKey="date" sort={giTable.sort} onSort={giTable.toggleSort} />
              <SortableHead label="SO Ref" sortKey="soRef" sort={giTable.sort} onSort={giTable.toggleSort} />
              <SortableHead label="Customer" sortKey="customer" sort={giTable.sort} onSort={giTable.toggleSort} />
              <SortableHead label="Product" sortKey="product" sort={giTable.sort} onSort={giTable.toggleSort} />
              <SortableHead label="Qty" sortKey="qty" sort={giTable.sort} onSort={giTable.toggleSort} className="text-right" />
              <SortableHead label="Total Cost" sortKey="totalCost" sort={giTable.sort} onSort={giTable.toggleSort} className="text-right" />
              <SortableHead label="GL" sortKey="glEntry" sort={giTable.sort} onSort={giTable.toggleSort} />
              <SortableHead label="Status" sortKey="status" sort={giTable.sort} onSort={giTable.toggleSort} />
            </TableRow></TableHeader>
            <TableBody>{giTable.pagedData.map(r => (
              <TableRow key={r.id} className="text-xs">
                <TableCell className="font-mono text-primary">{r.id}</TableCell>
                <TableCell>{r.date}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{r.soRef}</TableCell>
                <TableCell className="font-medium">{r.customer}</TableCell>
                <TableCell className="max-w-[150px] truncate">{r.product}</TableCell>
                <TableCell className="text-right font-mono">{r.qty} {r.unit}</TableCell>
                <TableCell className="text-right font-mono">{fmt(r.totalCost)}</TableCell>
                <TableCell className="font-mono text-[10px] text-muted-foreground">{r.glEntry}</TableCell>
                <TableCell><Badge className={`text-[10px] ${r.status === "Complete" ? "bg-success/15 text-success border-success/20" : "bg-amber-500/15 text-amber-700 border-amber-500/20"}`} variant="outline">{r.status}</Badge></TableCell>
              </TableRow>
            ))}</TableBody></Table>
            <PaginationBar page={giTable.page} totalPages={giTable.totalPages} totalItems={giTable.totalItems} pageSize={giTable.pageSize} onPageChange={giTable.setPage} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="transfers">
          <Card className="border-border"><CardContent className="p-0">
            <Table><TableHeader><TableRow className="bg-muted/30">
              {["ID", "Date", "From", "To", "Product", "Qty", "Status", "Initiator"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </TableRow></TableHeader>
            <TableBody>{stockTransfers.map(t => (
              <TableRow key={t.id} className="text-xs">
                <TableCell className="font-mono text-primary">{t.id}</TableCell>
                <TableCell>{t.date}</TableCell>
                <TableCell className="font-mono">{t.fromWH}</TableCell>
                <TableCell className="font-mono">{t.toWH}</TableCell>
                <TableCell className="font-medium">{t.product}</TableCell>
                <TableCell className="text-right font-mono">{t.qty}</TableCell>
                <TableCell><Badge className={`text-[10px] ${t.status === "Complete" ? "bg-success/15 text-success border-success/20" : t.status === "In Transit" ? "bg-blue-500/15 text-blue-700 border-blue-500/20" : "bg-muted text-muted-foreground"}`} variant="outline">{t.status}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{t.initiator}</TableCell>
              </TableRow>
            ))}</TableBody></Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="adjustments">
          <Card className="border-border"><CardContent className="p-0">
            <Table><TableHeader><TableRow className="bg-muted/30">
              {["ID", "Date", "Product", "Warehouse", "System Qty", "Physical Qty", "Variance", "Reason", "GL Entry", "Approved By"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </TableRow></TableHeader>
            <TableBody>{adjustments.map(a => (
              <TableRow key={a.id} className="text-xs">
                <TableCell className="font-mono text-primary">{a.id}</TableCell>
                <TableCell>{a.date}</TableCell>
                <TableCell className="font-medium">{a.product}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{a.warehouse}</TableCell>
                <TableCell className="text-right font-mono">{a.systemQty}</TableCell>
                <TableCell className="text-right font-mono">{a.physicalQty}</TableCell>
                <TableCell className={`text-right font-mono font-medium ${a.variance < 0 ? "text-destructive" : "text-success"}`}>{a.variance > 0 ? "+" : ""}{a.variance}</TableCell>
                <TableCell className="max-w-[180px] truncate text-muted-foreground">{a.reason}</TableCell>
                <TableCell className="font-mono text-[10px] text-muted-foreground">{a.glEntry}</TableCell>
                <TableCell>{a.approvedBy}</TableCell>
              </TableRow>
            ))}</TableBody></Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* GL Posting */}
      <div className="space-y-4 mt-6">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">GL Posting — Inventory</h2>
        </div>
        <GLPostingKPIsLive module="Inventory" />
        <GLBatchHistoryLive module="Inventory" />
      </div>
    </PageShell>
  );
}
