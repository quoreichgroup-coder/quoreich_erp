import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { GLAuditEntry } from "@/components/GLPostingConfig";

export function useGLAuditLogs(batchFilter?: string) {
  return useQuery({
    queryKey: ["gl-audit-logs", batchFilter],
    queryFn: async () => {
      let query = supabase
        .from("gl_audit_logs")
        .select("id, batch_id, entry_id, action, user_name, details, hash, prev_hash, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (batchFilter) {
        query = query.eq("batch_id", batchFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const entries: GLAuditEntry[] = (data || []).map((row) => ({
        id: row.id,
        batchId: row.batch_id,
        timestamp: new Date(row.created_at).toLocaleString("fr-FR", {
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        }),
        action: row.action as GLAuditEntry["action"],
        user: row.user_name,
        details: row.details || "",
        hash: row.hash,
        prevHash: row.prev_hash,
      }));

      return entries;
    },
  });
}
