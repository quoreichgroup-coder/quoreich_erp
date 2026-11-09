import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Fetch the current user's tenant_id from their profile */
async function fetchTenantId(): Promise<string> {
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
