import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { toast } from "sonner";

export function useComplianceFrameworks() {
  return useQuery({
    queryKey: ["compliance-frameworks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("compliance_frameworks").select("*").order("name");
      if (error) throw error;
      return data || [];
    },
  });
}

export function useComplianceControls(frameworkId?: string) {
  return useQuery({
    queryKey: ["compliance-controls", frameworkId],
    queryFn: async () => {
      let q = supabase.from("compliance_controls").select("*, framework:compliance_frameworks(name)");
      if (frameworkId) q = q.eq("framework_id", frameworkId);
      const { data, error } = await q.order("control_code");
      if (error) throw error;
      return data || [];
    },
  });
}

export function useComplianceTestLogs() {
  return useQuery({
    queryKey: ["compliance-test-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_test_logs")
        .select("*, control:compliance_controls(control_code, title, framework:compliance_frameworks(name))")
        .order("test_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useCreateComplianceFramework() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: { name: string; version?: string }) => {
      const { error } = await supabase.from("compliance_frameworks").insert({ ...input, tenant_id: tenantId! });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["compliance-frameworks"] }); toast.success("Référentiel créé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateComplianceControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { framework_id: string; control_code: string; title: string; description?: string; category?: string; owner?: string; risk_level?: string }) => {
      const { error } = await supabase.from("compliance_controls").insert(input);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["compliance-controls"] }); toast.success("Contrôle créé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useComplianceKpis() {
  const { data: frameworks = [] } = useComplianceFrameworks();
  const { data: controls = [] } = useComplianceControls();
  const compliant = controls.filter(c => c.status === "compliant").length;
  const nonCompliant = controls.filter(c => c.status === "non_compliant").length;
  const notTested = controls.filter(c => c.status === "not_tested").length;

  return { frameworks, controls, compliant, nonCompliant, notTested };
}

// ---------- RBAC ----------
import { useAuth as _useAuthC } from "@/contexts/AuthContext";
import {
  ALL_COMPLIANCE_ROLES, type CompliancePerms, type ComplianceRole,
} from "@/lib/compliance-roles";

export function useMyComplianceRoles(): CompliancePerms {
  const { user } = _useAuthC();
  // Rôles de la société courante, dits par la base (my_access, V27) ; la base contrôle ce module
  // par has_role, d'où une logique encore par rôle.
  const roles = useMyAccess().data?.roles ?? [];
  const has = (r: ComplianceRole) => roles.includes(r);
  const admin = has("compliance_admin") || roles.includes("admin");
  return {
    canCreate: admin || has("compliance_officer"),
    canEdit: admin || has("compliance_officer"),
    canRunTest: admin || has("compliance_officer"),
    canReviewTest: admin || has("compliance_auditor"),
    canManageFramework: admin,
    canManageSettings: admin,
    canExport: admin || has("compliance_auditor"),
    canViewSensitive: admin || has("compliance_officer") || has("compliance_auditor"),
  };
}

export function useTenantComplianceRoles() {
  return useQuery({
    queryKey: ["tenant-compliance-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles").select("user_id, role")
        .in("role", ALL_COMPLIANCE_ROLES as unknown as never);
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

export function useComplianceRoleAudit() {
  return useQuery({
    queryKey: ["compliance-role-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_role_audit" as never).select("*")
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
    return "Conflit de séparation des tâches : Officier et Auditeur sont mutuellement exclusifs. Révoquez d'abord le rôle existant.";
  if (m.includes("permission") || m.includes("denied") || m.includes("not authorized"))
    return "Action non autorisée : rôle d'administrateur Conformité requis.";
  if (m.includes("tenant")) return "Erreur de contexte tenant — rechargez la page.";
  if (m.includes("network") || m.includes("fetch")) return "Erreur réseau — réessayez.";
  return message || "Échec de l'opération.";
}

export function useAssignComplianceRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: ComplianceRole; action: "grant" | "revoke"; reason?: string }) => {
      const { error } = await supabase.rpc("assign_compliance_role" as never, {
        _target_user: input.target_user, _role: input.role,
        _action: input.action, _reason: input.reason ?? null,
      } as never);
      if (error) throw new Error(mapAssignmentError(error.message));
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["tenant-compliance-roles"] });
      const prev = qc.getQueryData<Map<string, string[]>>(["tenant-compliance-roles"]);
      if (prev instanceof Map) {
        const next = new Map(prev);
        const cur = next.get(vars.target_user) ?? [];
        if (vars.action === "grant" && !cur.includes(vars.role)) next.set(vars.target_user, [...cur, vars.role]);
        else if (vars.action === "revoke") next.set(vars.target_user, cur.filter((r) => r !== vars.role));
        qc.setQueryData(["tenant-compliance-roles"], next);
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tenant-compliance-roles"], ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.action === "grant" ? "Rôle Conformité attribué" : "Rôle Conformité révoqué");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tenant-compliance-roles"] });
      qc.invalidateQueries({ queryKey: ["compliance-role-audit"] });
      qc.invalidateQueries({ queryKey: ["my-compliance-roles"] });
    },
  });
}
