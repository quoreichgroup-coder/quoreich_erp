import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { moduleCan, useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { toast } from "sonner";
import type { FixedAssetPerms, FixedAssetRole } from "@/lib/fixed-assets-roles";
import { useTenantRoleMembers } from "@/hooks/use-role-members";
import { apiGet, apiPatch, apiPost, apiPut, isApiEnabled } from "@/api/client";
import { moduleRpc } from "@/api/rpc";

const FA_ROLES: FixedAssetRole[] = ["asset_clerk", "asset_accountant", "asset_controller", "asset_admin"];

export function useAssetCategories() {
  return useQuery({
    queryKey: ["asset-categories"],
    queryFn: async () => {
      const { data, error } = isApiEnabled() ? { data: await apiGet<any[]>("/api/v1/assets/categories"), error: null } : await supabase.from("asset_categories").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAssets() {
  return useQuery({
    queryKey: ["assets"],
    queryFn: async () => {
      const { data, error } = isApiEnabled() ? { data: await apiGet<any[]>("/api/v1/assets"), error: null } : await supabase
        .from("assets")
        .select("*, category:asset_categories(name)")
        .order("acquisition_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAssetRegister() {
  return useQuery({
    queryKey: ["assets-register"],
    queryFn: async () => {
      const { data, error } = isApiEnabled() ? { data: await apiGet<any[]>("/api/v1/assets/register"), error: null } : await supabase
        .from("fixed_assets_register_view" as never)
        .select("*")
        .order("acquisition_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        asset_id: string; asset_code: string; name: string; category_name: string | null;
        acquisition_date: string; acquisition_cost: number; accumulated_depreciation: number;
        net_book_value: number; salvage_value: number; depreciation_method: string;
        useful_life_months: number; status: string; location: string | null; assigned_to: string | null;
      }>;
    },
  });
}

export function useAssetKpis() {
  return useQuery({
    queryKey: ["asset-kpis"],
    queryFn: async () => {
      const { data, error } = isApiEnabled() ? { data: await apiGet<any>("/api/v1/assets/kpis"), error: null } : await supabase
        .from("asset_kpis_view" as never)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return (data ?? {
        active_count: 0, disposed_count: 0, gross_value: 0,
        accumulated: 0, net_book_value: 0, depreciation_ytd: 0,
      }) as {
        active_count: number; disposed_count: number; gross_value: number;
        accumulated: number; net_book_value: number; depreciation_ytd: number;
      };
    },
  });
}

export function useAssetDisposals() {
  return useQuery({
    queryKey: ["asset-disposals"],
    queryFn: async () => {
      const { data, error } = isApiEnabled() ? { data: await apiGet<any[]>("/api/v1/assets/disposals"), error: null } : await supabase
        .from("asset_disposals" as never)
        .select("*")
        .order("disposal_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; asset_id: string; disposal_date: string; disposal_type: string;
        sale_price: number; net_book_value_at_disposal: number; gain_loss: number;
        notes: string | null; journal_entry_id: string | null;
      }>;
    },
  });
}

// V75 : run_depreciation / dispose_asset (les anciennes fonctions, inutilisables, sont supprimées).
export { useRunDepreciation as useRunMonthlyDepreciation, useDisposeAsset as usePostAssetDisposal } from "@/hooks/use-asset-accounting";

/* ===== RBAC ===== */

export function useMyFixedAssetRoles(): FixedAssetPerms {
  // Même catalogue que les contrôles SQL V75, y compris pour un rôle standard personnalisé.
  const can = moduleCan(useMyAccess().data, "assets");
  const any = can("manage") || can("depreciate") || can("dispose") || can("settings");
  return {
    canCreate:           can("manage"),
    canEdit:             can("manage"),
    canPutInService:     can("manage"),
    canRunDepreciation:  can("depreciate"),
    canDispose:          can("dispose"),
    canManageCategories: can("settings"),
    canExport:           can("depreciate") || can("dispose"),
    canViewSensitive:    any,
  };
}

export function useTenantFixedAssetRoles() {
  return useTenantRoleMembers("tenant-fa-roles", FA_ROLES);
}

export function useAssignFixedAssetRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: FixedAssetRole; action: "assign" | "revoke"; comment?: string }) => {
      const { error } = await moduleRpc("assets", "assign_fixed_asset_role", {
        p_target_user: input.target_user,
        p_role: input.role,
        p_action: input.action,
        p_comment: input.comment ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["tenant-fa-roles"] });
      qc.invalidateQueries({ queryKey: ["fa-role-audit"] });
      // Droits de l'utilisateur (my_access, V27) et matrice de /settings : le rôle y est recopié.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      qc.invalidateQueries({ queryKey: ["authorizations"] });
      toast.success(vars.action === "assign" ? "Rôle attribué" : "Rôle révoqué");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useFixedAssetRoleAudit() {
  return useQuery({
    queryKey: ["fa-role-audit"],
    queryFn: async () => {
      const { data, error } = isApiEnabled() ? { data: await apiGet<any[]>("/api/v1/assets/role-audit"), error: null } : await supabase
        .from("fixed_asset_role_audit" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; created_at: string; actor_user_id: string; target_user_id: string | null;
        role: string | null; action: string; details: { comment?: string } | null;
      }>;
    },
  });
}
