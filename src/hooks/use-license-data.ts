import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ModuleName, ModuleStatus, PlanTier, LicenseType } from "@/lib/module-manager";

// ─── Types mapped from DB rows ───

export interface LicenseRow {
  id: string;
  tenant_id: string;
  module_name: string;
  plan: string;
  license_type: string;
  start_date: string;
  end_date: string;
  max_users: number | null;
  active_users: number | null;
  is_active: boolean;
  created_at: string;
}

export interface TenantModuleRow {
  id: string;
  tenant_id: string;
  module_name: string;
  status: string;
  activated_at: string | null;
  deactivated_at: string | null;
  activated_by: string | null;
  license_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Hooks ───

export function useLicenses() {
  return useQuery({
    queryKey: ["licenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("licenses")
        .select("*")
        .order("module_name");
      if (error) throw error;
      return (data || []) as LicenseRow[];
    },
  });
}

export function useTenantModules() {
  return useQuery({
    queryKey: ["tenant-modules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_modules")
        .select("*")
        .order("module_name");
      if (error) throw error;
      return (data || []) as TenantModuleRow[];
    },
  });
}

export function useActivateModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ moduleName, licenseId }: { moduleName: string; licenseId?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.email || user?.id || "system";

      const { error } = await supabase
        .from("tenant_modules")
        .upsert(
          {
            module_name: moduleName,
            status: "active",
            activated_at: new Date().toISOString(),
            activated_by: userId,
            license_id: licenseId || null,
            updated_at: new Date().toISOString(),
            tenant_id: (await supabase.rpc("get_user_tenant_id", { _user_id: user!.id })).data!,
          },
          { onConflict: "tenant_id,module_name" }
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-modules"] }),
  });
}

export function useDeactivateModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ moduleName }: { moduleName: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const tenantId = (await supabase.rpc("get_user_tenant_id", { _user_id: user!.id })).data!;

      const { error } = await supabase
        .from("tenant_modules")
        .update({
          status: "inactive",
          deactivated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("module_name", moduleName);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-modules"] }),
  });
}

// ─── Adapter: convert DB rows to module-manager License type ───

export function toLicense(row: LicenseRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    moduleName: row.module_name as ModuleName,
    plan: row.plan as PlanTier,
    licenseType: row.license_type as LicenseType,
    startDate: row.start_date,
    endDate: row.end_date,
    maxUsers: row.max_users ?? undefined,
    activeUsers: row.active_users ?? undefined,
    isActive: row.is_active,
  };
}

export function toModuleState(row: TenantModuleRow) {
  return {
    moduleName: row.module_name as ModuleName,
    status: row.status as ModuleStatus,
    activatedAt: row.activated_at ?? undefined,
    deactivatedAt: row.deactivated_at ?? undefined,
    activatedBy: row.activated_by ?? undefined,
    licenseId: row.license_id ?? undefined,
  };
}
