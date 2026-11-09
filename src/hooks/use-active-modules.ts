import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "./use-tenant";

export function useActiveModules() {
  const { data: tenantId } = useTenantId();

  return useQuery({
    queryKey: ["active-modules", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
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
