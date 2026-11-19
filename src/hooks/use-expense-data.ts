import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantId } from "@/hooks/use-tenant";
import { toast } from "sonner";
import { ALL_EXPENSE_ROLES, type ExpensePerms, type ExpenseRole } from "@/lib/expense-roles";
import { useTenantRoleMembers } from "@/hooks/use-role-members";

// Notes, lignes et indicateurs : voir use-expenses.ts (V109). Ce module ne garde que les rôles du module.

// ---------- RBAC ----------

export function useMyExpenseRoles(): ExpensePerms {
  const { user } = useAuth();
  // Rôles de la société courante, dits par la base (my_access, V27) ; la base contrôle ce module
  // par has_role, d'où une logique encore par rôle.
  const roles = useMyAccess().data?.roles ?? [];
  const has = (r: ExpenseRole) => roles.includes(r);
  const admin = has("expense_admin") || roles.includes("admin");
  return {
    canCreate: admin || has("expense_clerk"),
    canSubmit: admin || has("expense_clerk"),
    canApprove: admin || has("expense_approver"),
    canReject: admin || has("expense_approver"),
    canReimburse: admin || has("expense_controller"),
    canManageSettings: admin,
    canExport: admin || has("expense_approver") || has("expense_controller"),
    canViewSensitive:
      admin || has("expense_clerk") || has("expense_approver") || has("expense_controller"),
  };
}

export function useTenantExpenseRoles() {
  return useTenantRoleMembers("tenant-expense-roles", ALL_EXPENSE_ROLES);
}

export function useExpenseRoleAudit() {
  return useQuery({
    queryKey: ["expense-role-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_role_audit" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; created_at: string; tenant_id: string; actor_user_id: string;
        target_user_id: string; role: string; action: "grant" | "revoke"; reason: string | null;
      }>;
    },
  });
}

export function useAssignExpenseRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: ExpenseRole; action: "grant" | "revoke"; reason?: string }) => {
      const { error } = await supabase.rpc("assign_expense_role" as never, {
        _target_user: input.target_user,
        _role: input.role,
        _action: input.action,
        _reason: input.reason ?? null,
      } as never);
      if (error) throw error;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["tenant-expense-roles"] });
      const prev = qc.getQueryData<Map<string, string[]>>(["tenant-expense-roles"]);
      if (prev instanceof Map) {
        const next = new Map(prev);
        const cur = next.get(vars.target_user) ?? [];
        if (vars.action === "grant" && !cur.includes(vars.role)) {
          next.set(vars.target_user, [...cur, vars.role]);
        } else if (vars.action === "revoke") {
          next.set(vars.target_user, cur.filter((r) => r !== vars.role));
        }
        qc.setQueryData(["tenant-expense-roles"], next);
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tenant-expense-roles"], ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.action === "grant" ? "Rôle Notes de frais attribué" : "Rôle Notes de frais révoqué");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tenant-expense-roles"] });
      qc.invalidateQueries({ queryKey: ["expense-role-audit"] });
      // Droits de l'utilisateur (my_access, V27) et matrice de /settings : le rôle y est recopié.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      qc.invalidateQueries({ queryKey: ["authorizations"] });
    },
  });
}
