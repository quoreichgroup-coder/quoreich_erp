import { useState } from "react";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { useItems, useWarehouses } from "@/hooks/use-inventory-data";
import { useSuppliers } from "@/hooks/use-ap-data";
import { useMyAccess } from "@/hooks/use-my-access";
import {
  useConvertReplenishment, useDeleteReplenishmentRule, useDeleteSupplierItem, useDismissReplenishment, useGenerateReplenishment,
  useReplenishmentProposals, useReplenishmentRules, useSaveReplenishmentRule, useSaveSupplierItem, useStockProjection, useSupplierItems,
} from "@/hooks/use-replenishment";
import { METHOD_LABELS, validateRule, type RuleMethod } from "@/lib/replenishment";
import { exportToCSV } from "@/lib/csv-export";

/*
 * Réapprovisionnement (V54 ; SAP fiches d'achat + point de commande, Sage X3 plan de
 * réapprovisionnement, Odoo règles min / max). Trois écrans : catalogue fournisseur (Achats → Données
 * de base), règles par article et dépôt (Stocks → Données de base), propositions converties en
 * demandes d'achat (Achats → Transactions). Tout est contrôlé par le droit procurement.replenish.
 */
const fmt = (n: number) => Number(n ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const num = (s: string) => Number(String(s ?? "").replace(",", ".")) || 0;
const sel = "w-full h-8 rounded-md border border-input bg-background px-2 text-xs";

function useCanReplenish() {
  const { data: access } = useMyAccess();
  return (access?.permissions ?? []).includes("procurement.replenish");
}

/* ─── Catalogue fournisseur ─── */
function SupplierItemDialog({ row, onClose }: { row: any | null | undefined; onClose: () => void }) {
  const { data: items = [] } = useItems();
  const { data: suppliers = [] } = useSuppliers();
  const save = useSaveSupplierItem();
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [loaded, setLoaded] = useState<string | null>(null);
  const key = row === undefined ? null : row?.id ?? "new";
  if (key && loaded !== key) {
    setLoaded(key);
    setF({
      supplier_id: row?.supplier_id ?? "", item_id: row?.item_id ?? "", supplier_ref: row?.supplier_ref ?? "",
      unit_price: String(row?.unit_price ?? ""), currency: row?.currency ?? "XOF", lead_time_days: String(row?.lead_time_days ?? ""),
      min_order_qty: String(row?.min_order_qty ?? ""), order_multiple: String(row?.order_multiple ?? ""), is_preferred: row?.is_preferred ?? false,
    });
  }
  if (row === undefined) return null;
  const close = () => { setLoaded(null); onClose(); };
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const currency = String(f.currency ?? "").toUpperCase();
  const error = !f.supplier_id ? "Choisissez le fournisseur." : !f.item_id ? "Choisissez l'article."
    : !/^[A-Z]{3}$/.test(currency) ? "Devise sur trois lettres (XOF, EUR, USD…)." : null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{row ? "Ligne de catalogue fournisseur" : "Nouvelle ligne de catalogue"}</DialogTitle>
          <DialogDescription className="text-xs">Prix, délai, minimum et multiple de commande servent au calcul des propositions ; un seul fournisseur préféré par article.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="si-supplier">Fournisseur</Label>
            <select id="si-supplier" className={sel} value={String(f.supplier_id)} onChange={s("supplier_id")} disabled={!!row}>
              <option value="">Choisir…</option>{suppliers.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="si-item">Article</Label>
            <select id="si-item" className={sel} value={String(f.item_id)} onChange={s("item_id")} disabled={!!row}>
              <option value="">Choisir…</option>{items.map((x: any) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
            </select></div>
          {([["supplier_ref", "Référence fournisseur"], ["unit_price", "Prix unitaire"], ["currency", "Devise"], ["lead_time_days", "Délai (jours)"],
            ["min_order_qty", "Minimum de commande"], ["order_multiple", "Multiple de commande"]] as const).map(([k, l]) => (
            <div key={k} className="space-y-1.5"><Label className="text-xs" htmlFor={`si-${k}`}>{l}</Label>
              <Input id={`si-${k}`} className="h-8 text-xs" value={String(f[k] ?? "")} onChange={s(k)} /></div>
          ))}
          <label className="col-span-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!!f.is_preferred} onChange={(e) => setF({ ...f, is_preferred: e.target.checked })} />Fournisseur préféré pour cet article
          </label>
        </div>
        {error && (f.supplier_id || f.item_id) && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>Annuler</Button>
          <Button size="sm" disabled={!!error || save.isPending} onClick={() => save.mutate({
            ...(row ? { id: row.id } : { supplier_id: f.supplier_id, item_id: f.item_id }),
            supplier_ref: String(f.supplier_ref || "") || null, unit_price: num(String(f.unit_price)), currency,
            lead_time_days: Math.round(num(String(f.lead_time_days))), min_order_qty: num(String(f.min_order_qty)),
            order_multiple: num(String(f.order_multiple)), is_preferred: !!f.is_preferred,
          }, { onSuccess: close })}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SupplierCatalogPanel() {
  const { data: rows = [], isLoading } = useSupplierItems();
  const canEdit = useCanReplenish();
  const remove = useDeleteSupplierItem();
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  return (
    <section aria-label="Catalogue fournisseurs" className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">Fiches d'achat : quel fournisseur livre quel article, à quel prix, en combien de jours.</p>
        <div className="flex gap-2">
          {canEdit && <Button size="sm" className="gap-1.5" onClick={() => setEdit(null)}><Plus className="w-3.5 h-3.5" />Nouvelle ligne de catalogue</Button>}
          <Button size="sm" variant="outline" data-testid="btn-export-csv" onClick={() => exportToCSV(rows.map((r) => ({
            fournisseur: r.supplier?.name, article: `${r.item?.code} ${r.item?.name}`, reference: r.supplier_ref ?? "", prix: Number(r.unit_price),
            devise: r.currency, delai: r.lead_time_days, minimum: Number(r.min_order_qty), multiple: Number(r.order_multiple), prefere: r.is_preferred ? "oui" : "",
          })), [{ key: "fournisseur", header: "Fournisseur" }, { key: "article", header: "Article" }, { key: "reference", header: "Réf. fournisseur" },
            { key: "prix", header: "Prix" }, { key: "devise", header: "Devise" }, { key: "delai", header: "Délai (j)" }, { key: "minimum", header: "Minimum" },
            { key: "multiple", header: "Multiple" }, { key: "prefere", header: "Préféré" }], "catalogue-fournisseurs")}>Exporter</Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/30 text-muted-foreground">
            <th className="text-left p-2">Fournisseur</th><th className="text-left">Article</th><th className="text-left">Réf.</th><th className="text-right">Prix</th>
            <th className="text-right">Délai</th><th className="text-right">Minimum</th><th className="text-right">Multiple</th><th className="text-left pl-3">Préféré</th><th />
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={9} className="text-center text-muted-foreground py-6">{isLoading ? "Chargement…" : "Aucune ligne de catalogue."}</td></tr>
              : rows.map((r) => (
                <tr key={r.id} data-testid="supplier-item-row" className="border-t border-border/50 cursor-pointer hover:bg-muted/40" onClick={() => canEdit && setEdit(r)}>
                  <td className="p-2">{r.supplier?.name}</td><td><span className="font-mono text-muted-foreground mr-1">{r.item?.code}</span>{r.item?.name}</td>
                  <td>{r.supplier_ref || "—"}</td><td className="text-right tabular-nums">{fmt(r.unit_price)} {r.currency}</td>
                  <td className="text-right tabular-nums">{r.lead_time_days} j</td><td className="text-right tabular-nums">{fmt(r.min_order_qty)}</td>
                  <td className="text-right tabular-nums">{fmt(r.order_multiple)}</td>
                  <td className="pl-3">{r.is_preferred ? <StatusBadge status="success" label="Préféré" /> : ""}</td>
                  <td onClick={(e) => e.stopPropagation()}>{canEdit && (
                    <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Supprimer la ligne" onClick={() => remove.mutate(r.id)}><Trash2 className="w-3 h-3" /></Button>)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <SupplierItemDialog row={edit} onClose={() => setEdit(undefined)} />
    </section>
  );
}

/* ─── Règles par article × dépôt ─── */
function RuleDialog({ row, onClose }: { row: any | null | undefined; onClose: () => void }) {
  const { data: items = [] } = useItems();
  const { data: warehouses = [] } = useWarehouses();
  const save = useSaveReplenishmentRule();
  const [f, setF] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState<string | null>(null);
  const key = row === undefined ? null : row?.id ?? "new";
  if (key && loaded !== key) {
    setLoaded(key);
    setF({ item_id: row?.item_id ?? "", warehouse_id: row?.warehouse_id ?? "", method: row?.method ?? "min_max",
      reorder_point: String(row?.reorder_point ?? ""), safety_stock: String(row?.safety_stock ?? ""),
      order_qty: String(row?.order_qty ?? ""), max_qty: String(row?.max_qty ?? ""), active: row?.active === false ? "false" : "true" });
  }
  if (row === undefined) return null;
  const close = () => { setLoaded(null); onClose(); };
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const method = (f.method || "min_max") as RuleMethod;
  const v = { itemId: f.item_id, method, reorderPoint: num(f.reorder_point), safetyStock: num(f.safety_stock), orderQty: num(f.order_qty), maxQty: num(f.max_qty) };
  const error = validateRule(v);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{row ? "Règle de réapprovisionnement" : "Nouvelle règle de réapprovisionnement"}</DialogTitle>
          <DialogDescription className="text-xs">
            Une proposition naît quand le stock prévisionnel (en stock + commandé − réservé client) atteint le point de commande.
            Le stock de sécurité reste sous le point de commande.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="rule-item">Article</Label>
            <select id="rule-item" className={sel} value={f.item_id} onChange={s("item_id")} disabled={!!row}>
              <option value="">Choisir…</option>{items.map((x: any) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="rule-warehouse">Dépôt</Label>
            <select id="rule-warehouse" className={sel} value={f.warehouse_id} onChange={s("warehouse_id")} disabled={!!row}>
              <option value="">Tous les dépôts (stock total)</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="rule-method">Méthode</Label>
            <select id="rule-method" className={sel} value={method} onChange={s("method")}>
              {Object.entries(METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          {([["reorder_point", "Point de commande"], ["safety_stock", "Stock de sécurité"],
            method === "min_max" ? ["max_qty", "Stock maximum"] : ["order_qty", "Quantité à commander"]] as const).map(([k, l]) => (
            <div key={k} className="space-y-1.5"><Label className="text-xs" htmlFor={`rule-${k}`}>{l}</Label>
              <Input id={`rule-${k}`} className="h-8 text-xs text-right" inputMode="decimal" value={f[k] ?? ""} onChange={s(k)} /></div>
          ))}
          {row && (
            <div className="space-y-1.5"><Label className="text-xs" htmlFor="rule-active">Statut</Label>
              <select id="rule-active" className={sel} value={f.active} onChange={s("active")}><option value="true">Active</option><option value="false">Suspendue</option></select></div>
          )}
        </div>
        {error && f.item_id && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>Annuler</Button>
          <Button size="sm" disabled={!!error || save.isPending} onClick={() => save.mutate({
            ...(row ? { id: row.id, active: f.active === "true" } : { item_id: f.item_id, warehouse_id: f.warehouse_id || null }),
            method, reorder_point: v.reorderPoint, safety_stock: v.safetyStock,
            order_qty: method === "reorder_point" ? v.orderQty : 0, max_qty: method === "min_max" ? v.maxQty : 0,
          }, { onSuccess: close })}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReplenishmentRulesPanel() {
  const { data: rules = [], isLoading } = useReplenishmentRules();
  const { data: projection = [] } = useStockProjection();
  const canEdit = useCanReplenish();
  const remove = useDeleteReplenishmentRule();
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  const proj = new Map(projection.map((p) => [p.item_id, p]));
  return (
    <section aria-label="Règles de réapprovisionnement" className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">Prévisionnel = en stock + commandé (demandes et commandes ouvertes) − réservé (commandes clients non livrées).</p>
        {canEdit && <Button size="sm" className="gap-1.5" onClick={() => setEdit(null)}><Plus className="w-3.5 h-3.5" />Nouvelle règle</Button>}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/30 text-muted-foreground">
            <th className="text-left p-2">Article</th><th className="text-left">Dépôt</th><th className="text-left">Méthode</th>
            <th className="text-right">Point de commande</th><th className="text-right">Sécurité</th><th className="text-right">Qté / max</th>
            <th className="text-right">En stock</th><th className="text-right">Commandé</th><th className="text-right">Réservé</th><th className="text-right">Prévisionnel</th><th className="pl-3 text-left">État</th><th />
          </tr></thead>
          <tbody>
            {rules.length === 0 ? <tr><td colSpan={12} className="text-center text-muted-foreground py-6">{isLoading ? "Chargement…" : "Aucune règle : aucun article n'est suivi."}</td></tr>
              : rules.map((r) => {
                const p = proj.get(r.item_id);
                const sous = p && Number(p.projected) <= Number(r.reorder_point);
                return (
                  <tr key={r.id} data-testid="replenishment-rule-row" className="border-t border-border/50 cursor-pointer hover:bg-muted/40" onClick={() => canEdit && setEdit(r)}>
                    <td className="p-2"><span className="font-mono text-muted-foreground mr-1">{r.item?.code}</span>{r.item?.name}</td>
                    <td>{r.warehouse ? r.warehouse.code : "Tous"}</td><td>{r.method === "min_max" ? "Min / max" : "Point de commande"}</td>
                    <td className="text-right tabular-nums">{fmt(r.reorder_point)}</td><td className="text-right tabular-nums">{fmt(r.safety_stock)}</td>
                    <td className="text-right tabular-nums">{fmt(r.method === "min_max" ? r.max_qty : r.order_qty)}</td>
                    <td className="text-right tabular-nums">{fmt(p?.on_hand ?? 0)}</td><td className="text-right tabular-nums">{fmt(p?.on_order ?? 0)}</td>
                    <td className="text-right tabular-nums">{fmt(p?.reserved ?? 0)}</td><td className="text-right tabular-nums font-medium">{fmt(p?.projected ?? 0)}</td>
                    <td className="pl-3">{!r.active ? <StatusBadge status="neutral" label="Suspendue" /> : sous ? <StatusBadge status="warning" label="À commander" /> : <StatusBadge status="success" label="Couvert" />}</td>
                    <td onClick={(e) => e.stopPropagation()}>{canEdit && (
                      <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Supprimer la règle" onClick={() => remove.mutate(r.id)}><Trash2 className="w-3 h-3" /></Button>)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <RuleDialog row={edit} onClose={() => setEdit(undefined)} />
    </section>
  );
}

/* ─── Propositions ─── */
const PROPOSAL_STATUS: Record<string, [string, string]> = {
  proposed: ["warning", "Proposée"], converted: ["success", "Convertie"], dismissed: ["neutral", "Écartée"],
};

export function ReplenishmentProposalsPanel() {
  const { data: rows = [], isLoading } = useReplenishmentProposals();
  const canRun = useCanReplenish();
  const generate = useGenerateReplenishment();
  const convert = useConvertReplenishment();
  const dismiss = useDismissReplenishment();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ecarter, setEcarter] = useState<any | null>(null);
  const [motif, setMotif] = useState("");
  const open = rows.filter((r) => r.status === "proposed");
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <section aria-label="Propositions de réapprovisionnement" className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">
          Le calcul compare le stock prévisionnel aux règles des articles suivis ; la conversion crée une demande d'achat brouillon par fournisseur,
          soumise ensuite au circuit d'approbation habituel.
        </p>
        {canRun && (
          <div className="flex gap-2">
            <Button size="sm" className="gap-1.5" disabled={generate.isPending} onClick={() => { setPicked(new Set()); generate.mutate(); }}>
              {generate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}Calculer les besoins
            </Button>
            <Button size="sm" variant="outline" disabled={picked.size === 0 || convert.isPending}
              onClick={() => convert.mutate([...picked], { onSuccess: () => setPicked(new Set()) })}>
              Convertir en demandes d'achat ({picked.size})
            </Button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/30 text-muted-foreground">
            <th className="p-2 w-8">
              {canRun && open.length > 0 && (
                <input type="checkbox" aria-label="Tout sélectionner" checked={open.every((r) => picked.has(r.id))}
                  onChange={(e) => setPicked(e.target.checked ? new Set(open.map((r) => r.id)) : new Set())} />)}
            </th>
            <th className="text-left">Article</th><th className="text-left">Dépôt</th><th className="text-left">Fournisseur</th>
            <th className="text-right">Prévisionnel</th><th className="text-right">Point de commande</th><th className="text-right">À commander</th>
            <th className="text-right">Prix</th><th className="text-left pl-3">Besoin le</th><th className="text-left">État</th><th />
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={11} className="text-center text-muted-foreground py-6">{isLoading ? "Chargement…" : "Aucune proposition : lancer « Calculer les besoins »."}</td></tr>
              : rows.map((r) => {
                const [st, lbl] = PROPOSAL_STATUS[r.status] ?? ["neutral", r.status];
                return (
                  <tr key={r.id} data-testid="replenishment-proposal-row" className="border-t border-border/50">
                    <td className="p-2">{canRun && r.status === "proposed" && (
                      <input type="checkbox" aria-label={`Sélectionner ${r.item?.code}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />)}</td>
                    <td><span className="font-mono text-muted-foreground mr-1">{r.item?.code}</span>{r.item?.name}</td>
                    <td>{r.warehouse?.code ?? "Tous"}</td><td>{r.supplier?.name ?? <span className="text-muted-foreground">à choisir</span>}</td>
                    <td className="text-right tabular-nums">{fmt(r.projected)}</td><td className="text-right tabular-nums">{fmt(r.reorder_point)}</td>
                    <td className="text-right tabular-nums font-medium">{fmt(r.quantity)} {r.item?.unit ?? ""}</td>
                    <td className="text-right tabular-nums">{fmt(r.unit_price)} {r.currency}</td>
                    <td className="pl-3 tabular-nums">{r.needed_by ?? "—"}</td>
                    <td><StatusBadge status={st} label={r.requisition?.pr_number ? `${lbl} · ${r.requisition.pr_number}` : lbl} /></td>
                    <td>{canRun && r.status === "proposed" && (
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setEcarter(r); setMotif(""); }}>Écarter</Button>)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {ecarter && (
        <Dialog open onOpenChange={(o) => { if (!o) setEcarter(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="text-sm">Écarter la proposition {ecarter.item?.code}</DialogTitle></DialogHeader>
            <div className="space-y-1.5"><Label className="text-xs" htmlFor="dismiss-reason">Motif (obligatoire)</Label>
              <Input id="dismiss-reason" className="h-8 text-xs" value={motif} onChange={(e) => setMotif(e.target.value)} /></div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setEcarter(null)}>Annuler</Button>
              <Button size="sm" disabled={!motif.trim() || dismiss.isPending}
                onClick={() => dismiss.mutate({ id: ecarter.id, reason: motif.trim() }, { onSuccess: () => setEcarter(null) })}>Écarter</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
