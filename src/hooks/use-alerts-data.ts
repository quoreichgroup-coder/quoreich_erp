import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenantId } from "@/hooks/use-tenant";

export interface ERPAlertRow {
  id: string;
  tenant_id: string;
  module: string;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  action_required: boolean;
  is_resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  read_at: string | null;
  created_at: string;
}

export type AlertSortField = "created_at" | "severity" | "module";
export interface AlertsQueryParams {
  includeResolved?: boolean;
  module?: string;
  severity?: string;
  /** Optional whitelist of modules (from user prefs). Applied with .in() when non-empty. */
  modules?: string[];
  /** Optional whitelist of severities (from user prefs). Applied with .in() when non-empty. */
  severities?: string[];
  search?: string;
  sortBy?: AlertSortField;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

/** Simple list (backward compatible). Honors prefs whitelists when provided. */
export function useERPAlerts(
  opts?: { includeResolved?: boolean; modules?: string[]; severities?: string[] },
) {
  const includeResolved = opts?.includeResolved ?? false;
  const modules = opts?.modules ?? [];
  const severities = opts?.severities ?? [];
  return useQuery({
    queryKey: ["erp-alerts", "list", { includeResolved, modules, severities }],
    queryFn: async () => {
      let q = supabase
        .from("erp_alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (!includeResolved) q = q.eq("is_resolved", false);
      if (modules.length > 0) q = q.in("module", modules);
      if (severities.length > 0) q = q.in("severity", severities);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ERPAlertRow[];
    },
  });
}

/** Server-side paginated + sorted alerts query. */
export function useERPAlertsPaginated(params: AlertsQueryParams = {}) {
  const {
    includeResolved = false,
    module = "all",
    severity = "all",
    modules = [],
    severities = [],
    search = "",
    sortBy = "created_at",
    sortDir = "desc",
    page = 0,
    pageSize = 25,
  } = params;

  return useQuery({
    queryKey: ["erp-alerts", "paged", {
      includeResolved, module, severity, modules, severities, search, sortBy, sortDir, page, pageSize,
    }],
    queryFn: async () => {
      let q = supabase
        .from("erp_alerts")
        .select("*", { count: "exact" })
        .order(sortBy, { ascending: sortDir === "asc" });

      if (!includeResolved) q = q.eq("is_resolved", false);
      if (module !== "all") q = q.eq("module", module);
      else if (modules.length > 0) q = q.in("module", modules);
      if (severity !== "all") q = q.eq("severity", severity);
      else if (severities.length > 0) q = q.in("severity", severities);
      if (search.trim()) {
        const s = search.trim().replace(/[%,]/g, " ");
        q = q.or(`title.ilike.%${s}%,message.ilike.%${s}%`);
      }

      const from = page * pageSize;
      const to = from + pageSize - 1;
      q = q.range(from, to);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data || []) as ERPAlertRow[], total: count ?? 0 };
    },
  });
}

/** Lightweight unread count for the bell badge (server-side count). */
export function useUnreadAlertsCount(opts?: { modules?: string[]; severities?: string[] }) {
  const modules = opts?.modules ?? [];
  const severities = opts?.severities ?? [];
  return useQuery({
    queryKey: ["erp-alerts-unread-count", { modules, severities }],
    queryFn: async () => {
      let q = supabase
        .from("erp_alerts")
        .select("id", { count: "exact", head: true })
        .eq("is_resolved", false)
        .is("read_at", null);
      if (modules.length > 0) q = q.in("module", modules);
      if (severities.length > 0) q = q.in("severity", severities);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** Subscribe to realtime INSERT/UPDATE on erp_alerts for the current tenant. */
export function useRealtimeAlerts() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();

  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`erp-alerts-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "erp_alerts", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          qc.invalidateQueries({ queryKey: ["erp-alerts"] });
          qc.invalidateQueries({ queryKey: ["erp-alerts-unread-count"] });
          if (payload.eventType === "INSERT") {
            const row = payload.new as ERPAlertRow;
            const variant =
              row.severity === "critical" || row.severity === "error" ? "error" : "info";
            (toast as any)[variant === "error" ? "error" : "message"](
              row.title || "Nouvelle alerte",
              { description: row.message, id: `alert-${row.id}` },
            );
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, tenantId]);
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["erp-alerts"] });
  qc.invalidateQueries({ queryKey: ["erp-alerts-unread-count"] });
}

export function useResolveAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("resolve_erp_alert", { _alert_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Alerte marquée comme résolue");
    },
    onError: (e: any) => toast.error(e?.message ?? "Échec de la résolution"),
  });
}

export function useMarkAllAlertsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("mark_all_erp_alerts_read");
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      invalidateAll(qc);
      toast.success(`${n ?? 0} alerte(s) marquée(s) comme lue(s)`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Échec"),
  });
}

export function useResolveAllAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { module?: string; severity?: string } = {}) => {
      const { data, error } = await (supabase as any).rpc("resolve_all_erp_alerts", {
        _module: args.module && args.module !== "all" ? args.module : null,
        _severity: args.severity && args.severity !== "all" ? args.severity : null,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      invalidateAll(qc);
      toast.success(`${n ?? 0} alerte(s) résolue(s)`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Échec — droit administrateur requis"),
  });
}
