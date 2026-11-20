import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, isApiEnabled } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useMyAccess } from "@/hooks/use-my-access";
import { useWarehouses } from "@/hooks/use-inventory-data";

/*
 * Processus d'importation sans fichier Excel (V132 ; procédure Sage 300 « commandes internationales » automatisée,
 * idées reprises de Dynamics 365 Landed cost, SAP transfert en deux temps, NetSuite Inbound Shipment) :
 * frais estimés par règles puis réels, commande de transport depuis le dossier, expédition (consolidation → transit) et
 * arrivée (transit → dépôt) en un clic, stock consolidé ou en transit, paramètres (numéro d'expédition, dépôts, règles).
 */
const db = supabase as any;
const P = "/api/v1/procurement";
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const PRESETS: [string, string][] = [["IMP-{YYYY}-{SEQ4}", "IMP-2026-0012"], ["{YYYY}-{FWD}-{MODE}-{SEQ3}", "2026-BOL-MER-012 (procédure Sage 300)"]];

async function check<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => { for (const k of ["import-files", "import-file-costs", "cost-comparison", "import-transfers", "consolidation-stock", "items", "purchase-orders", "import-settings", "landed-cost-rules", "shipment-timeline", "import-cost-report", "goods-receipts"]) qc.invalidateQueries({ queryKey: [k] }); };
}

function useRun<I>(run: (i: I) => Promise<unknown>, success: (r: any) => string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: run, onSuccess: (r) => { invalidate(); toast.success(success(r)); }, onError: (e: Error) => toast.error(e.message) });
}

