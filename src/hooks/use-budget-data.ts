import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { BudgetRole, BudgetPerms } from "@/lib/budget-roles";
import { REQUIRED_ROLES, ALL_BUDGET_ROLES } from "@/lib/budget-roles";
import { useTenantRoleMembers } from "@/hooks/use-role-members";
import { apiGet, apiPost, isApiEnabled } from "@/api/client";


// =====================================================================
// RBAC — Budget roles (mirrors fixed-assets pattern)
// =====================================================================

export function useMyBudgetRoles(): BudgetPerms {
  // Droits du catalogue dans la société courante (my_access) : attribuables à un rôle sur mesure depuis
  // Paramètres → Rôles et autorisations (V78 ; avant, listes de rôles codées en dur).
  const permissions = useMyAccess().data?.permissions ?? [];
  const can = (code: string) => permissions.includes(code);
  return {
    canCreate:          can("budget.manage"),
    canEdit:            can("budget.manage"),
    canSubmit:          can("budget.manage"),
    canApprove:         can("budget.approve"),
    canLockPeriod:      can("budget.approve"),
    canManageScenarios: can("budget.forecast"),
    canExport:          can("budget.export"),
    canViewSensitive:   permissions.some((p) => p.startsWith("budget.")),
  };
}

export function useTenantBudgetRoles() {
  return useTenantRoleMembers("tenant-budget-roles", ALL_BUDGET_ROLES);
}

export function useBudgetRoleAudit() {
  return useQuery({
    queryKey: ["budget-role-audit"],
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<any[]>("/api/v1/budget/role-audit");
      const { data, error } = await supabase
        .from("budget_role_audit" as never)
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

export function useAssignBudgetRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: BudgetRole; action: "assign" | "revoke"; comment?: string }) => {
      if (isApiEnabled()) { await apiPost("/api/v1/budget/actions/assign_budget_role", { p_target_user: input.target_user, p_role: input.role, p_action: input.action, p_comment: input.comment ?? null }); return; }
      const { error } = await supabase.rpc("assign_budget_role" as never, {
        p_target_user: input.target_user,
        p_role: input.role,
        p_action: input.action,
        p_comment: input.comment ?? null,
      } as never);
      if (error) throw error;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["tenant-budget-roles"] });
      const prev = qc.getQueryData<Map<string, string[]>>(["tenant-budget-roles"]);
      if (prev instanceof Map) {
        const next = new Map(prev);
        const cur = next.get(vars.target_user) ?? [];
        if (vars.action === "assign" && !cur.includes(vars.role)) {
          next.set(vars.target_user, [...cur, vars.role]);
        } else if (vars.action === "revoke") {
          next.set(vars.target_user, cur.filter((r) => r !== vars.role));
        }
        qc.setQueryData(["tenant-budget-roles"], next);
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tenant-budget-roles"], ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.action === "assign" ? "Rôle Budget attribué" : "Rôle Budget révoqué");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tenant-budget-roles"] });
      qc.invalidateQueries({ queryKey: ["budget-role-audit"] });
      // Droits de l'utilisateur (my_access, V27) et matrice de /settings : le rôle y est recopié.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      qc.invalidateQueries({ queryKey: ["authorizations"] });
    },
  });
}


