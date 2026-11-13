import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { ProjectPerms, ProjectRole } from "@/lib/project-roles";
import { ALL_PROJECT_ROLES } from "@/lib/project-roles";

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useProjectCosts(projectId?: string) {
  return useQuery({
    queryKey: ["project-costs", projectId],
    queryFn: async () => {
      let q = supabase.from("project_costs").select("*, project:projects(name, project_code)");
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q.order("cost_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { project_code: string; name: string; client?: string; budget?: number; start_date?: string; end_date?: string; department?: string; project_manager?: string }) => {
      const { error } = await supabase.from("projects").insert({ ...input, tenant_id: tenantId!, created_by: user!.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); toast.success("Projet créé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateProjectCost() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { project_id: string; category: string; description?: string; amount: number; cost_date?: string }) => {
      const { error } = await supabase.from("project_costs").insert({ ...input, created_by: user!.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project-costs"] }); toast.success("Coût enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useProjectKpis() {
  const { data: projects = [] } = useProjects();
  const { data: costs = [] } = useProjectCosts();
  const active = projects.filter(p => p.status === "active");
  const totalBudget = active.reduce((s, p) => s + Number(p.budget), 0);
  const totalCosts = active.reduce((s, p) => s + Number(p.total_costs), 0);

  return { projects, costs, active, totalBudget, totalCosts };
}

// ---------- RBAC ----------

export function useMyProjectRoles(): ProjectPerms {
  const { user } = useAuth();
  // Rôles de la société courante, dits par la base (my_access, V27) ; la base contrôle ce module
  // par has_role, d'où une logique encore par rôle.
  const roles = useMyAccess().data?.roles ?? [];

  const has = (r: ProjectRole) => roles.includes(r);
  const admin = has("project_admin") || roles.includes("admin");
  return {
    canCreate: admin || has("project_planner"),
    canEdit: admin || has("project_planner"),
    canPostCost: admin || has("project_accountant"),
    canApproveCost: admin || has("project_controller"),
    canClose: admin || has("project_controller"),
    canManageSettings: admin,
    canExport: admin || has("project_accountant") || has("project_controller"),
    canViewSensitive:
      admin || has("project_planner") || has("project_accountant") || has("project_controller"),
  };
}

export function useTenantProjectRoles() {
  return useQuery({
    queryKey: ["tenant-project-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ALL_PROJECT_ROLES as unknown as never);
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

export function useProjectRoleAudit() {
  return useQuery({
    queryKey: ["project-role-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_role_audit" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; created_at: string; tenant_id: string; performed_by: string;
        target_user_id: string; role: string; action: "grant" | "revoke"; reason: string | null;
      }>;
    },
  });
}

export function useAssignProjectRole() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: ProjectRole; action: "grant" | "revoke"; reason?: string }) => {
      const { error } = await supabase.rpc("assign_project_role" as never, {
        _tenant_id: tenantId,
        _target_user_id: input.target_user,
        _role: input.role,
        _action: input.action,
        _reason: input.reason ?? null,
      } as never);
      if (error) throw error;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["tenant-project-roles"] });
      const prev = qc.getQueryData<Map<string, string[]>>(["tenant-project-roles"]);
      if (prev instanceof Map) {
        const next = new Map(prev);
        const cur = next.get(vars.target_user) ?? [];
        if (vars.action === "grant" && !cur.includes(vars.role)) {
          next.set(vars.target_user, [...cur, vars.role]);
        } else if (vars.action === "revoke") {
          next.set(vars.target_user, cur.filter((r) => r !== vars.role));
        }
        qc.setQueryData(["tenant-project-roles"], next);
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tenant-project-roles"], ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.action === "grant" ? "Rôle Projet attribué" : "Rôle Projet révoqué");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tenant-project-roles"] });
      qc.invalidateQueries({ queryKey: ["project-role-audit"] });
      qc.invalidateQueries({ queryKey: ["my-project-roles"] });
    },
  });
}
