import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { apiDelete, apiGet, apiPost, isApiEnabled } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";
import { readTableFile, TABLE_FILE_ACCEPT } from "@/lib/table-file";
import { parseTrackingRows, TRACKING_STATES, type EventCode, type ParsedEvent } from "@/lib/shipment-tracking";
import { cn } from "@/lib/utils";

/*
 * Suivi d'un dossier d'importation (V131) : état (ETA initiale / actuelle, retard), chronologie sans ressaisie (faits de
 * l'ERP + événements), ajout d'un événement, import du fichier de suivi du transitaire ou de la compagnie (Excel / CSV,
 * étapes reconnues par leur libellé, doublons ignorés).
 */
const db = supabase as any;
const P = "/api/v1/procurement";
const CLASS: Record<string, string> = { planned: "Prévu", estimated: "Estimé", actual: "Réel" };
const ORIGIN: Record<string, string> = { erp: "ERP", manual: "Saisie", import: "Fichier", provider: "Suivi automatique" };
const toneClass = { success: "bg-success/15 text-success", warning: "bg-warning/15 text-warning", destructive: "bg-destructive/10 text-destructive", muted: "bg-muted text-muted-foreground" };

async function check<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

export function useShipmentEventCodes() {
  return useQuery({
    queryKey: ["shipment-event-codes"],
    staleTime: Infinity,
    queryFn: async (): Promise<EventCode[]> => isApiEnabled() ? apiGet<EventCode[]>(`${P}/shipment-event-codes`)
      : check<EventCode[]>(db.from("shipment_event_codes").select("*").order("stage")),
  });
}

export function useTrackingStatus() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["tracking-status", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<any[]> => isApiEnabled() ? apiGet<any[]>(`${P}/tracking-status`) : check<any[]>(db.from("shipment_tracking_status").select("*")),
  });
}

export function TrackingBadge({ state, delay }: { state?: string | null; delay?: number | null }) {
  const s = TRACKING_STATES[state ?? ""];
  if (!s) return <span className="text-muted-foreground">—</span>;
  return <span className={cn("text-[11px] px-1.5 py-0.5 rounded", toneClass[s.tone])} data-testid="tracking-state">
    {s.label}{delay && delay > 0 ? ` · +${delay} j` : ""}</span>;
}

