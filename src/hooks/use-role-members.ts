import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";

/*
 * Qui détient quels rôles système d'un module, dans la société courante — lu dans la matrice
 * des autorisations (user_role_assignments → erp_roles.code, V23), source unique des droits.
 *
 * Les douze écrans de rôles par module lisaient jusqu'ici user_roles, sans filtre de société
 * et sous une clé de cache sans société : la table de transition que les RPC assign_*_role
 * écrivent encore, et qu'un déclencheur recopie dans la matrice (trg_mirror_user_roles). Lire la
 * matrice montre aussi les rôles attribués depuis /settings, et prépare la suppression de
 * user_roles.
 *
 * Forme rendue inchangée : Map<user_id, codes de rôle>.
 */
const db = supabase as any;
const PAGE = 1000;

export async function fetchRoleMembers(tenantId: string, codes: readonly string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (codes.length === 0) return map;
  // Toutes les pages : une liste tronquée ferait disparaître des membres sans le dire.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("user_role_assignments")
      .select("user_id, erp_roles!inner(code)")
      .eq("tenant_id", tenantId)
      .in("erp_roles.code", codes as string[])
      .order("user_id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { user_id: string; erp_roles: { code: string | null } | null }[];
    for (const r of rows) {
      const code = r.erp_roles?.code;
      if (!code) continue;
      const list = map.get(r.user_id) ?? [];
      if (!list.includes(code)) list.push(code);
      map.set(r.user_id, list);
    }
    if (rows.length < PAGE) break;
  }
  return map;
}

/** `keyPrefix` reste celui que les mutations invalident déjà (« tenant-treasury-roles »…). */
export function useTenantRoleMembers(keyPrefix: string, codes: readonly string[]) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: [keyPrefix, tenantId],
    enabled: Boolean(tenantId),
    queryFn: () => fetchRoleMembers(tenantId as string, codes),
  });
}
