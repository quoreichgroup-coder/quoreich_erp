import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantId } from "@/hooks/use-tenant";
import { apiGet, apiPut, isApiEnabled } from "@/api/client";

/*
 * Imputation analytique des pièces d'achat (V77) : une section par axe sur la demande, la commande et la
 * facture fournisseur. Reprise par la base : demande convertie → commande, commande citée → facture ; l'écriture
 * de la facture l'impute à ses lignes de charges, ce qui alimente le réalisé des budgets par section.
 * Modifiable tant que la pièce est en brouillon ou rejetée (garde V77).
 */
export type AnalyticDocKind = "PR" | "PO" | "AP";
const TABLE: Record<AnalyticDocKind, string> = { PR: "purchase_requisition_analytics", PO: "purchase_order_analytics", AP: "ap_invoice_analytics" };
const db = supabase as any;

export async function fetchDocumentAnalytics(kind: AnalyticDocKind, id: string): Promise<Record<string, string>> {
  const { data, error } = isApiEnabled()
    ? { data: await apiGet<{ axis_id: string; value_id: string }[]>(`/api/v1/document-analytics/${kind}/${id}`), error: null }
    : await db.from(TABLE[kind]).select("axis_id, value_id").eq("document_id", id);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r: { axis_id: string; value_id: string }) => [r.axis_id, r.value_id]));
}

export function useDocumentAnalytics(kind: AnalyticDocKind, id: string | null | undefined) {
  return useQuery({
    queryKey: ["document-analytics", kind, id],
    enabled: !!id,
    queryFn: () => fetchDocumentAnalytics(kind, id!),
  });
}

/** Remplace l'imputation de la pièce par les sections choisies (axe sans section = rien). */
export async function saveDocumentAnalytics(kind: AnalyticDocKind, id: string, values: Record<string, string> | undefined) {
  if (!values) return;
  if (isApiEnabled()) { await apiPut(`/api/v1/document-analytics/${kind}/${id}`, values); return; }
  const tenantId = await fetchTenantId();
  const rows = Object.entries(values).filter(([, v]) => !!v).map(([axis, value]) => ({ tenant_id: tenantId, document_id: id, axis_id: axis, value_id: value }));
  const { error: delErr } = await db.from(TABLE[kind]).delete().eq("document_id", id);
  if (delErr) throw delErr;
  if (!rows.length) return;
  const { error } = await db.from(TABLE[kind]).insert(rows);
  if (error) throw error;
}

/* Sections par ligne (V78) : la section d'une ligne l'emporte, axe par axe, sur celle de l'en-tête. */
const LINE_TABLE: Record<AnalyticDocKind, string> = { PR: "requisition_line_analytics", PO: "po_line_analytics", AP: "ap_invoice_line_analytics" };
export type LineAnalytics = Record<string, string>;

export async function fetchLineAnalytics(kind: AnalyticDocKind, lineIds: string[]): Promise<Map<string, LineAnalytics>> {
  const out = new Map<string, LineAnalytics>();
  if (!lineIds.length) return out;
  const { data, error } = isApiEnabled()
    ? { data: await apiGet<{ line_id: string; axis_id: string; value_id: string }[]>(`/api/v1/line-analytics/${kind}?ids=${lineIds.join(",")}`), error: null }
    : await db.from(LINE_TABLE[kind]).select("line_id, axis_id, value_id").in("line_id", lineIds);
  if (error) throw error;
  for (const r of (data ?? []) as { line_id: string; axis_id: string; value_id: string }[]) out.set(r.line_id, { ...(out.get(r.line_id) ?? {}), [r.axis_id]: r.value_id });
  return out;
}

export function useLineAnalytics(kind: AnalyticDocKind, lineIds: string[]) {
  return useQuery({
    queryKey: ["line-analytics", kind, lineIds.join(",")],
    enabled: lineIds.length > 0,
    queryFn: () => fetchLineAnalytics(kind, lineIds),
  });
}

/** Sections choisies ligne à ligne (même ordre que les lignes enregistrées) ; axe vide = section de l'en-tête. */
export async function saveLineAnalytics(kind: AnalyticDocKind, lineIds: string[], perLine: (LineAnalytics | undefined)[] | undefined) {
  if (!perLine?.some((v) => v && Object.values(v).some(Boolean))) return;
  const tenantId = await fetchTenantId();
  const rows = lineIds.flatMap((id, i) => Object.entries(perLine[i] ?? {}).filter(([, v]) => !!v)
    .map(([axis, value]) => ({ tenant_id: tenantId, line_id: id, axis_id: axis, value_id: value })));
  if (!rows.length) return;
  const { error } = await db.from(LINE_TABLE[kind]).upsert(rows, { onConflict: "line_id,axis_id" });
  if (error) throw error;
}
