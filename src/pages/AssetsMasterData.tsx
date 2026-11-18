import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DocumentPrintButtons } from "@/components/DocumentDetail";
import { ExportMenu } from "@/components/ExportMenu";
import { exportTable, type ExportFormat } from "@/lib/table-export";
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
import { AssetDisposalForm } from "@/components/AssetAccountingPanels";
import { useMyFixedAssetRoles } from "@/hooks/use-fixed-assets-data";
import { actionTooltip, canDo, maskAmount } from "@/lib/fixed-assets-roles";
import { exportToCSV } from "@/lib/csv-export";
import { toast } from "sonner";

const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

// UI-side allowlist mirroring DB column allowlist for new asset creation
const ASSET_CREATE_ALLOWLIST = [
  "asset_code", "name", "category_id", "acquisition_date", "acquisition_cost",
  "salvage_value", "useful_life_months", "depreciation_method", "location", "in_service_date", "opening_accumulated", "opening_date",
] as const;


/** Fiche d'immobilisation imprimable : identification, valeurs, amortissements comptabilisés mois par mois. */
function AssetSheetPrint({ asset }: { asset: any }) {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["asset-depreciation-entries", asset.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("depreciation_entries")
        .select("period_date, amount, accumulated, net_book_value, kind, entry:journal_entries(piece_number)")
        .eq("asset_id", asset.id).order("period_date");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const f = (n: number) => Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  const base = Number(asset.acquisitionCost) - Number(asset.salvageValue ?? 0);
  const done = entries.filter((e) => e.kind === "periodic").length;
  return (
    <DocumentPrintButtons testId="asset-sheet-print" disabled={isLoading} build={() => ({
      title: "Fiche d'immobilisation", fileName: `fiche-immobilisation-${asset.asset_code}`, amountInWords: false,
      subtitle: `${asset.asset_code} — ${asset.name}`,
      header: [["Code", asset.asset_code], ["Désignation", asset.name], ["Catégorie", asset.categoryName ?? "—"], ["Localisation", asset.location || "—"],
        ["Date d'acquisition", asset.acquisition_date ?? "—"], ["Mise en service", asset.in_service_date ?? asset.acquisition_date ?? "—"],
        ["Méthode", asset.depreciation_method === "declining_balance" ? "Dégressif" : "Linéaire"], ["Durée d'usage", `${asset.useful_life_months} mois`],
        ["Reprise (cumul à l'ouverture)", asset.opening_accumulated ? `${f(asset.opening_accumulated)} au ${asset.opening_date ?? "—"}` : "—"], ["Statut", String(asset.status)]],
      columns: [{ label: "Mois" }, { label: "Nature" }, { label: "Dotation", align: "right" }, { label: "Cumul", align: "right" }, { label: "VNC", align: "right" }, { label: "Pièce" }],
      rows: entries.map((e) => [String(e.period_date).slice(0, 7), e.kind === "disposal" ? "Dotation de sortie" : "Dotation mensuelle",
        f(e.amount), f(e.accumulated), f(e.net_book_value), e.entry?.piece_number ?? ""]),
      footer: [["Coût d'acquisition", f(asset.acquisitionCost)], ["Valeur résiduelle", f(asset.salvageValue ?? 0)], ["Base amortissable", f(base)],
        ["Amortissements cumulés", f(asset.accumulatedDepreciation)], ["Valeur nette comptable", f(asset.netBookValue), true],
        ["Reste à amortir", f(Math.max(0, base - Number(asset.accumulatedDepreciation)))],
        ["Mois restants (durée d'usage)", String(Math.max(0, Number(asset.useful_life_months) - done))]],
      notes: "Dotations comptabilisées par le calcul mensuel des amortissements ; les mois futurs sont calculés au moment de chaque clôture mensuelle selon les paramètres de la société.",
      signatures: ["Responsable des immobilisations", "Comptable"],
    })} />
  );
}

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

  const handleExport = (f: ExportFormat = "csv") => {
    if (!canDo(perms, "export")) return;
    exportTable(f, 
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
      if (k === "acquisition_cost" || k === "salvage_value" || k === "useful_life_months" || k === "opening_accumulated") {
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
                <div><Label className="text-xs" htmlFor="as-code">Code *</Label><Input id="as-code" value={form.asset_code} onChange={(e) => setForm({ ...form, asset_code: e.target.value })} /></div>
                <div><Label className="text-xs" htmlFor="as-name">Nom *</Label><Input id="as-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor="as-category">Catégorie</Label>
                  <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                    <SelectTrigger id="as-category"><SelectValue placeholder="Choisir…" /></SelectTrigger>
                    <SelectContent>
                      {(categories as any[]).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs" htmlFor="as-date">Date acquisition</Label><Input id="as-date" type="date" value={form.acquisition_date} onChange={(e) => setForm({ ...form, acquisition_date: e.target.value })} /></div>
                <div><Label className="text-xs" htmlFor="as-cost">Coût (XOF) *</Label><Input id="as-cost" type="number" value={form.acquisition_cost} onChange={(e) => setForm({ ...form, acquisition_cost: e.target.value })} /></div>
                <div><Label className="text-xs" htmlFor="as-salvage">Valeur résiduelle</Label><Input id="as-salvage" type="number" value={form.salvage_value} onChange={(e) => setForm({ ...form, salvage_value: e.target.value })} /></div>
                <div><Label className="text-xs" htmlFor="as-life">Durée (mois)</Label><Input id="as-life" type="number" value={form.useful_life_months} onChange={(e) => setForm({ ...form, useful_life_months: e.target.value })} /></div>
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor="as-method">Méthode</Label>
                  <Select value={form.depreciation_method} onValueChange={(v) => setForm({ ...form, depreciation_method: v })}>
                    <SelectTrigger id="as-method"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="straight_line">Linéaire</SelectItem>
                      <SelectItem value="declining_balance">Dégressif</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs" htmlFor="as-in-service">Mise en service</Label><Input id="as-in-service" type="date" value={form.in_service_date ?? ""} onChange={(e) => setForm({ ...form, in_service_date: e.target.value })} /></div>
                <div><Label className="text-xs" htmlFor="as-opening">Amortissements déjà pratiqués</Label><Input id="as-opening" type="number" value={form.opening_accumulated ?? ""} placeholder="0" onChange={(e) => setForm({ ...form, opening_accumulated: e.target.value })} /></div>
                <div className="col-span-2"><Label className="text-xs" htmlFor="as-opening-date">…arrêtés au (reprise d'un registre existant)</Label><Input id="as-opening-date" type="date" value={form.opening_date ?? ""} onChange={(e) => setForm({ ...form, opening_date: e.target.value })} /></div>
                <div className="col-span-2"><Label className="text-xs" htmlFor="as-location">Localisation</Label><Input id="as-location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
                <Button onClick={handleCreate} disabled={createAsset.isPending}>Enregistrer</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <ExportMenu size="sm" variant="outline" className="gap-1.5"
            disabled={!canDo(perms, "export") || enriched.length === 0}
            onPick={(f) => void handleExport(f)}
            aria-label={exportTooltip} title={exportTooltip}>
            {canDo(perms, "export") ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Export CSV
          </ExportMenu>
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
                <TableRow key={a.id} data-testid="asset-row" className="text-xs cursor-pointer hover:bg-muted/20" onClick={() => setSelected(a)}>
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
                {canDo(perms, "export") && <AssetSheetPrint asset={selected} />}
                <AssetDisposalForm asset={selected} onDone={() => setSelected(null)} />
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
