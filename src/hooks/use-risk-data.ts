import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/* Rôles du module Risques (les données sont dans use-grc.ts, V113). */
// ---------- RBAC ----------
import { ALL_RISK_ROLES, type RiskPerms, type RiskRole } from "@/lib/risk-roles";
import { useTenantRoleMembers } from "@/hooks/use-role-members";

export function useMyRiskRoles(): RiskPerms {
  // Droits du catalogue de la société courante (V113 : risks.*).
  const p = useMyAccess().data?.permissions ?? [];
  const has = (c: string) => p.includes(c);
  return {
    canCreate: has("risks.manage"), canEdit: has("risks.manage"), canAssess: has("risks.assess"), canApprove: has("risks.manage"),
    canClose: has("risks.manage"), canManageSettings: has("risks.settings"), canExport: has("risks.export"),
    canViewSensitive: has("risks.manage") || has("risks.assess") || has("risks.export"),
  };
}

export function useTenantRiskRoles() {
  return useTenantRoleMembers("tenant-risk-roles", ALL_RISK_ROLES);
}

export function useRiskRoleAudit() {
  return useQuery({
    queryKey: ["risk-role-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("risk_role_audit" as never).select("*")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; created_at: string; tenant_id: string; actor_user_id: string;
        target_user_id: string; role: string; action: "grant" | "revoke"; reason: string | null;
      }>;
    },
  });
}

function mapAssignmentError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("sod") || m.includes("conflict") || m.includes("mutually exclusive"))
    return "Conflit de séparation des tâches : Propriétaire et Évaluateur sont mutuellement exclusifs. Révoquez d'abord le rôle existant.";
  if (m.includes("permission") || m.includes("denied") || m.includes("not authorized"))
    return "Action non autorisée : rôle d'administrateur Risques requis.";
  if (m.includes("tenant")) return "Erreur de contexte tenant — rechargez la page.";
  if (m.includes("network") || m.includes("fetch")) return "Erreur réseau — réessayez.";
  return message || "Échec de l'opération.";
}

export function useAssignRiskRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: RiskRole; action: "grant" | "revoke"; reason?: string }) => {
      const { error } = await supabase.rpc("assign_risk_role" as never, {
        _target_user: input.target_user, _role: input.role,
        _action: input.action, _reason: input.reason ?? null,
      } as never);
      if (error) throw new Error(mapAssignmentError(error.message));
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["tenant-risk-roles"] });
      const prev = qc.getQueryData<Map<string, string[]>>(["tenant-risk-roles"]);
      if (prev instanceof Map) {
        const next = new Map(prev);
        const cur = next.get(vars.target_user) ?? [];
        if (vars.action === "grant" && !cur.includes(vars.role)) next.set(vars.target_user, [...cur, vars.role]);
        else if (vars.action === "revoke") next.set(vars.target_user, cur.filter((r) => r !== vars.role));
        qc.setQueryData(["tenant-risk-roles"], next);
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tenant-risk-roles"], ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.action === "grant" ? "Rôle Risque attribué" : "Rôle Risque révoqué");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tenant-risk-roles"] });
      qc.invalidateQueries({ queryKey: ["risk-role-audit"] });
      // Droits de l'utilisateur (my_access, V27) et matrice de /settings : le rôle y est recopié.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      qc.invalidateQueries({ queryKey: ["authorizations"] });
    },
  });
}
