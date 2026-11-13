import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { moduleCan, useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { HrPerms, HrRole } from "@/lib/hr-roles";
import { ALL_HR_ROLES } from "@/lib/hr-roles";
import { useTenantRoleMembers } from "@/hooks/use-role-members";

export type Employee = {
  id: string;
  tenant_id: string;
  matricule: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  department: string | null;
  contract_type: string;
  hire_date: string;
  end_date: string | null;
  base_salary: number;
  currency: string;
  bank_account: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type PayrollRun = {
  id: string;
  tenant_id: string;
  period: string;
  pay_date: string;
  status: string;
  gross_total: number;
  net_total: number;
  employee_count: number;
  created_by: string | null;
  approved_by: string | null;
  executed_by: string | null;
  approved_at: string | null;
  executed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type HrRoleAuditRow = {
  id: string; created_at: string; tenant_id: string;
  performed_by: string; target_user_id: string;
  role: string; action: "grant" | "revoke"; reason: string | null;
};

// ────────── Employees ──────────

export function useEmployees() {
  return useQuery({
    queryKey: ["hr-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees" as never)
        .select("*")
        .order("matricule", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Employee[];
    },
  });
}

export function useUpsertEmployee() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: Partial<Employee> & { matricule: string; first_name: string; last_name: string; base_salary: number }) => {
      const payload = { ...input, tenant_id: tenantId! } as Record<string, unknown>;
      const { error } = await supabase.from("employees" as never).upsert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-employees"] });
      toast.success("Employé enregistré");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ────────── Payroll Runs ──────────

export type PayrollLine = {
  id: string;
  tenant_id: string;
  run_id: string;
  employee_id: string;
  gross: number;
  deductions: number;
  taxes: number;
  net: number;
};

export function usePayrollRuns() {
  return useQuery({
    queryKey: ["hr-payroll-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs" as never)
        .select("*")
        .order("pay_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as PayrollRun[];
    },
  });
}

export function usePayrollLines(runId: string | null) {
  return useQuery({
    queryKey: ["hr-payroll-lines", runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_lines" as never)
        .select("*")
        .eq("run_id", runId!);
      if (error) throw error;
      return (data ?? []) as unknown as PayrollLine[];
    },
  });
}

export function usePayrollKpis() {
  const { data: runs = [] } = usePayrollRuns();
  const { data: employees = [] } = useEmployees();
  const active = employees.filter((e) => e.status === "active");
  const ytdGross = runs
    .filter((r) => r.period.startsWith(String(new Date().getFullYear())))
    .reduce((s, r) => s + Number(r.gross_total || 0), 0);
  const last = runs[0];
  const upcoming = runs
    .filter((r) => r.status !== "posted" && new Date(r.pay_date) >= new Date(new Date().toDateString()))
    .slice(0, 5);
  return {
    activeEmployees: active.length,
    runsCount: runs.length,
    ytdGross,
    lastRun: last,
    upcoming,
    runs,
  };
}

// ────────── Payroll RPCs (compute/approve/post) ──────────

function invalidatePayroll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["hr-payroll-runs"] });
  qc.invalidateQueries({ queryKey: ["hr-payroll-lines"] });
}

export function useCreatePayrollRun() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: { period: string; pay_date: string }) => {
      const { data, error } = await supabase
        .from("payroll_runs" as never)
        .insert({ tenant_id: tenantId!, period: input.period, pay_date: input.pay_date, status: "draft" } as never)
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => {
      invalidatePayroll(qc);
      toast.success("Cycle de paie créé");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useGeneratePayrollLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { data, error } = await supabase.rpc("generate_payroll_lines" as never, { _run_id: runId } as never);
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      invalidatePayroll(qc);
      toast.success(`${count ?? 0} ligne(s) de paie générée(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useApprovePayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase.rpc("approve_payroll_run" as never, { _run_id: runId } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidatePayroll(qc);
      toast.success("Cycle approuvé");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { data, error } = await supabase.rpc("post_payroll_run" as never, { _run_id: runId } as never);
      if (error) throw error;
      return data as string; // journal_entry_id
    },
    onSuccess: () => {
      invalidatePayroll(qc);
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
      toast.success("Cycle comptabilisé — écriture SYSCOHADA générée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ────────── HR Role Audit ──────────

export function useHrRoleAudit() {
  return useQuery({
    queryKey: ["hr-role-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_role_audit" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as HrRoleAuditRow[];
    },
  });
}

/**
 * Server-side audit query scoped to a single payroll run.
 * Filters + pagination are pushed down to Supabase; RLS strictly
 * enforces tenant + role permissions even if the request is tampered with.
 */
export function usePayrollRunAudit(
  runId: string | null,
  opts: { action?: "all" | "grant" | "revoke"; role?: string; page?: number; pageSize?: number } = {},
) {
  const { action = "all", role = "", page = 1, pageSize = 10 } = opts;
  return useQuery({
    queryKey: ["payroll-run-audit", runId, action, role, page, pageSize],
    enabled: !!runId,
    queryFn: async () => {
      const from = (Math.max(1, page) - 1) * pageSize;
      const to = from + pageSize - 1;
      let q = supabase
        .from("hr_role_audit" as never)
        .select("*", { count: "exact" })
        .ilike("reason", `%${runId}%`)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (action !== "all") q = q.eq("action", action);
      if (role.trim()) q = q.ilike("role", `%${role.trim()}%`);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as HrRoleAuditRow[], total: count ?? 0 };
    },
  });
}

// ────────── RBAC ──────────

export function useMyHrRoles(): HrPerms {
  // Droits dits par la base (my_access, V27). Création et modification de salariés suivent
  // hr.manage_employees, comme la politique RLS (l'ancien calcul les ouvrait à hr_clerk, que la
  // base refusait). Seul le paramétrage du module reste par rôle.
  const { data: access } = useMyAccess();
  const can = moduleCan(access, "hr");
  const roles = access?.roles ?? [];
  return {
    canCreateEmployee:    can("manage_employees"),
    canEditEmployee:      can("manage_employees"),
    canCreatePayrollRun:  can("create_payroll_run"),
    canApprovePayrollRun: can("approve_payroll_run"),
    canExecutePayroll:    can("execute_payroll"),
    canAuditPayroll:      can("audit_payroll"),
    canManageSettings:    roles.includes("admin") || roles.includes("hr_admin"),
    canExport:            can("export"),
    canViewSensitive:     can("view_sensitive"),
  };
}

export function useTenantHrRoles() {
  return useTenantRoleMembers("tenant-hr-roles", ALL_HR_ROLES);
}

// ────────── Assign role (SoD enforced server-side) ──────────

export function useAssignHrRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: HrRole; action: "assign" | "revoke"; reason?: string }) => {
      const { error } = await supabase.rpc("assign_hr_role" as never, {
        p_target_user: input.target_user,
        p_role: input.role,
        p_action: input.action,
        p_reason: input.reason ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["tenant-hr-roles"] });
      qc.invalidateQueries({ queryKey: ["hr-role-audit"] });
      // Droits de l'utilisateur (my_access, V27) et matrice de /settings : le rôle y est recopié.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      qc.invalidateQueries({ queryKey: ["authorizations"] });
      toast.success(v.action === "assign" ? "Rôle attribué" : "Rôle révoqué");
    },
    onError: (e: Error) => {
      const msg = e.message?.includes("SoD")
        ? e.message
        : e.message?.includes("administrateurs")
        ? "Seuls les administrateurs peuvent assigner les rôles RH"
        : e.message || "Erreur lors de l'attribution";
      toast.error(msg);
    },
  });
}

