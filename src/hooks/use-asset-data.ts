import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useAssetCategories() {
  return useQuery({
    queryKey: ["asset-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("asset_categories").select("*").order("name");
      if (error) throw error;
      return data || [];
    },
  });
}

export function useAssets() {
  return useQuery({
    queryKey: ["assets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("assets").select("*, category:asset_categories(name)").order("asset_code");
      if (error) throw error;
      return data || [];
    },
  });
}

export function useCreateAsset() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { asset_code: string; name: string; category_id?: string; acquisition_date: string; acquisition_cost: number; salvage_value?: number; useful_life_months?: number; depreciation_method?: string; location?: string }) => {
      const nbv = input.acquisition_cost - (input.salvage_value || 0);
      const { error } = await supabase.from("assets").insert({ ...input, tenant_id: tenantId!, created_by: user!.id, net_book_value: input.acquisition_cost });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assets"] }); toast.success("Immobilisation créée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateAssetCategory() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: { name: string; depreciation_method?: string; useful_life_years?: number }) => {
      const { error } = await supabase.from("asset_categories").insert({ ...input, tenant_id: tenantId! });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["asset-categories"] }); toast.success("Catégorie créée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAssetKpis() {
  const { data: assets = [] } = useAssets();
  const totalCost = assets.reduce((s, a) => s + Number(a.acquisition_cost), 0);
  const totalNBV = assets.reduce((s, a) => s + Number(a.net_book_value), 0);
  const totalDepreciation = assets.reduce((s, a) => s + Number(a.accumulated_depreciation), 0);
  const activeAssets = assets.filter(a => a.status === "active").length;
  const fullyDepreciated = assets.filter(a => a.status === "fully_depreciated").length;

  return { assets, totalCost, totalNBV, totalDepreciation, activeAssets, fullyDepreciated };
}
