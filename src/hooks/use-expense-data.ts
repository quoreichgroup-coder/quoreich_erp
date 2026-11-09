import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantId } from "@/hooks/use-tenant";
import { toast } from "sonner";
import { ALL_EXPENSE_ROLES, type ExpensePerms, type ExpenseRole } from "@/lib/expense-roles";

export function useExpenseReports() {
  return useQuery({
    queryKey: ["expense-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_reports")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useExpenseLines(reportId?: string) {
  return useQuery({
    queryKey: ["expense-lines", reportId],
    queryFn: async () => {
      let q = supabase.from("expense_lines").select("*");
      if (reportId) q = q.eq("report_id", reportId);
      const { data, error } = await q.order("expense_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!reportId || reportId === undefined,
  });
}

export function useCreateExpenseReport() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: { report_number: string; submission_date?: string }) => {
      const { error } = await supabase.from("expense_reports").insert({
        ...input,
        tenant_id: tenantId!,
        employee_id: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-reports"] }); toast.success("Note de frais créée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateExpenseReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string; approval_status?: string; total?: number }) => {
      const { error } = await supabase.from("expense_reports").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-reports"] }); toast.success("Note de frais mise à jour"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAddExpenseLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { report_id: string; category: string; description?: string; amount: number; expense_date: string }) => {
      const { error } = await supabase.from("expense_lines").insert(input);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-lines"] }); qc.invalidateQueries({ queryKey: ["expense-reports"] }); toast.success("Ligne ajoutée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useExpenseKpis() {
  const { data: reports = [] } = useExpenseReports();

  const pending = reports.filter(r => r.status === "draft" || r.approval_status === "pending");
  const approved = reports.filter(r => r.approval_status === "approved");
  const totalReimbursed = approved.reduce((s, r) => s + Number(r.total), 0);
  const violations = reports.filter(r => r.approval_status === "rejected");

  return { reports, pending, approved, totalReimbursed, violations };
}

// ---------- RBAC ----------

export function useMyExpenseRoles(): ExpensePerms {
  const { user } = useAuth();
  const { data: roles = [] } = useQuery({
    queryKey: ["my-expense-roles", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as string);
    },
  });
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
  return useQuery({
    queryKey: ["tenant-expense-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ALL_EXPENSE_ROLES as unknown as never);
      if (error) throw error;
      const map = new Map<string, string[]>();
      (data ?? []).forEach((r: { user_id: string; role: string }) => {
        const list = map.get(r.user_id) ?? [];
        list.push(r.role);
        map.set(r.user_id, list);
      });
      return map;
    },
  });
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
      qc.invalidateQueries({ queryKey: ["my-expense-roles"] });
    },
  });
}
