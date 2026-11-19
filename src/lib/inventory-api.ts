import { supabase } from "@/integrations/supabase/client";
import { ApiHttpError, apiPost, isApiEnabled } from "@/api/client";

/*
 * Accès communs du module Stocks : fonctions de la base et journal des stocks, par l'API Java sur site
 * (/api/v1/inventory), sinon par Supabase. Même contrat { data, error } que supabase-js : un refus de l'API
 * devient `error`, ce qui garde intacte la gestion d'erreur des écrans.
 */
type Result = { data: any; error: { message: string; code?: string } | null };

export async function invRpc(name: string, args?: Record<string, unknown>): Promise<Result> {
  if (!isApiEnabled()) return (supabase as any).rpc(name, args ?? {});
  try {
    return { data: await apiPost<any>(`/api/v1/inventory/actions/${name}`, args ?? {}), error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e), code: e instanceof ApiHttpError ? e.code : undefined } };
  }
}

/** Trace un export ou une tentative de clôture (le serveur pose l'auteur et la société). */
export async function invAudit(row: { tenant_id?: string; target_user_id?: string; role: string; action: string; performed_by?: string; comment: string }): Promise<Result> {
  if (!isApiEnabled()) return (supabase as any).from("inventory_role_audit").insert(row);
  try {
    return { data: await apiPost<any>("/api/v1/inventory/role-audit", { role: row.role, action: row.action, comment: row.comment }), error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e), code: e instanceof ApiHttpError ? e.code : undefined } };
  }
}