/** Actions du processus dans le détail d'un dossier. */
export function ImportFileProcess({ file, editable }: { file: any; editable: boolean }) {
  const id = file.id as string;
  const { data: warehouses = [] } = useWarehouses();
  const comparison = useQuery({
    queryKey: ["cost-comparison", id],
    queryFn: async (): Promise<any[]> => isApiEnabled() ? apiGet<any[]>(`${P}/import-files/${id}/cost-comparison`)
      : check<any[]>(db.from("import_file_cost_comparison").select("*").eq("import_file_id", id)),
  });
  const transfers = useQuery({
    queryKey: ["import-transfers", id],
    queryFn: async (): Promise<any[]> => isApiEnabled() ? apiGet<any[]>(`${P}/import-files/${id}/transfers`)
      : check<any[]>(db.from("import_file_transfers").select("*, item:items(name)").eq("import_file_id", id).order("created_at")),
  });
  const setWarehouse = useRun(async (patch: Record<string, string | null>) => isApiEnabled() ? apiPatch(`${P}/import-files/${id}`, patch)
    : check(db.from("import_files").update(patch).eq("id", id).select("id")), () => "Dépôts du dossier enregistrés");
  const estimate = useRun(async () => isApiEnabled() ? apiPost(`${P}/import-files/${id}/estimate`, {}) : check(db.rpc("apply_landed_cost_rules", { _file: id })),
    (n) => `${n} frais estimé(s) d'après les règles de la société`);
  const transportPo = useRun(async () => isApiEnabled() ? apiPost(`${P}/import-files/${id}/transport-po`, {}) : check(db.rpc("create_transport_po", { _file: id })),
    () => "Commande de transport créée (brouillon) et rattachée au dossier");
  const report = useQuery({
    queryKey: ["import-cost-report", id],
    queryFn: async (): Promise<any[]> => isApiEnabled() ? apiGet<any[]>(`${P}/import-files/${id}/cost-report`)
      : check<any[]>(db.from("import_file_cost_report").select("*").eq("import_file_id", id).order("item_code")),
  });
  const receive = useRun(async () => isApiEnabled() ? apiPost(`${P}/import-files/${id}/receive`, { date })
    : check(db.rpc("receive_import_file", { _file: id, _date: date })), (r) => `${r.receipts} réception(s) validée(s) pour le dossier`);
  const [date, setDate] = useState(today());
  const transfer = useRun(async (stage: "ship" | "deliver") => isApiEnabled() ? apiPost(`${P}/import-files/${id}/transit`, { stage, date })
    : check(db.rpc("import_file_transit_transfer", { _file: id, _stage: stage, _date: date })),
    (r) => `Transfert effectué : ${r.lines} article(s), ${fmt(r.value)} XOF`);
  const wh = (kind: string[]) => (warehouses as any[]).filter((w) => kind.includes(w.kind ?? "standard") && w.status !== "inactive");
  const select = (label: string, field: string, kinds: string[]) => (
    <div className="space-y-1"><Label className="text-xs" htmlFor={`imp-${field}`}>{label}</Label>
      <select id={`imp-${field}`} className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={file[field] ?? ""} disabled={!editable || setWarehouse.isPending}
        onChange={(e) => setWarehouse.mutate({ [field]: e.target.value || null })}>
        <option value="">—</option>{wh(kinds).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></div>
  );
  return (
    <section className="space-y-3 border-t border-border pt-3" data-testid="import-process">
      <p className="text-xs font-medium">Processus d'importation</p>
      <div className="flex flex-wrap items-end gap-3">
        {select("Magasin de consolidation", "consolidation_warehouse_id", ["consolidation"])}
        {select("Dépôt de transit", "transit_warehouse_id", ["transit"])}
        {select("Dépôt de destination", "destination_warehouse_id", ["standard"])}
      </div>
      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={estimate.isPending} onClick={() => estimate.mutate(undefined)} data-testid="import-estimate">Appliquer les frais estimés</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={transportPo.isPending || !file.forwarder_id} title={file.forwarder_id ? "" : "Choisissez d'abord le transitaire"}
            onClick={() => transportPo.mutate(undefined)} data-testid="import-transport-po">Créer la commande de transport</Button>
          <div className="space-y-1"><Label className="text-xs" htmlFor="imp-transit-date">Date du transfert</Label>
            <Input id="imp-transit-date" type="date" className="h-8 text-xs w-36" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={receive.isPending} onClick={() => receive.mutate(undefined)} data-testid="import-receive"
            title="Une réception validée par commande du dossier, pour tout le reste à recevoir, dans le magasin de consolidation (sinon le dépôt de destination)">
            Réceptionner tout le dossier</Button>
          <Button size="sm" className="h-8 text-xs" disabled={transfer.isPending} onClick={() => transfer.mutate("ship")} data-testid="import-ship">
            {transfer.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Expédier (consolidation → transit)</Button>
          <Button size="sm" className="h-8 text-xs" disabled={transfer.isPending} onClick={() => transfer.mutate("deliver")} data-testid="import-deliver">Arrivée au dépôt (transit → destination)</Button>
        </div>
      )}
      {(comparison.data ?? []).length > 0 && (
        <table className="w-full text-xs" data-testid="import-cost-comparison">
          <thead className="text-muted-foreground"><tr><th className="text-left">Frais</th><th className="text-right">Estimé</th><th className="text-right">Réel</th><th className="text-right">Écart</th></tr></thead>
          <tbody>{(comparison.data ?? []).map((c) => (
            <tr key={c.cost_type_id} className="border-t border-border/50"><td>{c.label}</td><td className="text-right tabular-nums">{fmt(c.estimated)}</td>
              <td className="text-right tabular-nums">{fmt(c.actual)}</td><td className={`text-right tabular-nums ${Number(c.variance) > 0 ? "text-destructive" : ""}`}>{fmt(c.variance)}</td></tr>))}</tbody>
        </table>
      )}
      {(report.data ?? []).length > 0 && (
        <table className="w-full text-xs" data-testid="import-cost-report">
          <caption className="text-left font-medium pb-1">Coût de revient par article</caption>
          <thead className="text-muted-foreground"><tr><th className="text-left">Article</th><th className="text-right">Quantité</th><th className="text-right">Valeur d'achat</th>
            <th className="text-right">Frais répartis</th><th className="text-right">Coût unitaire rendu</th></tr></thead>
          <tbody>{(report.data ?? []).map((c) => (
            <tr key={`${c.item_id}-${c.item_name}`} className="border-t border-border/50"><td>{c.item_code ? `${c.item_code} — ` : ""}{c.item_name}</td>
              <td className="text-right tabular-nums">{fmt(c.quantity)}</td><td className="text-right tabular-nums">{fmt(c.purchase_value)}</td>
              <td className="text-right tabular-nums">{fmt(c.landed_costs)}</td><td className="text-right tabular-nums">{fmt(c.unit_landed_cost)}</td></tr>))}</tbody>
        </table>
      )}
      {(transfers.data ?? []).length > 0 && (
        <table className="w-full text-xs" data-testid="import-transfers">
          <thead className="text-muted-foreground"><tr><th className="text-left">Date</th><th className="text-left">Étape</th><th className="text-left">Article</th><th className="text-right">Quantité</th><th className="text-right">Valeur</th></tr></thead>
          <tbody>{(transfers.data ?? []).map((t) => (
            <tr key={t.id} className="border-t border-border/50"><td>{t.transfer_date}</td><td>{t.stage === "ship" ? "Expédition" : "Arrivée"}</td><td>{t.item_name ?? t.item?.name}</td>
              <td className="text-right tabular-nums">{fmt(t.quantity)}</td><td className="text-right tabular-nums">{fmt(Number(t.quantity) * Number(t.unit_cost))}</td></tr>))}</tbody>
        </table>
      )}
    </section>
  );
}

