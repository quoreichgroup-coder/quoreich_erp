import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Package, Plus, Warehouse } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useCreateItem, useCreateWarehouse, useItems, useUpdateItem, useUpdateWarehouse, useWarehouses } from "@/hooks/use-inventory-data";
import { useMyAccess } from "@/hooks/use-my-access";
import { StatusBadge } from "@/components/StatusBadge";
import { exportToCSV } from "@/lib/csv-export";
import { ReplenishmentRulesPanel } from "@/components/Replenishment";

/*
 * Stocks → Données de base : articles et dépôts réels de la société. La quantité en stock et le
 * coût moyen ne se saisissent pas (V53) : ils résultent des mouvements (réceptions, livraisons,
 * retours, ajustements, inventaires).
 */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const num = (s: string) => Number(String(s).replace(",", "."));

type ItemForm = {
  code: string; name: string; category: string; unit: string; unit_cost: string; selling_price: string;
  reorder_level: string; safety_stock: string; default_warehouse_id: string; status: string;
};
const EMPTY: ItemForm = { code: "", name: "", category: "", unit: "unité", unit_cost: "", selling_price: "", reorder_level: "",
  safety_stock: "", default_warehouse_id: "", status: "active" };

function ItemDialog({ item, open, onClose }: { item: any | null; open: boolean; onClose: () => void }) {
  const { data: warehouses = [] } = useWarehouses();
  const create = useCreateItem();
  const update = useUpdateItem();
  const [f, setF] = useState<ItemForm>(EMPTY);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = item?.id ?? "new";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setF(item ? {
      code: item.code ?? "", name: item.name ?? "", category: item.category ?? "", unit: item.unit ?? "", unit_cost: String(item.unit_cost ?? ""),
      selling_price: String(item.selling_price ?? ""), reorder_level: String(item.reorder_level ?? ""), safety_stock: String(item.safety_stock ?? ""),
      default_warehouse_id: item.default_warehouse_id ?? "", status: item.status ?? "active",
    } : EMPTY);
  }
  const close = () => { setLoadedFor(null); onClose(); };
  const set = (k: keyof ItemForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const error = !f.code.trim() ? "Le code article est obligatoire." : !f.name.trim() ? "Le libellé est obligatoire." : null;
  const payload = {
    code: f.code.trim(), name: f.name.trim(), category: f.category.trim() || undefined, unit: f.unit.trim() || undefined,
    unit_cost: f.unit_cost ? num(f.unit_cost) : undefined, selling_price: f.selling_price ? num(f.selling_price) : undefined,
    reorder_level: f.reorder_level ? num(f.reorder_level) : undefined, safety_stock: f.safety_stock ? num(f.safety_stock) : undefined,
    default_warehouse_id: f.default_warehouse_id || undefined,
  };
  const save = () => item
    ? update.mutate({ id: item.id, ...payload, default_warehouse_id: f.default_warehouse_id || null, status: f.status }, { onSuccess: close })
    : create.mutate(payload, { onSuccess: close });
  const field = (k: keyof ItemForm, label: string, extra: Record<string, unknown> = {}) => (
    <div className="space-y-1.5">
      <Label className="text-xs" htmlFor={`item-${k}`}>{label}</Label>
      <Input id={`item-${k}`} className="h-8 text-xs" value={f[k]} onChange={set(k)} {...extra} />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{item ? `Article ${item.code}` : "Nouvel article"}</DialogTitle>
          <DialogDescription className="text-xs">
            Le stock et le coût moyen ne se saisissent pas : ils viennent des réceptions, livraisons, retours, ajustements et inventaires.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {field("code", "Code article")}
          {field("name", "Libellé")}
          {field("category", "Catégorie")}
          {field("unit", "Unité")}
          {field("unit_cost", "Prix d'achat de référence", { inputMode: "decimal", className: "h-8 text-xs text-right" })}
          {field("selling_price", "Prix de vente", { inputMode: "decimal", className: "h-8 text-xs text-right" })}
          {field("reorder_level", "Seuil de réapprovisionnement", { inputMode: "decimal", className: "h-8 text-xs text-right" })}
          {field("safety_stock", "Stock de sécurité", { inputMode: "decimal", className: "h-8 text-xs text-right" })}
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="item-warehouse">Dépôt par défaut</Label>
            <select id="item-warehouse" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.default_warehouse_id} onChange={set("default_warehouse_id")}>
              <option value="">—</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          {item && (
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="item-status">Statut</Label>
              <select id="item-status" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.status} onChange={set("status")}>
                <option value="active">Actif</option>
                <option value="inactive">Inactif</option>
              </select>
            </div>
          )}
        </div>
        {error && (f.code || f.name) && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>Annuler</Button>
          <Button size="sm" disabled={!!error || create.isPending || update.isPending} onClick={save}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WarehouseDialog({ wh, open, onClose }: { wh: any | null; open: boolean; onClose: () => void }) {
  const create = useCreateWarehouse();
  const update = useUpdateWarehouse();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState("active");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = wh?.id ?? "new";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setCode(wh?.code ?? ""); setName(wh?.name ?? ""); setAddress(wh?.address ?? ""); setStatus(wh?.status ?? "active");
  }
  const close = () => { setLoadedFor(null); onClose(); };
  const ok = code.trim() && name.trim();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">{wh ? `Dépôt ${wh.code}` : "Nouveau dépôt"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="wh-code">Code</Label>
            <Input id="wh-code" className="h-8 text-xs" value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="wh-name">Nom</Label>
            <Input id="wh-name" className="h-8 text-xs" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="wh-address">Adresse</Label>
            <Input id="wh-address" className="h-8 text-xs" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          {wh && (
            <div className="space-y-1.5"><Label className="text-xs" htmlFor="wh-status">Statut</Label>
              <select id="wh-status" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Actif</option><option value="inactive">Inactif</option>
              </select></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>Annuler</Button>
          <Button size="sm" disabled={!ok || create.isPending || update.isPending}
            onClick={() => wh
              ? update.mutate({ id: wh.id, code: code.trim(), name: name.trim(), address: address.trim() || null, status }, { onSuccess: close })
              : create.mutate({ code: code.trim(), name: name.trim(), address: address.trim() || undefined }, { onSuccess: close })}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InventoryMasterData() {
  const { data: items = [] } = useItems();
  const { data: warehouses = [] } = useWarehouses();
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("inventory.move");
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = ["warehouses", "replenishment"].includes(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "items";
  const [itemDialog, setItemDialog] = useState<{ item: any | null } | null>(null);
  const [whDialog, setWhDialog] = useState<{ wh: any | null } | null>(null);

  const rows = items.map((i: any) => ({
    ...i, stock: Number(i.quantity_on_hand ?? 0), cmp: Number(i.average_cost ?? 0),
    valeur: Math.round(Number(i.quantity_on_hand ?? 0) * Number(i.average_cost ?? 0) * 100) / 100,
    alerte: Number(i.reorder_level ?? 0) > 0 && Number(i.quantity_on_hand ?? 0) <= Number(i.reorder_level ?? 0),
  }));
  const t = useTableFeatures({
    data: rows, pageSize: 15, searchableKeys: ["code", "name", "category"],
    filterConfigs: [{ key: "category", label: "Catégorie", options: Array.from(new Set(rows.map((r) => r.category).filter(Boolean))).sort() as string[] }],
  });

  const exporter = () => tab === "warehouses"
    ? exportToCSV(warehouses as any[], [{ key: "code", header: "Code" }, { key: "name", header: "Nom" }, { key: "address", header: "Adresse" }, { key: "status", header: "Statut" }], "depots")
    : exportToCSV(t.processedData, [
      { key: "code", header: "Code" }, { key: "name", header: "Libellé" }, { key: "category", header: "Catégorie" }, { key: "unit", header: "Unité" },
      { key: "stock", header: "Stock" }, { key: "cmp", header: "Coût moyen" }, { key: "valeur", header: "Valeur" },
      { key: "reorder_level", header: "Seuil" }, { key: "selling_price", header: "Prix de vente" }, { key: "status", header: "Statut" },
    ], "articles");

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Stocks" }, { label: "Gestion des stocks", href: "/inventory" }, { label: "Données de base" }]} />
      <GuidanceBanner title="Articles et dépôts" description="Référentiel réel de la société. Le stock et le coût moyen résultent des mouvements ; ils ne se saisissent pas." />

      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h1 className="text-lg font-semibold text-foreground">Stocks — Données de base</h1>
        <div className="flex gap-2">
          {canEdit && tab === "items" && <Button size="sm" className="gap-1.5" onClick={() => setItemDialog({ item: null })}><Plus className="w-3.5 h-3.5" />Nouvel article</Button>}
          {canEdit && tab === "warehouses" && <Button size="sm" className="gap-1.5" onClick={() => setWhDialog({ wh: null })}><Plus className="w-3.5 h-3.5" />Nouveau dépôt</Button>}
          <Button size="sm" variant="outline" className="gap-1.5" data-testid="btn-export-csv" onClick={exporter}><Download className="w-3.5 h-3.5" />Exporter</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setSearchParams((sp) => { sp.set("tab", v); return sp; }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="items" className="gap-1.5"><Package className="w-3.5 h-3.5" />Articles ({items.length})</TabsTrigger>
          <TabsTrigger value="warehouses" className="gap-1.5"><Warehouse className="w-3.5 h-3.5" />Dépôts ({warehouses.length})</TabsTrigger>
          <TabsTrigger value="replenishment">Réapprovisionnement</TabsTrigger>
        </TabsList>

        <TabsContent value="items">
          <Card className="border-border"><CardContent className="p-0">
            <FilterBar search={t.search} onSearch={t.setSearch} filters={t.filters} onFilter={t.setFilter} onClear={t.clearFilters}
              filterConfigs={t.filterConfigs} activeCount={t.activeFilterCount} searchPlaceholder="Code, libellé, catégorie…" />
            <div className="overflow-x-auto">
              <Table><TableHeader><TableRow className="bg-muted/30">
                <SortableHead label="Code" sortKey="code" sort={t.sort} onSort={t.toggleSort} />
                <SortableHead label="Libellé" sortKey="name" sort={t.sort} onSort={t.toggleSort} />
                <SortableHead label="Catégorie" sortKey="category" sort={t.sort} onSort={t.toggleSort} />
                <SortableHead label="Stock" sortKey="stock" sort={t.sort} onSort={t.toggleSort} className="text-right" />
                <SortableHead label="Coût moyen" sortKey="cmp" sort={t.sort} onSort={t.toggleSort} className="text-right" />
                <SortableHead label="Valeur" sortKey="valeur" sort={t.sort} onSort={t.toggleSort} className="text-right" />
                <SortableHead label="Seuil" sortKey="reorder_level" sort={t.sort} onSort={t.toggleSort} className="text-right" />
                <SortableHead label="Statut" sortKey="status" sort={t.sort} onSort={t.toggleSort} />
              </TableRow></TableHeader>
              <TableBody>
                {t.pagedData.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">Aucun article.</TableCell></TableRow>
                ) : t.pagedData.map((r: any) => (
                  <TableRow key={r.id} data-testid="item-row" className={canEdit ? "text-xs cursor-pointer" : "text-xs"}
                    onClick={() => canEdit && setItemDialog({ item: r })}>
                    <TableCell className="font-mono">{r.code}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.category || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.stock)} {r.unit ?? ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.cmp)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.valeur)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.reorder_level ? fmt(Number(r.reorder_level)) : "—"}</TableCell>
                    <TableCell>
                      {r.status === "inactive" ? <StatusBadge status="neutral" label="Inactif" />
                        : r.alerte ? <StatusBadge status="warning" label="À réapprovisionner" /> : <StatusBadge status="success" label="Actif" />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            </div>
            <PaginationBar page={t.page} totalPages={t.totalPages} totalItems={t.totalItems} pageSize={t.pageSize} onPageChange={t.setPage} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="warehouses">
          <Card className="border-border"><CardContent className="p-0">
            <Table><TableHeader><TableRow className="bg-muted/30">
              <TableCell className="text-xs font-medium">Code</TableCell><TableCell className="text-xs font-medium">Nom</TableCell>
              <TableCell className="text-xs font-medium">Adresse</TableCell><TableCell className="text-xs font-medium">Statut</TableCell>
            </TableRow></TableHeader>
            <TableBody>
              {warehouses.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-8">Aucun dépôt.</TableCell></TableRow>
              ) : warehouses.map((w) => (
                <TableRow key={w.id} data-testid="warehouse-row" className={canEdit ? "text-xs cursor-pointer" : "text-xs"}
                  onClick={() => canEdit && setWhDialog({ wh: w })}>
                  <TableCell className="font-mono">{w.code}</TableCell>
                  <TableCell className="font-medium">{w.name}{w.is_default ? " (par défaut)" : ""}</TableCell>
                  <TableCell>{w.address || "—"}</TableCell>
                  <TableCell>{w.status === "inactive" ? <StatusBadge status="neutral" label="Inactif" /> : <StatusBadge status="success" label="Actif" />}</TableCell>
                </TableRow>
              ))}
            </TableBody></Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="replenishment">
          <Card className="border-border"><CardContent className="p-4"><ReplenishmentRulesPanel /></CardContent></Card>
        </TabsContent>
      </Tabs>

      <ItemDialog item={itemDialog?.item ?? null} open={!!itemDialog} onClose={() => setItemDialog(null)} />
      <WarehouseDialog wh={whDialog?.wh ?? null} open={!!whDialog} onClose={() => setWhDialog(null)} />
    </PageShell>
  );
}