export function ShipmentTracking({ file, canEdit }: { file: any; canEdit: boolean }) {
  const qc = useQueryClient();
  const id = file.id as string;
  const codes = useShipmentEventCodes();
  const status = useTrackingStatus();
  const st = (status.data ?? []).find((s) => s.import_file_id === id);
  const timeline = useQuery({
    queryKey: ["shipment-timeline", id],
    queryFn: async (): Promise<any[]> => isApiEnabled() ? apiGet<any[]>(`${P}/import-files/${id}/timeline`)
      : check<any[]>(db.rpc("shipment_timeline", { _import_file: id, _po: null })),
  });
  const events = useQuery({
    queryKey: ["shipment-events", id],
    enabled: !isApiEnabled(),
    queryFn: async (): Promise<any[]> => check<any[]>(db.from("shipment_events").select("id, event_code, event_at, event_class, source").eq("import_file_id", id)),
  });
  const refresh = () => { for (const k of ["shipment-timeline", "tracking-status", "import-files", "shipment-events"]) qc.invalidateQueries({ queryKey: [k] }); };
  const add = useMutation({
    mutationFn: async (e: Record<string, unknown>) => isApiEnabled() ? apiPost(`${P}/import-files/${id}/events`, e)
      : check(db.from("shipment_events").insert({ ...e, tenant_id: file.tenant_id, import_file_id: id }).select("id")),
    onSuccess: () => { refresh(); toast.success("Événement de suivi ajouté"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (eventId: string) => isApiEnabled() ? apiDelete(`${P}/shipment-events/${eventId}`) : check(db.from("shipment_events").delete().eq("id", eventId).select("id")),
    onSuccess: () => { refresh(); toast.success("Événement retiré"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const importRows = useMutation({
    mutationFn: async (rows: ParsedEvent[]): Promise<{ added: number; ignored: number }> => {
      const body = rows.map(({ line: _l, raw: _r, ...r }) => r);
      return isApiEnabled() ? apiPost(`${P}/import-files/${id}/events/import`, { rows: body })
        : check(db.rpc("import_shipment_events", { _import_file: id, _rows: body }));
    },
    onSuccess: (r) => { refresh(); setPreview(null); toast.success(`Suivi importé : ${r.added} événement(s) ajouté(s), ${r.ignored} déjà connu(s)`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [f, setF] = useState({ code: "", kind: "actual", date: new Date().toISOString().slice(0, 10), location: "", vessel: "", container: "" });
  const [preview, setPreview] = useState<ParsedEvent[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const t = await readTableFile(file);
      const rows = parseTrackingRows([t.headers, ...t.records.map((r) => t.headers.map((h) => r[h] ?? ""))], codes.data ?? []);
      if (rows.length === 0) { toast.error("Aucune ligne lisible dans le fichier"); return; }
      setPreview(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fichier illisible");
    } finally {
      if (input.current) input.current.value = "";
    }
  };
  const recognised = (preview ?? []).filter((r) => r.event_code && r.event_at);
  const eventIds = new Map((events.data ?? []).map((e) => [`${e.event_code}|${String(e.event_at).slice(0, 10)}|${e.event_class}`, e.id]));

  return (
    <section className="space-y-3 border-t border-border pt-3" data-testid="shipment-tracking">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <p className="font-medium">Suivi de l'expédition</p>
        <TrackingBadge state={st?.tracking_state} delay={st?.delay_days} />
        <span className="text-muted-foreground">ETA initiale {file.initial_eta ?? "—"} · ETA actuelle {file.eta ?? "—"}{file.arrival_date ? ` · arrivé le ${file.arrival_date}` : ""}
          {st?.last_event_label ? ` · dernier événement : ${st.last_event_label}${st.last_event_location ? ` (${st.last_event_location})` : ""}` : ""}</span>
      </div>
      <ol className="space-y-1 text-xs" data-testid="shipment-timeline">
        {(timeline.data ?? []).length === 0 && <li className="text-muted-foreground">Aucun événement.</li>}
        {(timeline.data ?? []).map((t, i) => {
          const eventId = t.origin !== "erp" ? eventIds.get(`${t.event_code}|${String(t.event_at).slice(0, 10)}|${t.event_class}`) : undefined;
          return (
            <li key={i} className="flex flex-wrap items-center gap-2" data-testid="timeline-row">
              <span className="tabular-nums w-20 text-muted-foreground">{String(t.event_at).slice(0, 10)}</span>
              <span className={cn("px-1.5 rounded text-[10px]", t.event_class === "actual" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{CLASS[t.event_class] ?? t.event_class}</span>
              <span className="font-medium">{t.label}</span>
              {t.location && <span className="text-muted-foreground">{t.location}</span>}
              {t.detail && <span className="text-muted-foreground">{t.detail}</span>}
              {t.po_number && <span className="text-muted-foreground">· {t.po_number}</span>}
              <span className="text-[10px] text-muted-foreground">{ORIGIN[t.origin] ?? t.origin}</span>
              {canEdit && eventId && <button type="button" aria-label={`Retirer ${t.label}`} onClick={() => remove.mutate(eventId)}><Trash2 className="w-3 h-3" /></button>}
            </li>
          );
        })}
      </ol>
      {canEdit && (
        <>
          <div className="flex flex-wrap items-end gap-2" data-testid="shipment-event-form">
            <div className="space-y-1"><Label className="text-xs" htmlFor="ev-code">Étape</Label>
              <select id="ev-code" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={f.code} onChange={(e) => setF((x) => ({ ...x, code: e.target.value }))}>
                <option value="">— Sélectionner —</option>{(codes.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="ev-kind">Nature</Label>
              <select id="ev-kind" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={f.kind} onChange={(e) => setF((x) => ({ ...x, kind: e.target.value }))}>
                {Object.entries(CLASS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="ev-date">Date</Label>
              <Input id="ev-date" type="date" className="h-8 text-xs w-36" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="ev-location">Lieu (port, code UN/LOCODE)</Label>
              <Input id="ev-location" className="h-8 text-xs w-32" value={f.location} onChange={(e) => setF((x) => ({ ...x, location: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="ev-vessel">Navire / vol</Label>
              <Input id="ev-vessel" className="h-8 text-xs w-32" value={f.vessel} onChange={(e) => setF((x) => ({ ...x, vessel: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="ev-container">Conteneur</Label>
              <Input id="ev-container" className="h-8 text-xs w-32 uppercase" placeholder="MSCU1234567" value={f.container} onChange={(e) => setF((x) => ({ ...x, container: e.target.value }))} /></div>
            <Button size="sm" className="h-8 text-xs" data-testid="shipment-event-add" disabled={!f.code || !f.date || add.isPending}
              onClick={() => add.mutate({ event_code: f.code, event_class: f.kind, event_at: f.date, location: f.location || null, vessel: f.vessel || null,
                container_number: f.container.replace(/\s/g, "").toUpperCase() || null }, { onSuccess: () => setF((x) => ({ ...x, code: "", location: "" })) })}>Ajouter l'événement</Button>
            <input ref={input} type="file" accept={TABLE_FILE_ACCEPT} className="hidden" aria-label="Fichier de suivi" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => input.current?.click()} data-testid="shipment-import-file">
              <Upload className="w-3 h-3" /> Importer le fichier de suivi</Button>
          </div>
          {preview && (
            <div className="rounded-md border border-border p-2 space-y-2 text-xs" data-testid="shipment-import-preview">
              <p>{recognised.length} ligne(s) reconnue(s) sur {preview.length}. Les lignes non reconnues ne sont pas importées.</p>
              <ul className="max-h-40 overflow-auto space-y-0.5">{preview.map((r) => (
                <li key={r.line} className={cn(!r.event_code || !r.event_at ? "text-muted-foreground line-through" : "")}>
                  Ligne {r.line} : {r.event_at ?? "date ?"} — {(codes.data ?? []).find((c) => c.code === r.event_code)?.label ?? "étape non reconnue"} ({CLASS[r.event_class]}) · {r.raw}
                </li>))}</ul>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" disabled={recognised.length === 0 || importRows.isPending} onClick={() => importRows.mutate(recognised)} data-testid="shipment-import-confirm">
                  {importRows.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Importer {recognised.length} événement(s)</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPreview(null)}>Annuler</Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
