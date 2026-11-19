import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, isApiEnabled } from "@/api/client";

/** Fetch the current user's tenant_id from their profile */
async function fetchTenantId(): Promise<string> {
  if (isApiEnabled()) {
    // Sur site : la société vient du profil de la base locale, pas du nuage.
    const me = await apiGet<{ tenant_id: string | null } | null>("/api/v1/me");
    if (!me?.tenant_id) throw new Error("No tenant assigned");
    return me.tenant_id;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (error) throw error;
  if (!data?.tenant_id) throw new Error("No tenant assigned");
  return data.tenant_id;
}

/** React hook – cached tenant_id for the current session */
export function useTenantId() {
  return useQuery({
    queryKey: ["tenant-id"],
    queryFn: fetchTenantId,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export { fetchTenantId };
