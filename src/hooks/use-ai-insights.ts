import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "./use-tenant";

const useTenant = () => {
  const { data } = useTenantId();
  return { tenantId: data ?? null };
};

export interface CashflowProjection {
  horizon: string;
  projected_cash: number;
  net_movement: number;
  confidence: "low" | "medium" | "high";
}
export interface CashflowForecast {
  projections: CashflowProjection[];
  summary: string;
  recommendations: string[];
  risk_level: "low" | "medium" | "high";
}
export interface CashflowResponse {
  forecast: CashflowForecast | null;
  inputs: Record<string, unknown>;
}

export interface AnomalyLine {
  account_code: string | null;
  account_name: string | null;
  debit: number;
  credit: number;
  description: string | null;
}
export interface GLAnomaly {
  entry_ref: string;
  entry_id: string | null;
  entry_date: string | null;
  entry_description: string | null;
  severity: "low" | "medium" | "high";
  type: string;
  description: string;
  recommendation: string;
  lines: AnomalyLine[];
}
export interface GLAnomalyResponse {
  anomalies: GLAnomaly[];
  summary: string;
  total_reviewed: number;
}

export interface CashflowParams {
  horizons?: number[];
  from?: string;
  to?: string;
}

export function useCashflowForecast() {
  return useMutation<CashflowResponse, Error, CashflowParams | undefined>({
    mutationFn: async (params) => {
      const { data, error } = await supabase.functions.invoke("ai-cashflow-forecast", {
        body: params ?? {},
      });
      if (error) throw new Error(error.message);
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as CashflowResponse;
    },
  });
}

export function useGLAnomalyDetection() {
  return useMutation<GLAnomalyResponse, Error, { days?: number } | undefined>({
    mutationFn: async (params) => {
      const { data, error } = await supabase.functions.invoke("ai-gl-anomaly-detection", {
        body: params ?? {},
      });
      if (error) throw new Error(error.message);
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as GLAnomalyResponse;
    },
  });
}

// =========================
// AI Analysis History
// =========================
export interface AiHistoryRow {
  id: string;
  tenant_id: string;
  analysis_type: "cashflow_forecast" | "gl_anomaly_detection";
  trigger_source: "manual" | "scheduled";
  status: "success" | "error" | "partial";
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  inputs: Record<string, unknown>;
  error_message: string | null;
  duration_ms: number | null;
  created_by: string | null;
  created_at: string;
}

export function useAiHistory(filter?: { type?: AiHistoryRow["analysis_type"]; limit?: number }) {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  // Un canal par composant (voir useRealtimeAlerts) : un nom partagé fait planter le second abonné.
  const instance = useId();
  const queryKey = ["ai-history", tenantId, filter?.type ?? "all", filter?.limit ?? 50];

  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`ai-history-${tenantId}-${instance}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "ai_analysis_history",
        filter: `tenant_id=eq.${tenantId}`,
      }, () => qc.invalidateQueries({ queryKey: ["ai-history", tenantId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, qc, instance]);

  return useQuery({
    queryKey,
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from("ai_analysis_history")
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false })
        .limit(filter?.limit ?? 50);
      if (filter?.type) q = q.eq("analysis_type", filter.type);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AiHistoryRow[];
    },
  });
}

export function useAiHistoryInfinite(filter?: {
  type?: AiHistoryRow["analysis_type"];
  pageSize?: number;
  dateFrom?: string; // ISO string (inclusive)
  dateTo?: string;   // ISO string (inclusive)
}) {
  const { tenantId } = useTenant();
  const instance = useId();
  const qc = useQueryClient();
  const pageSize = filter?.pageSize ?? 25;
  const queryKey = [
    "ai-history-infinite",
    tenantId,
    filter?.type ?? "all",
    pageSize,
    filter?.dateFrom ?? null,
    filter?.dateTo ?? null,
  ];

  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`ai-history-inf-${tenantId}-${instance}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "ai_analysis_history",
        filter: `tenant_id=eq.${tenantId}`,
      }, () => qc.invalidateQueries({ queryKey: ["ai-history-infinite", tenantId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, qc, instance]);

  return useInfiniteQuery({
    queryKey,
    enabled: !!tenantId,
    initialPageParam: 0 as number,
    queryFn: async ({ pageParam }) => {
      const from = pageParam as number;
      const to = from + pageSize - 1;
      let q = supabase
        .from("ai_analysis_history")
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (filter?.type) q = q.eq("analysis_type", filter.type);
      if (filter?.dateFrom) q = q.gte("created_at", filter.dateFrom);
      if (filter?.dateTo) q = q.lte("created_at", filter.dateTo);
      const { data, error } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as AiHistoryRow[], nextOffset: (data?.length ?? 0) === pageSize ? from + pageSize : null };
    },
    getNextPageParam: (last) => last.nextOffset,
  });
}

// =========================
// AI Schedules
// =========================
export interface AiScheduleRow {
  id: string;
  tenant_id: string;
  analysis_type: "cashflow_forecast" | "gl_anomaly_detection";
  frequency: "daily" | "weekly" | "monthly";
  enabled: boolean;
  params: Record<string, unknown>;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}

export function useAiSchedules() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ["ai-schedules", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_analysis_schedules")
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("analysis_type");
      if (error) throw error;
      return (data ?? []) as AiScheduleRow[];
    },
  });
}

export function useUpsertAiSchedule() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      analysis_type: AiScheduleRow["analysis_type"];
      frequency: AiScheduleRow["frequency"];
      enabled: boolean;
      params?: Record<string, unknown>;
    }) => {
      if (!tenantId) throw new Error("Tenant introuvable");
      const { data, error } = await supabase
        .from("ai_analysis_schedules")
        .upsert(
          [{
            tenant_id: tenantId,
            analysis_type: input.analysis_type,
            frequency: input.frequency,
            enabled: input.enabled,
            params: (input.params ?? {}) as never,
            next_run_at: new Date().toISOString(),
          }],
          { onConflict: "tenant_id,analysis_type" },
        )
        .select()
        .single();
      if (error) throw error;
      return data as AiScheduleRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-schedules", tenantId] }),
  });
}
