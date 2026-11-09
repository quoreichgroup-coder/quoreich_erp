import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Plus, Lock } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useAssets, useAssetCategories, useCreateAsset } from "@/hooks/use-asset-data";
import { useMyFixedAssetRoles } from "@/hooks/use-fixed-assets-data";
import { actionTooltip, canDo, maskAmount } from "@/lib/fixed-assets-roles";
import { exportToCSV } from "@/lib/csv-export";
import { toast } from "sonner";

const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

// UI-side allowlist mirroring DB column allowlist for new asset creation
const ASSET_CREATE_ALLOWLIST = [
  "asset_code", "name", "category_id", "acquisition_date", "acquisition_cost",
  "salvage_value", "useful_life_months", "depreciation_method", "location",
] as const;

export default function AssetsMasterData() {
  const perms = useMyFixedAssetRoles();
  const { data: assets = [], isLoading } = useAssets();
  const { data: categories = [] } = useAssetCategories();
  const createAsset = useCreateAsset();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({
    asset_code: "", name: "", category_id: "", acquisition_date: new Date().toISOString().slice(0, 10),
    acquisition_cost: "", salvage_value: "0", useful_life_months: "60", depreciation_method: "straight_line", location: "",
  });

  const enriched = useMemo(() => (assets as any[]).map((a) => ({
    ...a, categoryName: a.category?.name || "—",
    acquisitionCost: Number(a.acquisition_cost),
    netBookValue: Number(a.net_book_value),
    accumulatedDepreciation: Number(a.accumulated_depreciation),
    salvageValue: Number(a.salvage_value ?? 0),
  })), [assets]);

  type Row = typeof enriched[number];
  const [selected, setSelected] = useState<Row | null>(null);

  const allCategories = useMemo(() => [...new Set(enriched.map((a) => a.categoryName))], [enriched]);
  const allStatuses = useMemo(() => [...new Set(enriched.map((a) => a.status))], [enriched]);

  const table = useTableFeatures({
    data: enriched, pageSize: 15,
    searchableKeys: ["name", "asset_code", "categoryName", "location"],
    filterConfigs: [
      { key: "categoryName", label: "Catégorie", options: allCategories },
      { key: "status", label: "Statut", options: allStatuses },
      { key: "depreciation_method", label: "Méthode", options: ["straight_line", "declining_balance"] },
    ],
  });

  const handleExport = () => {
    if (!canDo(perms, "export")) return;
    exportToCSV(
      enriched.map((a) => ({
        Code: a.asset_code, Nom: a.name, Catégorie: a.categoryName, Localisation: a.location || "",
        Méthode: a.depreciation_method, Acquisition: a.acquisition_date,
        Coût: a.acquisitionCost, VNC: a.netBookValue, Cumul: a.accumulatedDepreciation, Statut: a.status,
      })),
      [
        { key: "Code", header: "Code" }, { key: "Nom", header: "Nom" },
        { key: "Catégorie", header: "Catégorie" }, { key: "Localisation", header: "Localisation" },
        { key: "Méthode", header: "Méthode" }, { key: "Acquisition", header: "Date acquisition" },
        { key: "Coût", header: "Coût (XOF)" }, { key: "VNC", header: "VNC (XOF)" },
        { key: "Cumul", header: "Amort. cumulé" }, { key: "Statut", header: "Statut" },
      ],
      `assets-register-${new Date().toISOString().slice(0, 10)}`,
    );
  };

  const handleCreate = () => {
    // Apply allowlist client-side: strip any unknown keys defensively
    const payload: any = {};
    for (const k of ASSET_CREATE_ALLOWLIST) {
      const v = form[k];
      if (v === "" || v == null) continue;
      if (k === "acquisition_cost" || k === "salvage_value" || k === "useful_life_months") {
        payload[k] = Number(v);
      } else {
        payload[k] = v;
      }
    }
    if (!payload.asset_code || !payload.name || !payload.acquisition_cost) {
      toast.error("Code, nom et coût sont obligatoires");
      return;
    }
    createAsset.mutate(payload, {
      onSuccess: () => { setDialogOpen(false); },
    });
  };

  const exportTooltip = actionTooltip(perms, "export", "Exporter le registre");
  const createTooltip = actionTooltip(perms, "create_asset", "Créer une fiche immobilisation");

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Fixed Assets", href: "/assets" }, { label: "Master Data" }]} />
      <GuidanceBanner title="Registre des Immobilisations" description="Fiches actifs SYSCOHADA — catégorie, méthode, durée d'usage, VNC live." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Registre</h1>
        <div className="flex gap-2">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5"
                disabled={!canDo(perms, "create_asset")}
                aria-label={createTooltip} title={createTooltip}>
                {canDo(perms, "create_asset") ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                Nouvelle immobilisation
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Créer une immobilisation</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><Label className="text-xs">Code *</Label><Input value={form.asset_code} onChange={(e) => setForm({ ...form, asset_code: e.target.value })} /></div>
                <div><Label className="text-xs">Nom *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="col-span-2">
                  <Label className="text-xs">Catégorie</Label>
                  <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                    <SelectContent>
                      {(categories as any[]).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Date acquisition</Label><Input type="date" value={form.acquisition_date} onChange={(e) => setForm({ ...form, acquisition_date: e.target.value })} /></div>
                <div><Label className="text-xs">Coût (XOF) *</Label><Input type="number" value={form.acquisition_cost} onChange={(e) => setForm({ ...form, acquisition_cost: e.target.value })} /></div>
                <div><Label className="text-xs">Valeur résiduelle</Label><Input type="number" value={form.salvage_value} onChange={(e) => setForm({ ...form, salvage_value: e.target.value })} /></div>
                <div><Label className="text-xs">Durée (mois)</Label><Input type="number" value={form.useful_life_months} onChange={(e) => setForm({ ...form, useful_life_months: e.target.value })} /></div>
                <div className="col-span-2">
                  <Label className="text-xs">Méthode</Label>
                  <Select value={form.depreciation_method} onValueChange={(v) => setForm({ ...form, depreciation_method: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="straight_line">Linéaire</SelectItem>
                      <SelectItem value="declining_balance">Dégressif</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2"><Label className="text-xs">Localisation</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
                <Button onClick={handleCreate} disabled={createAsset.isPending}>Enregistrer</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="outline" className="gap-1.5"
            disabled={!canDo(perms, "export") || enriched.length === 0}
            onClick={handleExport}
            aria-label={exportTooltip} title={exportTooltip}>
            {canDo(perms, "export") ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Export CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : (
        <Card className="border-border"><CardContent className="p-0">
          <FilterBar search={table.search} onSearch={table.setSearch} filters={table.filters} onFilter={table.setFilter} onClear={table.clearFilters} filterConfigs={table.filterConfigs} activeCount={table.activeFilterCount} searchPlaceholder="Rechercher un actif…" />
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <SortableHead label="Code" sortKey="asset_code" sort={table.sort} onSort={table.toggleSort} />
                <SortableHead label="Nom" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
                <SortableHead label="Catégorie" sortKey="categoryName" sort={table.sort} onSort={table.toggleSort} />
                <SortableHead label="Localisation" sortKey="location" sort={table.sort} onSort={table.toggleSort} />
                <SortableHead label="Méthode" sortKey="depreciation_method" sort={table.sort} onSort={table.toggleSort} />
                <SortableHead label="Coût" sortKey="acquisitionCost" sort={table.sort} onSort={table.toggleSort} className="text-right" />
                <SortableHead label="VNC" sortKey="netBookValue" sort={table.sort} onSort={table.toggleSort} className="text-right" />
                <SortableHead label="Statut" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.pagedData.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">Aucun actif trouvé.</TableCell></TableRow>
              ) : table.pagedData.map((a) => (
                <TableRow key={a.id} className="text-xs cursor-pointer hover:bg-muted/20" onClick={() => setSelected(a)}>
                  <TableCell className="font-mono text-primary">{a.asset_code}</TableCell>
                  <TableCell className="font-medium max-w-[180px] truncate">{a.name}</TableCell>
                  <TableCell className="text-muted-foreground">{a.categoryName}</TableCell>
                  <TableCell className="text-muted-foreground">{a.location || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px] capitalize">{String(a.depreciation_method).replace("_", " ")}</Badge></TableCell>
                  <TableCell className="text-right font-mono">{maskAmount(perms, a.acquisitionCost)}</TableCell>
                  <TableCell className="text-right font-mono font-medium">{maskAmount(perms, a.netBookValue)}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === "active" ? "default" : a.status === "fully_depreciated" ? "outline" : "destructive"} className="text-[10px] capitalize">{String(a.status).replace("_", " ")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
        </CardContent></Card>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="text-sm">{selected.asset_code} — {selected.name}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {[
                    ["Catégorie", selected.categoryName],
                    ["Localisation", selected.location || "—"],
                    ["Méthode", String(selected.depreciation_method).replace("_", " ")],
                    ["Durée d'usage", `${selected.useful_life_months} mois`],
                    ["Date acquisition", selected.acquisition_date],
                    ["Statut", String(selected.status).replace("_", " ")],
                  ].map(([l, v]) => (
                    <div key={l as string}><div className="text-muted-foreground">{l}</div><div className="font-medium capitalize">{v}</div></div>
                  ))}
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><div className="text-muted-foreground">Coût d'acquisition</div><div className="font-mono font-bold">{maskAmount(perms, selected.acquisitionCost)} XOF</div></div>
                  <div><div className="text-muted-foreground">Valeur nette comptable</div><div className="font-mono font-bold text-primary">{maskAmount(perms, selected.netBookValue)} XOF</div></div>
                </div>
                {selected.acquisitionCost - selected.salvageValue > 0 && (
                  <Progress value={(selected.accumulatedDepreciation / (selected.acquisitionCost - selected.salvageValue)) * 100} className="h-2" />
                )}
              </div>
              <SheetFooter className="mt-4 text-xs text-muted-foreground">
                {!canDo(perms, "edit_asset") && <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Édition verrouillée</span>}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
