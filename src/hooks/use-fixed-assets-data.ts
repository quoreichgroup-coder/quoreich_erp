import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { FixedAssetPerms, FixedAssetRole } from "@/lib/fixed-assets-roles";

const FA_ROLES: FixedAssetRole[] = ["asset_clerk", "asset_accountant", "asset_controller", "asset_admin"];

export function useAssetCategories() {
  return useQuery({
    queryKey: ["asset-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("asset_categories").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAssets() {
  return useQuery({
    queryKey: ["assets"],
    queryFn: async () => {
      const { data, error } = await supabase
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
      const { data, error } = await supabase
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
      const { data, error } = await supabase
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
      const { data, error } = await supabase
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

export function useRunMonthlyDepreciation() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (period: string) => {
      const { data, error } = await supabase.rpc("post_monthly_depreciation" as never, {
        _tenant_id: tenantId!, _period: period,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: (rows: unknown) => {
      const count = Array.isArray(rows) ? rows.length : 0;
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["asset-kpis"] });
      qc.invalidateQueries({ queryKey: ["assets-register"] });
      toast.success(`Dotation comptabilisée : ${count} actif(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostAssetDisposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      asset_id: string; disposal_date: string; disposal_type: string; sale_price: number; notes?: string;
    }) => {
      const { data, error } = await supabase.rpc("post_asset_disposal" as never, {
        _asset_id: input.asset_id, _disposal_date: input.disposal_date,
        _disposal_type: input.disposal_type, _sale_price: input.sale_price,
        _notes: input.notes ?? null,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["asset-disposals"] });
      qc.invalidateQueries({ queryKey: ["asset-kpis"] });
      toast.success("Cession enregistrée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ===== RBAC ===== */

export function useMyFixedAssetRoles(): FixedAssetPerms {
  const { user } = useAuth();
  const { data: roles = [] } = useQuery({
    queryKey: ["my-fa-roles", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as string);
    },
  });
  const has = (r: FixedAssetRole | "admin") => roles.includes(r);
  const admin = has("asset_admin") || has("admin");
  const any = admin || has("asset_clerk") || has("asset_accountant") || has("asset_controller");
  return {
    canCreate:           admin || has("asset_clerk") || has("asset_accountant"),
    canEdit:             admin || has("asset_clerk") || has("asset_accountant"),
    canPutInService:     admin || has("asset_accountant"),
    canRunDepreciation:  admin || has("asset_accountant") || has("asset_controller"),
    canDispose:          admin || has("asset_accountant"),
    canManageCategories: admin,
    canExport:           admin || has("asset_accountant") || has("asset_controller"),
    canViewSensitive:    any,
  };
}

export function useTenantFixedAssetRoles() {
  return useQuery({
    queryKey: ["tenant-fa-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", FA_ROLES as unknown as ("asset_clerk" | "asset_accountant" | "asset_controller" | "asset_admin")[]);
      if (error) throw error;
      const map = new Map<string, string[]>();
      (data ?? []).forEach((r) => {
        const list = map.get(r.user_id) ?? [];
        list.push(r.role as string);
        map.set(r.user_id, list);
      });
      return map;
    },
  });
}

export function useAssignFixedAssetRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: FixedAssetRole; action: "assign" | "revoke"; comment?: string }) => {
      const { error } = await supabase.rpc("assign_fixed_asset_role" as never, {
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
      qc.invalidateQueries({ queryKey: ["my-fa-roles"] });
      toast.success(vars.action === "assign" ? "Rôle attribué" : "Rôle révoqué");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useFixedAssetRoleAudit() {
  return useQuery({
    queryKey: ["fa-role-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
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
