import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantId } from "@/hooks/use-tenant";

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
  const { data, error } = await db.from(TABLE[kind]).select("axis_id, value_id").eq("document_id", id);
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
  const tenantId = await fetchTenantId();
  const rows = Object.entries(values).filter(([, v]) => !!v).map(([axis, value]) => ({ tenant_id: tenantId, document_id: id, axis_id: axis, value_id: value }));
  const { error: delErr } = await db.from(TABLE[kind]).delete().eq("document_id", id);
  if (delErr) throw delErr;
  if (!rows.length) return;
  const { error } = await db.from(TABLE[kind]).insert(rows);
  if (error) throw error;
}
