import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "./use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { apiGet, isApiEnabled } from "@/api/client";

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

export function useTenantProfiles() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["tenant-profiles", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      if (isApiEnabled()) return apiGet<TenantProfile[]>("/api/v1/profiles");
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
