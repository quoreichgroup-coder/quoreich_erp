import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ModuleName } from "@/lib/module-manager";

// ─── Types ───

export interface WorkflowCondition {
  field: string;
  operator: ">" | "<" | ">=" | "<=" | "==" | "!=" | "in";
  value: string | number;
}

export interface WorkflowApprover {
  role: string;
  name: string;
  substitute?: { name: string; from: string; to: string };
}

export interface WorkflowEscalation {
  afterHours: number;
  escalateTo: string;
}

export interface WorkflowRuleRow {
  id: string;
  tenant_id: string;
  name: string;
  module: string;
  event_type: string;
  conditions: WorkflowCondition[];
  combinator: "AND" | "OR";
  approvers: WorkflowApprover[];
  escalation: WorkflowEscalation | null;
  sla_hours: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowInstanceRow {
  id: string;
  tenant_id: string;
  rule_id: string;
  reference_type: string;
  reference_id: string | null;
  status: string;
  current_step: number;
  started_at: string;
  completed_at: string | null;
  decided_by: string | null;
  notes: string | null;
  created_at: string;
}

// ─── Hooks ───

export function useWorkflowRules() {
  return useQuery({
    queryKey: ["workflow-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_rules")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map((row: any) => ({
        ...row,
        conditions: (row.conditions || []) as WorkflowCondition[],
        approvers: (row.approvers || []) as WorkflowApprover[],
        escalation: row.escalation as WorkflowEscalation | null,
      })) as WorkflowRuleRow[];
    },
  });
}

export function useWorkflowInstances(ruleId?: string) {
  return useQuery({
    queryKey: ["workflow-instances", ruleId],
    queryFn: async () => {
      let query = supabase
        .from("workflow_instances")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (ruleId) query = query.eq("rule_id", ruleId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as WorkflowInstanceRow[];
    },
  });
}

export function useCreateWorkflowRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: {
      name: string;
      module: string;
      event_type: string;
      conditions: WorkflowCondition[];
      combinator: "AND" | "OR";
      approvers: WorkflowApprover[];
      escalation?: WorkflowEscalation;
      sla_hours: number;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const tenantId = (await supabase.rpc("get_user_tenant_id", { _user_id: user!.id })).data!;

      const { error } = await supabase.from("workflow_rules").insert({
        tenant_id: tenantId,
        name: rule.name,
        module: rule.module,
        event_type: rule.event_type,
        conditions: rule.conditions as any,
        combinator: rule.combinator,
        approvers: rule.approvers as any,
        escalation: rule.escalation as any || null,
        sla_hours: rule.sla_hours,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflow-rules"] }),
  });
}

export function useToggleWorkflowRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ruleId, isActive }: { ruleId: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("workflow_rules")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq("id", ruleId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflow-rules"] }),
  });
}

// ─── Simulation (pure function, works with DB or mock data) ───

export function simulateWorkflowRules(
  rules: WorkflowRuleRow[],
  input: { module: string; amount: number; currency: string; department?: string }
) {
  const activeRules = rules.filter(r => r.is_active && r.module === input.module);

  const matchedRules = activeRules.filter(rule => {
    const results = rule.conditions.map(cond => {
      const fieldValue = (input as any)[cond.field];
      if (fieldValue === undefined) return true;
      switch (cond.operator) {
        case ">": return fieldValue > cond.value;
        case "<": return fieldValue < cond.value;
        case ">=": return fieldValue >= cond.value;
        case "<=": return fieldValue <= cond.value;
        case "==": return String(fieldValue) === String(cond.value);
        case "!=": return String(fieldValue) !== String(cond.value);
        default: return false;
      }
    });
    return rule.combinator === "AND" ? results.every(Boolean) : results.some(Boolean);
  });

  const requiredApprovers = matchedRules.flatMap(r => r.approvers);
  const uniqueApprovers = requiredApprovers.filter((a, i, arr) => arr.findIndex(b => b.role === a.role) === i);
  const estimatedSLA = matchedRules.length > 0 ? Math.max(...matchedRules.map(r => r.sla_hours)) : 0;

  return {
    matchedRules,
    requiredApprovers: uniqueApprovers,
    estimatedSLA,
    escalationRisk: matchedRules.some(r => r.escalation !== null),
  };
}
