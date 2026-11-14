import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId, fetchTenantId } from "@/hooks/use-tenant";
import type { ColumnMap, ImportRow } from "@/lib/chart-import";

/* Import guidé du plan comptable (V65) : profils, exécutions, lignes contrôlées par la base. */
export type ImportProfile = { id: string; tenant_id: string | null; code: string; name: string; source: string; delimiter: string; column_map: ColumnMap; notes: string | null };
export type ImportRun = {
  id: string; file_name: string; status: "prepared" | "validated" | "cancelled"; created_by: string; created_at: string;
  validated_by: string | null; validated_at: string | null; cancel_reason: string | null; profile_id: string | null;
  summary: { lignes?: number; erreurs?: number; avertissements?: number; a_creer?: number; a_mettre_a_jour?: number; ignorees?: number; crees?: number; mis_a_jour?: number; rattaches?: number };
};
export type ImportRunRow = {
  id: string; line_no: number; code: string | null; name: string | null; raw_type: string | null; account_type: string | null; parent_code: string | null;
  is_header: boolean; action: "create" | "update" | "skip"; status: "ok" | "warning" | "error"; messages: string[];
};
export type ImportSettings = { require_second_person: boolean; allow_label_updates: boolean; mapping_second_person: boolean };

const db = supabase as any;
const KEYS = ["chart-import-runs", "chart-import-rows", "gl-accounts", "gl-accounts-full", "chart-issues"];

export function useImportProfiles() {
  return useQuery({
    queryKey: ["import-profiles"],
    queryFn: async () => {
      const { data, error } = await db.from("import_profiles").select("*").order("tenant_id", { nullsFirst: true }).order("name");
      if (error) throw error;
      return (data ?? []) as ImportProfile[];
    },
  });
}

export function useImportRuns() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["chart-import-runs", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("chart_import_runs").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as ImportRun[];
    },
  });
}

export function useImportRows(runId: string | null) {
  return useQuery({
    queryKey: ["chart-import-rows", runId],
    enabled: !!runId,
    queryFn: async () => {
      const all: ImportRunRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from("chart_import_rows").select("*").eq("run_id", runId).order("line_no").range(from, from + 999);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return all;
    },
  });
}

export function useImportSettings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["chart-import-settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("chart_import_settings").select("require_second_person, allow_label_updates, mapping_second_person").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? { require_second_person: true, allow_label_updates: true, mapping_second_person: true }) as ImportSettings;
    },
  });
}

function useRpc<V>(fn: (v: V) => Promise<unknown>, ok: string | ((d: any) => string)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d) => { for (const k of KEYS) qc.invalidateQueries({ queryKey: [k] }); toast.success(typeof ok === "string" ? ok : ok(d)); },
    onError: (e: Error) => toast.error(e.message),
  });
}
const call = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
};

export const usePrepareImport = () => useRpc((v: { profileId: string; fileName: string; rows: ImportRow[] }) =>
  call("prepare_chart_import", { _profile_id: v.profileId, _file_name: v.fileName, _rows: v.rows }), "Import préparé : lignes contrôlées");
export const useUpdateImportRow = () => useRpc((v: { id: string; code: string; name: string; type: string | null; parent: string | null; header: boolean; skip: boolean }) =>
  call("update_chart_import_row", { _row_id: v.id, _code: v.code, _name: v.name, _type: v.type, _parent: v.parent, _header: v.header, _skip: v.skip }), "Ligne corrigée et recontrôlée");
export const useValidateImport = () => useRpc((runId: string) => call("validate_chart_import", { _run: runId }),
  (d) => `Import validé : ${d?.crees ?? 0} compte(s) créé(s), ${d?.mis_a_jour ?? 0} mis à jour`);
export const useCancelImport = () => useRpc((v: { runId: string; reason: string }) => call("cancel_chart_import", { _run: v.runId, _reason: v.reason }), "Import annulé");

export function useSaveImportSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: ImportSettings) => {
      const tenantId = await fetchTenantId();
      const { data, error } = await db.from("chart_import_settings").upsert({ tenant_id: tenantId, ...s, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("tenant_id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Administrer les plans comptables et les attributs de compte » requis.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["chart-import-settings"] }); toast.success("Paramètres d'import enregistrés"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
