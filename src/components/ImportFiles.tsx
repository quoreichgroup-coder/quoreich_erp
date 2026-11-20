import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { apiDelete, apiGet, apiPatch, apiPost, isApiEnabled } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useMyAccess } from "@/hooks/use-my-access";
import { cn } from "@/lib/utils";
import { ShipmentTracking, TrackingBadge, useTrackingStatus } from "@/components/ShipmentTracking";
import { ConsolidationStock, ImportFileProcess, ImportSettingsPanel } from "@/components/ImportProcess";

/*
 * Dossiers d'importation (V129, lot I2) : commandes rattachées, lignes reçues, frais d'approche (factures du transitaire,
 * du transporteur, de l'assureur, de la douane), estimation des droits UEMOA, répartition dans le coût du stock (part en
 * stock : coût moyen relevé, 311 / 6031 en inventaire permanent ; part consommée : en charges). Droit procurement.import.
 */
const db = supabase as any;
const P = "/api/v1/procurement";
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const STATUS: Record<string, string> = { open: "Ouvert", in_transit: "En transit", arrived: "Arrivé", cleared: "Dédouané", allocated: "Frais répartis", closed: "Clos" };
const TRANSPORT: Record<string, string> = { sea: "Maritime", air: "Aérien", road: "Routier", rail: "Ferroviaire", multimodal: "Multimodal" };
const BASIS: Record<string, string> = { value: "Valeur", quantity: "Quantité", weight: "Poids", volume: "Volume" };
const TEC = [0, 5, 10, 20, 35];

async function check<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

function useImportData<T>(key: unknown[], api: string | null, cloud: () => PromiseLike<{ data: T; error: unknown }>, enabled = true) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: [...key, tenantId],
    enabled: Boolean(tenantId) && enabled,
    retry: false,
    queryFn: async (): Promise<T> => (isApiEnabled() && api ? apiGet<T>(api) : check<T>(cloud())),
  });
}

