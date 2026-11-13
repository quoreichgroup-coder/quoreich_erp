import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useRiskRegister() {
  return useQuery({
    queryKey: ["risk-register"],
    queryFn: async () => {
      const { data, error } = await supabase.from("risk_register").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useRiskAssessments(riskId?: string) {
  return useQuery({
    queryKey: ["risk-assessments", riskId],
    queryFn: async () => {
      let q = supabase.from("risk_assessments").select("*");
      if (riskId) q = q.eq("risk_id", riskId);
      const { data, error } = await q.order("assessment_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useCreateRisk() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { risk_code: string; title: string; description?: string; category: string; likelihood?: number; impact?: number; owner?: string; mitigation_plan?: string }) => {
      const { error } = await supabase.from("risk_register").insert({ ...input, tenant_id: tenantId!, created_by: user!.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["risk-register"] }); toast.success("Risque créé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRiskKpis() {
  const { data: risks = [] } = useRiskRegister();
  const open = risks.filter(r => r.status === "open");
  const critical = risks.filter(r => Number(r.risk_score) >= 16);
  const high = risks.filter(r => Number(r.risk_score) >= 9 && Number(r.risk_score) < 16);
  const mitigated = risks.filter(r => r.status === "mitigated").length;

  return { risks, open, critical, high, mitigated };
}

// ---------- RBAC ----------
import { ALL_RISK_ROLES, type RiskPerms, type RiskRole } from "@/lib/risk-roles";

export function useMyRiskRoles(): RiskPerms {
  const { user } = useAuth();
  // Rôles de la société courante, dits par la base (my_access, V27) ; la base contrôle ce module
  // par has_role, d'où une logique encore par rôle.
  const roles = useMyAccess().data?.roles ?? [];
  const has = (r: RiskRole) => roles.includes(r);
  const admin = has("risk_admin") || roles.includes("admin");
  return {
    canCreate: admin || has("risk_owner"),
    canEdit: admin || has("risk_owner"),
    canAssess: admin || has("risk_assessor"),
    canApprove: admin,
    canClose: admin || has("risk_owner"),
    canManageSettings: admin,
    canExport: admin || has("risk_owner") || has("risk_assessor"),
    canViewSensitive: admin || has("risk_owner") || has("risk_assessor"),
  };
}

export function useTenantRiskRoles() {
  return useQuery({
    queryKey: ["tenant-risk-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles").select("user_id, role")
        .in("role", ALL_RISK_ROLES as unknown as never);
      if (error) throw error;
      const map = new Map<string, string[]>();
      (data ?? []).forEach((r: { user_id: string; role: string }) => {
        const list = map.get(r.user_id) ?? [];
        list.push(r.role); map.set(r.user_id, list);
      });
      return map;
    },
  });
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
      qc.invalidateQueries({ queryKey: ["my-risk-roles"] });
    },
  });
}