/** Stock acheté encore en consolidation ou en transit (381). */
export function ConsolidationStock() {
  const { data: tenantId } = useTenantId();
  const q = useQuery({
    queryKey: ["consolidation-stock", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<any[]> => isApiEnabled() ? apiGet<any[]>(`${P}/consolidation-stock`) : check<any[]>(db.from("consolidation_stock").select("*")),
  });
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs space-y-1" data-testid="consolidation-stock">
      <p className="font-medium">Marchandises en consolidation ou en transit (compte 381)</p>
      <table className="w-full"><tbody>{rows.map((r) => (
        <tr key={`${r.warehouse_id}-${r.item_id}`} className="border-t border-border/50"><td className="py-1">{r.warehouse_code} · {r.kind === "consolidation" ? "consolidation" : "transit"}</td>
          <td>{r.item_code} — {r.item_name}</td><td className="text-right tabular-nums">{fmt(r.quantity_on_hand)}</td><td className="text-right tabular-nums">{fmt(r.value)} XOF</td></tr>))}</tbody></table>
    </div>
  );
}

const PROVIDERS: [string, string][] = [["dcsa", "Format DCSA (compagnie ou plateforme compatible)"], ["terminal49", "Terminal49"], ["vizion", "Vizion"],
  ["shipsgo", "ShipsGo"], ["searates", "SeaRates"]];