function useImportMutation<I>(run: (i: I) => Promise<unknown>, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      for (const k of ["import-files", "import-file-costs", "import-file-lines", "import-file-allocations", "items", "journal-entries", "tracking-status", "shipment-timeline"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function ImportFiles({ suppliers, purchaseOrders }: { suppliers: any[]; purchaseOrders: any[] }) {
  const access = useMyAccess();
  const canEdit = access.data?.permissions.includes("procurement.import") ?? false;
  const files = useImportData<any[]>(["import-files"], `${P}/import-files`,
    () => db.from("import_files").select("*, supplier:suppliers!import_files_supplier_id_fkey(name), orders:import_file_orders(po_id)").order("created_at", { ascending: false }));
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({ supplier_id: "", forwarder_id: "", incoterm: "FOB", transport_mode: "sea", bill_of_lading: "", destination_country: "BF", tec_category: "10", eta: "" });
  const create = useImportMutation(async () => {
    const body = { ...form, forwarder_id: form.forwarder_id || null, tec_category: Number(form.tec_category), eta: form.eta || null, bill_of_lading: form.bill_of_lading || null };
    if (isApiEnabled()) return apiPost(`${P}/import-files`, body);
    const tenant_id = (await db.from("profiles").select("tenant_id").limit(1).single()).data?.tenant_id;
    return check(db.from("import_files").insert({ ...body, tenant_id }).select("id"));
  }, "Dossier d'importation ouvert");
  const list = (files.data ?? []).map((f: any) => ({ ...f, supplier_name: f.supplier_name ?? f.supplier?.name, po_ids: f.po_ids ?? (f.orders ?? []).map((o: any) => o.po_id) }));
  const tracking = useTrackingStatus();
  const trackingById = new Map((tracking.data ?? []).map((t: any) => [t.import_file_id, t]));
  // Dossier ouvert depuis une commande (V131) : fournisseur, Incoterm, date prévue et commande repris, sans ressaisie.
  const linked = new Set(list.flatMap((f) => f.po_ids));
  const openable = purchaseOrders.filter((p) => !linked.has(p.id) && ["approved", "ordered", "partially_received", "received"].includes(p.status));
  const fromPo = useImportMutation(async (poId: string) => isApiEnabled() ? apiPost(`${P}/purchase-orders/${poId}/import-file`, {})
    : check(db.rpc("create_import_file_from_po", { _po: poId })), "Dossier d'importation ouvert depuis la commande");
  const current = list.find((f) => f.id === selected) ?? null;

  return (
    <div className="space-y-3" data-testid="import-files">
      <ImportSettingsPanel />
      <ConsolidationStock />
      {canEdit && (
        <div className="bg-card border border-border rounded-lg p-3 flex flex-wrap items-end gap-3" data-testid="import-file-form">
          <div className="space-y-1"><Label className="text-xs" htmlFor="imp-supplier">Fournisseur *</Label>
            <select id="imp-supplier" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={form.supplier_id} onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}>
              <option value="">— Sélectionner —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="imp-forwarder">Transitaire</Label>
            <select id="imp-forwarder" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={form.forwarder_id} onChange={(e) => setForm((f) => ({ ...f, forwarder_id: e.target.value }))}>
              <option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="imp-incoterm">Incoterm</Label>
            <Input id="imp-incoterm" className="h-8 text-xs w-20 uppercase" value={form.incoterm} onChange={(e) => setForm((f) => ({ ...f, incoterm: e.target.value.toUpperCase() }))} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="imp-transport">Transport</Label>
            <select id="imp-transport" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={form.transport_mode} onChange={(e) => setForm((f) => ({ ...f, transport_mode: e.target.value }))}>
              {Object.entries(TRANSPORT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="imp-bl">Connaissement / LTA</Label>
            <Input id="imp-bl" className="h-8 text-xs w-36" value={form.bill_of_lading} onChange={(e) => setForm((f) => ({ ...f, bill_of_lading: e.target.value }))} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="imp-country">Pays de dédouanement</Label>
            <select id="imp-country" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={form.destination_country} onChange={(e) => setForm((f) => ({ ...f, destination_country: e.target.value }))}>
              <option value="BF">Burkina Faso</option><option value="CI">Côte d'Ivoire</option></select></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="imp-tec">Catégorie TEC</Label>
            <select id="imp-tec" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={form.tec_category} onChange={(e) => setForm((f) => ({ ...f, tec_category: e.target.value }))}>
              {TEC.map((t) => <option key={t} value={t}>{t} %</option>)}</select></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="imp-eta">Arrivée prévue (ETA)</Label>
            <Input id="imp-eta" type="date" className="h-8 text-xs w-36" value={form.eta} onChange={(e) => setForm((f) => ({ ...f, eta: e.target.value }))} /></div>
          <Button size="sm" className="h-8 text-xs" disabled={!form.supplier_id || create.isPending} onClick={() => create.mutate(undefined)} data-testid="import-file-create">Ouvrir le dossier</Button>
          {openable.length > 0 && <div className="space-y-1 ml-auto"><Label className="text-xs" htmlFor="imp-from-po">Ou depuis une commande (déjà rempli)</Label>
            <select id="imp-from-po" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value="" disabled={fromPo.isPending}
              onChange={(e) => e.target.value && fromPo.mutate(e.target.value)}>
              <option value="">— Commande —</option>{openable.map((p) => <option key={p.id} value={p.id}>{p.po_number} · {p.supplier?.name ?? ""}</option>)}</select></div>}
        </div>
      )}
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        {files.isLoading ? <div className="p-3"><Loader2 className="w-4 h-4 animate-spin" /></div> : (
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-muted-foreground"><tr><th className="text-left p-2">Dossier</th><th className="text-left">Fournisseur</th><th className="text-left">Incoterm</th>
              <th className="text-left">Transport</th><th className="text-left">ETA</th><th className="text-left">Suivi</th><th className="text-left">Commandes</th><th className="text-left pr-2">Statut</th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={8} className="p-3 text-muted-foreground">Aucun dossier d'importation.</td></tr>}
              {list.map((f) => (
                <tr key={f.id} data-testid="import-file-row" className={cn("border-t border-border/50 cursor-pointer hover:bg-muted/30", selected === f.id && "bg-primary/5")} onClick={() => setSelected(f.id)}>
                  <td className="p-2 font-mono">{f.file_number}</td><td>{f.supplier_name}</td><td>{f.incoterm ?? "—"}</td><td>{TRANSPORT[f.transport_mode] ?? "—"}</td>
                  <td>{f.eta ?? "—"}</td><td><TrackingBadge state={trackingById.get(f.id)?.tracking_state} delay={trackingById.get(f.id)?.delay_days} /></td>
                  <td>{f.po_ids.length}</td><td className="pr-2">{STATUS[f.status] ?? f.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {current && <ImportFileDetail file={current} canEdit={canEdit} purchaseOrders={purchaseOrders} />}
    </div>
  );
}

function ImportFileDetail({ file, canEdit, purchaseOrders }: { file: any; canEdit: boolean; purchaseOrders: any[] }) {
  const frozen = ["allocated", "closed"].includes(file.status);
  const editable = canEdit && !frozen;
  const id = file.id as string;
  const lines = useImportData<any[]>(["import-file-lines", id], `${P}/import-files/${id}/received-lines`, () => db.rpc("import_file_received_lines", { _file: id }));
  const costs = useImportData<any[]>(["import-file-costs", id], `${P}/import-files/${id}/costs`,
    () => db.from("import_file_costs").select("*, type:landed_cost_types(code, label, capitalize, allocation_basis), ap:ap_invoices(invoice_number)").eq("import_file_id", id).order("created_at"));
  const types = useImportData<any[]>(["landed-cost-types"], `${P}/landed-cost-types`, () => db.from("landed_cost_types").select("*").order("code"));
  const allocations = useImportData<any[]>(["import-file-allocations", id], `${P}/import-files/${id}/allocations`,
    () => db.from("import_file_allocations").select("*, item:items(name)").eq("import_file_id", id), frozen);
  const costRows = (costs.data ?? []).map((c: any) => ({ ...c, type_code: c.type_code ?? c.type?.code, type_label: c.type_label ?? c.type?.label,
    capitalize: c.capitalize ?? c.type?.capitalize, basis: c.allocation_basis ?? c.type_basis ?? c.type?.allocation_basis, ap_invoice_number: c.ap_invoice_number ?? c.ap?.invoice_number }));
  const received = lines.data ?? [];
  const goodsValue = received.reduce((t, l) => t + Number(l.value), 0);
  const freightInsurance = costRows.filter((c) => ["FRET", "ASSUR"].includes(c.type_code)).reduce((t, c) => t + Number(c.amount), 0);
  const cif = Math.round(goodsValue + freightInsurance);

  const setStatus = useImportMutation(async (status: string) => isApiEnabled() ? apiPatch(`${P}/import-files/${id}`, { status })
    : check(db.from("import_files").update({ status }).eq("id", id).select("id")), "Statut du dossier mis à jour");
  const addOrder = useImportMutation(async (po_id: string) => isApiEnabled() ? apiPost(`${P}/import-files/${id}/orders`, { po_id })
    : check(db.from("import_file_orders").insert({ import_file_id: id, po_id, tenant_id: file.tenant_id }).select("po_id")), "Commande rattachée au dossier");
  const removeOrder = useImportMutation(async (po_id: string) => isApiEnabled() ? apiDelete(`${P}/import-files/${id}/orders/${po_id}`)
    : check(db.from("import_file_orders").delete().eq("import_file_id", id).eq("po_id", po_id).select("po_id")), "Commande détachée");
  const addCost = useImportMutation(async (c: { cost_type_id: string; amount: number; description: string | null; allocation_basis: string | null }) =>
    isApiEnabled() ? apiPost(`${P}/import-files/${id}/costs`, c)
      : check(db.from("import_file_costs").insert({ ...c, import_file_id: id, tenant_id: file.tenant_id }).select("id")), "Frais ajouté au dossier");
  const removeCost = useImportMutation(async (costId: string) => isApiEnabled() ? apiDelete(`${P}/import-files/${id}/costs/${costId}`)
    : check(db.from("import_file_costs").delete().eq("id", costId).select("id")), "Frais retiré");
  const allocate = useImportMutation(async (date: string) => isApiEnabled() ? apiPost(`${P}/import-files/${id}/allocate`, { date })
    : check(db.rpc("allocate_import_costs", { _file: id, _date: date })), "Frais répartis dans le coût du stock");

  const [cost, setCost] = useState({ type: "", amount: "", description: "", basis: "" });
  const [allocDate, setAllocDate] = useState(today());
  const estimate = useImportData<any[]>(["customs-estimate", id, cif, file.destination_country, file.tec_category],
    `${P}/customs-estimate?country=${file.destination_country ?? "BF"}&category=${file.tec_category ?? 0}&cif=${cif}`,
    () => db.rpc("customs_estimate", { _country: file.destination_country ?? "BF", _tec_category: file.tec_category ?? 0, _cif: cif }), cif > 0);
  const linkable = purchaseOrders.filter((p) => p.supplier_id === file.supplier_id && !file.po_ids.includes(p.id) && p.status !== "draft");
  const typeByCode = useMemo(() => new Map((types.data ?? []).map((t: any) => [t.code, t])), [types.data]);
  const addDuties = async () => {
    for (const e of (estimate.data ?? []).filter((x) => x.capitalize && Number(x.amount) > 0)) {
      const t = typeByCode.get(e.code);
      if (t) await addCost.mutateAsync({ cost_type_id: t.id, amount: Number(e.amount), description: `${e.label} (estimation, taux ${e.rate} %)`, allocation_basis: null });
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-4" data-testid="import-file-detail">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold flex-1">Dossier {file.file_number} — {file.supplier_name}</h3>
        {canEdit && file.status !== "closed" && (
          <select aria-label="Statut du dossier" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={file.status}
            onChange={(e) => setStatus.mutate(e.target.value)} disabled={file.status === "closed"}>
            {Object.entries(STATUS).filter(([v]) => v !== "allocated" || file.status === "allocated").filter(([v]) => !frozen || v === "allocated" || v === "closed")
              .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </div>

      <section className="space-y-2">
        <p className="text-xs font-medium">Commandes du dossier</p>
        <div className="flex flex-wrap gap-2 text-xs">
          {file.po_ids.length === 0 && <span className="text-muted-foreground">Aucune commande rattachée.</span>}
          {file.po_ids.map((poId: string) => {
            const po = purchaseOrders.find((p) => p.id === poId);
            return <span key={poId} className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5">{po?.po_number ?? poId.slice(0, 8)}
              {editable && <button type="button" aria-label={`Détacher ${po?.po_number ?? ""}`} onClick={() => removeOrder.mutate(poId)}><Trash2 className="w-3 h-3" /></button>}</span>;
          })}
          {editable && linkable.length > 0 && (
            <select aria-label="Rattacher une commande" className="h-7 px-2 rounded-md border border-input bg-background text-xs" value="" onChange={(e) => e.target.value && addOrder.mutate(e.target.value)}>
              <option value="">+ Rattacher une commande</option>{linkable.map((p) => <option key={p.id} value={p.id}>{p.po_number}</option>)}</select>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium">Marchandises reçues (valeur au coût de la commande)</p>
        <table className="w-full text-xs" data-testid="import-file-lines">
          <thead className="text-muted-foreground"><tr><th className="text-left">Réception</th><th className="text-left">Article</th><th className="text-right">Quantité</th>
            <th className="text-right">Valeur</th><th className="text-right">Poids (kg)</th><th className="text-right">Volume (m³)</th></tr></thead>
          <tbody>
            {received.length === 0 && <tr><td colSpan={6} className="py-2 text-muted-foreground">Aucune réception validée sur les commandes du dossier.</td></tr>}
            {received.map((l) => <tr key={l.gr_line_id} className="border-t border-border/50"><td>{l.gr_number}</td><td>{l.item_name}</td>
              <td className="text-right tabular-nums">{fmt(l.quantity)}</td><td className="text-right tabular-nums">{fmt(l.value)}</td>
              <td className="text-right tabular-nums">{fmt(l.weight)}</td><td className="text-right tabular-nums">{fmt(l.volume)}</td></tr>)}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium">Frais d'approche</p>
        <table className="w-full text-xs" data-testid="import-file-costs">
          <thead className="text-muted-foreground"><tr><th className="text-left">Type</th><th className="text-left">Libellé</th><th className="text-left">Base</th>
            <th className="text-left">Coût du stock</th><th className="text-right">Montant HT</th><th /></tr></thead>
          <tbody>
            {costRows.length === 0 && <tr><td colSpan={6} className="py-2 text-muted-foreground">Aucun frais.</td></tr>}
            {costRows.map((c) => <tr key={c.id} className="border-t border-border/50" data-testid="import-cost-row"><td>{c.type_label}</td><td>{c.description ?? ""}{c.ap_invoice_number ? ` · ${c.ap_invoice_number}` : ""}</td>
              <td>{BASIS[c.basis] ?? c.basis}</td><td>{c.is_estimate ? "Estimation" : c.capitalize ? "Incorporé" : "En charges"}</td><td className="text-right tabular-nums">{fmt(c.amount)}</td>
              <td className="text-right">{editable && <button type="button" aria-label={`Retirer ${c.type_label}`} onClick={() => removeCost.mutate(c.id)}><Trash2 className="w-3 h-3" /></button>}</td></tr>)}
          </tbody>
        </table>
        {editable && (
          <div className="flex flex-wrap items-end gap-2" data-testid="import-cost-form">
            <div className="space-y-1"><Label className="text-xs" htmlFor="imp-cost-type">Type de frais</Label>
              <select id="imp-cost-type" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={cost.type} onChange={(e) => setCost((c) => ({ ...c, type: e.target.value }))}>
                <option value="">— Sélectionner —</option>{(types.data ?? []).filter((t: any) => t.is_active).map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="imp-cost-amount">Montant HT (XOF)</Label>
              <Input id="imp-cost-amount" inputMode="decimal" className="h-8 text-xs w-32 text-right" value={cost.amount} onChange={(e) => setCost((c) => ({ ...c, amount: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="imp-cost-basis">Base de répartition</Label>
              <select id="imp-cost-basis" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={cost.basis} onChange={(e) => setCost((c) => ({ ...c, basis: e.target.value }))}>
                <option value="">Celle du type</option>{Object.entries(BASIS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div className="space-y-1 flex-1 min-w-[160px]"><Label className="text-xs" htmlFor="imp-cost-desc">Libellé / facture</Label>
              <Input id="imp-cost-desc" className="h-8 text-xs" value={cost.description} onChange={(e) => setCost((c) => ({ ...c, description: e.target.value }))} /></div>
            <Button size="sm" className="h-8 text-xs" data-testid="import-cost-add" disabled={!cost.type || !(Number(cost.amount.replace(",", ".")) > 0) || addCost.isPending}
              onClick={() => addCost.mutate({ cost_type_id: cost.type, amount: Number(cost.amount.replace(",", ".")), description: cost.description || null, allocation_basis: cost.basis || null },
                { onSuccess: () => setCost({ type: "", amount: "", description: "", basis: "" }) })}>Ajouter le frais</Button>
          </div>
        )}
      </section>

      {cif > 0 && (
        <section className="space-y-2" data-testid="customs-estimate">
          <p className="text-xs font-medium">Droits et taxes estimés ({file.destination_country}, catégorie TEC {file.tec_category ?? 0} %) sur une valeur CAF de {fmt(cif)} XOF</p>
          <table className="w-full text-xs">
            <tbody>{(estimate.data ?? []).map((e) => <tr key={e.code} className="border-t border-border/50"><td>{e.label}</td><td className="text-right tabular-nums">{e.rate} %</td>
              <td className="text-right tabular-nums">{fmt(e.amount)}</td><td className="pl-2 text-muted-foreground">{e.capitalize ? "coût du stock" : "TVA récupérable (4452)"}{e.is_validated ? "" : " · taux à confirmer"}</td></tr>)}</tbody>
          </table>
          {editable && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addDuties} disabled={addCost.isPending}>Ajouter les droits estimés au dossier</Button>}
          <p className="text-[11px] text-muted-foreground">Estimation : la déclaration en douane (et la facture du transitaire) fait foi. La TVA à l'importation ne se répartit pas : elle se récupère.</p>
        </section>
      )}

      {editable && (
        <section className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <div className="space-y-1"><Label className="text-xs" htmlFor="imp-alloc-date">Date de la répartition</Label>
            <Input id="imp-alloc-date" type="date" className="h-8 text-xs w-40" value={allocDate} onChange={(e) => setAllocDate(e.target.value)} /></div>
          <Button size="sm" className="h-8 text-xs" data-testid="import-allocate" disabled={allocate.isPending || received.length === 0 || costRows.length === 0}
            onClick={() => { if (window.confirm(`Répartir les frais du dossier ${file.file_number} ? Le dossier sera ensuite figé.`)) allocate.mutate(allocDate); }}>
            {allocate.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Répartir les frais dans le coût du stock</Button>
        </section>
      )}

      <ImportFileProcess file={file} editable={canEdit && file.status !== "closed"} />
      <ShipmentTracking file={file} canEdit={canEdit && file.status !== "closed"} />

      {frozen && (
        <section className="space-y-2" data-testid="import-file-allocations">
          <p className="text-xs font-medium">Répartition ({file.allocation_date})</p>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground"><tr><th className="text-left">Article</th><th className="text-left">Base</th><th className="text-right">Réparti</th>
              <th className="text-right">Au stock</th><th className="text-right">En charges</th></tr></thead>
            <tbody>{(allocations.data ?? []).map((a: any) => <tr key={a.id} className="border-t border-border/50"><td>{a.item_name ?? a.item?.name ?? "—"}</td><td>{BASIS[a.basis] ?? a.basis}</td>
              <td className="text-right tabular-nums">{fmt(a.allocated)}</td><td className="text-right tabular-nums">{fmt(a.to_stock)}</td><td className="text-right tabular-nums">{fmt(a.to_expense)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
