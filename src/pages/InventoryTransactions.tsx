import { useMemo, useState } from "react";
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
import { ArrowLeftRight, BookOpen, ClipboardEdit, Download, Loader2 } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { useAllStockMovements, useCreateStockAdjustment, useItems, useTransferStock, useWarehouses } from "@/hooks/use-inventory-data";
import { useMyAccess } from "@/hooks/use-my-access";
import { movementLabel, movementsOfTab, validateAdjustment, type MovementTab } from "@/lib/stock-movements";
import { exportToCSV } from "@/lib/csv-export";
import { cn } from "@/lib/utils";

/*
 * Stocks → Transactions : mouvements réels de la société (réceptions, livraisons, retours,
 * transferts, ajustements, écarts d'inventaire), un onglet par type de pièce. Les mouvements ne se
 * saisissent pas dans la table (V53) : ils naissent des pièces ou des deux fonctions habilitées
 * ci-dessous (ajustement motivé, transfert entre dépôts).
 */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().split("T")[0];
const num = (s: string) => Number(String(s).replace(",", "."));

type Row = {
  id: string; date: string; type: string; libelle: string; article: string; code: string; depot: string;
  quantite: number; cout: number; valeur: number; piece: string; motif: string;
};

function MovementsTable({ rows, empty }: { rows: Row[]; empty: string }) {
  const t = useTableFeatures({
    data: rows, pageSize: 15, searchableKeys: ["article", "code", "depot", "piece", "motif", "libelle"],
    filterConfigs: [{ key: "libelle", label: "Type", options: Array.from(new Set(rows.map((r) => r.libelle))).sort() }],
  });
  return (
    <Card className="border-border"><CardContent className="p-0">
      <FilterBar search={t.search} onSearch={t.setSearch} filters={t.filters} onFilter={t.setFilter} onClear={t.clearFilters}
        filterConfigs={t.filterConfigs} activeCount={t.activeFilterCount} searchPlaceholder="Article, dépôt, pièce, motif…" />
      <div className="overflow-x-auto">
        <Table><TableHeader><TableRow className="bg-muted/30">
          <SortableHead label="Date" sortKey="date" sort={t.sort} onSort={t.toggleSort} />
          <SortableHead label="Type" sortKey="libelle" sort={t.sort} onSort={t.toggleSort} />
          <SortableHead label="Article" sortKey="article" sort={t.sort} onSort={t.toggleSort} />
          <SortableHead label="Dépôt" sortKey="depot" sort={t.sort} onSort={t.toggleSort} />
          <SortableHead label="Quantité" sortKey="quantite" sort={t.sort} onSort={t.toggleSort} className="text-right" />
          <SortableHead label="Coût unitaire" sortKey="cout" sort={t.sort} onSort={t.toggleSort} className="text-right" />
          <SortableHead label="Valeur" sortKey="valeur" sort={t.sort} onSort={t.toggleSort} className="text-right" />
          <SortableHead label="Pièce comptable" sortKey="piece" sort={t.sort} onSort={t.toggleSort} />
          <SortableHead label="Motif" sortKey="motif" sort={t.sort} onSort={t.toggleSort} />
        </TableRow></TableHeader>
        <TableBody>
          {t.pagedData.length === 0 ? (
            <TableRow><TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-8">{empty}</TableCell></TableRow>
          ) : t.pagedData.map((r) => (
            <TableRow key={r.id} className="text-xs" data-testid="stock-movement-row">
              <TableCell className="tabular-nums">{r.date}</TableCell>
              <TableCell>{r.libelle}</TableCell>
              <TableCell><span className="font-mono text-muted-foreground mr-1">{r.code}</span>{r.article}</TableCell>
              <TableCell>{r.depot || "—"}</TableCell>
              <TableCell className={cn("text-right tabular-nums", r.quantite < 0 && "text-destructive")}>{fmt(r.quantite)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.cout)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.valeur)}</TableCell>
              <TableCell className="font-mono">{r.piece || "—"}</TableCell>
              <TableCell className="truncate max-w-[14rem]">{r.motif || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody></Table>
      </div>
      <PaginationBar page={t.page} totalPages={t.totalPages} totalItems={t.totalItems} pageSize={t.pageSize} onPageChange={t.setPage} />
    </CardContent></Card>
  );
}

function AdjustmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: items = [] } = useItems();
  const { data: warehouses = [] } = useWarehouses();
  const create = useCreateStockAdjustment();
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  const item: any = items.find((i: any) => i.id === itemId);
  const q = num(qty);
  const error = validateAdjustment({ itemId, quantity: q, reason }, Number(item?.quantity_on_hand ?? 0));
  const close = () => { setItemId(""); setQty(""); setCost(""); setReason(""); onClose(); };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Ajustement de stock</DialogTitle>
          <DialogDescription className="text-xs">
            Quantité positive pour un excédent, négative pour un manquant. Un manquant se valorise au coût moyen ; l'écriture
            Stocks / Variation des stocks est passée automatiquement en inventaire permanent.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="adj-item">Article</Label>
            <select id="adj-item" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Choisir…</option>
              {items.map((i: any) => <option key={i.id} value={i.id}>{i.code} — {i.name} (stock {fmt(Number(i.quantity_on_hand ?? 0))})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="adj-warehouse">Dépôt</Label>
              <select id="adj-warehouse" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">—</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="adj-date">Date</Label>
              <Input id="adj-date" type="date" className="h-8 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="adj-qty">Quantité (±)</Label>
              <Input id="adj-qty" className="h-8 text-xs text-right" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="adj-cost">Coût unitaire (excédent)</Label>
              <Input id="adj-cost" className="h-8 text-xs text-right" inputMode="decimal" disabled={!(q > 0)} value={cost}
                placeholder={item ? `coût moyen ${fmt(Number(item.average_cost ?? 0))}` : ""} onChange={(e) => setCost(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="adj-reason">Motif (obligatoire)</Label>
            <Input id="adj-reason" className="h-8 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Casse, péremption, erreur de saisie…" />
          </div>
          {error && (itemId || qty || reason) && <p className="text-xs text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>Annuler</Button>
          <Button size="sm" disabled={!!error || create.isPending}
            onClick={() => create.mutate({ item_id: itemId, warehouse_id: warehouseId || null, quantity: q, unit_cost: num(cost) || 0, date, reason: reason.trim() },
              { onSuccess: close })}>
            {create.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}Enregistrer l'ajustement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: items = [] } = useItems();
  const { data: warehouses = [] } = useWarehouses();
  const transfer = useTransferStock();
  const [itemId, setItemId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const q = num(qty);
  const error = !itemId ? "Choisissez l'article." : !from || !to || from === to ? "Choisissez deux dépôts différents."
    : !(q > 0) ? "La quantité transférée doit être positive." : null;
  const close = () => { setItemId(""); setQty(""); setNotes(""); onClose(); };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Transfert entre dépôts</DialogTitle>
          <DialogDescription className="text-xs">Deux mouvements (sortie puis entrée) au coût moyen ; aucune écriture comptable (même compte de stock).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="tr-item">Article</Label>
            <select id="tr-item" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Choisir…</option>
              {items.map((i: any) => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[["tr-from", "Dépôt de départ", from, setFrom], ["tr-to", "Dépôt d'arrivée", to, setTo]].map(([id, label, value, set]) => (
              <div key={id as string} className="space-y-1.5">
                <Label className="text-xs" htmlFor={id as string}>{label as string}</Label>
                <select id={id as string} className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={value as string}
                  onChange={(e) => (set as (v: string) => void)(e.target.value)}>
                  <option value="">Choisir…</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
              </div>
            ))}
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="tr-qty">Quantité</Label>
              <Input id="tr-qty" className="h-8 text-xs text-right" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="tr-notes">Note</Label>
              <Input id="tr-notes" className="h-8 text-xs" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          {error && (itemId || qty) && <p className="text-xs text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>Annuler</Button>
          <Button size="sm" disabled={!!error || transfer.isPending}
            onClick={() => transfer.mutate({ item_id: itemId, from_wh: from, to_wh: to, qty: q, notes: notes.trim() || undefined }, { onSuccess: close })}>
            Transférer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InventoryTransactions() {
  const { data: movements = [], isLoading } = useAllStockMovements();
  const { data: access } = useMyAccess();
  const perms = new Set(access?.permissions ?? []);
  const [searchParams, setSearchParams] = useSearchParams();
  const TABS = ["movements", "transfers", "adjustments", "posting"];
  const tab = TABS.includes(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "movements";
  const [adjOpen, setAdjOpen] = useState(false);
  const [trOpen, setTrOpen] = useState(false);

  const rows: Row[] = useMemo(() => movements.map((m: any) => ({
    id: m.id, date: m.movement_date, type: m.movement_type, libelle: movementLabel(m.movement_type, m.reference_type),
    article: m.item?.name ?? "", code: m.item?.code ?? "", depot: m.warehouse ? `${m.warehouse.code} — ${m.warehouse.name}` : "",
    quantite: Number(m.quantity), cout: Number(m.unit_cost ?? 0), valeur: Number(m.total_value ?? 0) * (Number(m.quantity) < 0 ? -1 : 1),
    piece: m.entry?.piece_number ?? "", motif: m.reason ?? "",
  })), [movements]);
  const shown = (t: MovementTab) => movementsOfTab(rows.map((r) => ({ ...r, movement_type: r.type })), t);

  const exporter = () => {
    const t = (tab === "posting" ? "movements" : tab) as MovementTab;
    exportToCSV(shown(t), [
      { key: "date", header: "Date" }, { key: "libelle", header: "Type" }, { key: "code", header: "Code article" },
      { key: "article", header: "Article" }, { key: "depot", header: "Dépôt" }, { key: "quantite", header: "Quantité" },
      { key: "cout", header: "Coût unitaire" }, { key: "valeur", header: "Valeur" }, { key: "piece", header: "Pièce comptable" },
      { key: "motif", header: "Motif" },
    ], `mouvements-de-stock-${t}`);
  };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Stocks" }, { label: "Gestion des stocks", href: "/inventory" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Mouvements de stock"
        description="Réceptions, livraisons, retours, transferts et ajustements réels de la société, avec leur pièce comptable. Un mouvement naît d'une pièce : il ne se saisit ni ne se modifie directement." />

      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h1 className="text-lg font-semibold text-foreground">Stocks — Transactions</h1>
        <div className="flex gap-2">
          {perms.has("inventory.adjust") && (
            <Button size="sm" className="gap-1.5" onClick={() => setAdjOpen(true)}><ClipboardEdit className="w-3.5 h-3.5" />Ajustement de stock</Button>
          )}
          {perms.has("inventory.transfer") && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setTrOpen(true)}><ArrowLeftRight className="w-3.5 h-3.5" />Transfert</Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" data-testid="btn-export-csv" onClick={exporter}><Download className="w-3.5 h-3.5" />Exporter</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setSearchParams((sp) => { sp.set("tab", v); return sp; }, { replace: true })}>
        <TabsList className="h-auto flex-wrap justify-start mb-4">
          <TabsTrigger value="movements">Mouvements ({rows.length})</TabsTrigger>
          <TabsTrigger value="transfers">Transferts</TabsTrigger>
          <TabsTrigger value="adjustments">Ajustements et inventaires</TabsTrigger>
          <TabsTrigger value="posting">Comptabilisation</TabsTrigger>
        </TabsList>
        {(["movements", "transfers", "adjustments"] as MovementTab[]).map((t) => (
          <TabsContent key={t} value={t}>
            {isLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <MovementsTable rows={shown(t)} empty={t === "movements" ? "Aucun mouvement de stock." : "Aucun mouvement de ce type."} />
            )}
          </TabsContent>
        ))}
        <TabsContent value="posting" className="space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Comptabilisation — mouvements de stock</h2>
          </div>
          <GLPostingKPIsLive module="Inventory" />
          <GLBatchHistoryLive module="Inventory" />
        </TabsContent>
      </Tabs>

      <AdjustmentDialog open={adjOpen} onClose={() => setAdjOpen(false)} />
      <TransferDialog open={trOpen} onClose={() => setTrOpen(false)} />
    </PageShell>
  );
}

