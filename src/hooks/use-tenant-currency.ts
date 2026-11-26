import { useQuery } from "@tanstack/react-query";
import { apiGet, isApiEnabled } from "@/api/client";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";

export type TenantInfo = { name: string; currency: string } | null;

/** Nom et devise de la société courante (même cache que la barre du haut). */
export function useTenantInfo() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["tenant-info", tenantId],
    queryFn: async (): Promise<TenantInfo> => {
      if (!tenantId) return null;
      if (isApiEnabled()) return apiGet<TenantInfo>("/api/v1/tenant");
      const { data } = await supabase.from("tenants").select("name, currency").eq("id", tenantId).single();
      return data;
    },
    enabled: !!tenantId,
    staleTime: Infinity,
  });
}

/**
 * Devise de la société (C-02) : jamais déduite de la langue ni de la locale. Pendant le chargement,
 * on affiche la valeur par défaut de la colonne tenants.currency (XOF), comme le faisait l'écran.
 */
export function useTenantCurrency(): string {
  return useTenantInfo().data?.currency ?? "XOF";
}
