import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenantId } from "@/hooks/use-tenant";

export interface NotificationPreferences {
  user_id: string;
  tenant_id: string;
  modules: string[];
  severities: string[];
  include_resolved: boolean;
}

export const DEFAULT_PREFS: Omit<NotificationPreferences, "user_id" | "tenant_id"> = {
  modules: [],
  severities: ["critical", "error", "warning", "info"],
  include_resolved: false,
};

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return (data as NotificationPreferences | null) ?? null;
    },
  });
}

export function useSaveNotificationPreferences() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (prefs: Omit<NotificationPreferences, "user_id" | "tenant_id">) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      if (!tenantId) throw new Error("No tenant");
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({ user_id: user.id, tenant_id: tenantId, ...prefs });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-preferences"] });
      toast.success("Préférences enregistrées");
    },
    onError: (e: any) => toast.error(e?.message ?? "Échec d'enregistrement"),
  });
}
