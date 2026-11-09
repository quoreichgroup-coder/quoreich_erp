import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Plus, Package, Warehouse, Lock } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useMyInventoryRoles } from "@/hooks/use-inventory-data";
import { actionTooltip, canDo } from "@/lib/inventory-roles";
import { exportToCSV } from "@/lib/csv-export";
import { toast } from "sonner";

const fmt = (n: number) => n.toLocaleString("fr-FR");

const products = [
  { sku: "RM-0451", name: "Copper Wire 2.5mm", category: "Raw Materials", unit: "kg", warehouse: "WH-ABJ-01", reorderPoint: 50, currentStock: 12, unitCost: 15000, valuation: "Average Cost", taxMapping: "VAT-18", active: true },
  { sku: "RM-0312", name: "Steel Bar 12mm", category: "Raw Materials", unit: "m", warehouse: "WH-ABJ-02", reorderPoint: 30, currentStock: 40, unitCost: 8500, valuation: "FIFO", taxMapping: "VAT-18", active: true },
  { sku: "FG-0892", name: "Module Controller X1", category: "Finished Goods", unit: "Unit", warehouse: "WH-DKR-01", reorderPoint: 25, currentStock: 8, unitCost: 1200000, valuation: "Average Cost", taxMapping: "VAT-18", active: true },
  { sku: "FG-0893", name: "Power Inverter 5kW", category: "Finished Goods", unit: "Unit", warehouse: "WH-ABJ-01", reorderPoint: 10, currentStock: 22, unitCost: 2500000, valuation: "FIFO", taxMapping: "VAT-18", active: true },
  { sku: "CS-0045", name: "Safety Gloves L", category: "Consumables", unit: "Pair", warehouse: "WH-ABJ-01", reorderPoint: 100, currentStock: 15, unitCost: 3500, valuation: "Average Cost", taxMapping: "VAT-18", active: true },
  { sku: "SP-0128", name: "Bearing SKF 6205", category: "Spare Parts", unit: "Unit", warehouse: "WH-ABJ-02", reorderPoint: 20, currentStock: 3, unitCost: 45000, valuation: "FIFO", taxMapping: "VAT-18", active: true },
  { sku: "CS-0102", name: "Cleaning Solution 5L", category: "Consumables", unit: "Bottle", warehouse: "WH-ABJ-01", reorderPoint: 30, currentStock: 85, unitCost: 12000, valuation: "Average Cost", taxMapping: "VAT-18", active: false },
];

const warehouses = [
  { code: "WH-ABJ-01", name: "Abidjan Main Warehouse", location: "Zone Industrielle, Abidjan", capacity: 5000, used: 3800, skuCount: 485, manager: "A. Koné", active: true },
  { code: "WH-ABJ-02", name: "Abidjan Secondary", location: "Yopougon, Abidjan", capacity: 2000, used: 1650, skuCount: 312, manager: "B. Coulibaly", active: true },
  { code: "WH-DKR-01", name: "Dakar Warehouse", location: "SODIDA, Dakar", capacity: 3000, used: 2100, skuCount: 451, manager: "D. Ouattara", active: true },
];

