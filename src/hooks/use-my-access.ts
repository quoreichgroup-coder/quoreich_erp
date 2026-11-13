import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { apiGet, isApiEnabled } from "@/api/client";

/**
 * Ce que l'utilisateur connecté peut faire, dit par la base (my_access, V27), dans SA société :
 *   - permissions : droits du catalogue (« treasury.close_period »…) accordés par tous ses rôles,
 *     rôles sur mesure compris — exactement ce que vérifie has_permission() ;
 *   - roles : codes des rôles système détenus, pour les modules que la base contrôle encore par
 *     has_role (budget, projets, notes de frais, risques, conformité, immobilisations).
 *
 * Les écrans s'en servent pour activer ou verrouiller les boutons ; la base vérifie de toute
 * façon à chaque opération. Une seule requête, partagée par tous les modules.
 */
export interface MyAccess {
  roles: string[];
  permissions: string[];
}

export const NO_ACCESS: MyAccess = { roles: [], permissions: [] };

export function useMyAccess() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["my-access", tenantId, isApiEnabled() ? "api" : "supabase"],
    enabled: Boolean(tenantId),
    // Un refus ici verrouille les boutons : mieux vaut le savoir tout de suite.
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<MyAccess> => {
      if (isApiEnabled()) return apiGet<MyAccess>("/api/v1/authorizations/me");
      const { data, error } = await (supabase as any).rpc("my_access");
      if (error) throw error;
      return { roles: data?.roles ?? [], permissions: data?.permissions ?? [] };
    },
  });
}

/** Droits d'un module du catalogue : « peut faire telle action » selon la base. */
export function moduleCan(access: MyAccess | undefined, module: string) {
  const set = new Set(access?.permissions ?? []);
  return (action: string) => set.has(`${module}.${action}`);
}