/** Suivi automatique par un prestataire (V134) : adresse de réception propre à la société, clé API en écriture seule. */
function TrackingConnection({ canSettings }: { canSettings: boolean }) {
  const { data: tenantId } = useTenantId();
  const invalidate = useQueryClient();
  const conn = useQuery({
    queryKey: ["tracking-connection", tenantId],
    enabled: Boolean(tenantId) && canSettings,
    queryFn: async (): Promise<any> => isApiEnabled() ? apiGet<any>(`${P}/tracking-connection`)
      : (await check<any[]>(db.from("tracking_connections").select("provider, enabled, webhook_token, last_received_at, last_result").limit(1)))[0] ?? null,
  });
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const save = useMutation({
    mutationFn: async (v: { provider: string; enabled: boolean; api_key: string | null; regenerate?: boolean }) => isApiEnabled()
      ? apiPut(`${P}/tracking-connection`, v)
      : check(db.rpc("set_tracking_connection", { _provider: v.provider, _enabled: v.enabled, _api_key: v.api_key, _regenerate: v.regenerate ?? false })),
    onSuccess: () => { invalidate.invalidateQueries({ queryKey: ["tracking-connection"] }); setApiKey(""); toast.success("Connexion de suivi enregistrée"); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!canSettings) return null;
  const c = conn.data;
  const current = provider || c?.provider || "dcsa";
  const base = isApiEnabled() ? String(import.meta.env.VITE_QERP_API_URL ?? "").replace(/\/$/, "") : String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  const url = c?.webhook_token ? (isApiEnabled() ? `${base}/api/v1/tracking-webhook/${c.webhook_token}` : `${base}/functions/v1/tracking-webhook?token=${c.webhook_token}`) : null;
  return (
    <div className="space-y-2 border-t border-border pt-2" data-testid="tracking-connection">
      <p className="font-medium">Suivi automatique par un prestataire</p>
      <p className="text-muted-foreground">Le prestataire envoie les événements (format DCSA) à l'adresse ci-dessous ; ils se rattachent au dossier par le connaissement
        ou le numéro de conteneur. Service payant, à souscrire auprès du prestataire choisi.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label className="text-xs" htmlFor="trk-provider">Prestataire</Label>
          <select id="trk-provider" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={current} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="space-y-1"><Label className="text-xs" htmlFor="trk-key">Clé API du prestataire</Label>
          <Input id="trk-key" type="password" autoComplete="off" className="h-8 text-xs w-56" placeholder={c ? "inchangée (jamais affichée)" : "facultative"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={c ? Boolean(c.enabled) : true}
          onChange={(e) => save.mutate({ provider: current, enabled: e.target.checked, api_key: null })} />Activé</label>
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={save.isPending} data-testid="tracking-connection-save"
          onClick={() => save.mutate({ provider: current, enabled: c ? Boolean(c.enabled) : true, api_key: apiKey || null })}>Enregistrer</Button>
        {c && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { if (window.confirm("Changer l'adresse ? L'ancienne ne recevra plus rien.")) save.mutate({ provider: current, enabled: Boolean(c.enabled), api_key: null, regenerate: true }); }}>Nouvelle adresse</Button>}
      </div>
      {url && <p className="break-all" data-testid="tracking-webhook-url">Adresse de réception : <code>{url}</code></p>}
      {c?.last_received_at && <p className="text-muted-foreground">Dernière réception {new Date(c.last_received_at).toLocaleString("fr-FR")} :
        {" "}{c.last_result?.added ?? 0} ajouté(s), {c.last_result?.unmatched ?? 0} sans dossier, {c.last_result?.ignored ?? 0} ignoré(s).</p>}
    </div>
  );
}

/** Paramètres des dossiers : format du numéro d'expédition, dépôts par défaut, transferts automatiques, règles de frais. */
export function ImportSettingsPanel() {
  const access = useMyAccess();
  const canSettings = access.data?.permissions.includes("procurement.settings") ?? false;
  const canRules = access.data?.permissions.includes("procurement.import") ?? false;
  const { data: tenantId } = useTenantId();
  const { data: warehouses = [] } = useWarehouses();
  const [open, setOpen] = useState(false);
  const settings = useQuery({
    queryKey: ["import-settings", tenantId],
    enabled: Boolean(tenantId) && open,
    queryFn: async (): Promise<any> => isApiEnabled() ? apiGet<any>(`${P}/import-settings`)
      : (await check<any[]>(db.from("import_settings").select("*").limit(1)))[0] ?? null,
  });
  const types = useQuery({ queryKey: ["landed-cost-types"], enabled: open,
    queryFn: async (): Promise<any[]> => isApiEnabled() ? apiGet<any[]>(`${P}/landed-cost-types`) : check<any[]>(db.from("landed_cost_types").select("*").order("code")) });
  const rules = useQuery({ queryKey: ["landed-cost-rules", tenantId], enabled: Boolean(tenantId) && open,
    queryFn: async (): Promise<any[]> => isApiEnabled() ? apiGet<any[]>(`${P}/landed-cost-rules`) : check<any[]>(db.from("landed_cost_rules").select("*").order("cost_type_id")) });
  const save = useRun(async (v: Record<string, unknown>) => isApiEnabled() ? apiPut(`${P}/import-settings`, v)
    : check(db.from("import_settings").upsert({ ...(settings.data ?? {}), ...v, tenant_id: tenantId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("tenant_id")),
    () => "Paramètres des dossiers enregistrés");
  const addRule = useRun(async (r: Record<string, unknown>) => isApiEnabled() ? apiPost(`${P}/landed-cost-rules`, r)
    : check(db.from("landed_cost_rules").insert({ ...r, tenant_id: tenantId }).select("id")), () => "Règle de frais ajoutée");
  const delRule = useRun(async (rid: string) => isApiEnabled() ? apiDelete(`${P}/landed-cost-rules/${rid}`) : check(db.from("landed_cost_rules").delete().eq("id", rid).select("id")),
    () => "Règle retirée");
  const [rule, setRule] = useState({ type: "", mode: "", method: "percent", value: "" });
  const s = settings.data ?? { number_format: "IMP-{YYYY}-{SEQ4}", auto_transit_transfers: false };
  const typeLabel = new Map((types.data ?? []).map((t: any) => [t.id, t.label]));
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs space-y-3" data-testid="import-settings">
      <button type="button" className="font-medium" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "▾" : "▸"} Paramètres des dossiers d'importation</button>
      {open && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1"><Label className="text-xs" htmlFor="imp-format">Numéro d'expédition</Label>
              <select id="imp-format" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={s.number_format} disabled={!canSettings}
                onChange={(e) => save.mutate({ number_format: e.target.value })}>
                {[...PRESETS, ...(PRESETS.some(([f]) => f === s.number_format) ? [] : [[s.number_format, s.number_format] as [string, string]])].map(([f, l]) => <option key={f} value={f}>{l}</option>)}
              </select></div>
            {(["default_consolidation_warehouse_id", "default_transit_warehouse_id", "default_destination_warehouse_id"] as const).map((f, i) => (
              <div key={f} className="space-y-1"><Label className="text-xs" htmlFor={`imp-${f}`}>{["Consolidation par défaut", "Transit par défaut", "Destination par défaut"][i]}</Label>
                <select id={`imp-${f}`} className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={s[f] ?? ""} disabled={!canSettings}
                  onChange={(e) => save.mutate({ [f]: e.target.value || null })}>
                  <option value="">—</option>{(warehouses as any[]).filter((w) => (w.kind ?? "standard") === ["consolidation", "transit", "standard"][i]).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                </select></div>
            ))}
            <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(s.auto_transit_transfers)} disabled={!canSettings}
              onChange={(e) => save.mutate({ auto_transit_transfers: e.target.checked })} />Transferts automatiques au départ et à la livraison (événements réels)</label>
          </div>
          <TrackingConnection canSettings={canSettings} />
          <div className="space-y-1">
            <p className="font-medium">Règles de frais estimés</p>
            <table className="w-full"><tbody>
              {(rules.data ?? []).length === 0 && <tr><td className="text-muted-foreground py-1">Aucune règle : les frais se saisissent sur le dossier.</td></tr>}
              {(rules.data ?? []).map((r: any) => (
                <tr key={r.id} className="border-t border-border/50"><td className="py-1">{typeLabel.get(r.cost_type_id) ?? "?"}</td><td>{r.transport_mode ?? "tous modes"}</td>
                  <td>{r.method === "percent" ? `${r.value} % de la valeur` : `${fmt(r.value)} XOF`}</td>
                  <td className="text-right">{canRules && <button type="button" aria-label="Retirer la règle" onClick={() => delRule.mutate(r.id)}><Trash2 className="w-3 h-3" /></button>}</td></tr>))}
            </tbody></table>
            {canRules && (
              <div className="flex flex-wrap items-end gap-2">
                <select aria-label="Type de frais de la règle" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={rule.type} onChange={(e) => setRule((x) => ({ ...x, type: e.target.value }))}>
                  <option value="">— Type de frais —</option>{(types.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
                <select aria-label="Mode de transport de la règle" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={rule.mode} onChange={(e) => setRule((x) => ({ ...x, mode: e.target.value }))}>
                  <option value="">Tous modes</option><option value="sea">Maritime</option><option value="air">Aérien</option><option value="road">Routier</option><option value="rail">Ferroviaire</option></select>
                <select aria-label="Méthode de la règle" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={rule.method} onChange={(e) => setRule((x) => ({ ...x, method: e.target.value }))}>
                  <option value="percent">% de la valeur</option><option value="fixed">Forfait (XOF)</option></select>
                <Input aria-label="Valeur de la règle" inputMode="decimal" className="h-8 text-xs w-24 text-right" value={rule.value} onChange={(e) => setRule((x) => ({ ...x, value: e.target.value }))} />
                <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!rule.type || !(Number(rule.value.replace(",", ".")) > 0)}
                  onClick={() => addRule.mutate({ cost_type_id: rule.type, transport_mode: rule.mode || null, method: rule.method, value: Number(rule.value.replace(",", ".")) },
                    { onSuccess: () => setRule({ type: "", mode: "", method: "percent", value: "" }) })}>Ajouter la règle</Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
