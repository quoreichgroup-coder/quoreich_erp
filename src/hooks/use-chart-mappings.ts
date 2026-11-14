import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";

/* Correspondances entre plans et plans secondaires (V66, lot PC-5). Écritures par RPC uniquement. */
export type SecondaryChart = { id: string; code: string; name: string; framework_code: string | null; framework_version: string | null; status: string };
export type ChartMapping = {
  id: string; name: string; target_framework: string | null; target_chart_id: string | null; status: "draft" | "validated" | "archived";
  created_by: string; created_at: string; validated_by: string | null; validated_at: string | null;
};
export type CompareRow = {
  source_account_id: string; source_code: string; source_name: string; source_type: string; lines: number; line_id: string | null;
  target_code: string | null; target_name: string | null; target_type: string | null; ratio: number | null; method: string | null;
  status: "proposed" | "validated" | "rejected" | null; finding: string | null;
};
export type MappedBalance = { target_code: string; target_name: string; target_type: string | null; debit: number; credit: number; balance: number; sources: string };

const db = supabase as any;
const KEYS = ["secondary-charts", "chart-mappings", "chart-mapping-compare", "mapped-trial-balance", "chart-mapping-lines"];
const call = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
};
function useRpc<V>(fn: (v: V) => Promise<unknown>, ok: string | ((d: any) => string)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d) => { for (const k of KEYS) qc.invalidateQueries({ queryKey: [k] }); toast.success(typeof ok === "string" ? ok : ok(d)); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSecondaryCharts() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["secondary-charts", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("charts").select("id, code, name, framework_code, framework_version, status").eq("tenant_id", tenantId).eq("kind", "secondary").order("code");
      if (error) throw error;
      return (data ?? []) as SecondaryChart[];
    },
  });
}

export function useChartMappings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["chart-mappings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("chart_mappings").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChartMapping[];
    },
  });
}

export function useMappingLineAuthors(mappingId: string | null) {
  return useQuery({
    queryKey: ["chart-mapping-lines", mappingId],
    enabled: !!mappingId,
    queryFn: async () => {
      const all: { id: string; proposed_by: string | null; comment: string | null }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from("chart_mapping_lines").select("id, proposed_by, comment").eq("mapping_id", mappingId).range(from, from + 999);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return all;
    },
  });
}

export function useCompareMapping(mappingId: string | null) {
  return useQuery({
    queryKey: ["chart-mapping-compare", mappingId],
    enabled: !!mappingId,
    queryFn: async () => (await call("compare_chart_mapping", { _mapping: mappingId })) as CompareRow[],
  });
}

export function useMappedTrialBalance(mappingId: string | null, from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ["mapped-trial-balance", mappingId, from, to],
    enabled: !!mappingId && enabled,
    queryFn: async () => (await call("mapped_trial_balance", { _mapping: mappingId, _from: from || null, _to: to })) as MappedBalance[],
  });
}

export const useCreateSecondaryChart = () => useRpc((v: { code: string; name: string; framework: string | null }) =>
  call("create_secondary_chart", { _code: v.code, _name: v.name, _framework: v.framework }), "Plan secondaire créé");
export const useCreateMapping = () => useRpc((v: { name: string; framework: string | null; chart: string | null }) =>
  call("create_chart_mapping", { _name: v.name, _target_framework: v.framework, _target_chart: v.chart }), "Correspondance créée");
export const useProposeMapping = () => useRpc((id: string) => call("propose_chart_mapping", { _mapping: id }), (n) => `${n} correspondance(s) proposée(s), à valider`);
export const useSetMappingLines = () => useRpc((v: { mapping: string; source: string; targets: { code: string; ratio: number }[]; comment: string }) =>
  call("set_chart_mapping_lines", { _mapping: v.mapping, _source_account: v.source, _targets: v.targets, _comment: v.comment }), "Correspondance enregistrée (proposée)");
export const useDecideMappingLines = () => useRpc((v: { mapping: string; lines: string[]; approve: boolean; comment?: string }) =>
  call("decide_chart_mapping_lines", { _mapping: v.mapping, _lines: v.lines, _approve: v.approve, _comment: v.comment ?? null }),
  (n) => `${n} ligne(s) traitée(s)`);
export const useValidateMapping = () => useRpc((id: string) => call("validate_chart_mapping", { _mapping: id }), "Correspondance validée");
export const useArchiveMapping = () => useRpc((id: string) => call("archive_chart_mapping", { _mapping: id }), "Correspondance archivée");
