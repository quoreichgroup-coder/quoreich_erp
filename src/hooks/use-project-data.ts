import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { ProjectPerms, ProjectRole } from "@/lib/project-roles";
import { ALL_PROJECT_ROLES } from "@/lib/project-roles";
import { useTenantRoleMembers } from "@/hooks/use-role-members";
import { apiGet, isApiEnabled } from "@/api/client";
import { moduleRpc } from "@/api/rpc";

// Projets, budget et chiffres : voir use-projects.ts (V111). Ce module ne garde que les rôles.


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
  return useTenantRoleMembers("tenant-project-roles", ALL_PROJECT_ROLES);
}

export function useProjectRoleAudit() {
  return useQuery({
    queryKey: ["project-role-audit"],
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<any[]>("/api/v1/projects/role-audit");
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
      const { error } = await moduleRpc("projects", "assign_project_role", {
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
      // Droits de l'utilisateur (my_access, V27) et matrice de /settings : le rôle y est recopié.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      qc.invalidateQueries({ queryKey: ["authorizations"] });
    },
  });
}
