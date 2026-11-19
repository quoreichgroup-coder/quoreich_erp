import { supabase } from "@/integrations/supabase/client";
import { ApiHttpError, apiPost, isApiEnabled } from "@/api/client";

/**
 * Fonction de la base d'un module : par la route d'action de l'API Java sur site
 * (`/api/v1/<module>/actions/<fonction>`, liste fermée côté serveur), sinon par Supabase.
 * Même contrat { data, error } que supabase-js : un refus de l'API devient `error` (message et SQLSTATE),
 * si bien que la gestion d'erreur des écrans ne change pas.
 */
export async function moduleRpc(module: string, name: string, args?: Record<string, unknown>): Promise<{ data: any; error: { message: string; code?: string } | null }> {
  if (!isApiEnabled()) return (supabase as any).rpc(name, args ?? {});
  try {
    return { data: await apiPost<any>(`/api/v1/${module}/actions/${name}`, args ?? {}), error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e), code: e instanceof ApiHttpError ? e.code : undefined } };
  }
}
