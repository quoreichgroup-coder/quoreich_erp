import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "./use-tenant";
import { apiGet, isApiEnabled } from "@/api/client";

export function useActiveModules() {
  const { data: tenantId } = useTenantId();

  return useQuery({
    queryKey: ["active-modules", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      if (isApiEnabled()) return (await apiGet<{ module_name: string }[]>("/api/v1/active-modules")).map((m) => m.module_name);
      const { data, error } = await supabase
        .from("tenant_modules")
        .select("module_name, status")
        .eq("tenant_id", tenantId)
        .eq("status", "active");
      if (error) throw error;
      return (data || []).map((m) => m.module_name);
    },
    enabled: !!tenantId,
    staleTime: 60_000,
  });
}
