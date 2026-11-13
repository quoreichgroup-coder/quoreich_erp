import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { BudgetRole, BudgetPerms } from "@/lib/budget-roles";
import { REQUIRED_ROLES, ALL_BUDGET_ROLES } from "@/lib/budget-roles";
import { useTenantRoleMembers } from "@/hooks/use-role-members";


export function useBudgets() {
  return useQuery({
    queryKey: ["budgets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("budgets").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useBudgetLines(budgetId?: string) {
  return useQuery({
    queryKey: ["budget-lines", budgetId],
    queryFn: async () => {
      let q = supabase.from("budget_lines").select("*, gl_account:gl_accounts(code, name)");
      if (budgetId) q = q.eq("budget_id", budgetId);
      const { data, error } = await q.order("period");
      if (error) throw error;
      return data || [];
    },
    enabled: !!budgetId || budgetId === undefined,
  });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { name: string; fiscal_year: string; scenario?: string; total_amount?: number }) => {
      const { error } = await supabase.from("budgets").insert({ ...input, tenant_id: tenantId!, created_by: user!.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budgets"] }); toast.success("Budget créé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useBudgetKpis() {
  const { data: budgets = [] } = useBudgets();
  const approved = budgets.filter(b => b.status === "approved");
  const totalBudgeted = approved.reduce((s, b) => s + Number(b.total_amount), 0);
  const draft = budgets.filter(b => b.status === "draft").length;

  return { budgets, approved, totalBudgeted, draft };
}

// =====================================================================
// RBAC — Budget roles (mirrors fixed-assets pattern)
// =====================================================================

export function useMyBudgetRoles(): BudgetPerms {
  const { user } = useAuth();
  // Rôles de la société courante, dits par la base (my_access, V27) ; la base contrôle ce module
  // par has_role, d'où une logique encore par rôle.
  const roles = useMyAccess().data?.roles ?? [];
  const has = (r: BudgetRole | "admin") => roles.includes(r);
  const admin = has("budget_admin") || has("admin");
  const any = admin || has("budget_planner") || has("budget_approver") || has("budget_controller");
  return {
    canCreate:          admin || has("budget_planner"),
    canEdit:            admin || has("budget_planner"),
    canSubmit:          admin || has("budget_planner"),
    canApprove:         admin || has("budget_approver"),
    canLockPeriod:      admin || has("budget_approver"),
    canManageScenarios: admin,
    canExport:          admin || has("budget_approver") || has("budget_controller"),
    canViewSensitive:   any,
  };
}

export function useTenantBudgetRoles() {
  return useTenantRoleMembers("tenant-budget-roles", ALL_BUDGET_ROLES);
}

export function useBudgetRoleAudit() {
  return useQuery({
    queryKey: ["budget-role-audit"],
    queryFn: async () => {
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