export default function InventoryMasterData() {
  const { data: perms } = useMyInventoryRoles();
  const canMove = canDo(perms, "move");
  const canExport = canDo(perms, "export");

  const prodTable = useTableFeatures({
    data: products,
    pageSize: 10,
    searchableKeys: ["sku", "name"],
    filterConfigs: [
      { key: "category", label: "Category", options: ["Raw Materials", "Finished Goods", "Consumables", "Spare Parts"] },
      { key: "valuation", label: "Valuation", options: ["FIFO", "Average Cost"] },
    ],
  });

  const handleExport = () => {
    if (!canExport) { toast.error(actionTooltip(perms, "export")); return; }
    exportToCSV(
      products as unknown as Record<string, unknown>[],
      [
        { key: "sku", header: "SKU" }, { key: "name", header: "Name" },
        { key: "category", header: "Category" }, { key: "warehouse", header: "Warehouse" },
        { key: "currentStock", header: "Stock" }, { key: "reorderPoint", header: "Reorder" },
        { key: "unitCost", header: "Unit Cost" }, { key: "valuation", header: "Valuation" },
      ],
      `inventory-items-${new Date().toISOString().slice(0, 10)}`,
    );
  };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Inventory Control", href: "/inventory" }, { label: "Master Data" }]} />
      <GuidanceBanner title="Inventory Master Data" description="Product catalog, SKU management, warehouse configuration, and valuation methods." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Inventory Master Data</h1>
        <div className="flex gap-2">
          <Button
            size="sm" className="gap-1.5"
            disabled={!canMove} aria-disabled={!canMove}
            aria-label={canMove ? "Nouvel article" : actionTooltip(perms, "move")}
            title={actionTooltip(perms, "move", "Créer un article")}
          >
            {canMove ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            New Product
          </Button>
          <Button
            size="sm" variant="outline" className="gap-1.5"
            disabled={!canExport} aria-disabled={!canExport}
            aria-label={canExport ? "Exporter en CSV" : actionTooltip(perms, "export")}
            title={actionTooltip(perms, "export", "Exporter le catalogue en CSV")}
            onClick={handleExport}
          >
            {canExport ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Export
          </Button>
        </div>
      </div>


      <Tabs defaultValue="products">
        <TabsList className="mb-4">
          <TabsTrigger value="products" className="gap-1.5"><Package className="w-3.5 h-3.5" />Product Catalog</TabsTrigger>
          <TabsTrigger value="warehouses" className="gap-1.5"><Warehouse className="w-3.5 h-3.5" />Warehouses</TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          <Card className="border-border"><CardContent className="p-0">
            <FilterBar search={prodTable.search} onSearch={prodTable.setSearch} filters={prodTable.filters} onFilter={prodTable.setFilter} onClear={prodTable.clearFilters} filterConfigs={prodTable.filterConfigs} activeCount={prodTable.activeFilterCount} searchPlaceholder="Search SKU or product…" />
            <Table><TableHeader><TableRow className="bg-muted/30">
              <SortableHead label="SKU" sortKey="sku" sort={prodTable.sort} onSort={prodTable.toggleSort} />
              <SortableHead label="Product Name" sortKey="name" sort={prodTable.sort} onSort={prodTable.toggleSort} />
              <SortableHead label="Category" sortKey="category" sort={prodTable.sort} onSort={prodTable.toggleSort} />
              <SortableHead label="Unit" sortKey="unit" sort={prodTable.sort} onSort={prodTable.toggleSort} />
              <SortableHead label="Warehouse" sortKey="warehouse" sort={prodTable.sort} onSort={prodTable.toggleSort} />
              <SortableHead label="Stock" sortKey="currentStock" sort={prodTable.sort} onSort={prodTable.toggleSort} className="text-right" />
              <SortableHead label="Reorder" sortKey="reorderPoint" sort={prodTable.sort} onSort={prodTable.toggleSort} className="text-right" />
              <SortableHead label="Unit Cost" sortKey="unitCost" sort={prodTable.sort} onSort={prodTable.toggleSort} className="text-right" />
              <SortableHead label="Valuation" sortKey="valuation" sort={prodTable.sort} onSort={prodTable.toggleSort} />
              <SortableHead label="Tax" sortKey="taxMapping" sort={prodTable.sort} onSort={prodTable.toggleSort} />
              <SortableHead label="Status" sortKey="active" sort={prodTable.sort} onSort={prodTable.toggleSort} />
            </TableRow></TableHeader>
            <TableBody>{prodTable.pagedData.map(p => (
              <TableRow key={p.sku} className="text-xs">
                <TableCell className="font-mono text-primary">{p.sku}</TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{p.category}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{p.unit}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{p.warehouse}</TableCell>
                <TableCell className={`text-right font-mono ${p.currentStock <= p.reorderPoint ? "text-destructive font-medium" : ""}`}>{p.currentStock}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{p.reorderPoint}</TableCell>
                <TableCell className="text-right font-mono">{fmt(p.unitCost)}</TableCell>
                <TableCell><Badge variant="secondary" className="text-[10px]">{p.valuation}</Badge></TableCell>
                <TableCell className="font-mono text-[10px] text-muted-foreground">{p.taxMapping}</TableCell>
                <TableCell><Badge className={`text-[10px] ${p.active ? "bg-success/15 text-success border-success/20" : "bg-muted text-muted-foreground"}`} variant="outline">{p.active ? "Active" : "Inactive"}</Badge></TableCell>
              </TableRow>
            ))}</TableBody></Table>
            <PaginationBar page={prodTable.page} totalPages={prodTable.totalPages} totalItems={prodTable.totalItems} pageSize={prodTable.pageSize} onPageChange={prodTable.setPage} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="warehouses">
          <Card className="border-border"><CardContent className="p-0">
            <Table><TableHeader><TableRow className="bg-muted/30">
              {["Code", "Name", "Location", "Capacity", "Used", "Utilization", "SKUs", "Manager", "Status"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </TableRow></TableHeader>
            <TableBody>{warehouses.map(w => (
              <TableRow key={w.code} className="text-xs">
                <TableCell className="font-mono text-primary">{w.code}</TableCell>
                <TableCell className="font-medium">{w.name}</TableCell>
                <TableCell className="text-muted-foreground">{w.location}</TableCell>
                <TableCell className="text-right font-mono">{fmt(w.capacity)}</TableCell>
                <TableCell className="text-right font-mono">{fmt(w.used)}</TableCell>
                <TableCell className="text-right font-mono font-medium">{((w.used / w.capacity) * 100).toFixed(0)}%</TableCell>
                <TableCell className="text-right font-mono">{w.skuCount}</TableCell>
                <TableCell>{w.manager}</TableCell>
                <TableCell><Badge className="text-[10px] bg-success/15 text-success border-success/20" variant="outline">Active</Badge></TableCell>
              </TableRow>
            ))}</TableBody></Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
