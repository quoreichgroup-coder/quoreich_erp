import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId, fetchTenantId } from "@/hooks/use-tenant";

/* Immobilisations (V75) : amortissements, cessions, catégories et paramètres. Écritures par fonctions. */
const db = supabase as any;
const KEYS = ["assets", "asset-kpis", "assets-register", "depreciation-entries", "depreciation-runs", "asset-disposals", "asset-categories", "asset-settings", "journal-entries"];
const invalidate = (qc: ReturnType<typeof useQueryClient>) => { for (const k of KEYS) qc.invalidateQueries({ queryKey: [k] }); };
const rpc = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
};

export function useRunDepreciation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (period: string) => rpc("run_depreciation", { _period: period.slice(0, 7) }),
    onSuccess: (d: any, period) => {
      invalidate(qc);
      toast.success(d?.immobilisations ? `Amortissements ${period.slice(0, 7)} comptabilisés : ${d.immobilisations} immobilisation(s), ${Number(d.total).toLocaleString("fr-FR")} XOF`
        : `Aucun amortissement à calculer pour ${period.slice(0, 7)}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useReverseLastDepreciation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reason: string) => rpc("reverse_last_depreciation", { _reason: reason }),
    onSuccess: (period: any) => { invalidate(qc); toast.success(`Calcul ${period} contre-passé`); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDisposeAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { asset: string; date: string; type: "sale" | "scrap"; price: number; proceeds: "receivable" | "bank"; notes: string }) =>
      rpc("dispose_asset", { _asset: v.asset, _date: v.date, _type: v.type, _price: v.price, _proceeds: v.proceeds, _notes: v.notes || null }),
    onSuccess: (d: any) => {
      invalidate(qc);
      const r = Number(d?.plus_ou_moins_value ?? 0);
      toast.success(`Sortie comptabilisée : ${r >= 0 ? "plus-value" : "moins-value"} de ${Math.abs(r).toLocaleString("fr-FR")} XOF`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDepreciationRuns() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["depreciation-runs", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("depreciation_runs").select("*").eq("tenant_id", tenantId).order("period", { ascending: false }).limit(24);
      if (error) throw error;
      return (data ?? []) as { id: string; period: string; assets_count: number; total: number; status: string; reversal_reason: string | null }[];
    },
  });
}

export type AssetCategory = { id: string; name: string; depreciation_method: string; useful_life_years: number | null;
  gl_asset_account_id: string | null; gl_depreciation_account_id: string | null; gl_expense_account_id: string | null };

export function useAssetCategoriesV75() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["asset-categories", "v75", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("asset_categories").select("*").eq("tenant_id", tenantId).order("name");
      if (error) throw error;
      return (data ?? []) as AssetCategory[];
    },
  });
}

export function useSaveAssetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: Omit<AssetCategory, "id"> & { id?: string }) => {
      const tenantId = await fetchTenantId();
      const { id, ...row } = v;
      const q = id ? db.from("asset_categories").update(row).eq("id", id) : db.from("asset_categories").insert({ ...row, tenant_id: tenantId });
      const { data, error } = await q.select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Modifier les catégories et paramètres des immobilisations » requis.");
    },
    onSuccess: (_d, v) => { invalidate(qc); toast.success(v.id ? "Catégorie modifiée" : "Catégorie créée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export type AssetSettings = { declining_coef_short: number; declining_coef_mid: number; declining_coef_long: number; first_month_prorata: boolean };
export function useAssetSettings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["asset-settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("asset_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? { declining_coef_short: 1.5, declining_coef_mid: 2, declining_coef_long: 2.5, first_month_prorata: true }) as AssetSettings;
    },
  });
}
export function useSaveAssetSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: AssetSettings) => {
      const tenantId = await fetchTenantId();
      const { data, error } = await db.from("asset_settings").upsert({ tenant_id: tenantId, ...v, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("tenant_id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Modifier les catégories et paramètres des immobilisations » requis.");
    },
    onSuccess: () => { invalidate(qc); toast.success("Paramètres des immobilisations enregistrés"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
