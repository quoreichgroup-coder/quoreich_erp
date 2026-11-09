import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "./use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ERPRole {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
}

export interface ERPPermission {
  id: string;
  role_id: string;
  module: string;
  permission: string;
}

export interface UserRoleAssignment {
  id: string;
  user_id: string;
  role_id: string;
  tenant_id: string;
  assigned_at: string;
  assigned_by: string | null;
}

export interface TenantProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  tenant_id: string | null;
  created_at: string;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useERPRoles() {
  return useQuery({
    queryKey: ["erp-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("erp_roles")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data || []) as ERPRole[];
    },
  });
}

export function useERPPermissions() {
  return useQuery({
    queryKey: ["erp-permissions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("erp_permissions")
        .select("*");
      if (error) throw error;
      return (data || []) as ERPPermission[];
    },
  });
}

export function useUserRoleAssignments() {
  return useQuery({
    queryKey: ["user-role-assignments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_role_assignments")
        .select("*");
      if (error) throw error;
      return (data || []) as UserRoleAssignment[];
    },
  });
}

export function useTenantProfiles() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["tenant-profiles", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, tenant_id, created_at")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return (data || []) as TenantProfile[];
    },
    enabled: !!tenantId,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateRole() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      if (!tenantId) throw new Error("No tenant");
      const { data, error } = await supabase
        .from("erp_roles")
        .insert({ tenant_id: tenantId, name: input.name, description: input.description || null })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["erp-roles"] });
      toast.success("Rôle créé");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (roleId: string) => {
      const { error } = await supabase.from("erp_roles").delete().eq("id", roleId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["erp-roles"] });
      qc.invalidateQueries({ queryKey: ["erp-permissions"] });
      qc.invalidateQueries({ queryKey: ["user-role-assignments"] });
      toast.success("Rôle supprimé");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useTogglePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { roleId: string; module: string; permission: string; enabled: boolean }) => {
      if (input.enabled) {
        const { error } = await supabase
          .from("erp_permissions")
          .insert({ role_id: input.roleId, module: input.module, permission: input.permission });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("erp_permissions")
          .delete()
          .eq("role_id", input.roleId)
          .eq("module", input.module)
          .eq("permission", input.permission);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["erp-permissions"] }),
    onError: (e: any) => toast.error(e.message),
  });
}

export function useAssignRole() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { userId: string; roleId: string }) => {
      if (!tenantId) throw new Error("No tenant");
      const { error } = await supabase
        .from("user_role_assignments")
        .insert({ user_id: input.userId, role_id: input.roleId, tenant_id: tenantId, assigned_by: user?.id || null });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-role-assignments"] });
      toast.success("Rôle assigné");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUnassignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; roleId: string }) => {
      const { error } = await supabase
        .from("user_role_assignments")
        .delete()
        .eq("user_id", input.userId)
        .eq("role_id", input.roleId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-role-assignments"] });
      toast.success("Rôle retiré");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export const ERP_MODULES = ["AR", "AP", "GL", "Treasury", "Inventory", "Sales", "Procurement", "Expenses", "Assets", "Budget", "Projects", "Compliance", "Risk", "Reports", "Settings"] as const;
export const ERP_PERMISSIONS = ["Read", "Create", "Edit", "Validate", "Delete", "Export"] as const;

export type ERPModule = typeof ERP_MODULES[number];
export type ERPPermissionType = typeof ERP_PERMISSIONS[number];

/** Build a role→module→permissions lookup */
export function buildPermissionMatrix(permissions: ERPPermission[]): Record<string, Record<string, string[]>> {
  const matrix: Record<string, Record<string, string[]>> = {};
  for (const p of permissions) {
    if (!matrix[p.role_id]) matrix[p.role_id] = {};
    if (!matrix[p.role_id][p.module]) matrix[p.role_id][p.module] = [];
    matrix[p.role_id][p.module].push(p.permission);
  }
  return matrix;
}
