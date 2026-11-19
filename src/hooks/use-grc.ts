import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantId, useTenantId } from "@/hooks/use-tenant";
import { useMyAccess } from "@/hooks/use-my-access";
import {
  DEFAULT_RISK_SETTINGS, type ControlStatus, type IssueStatus, type RiskLevel, type RiskSettings, type RiskStatus, type TestResult, type Treatment,
} from "@/lib/grc";

/*
 * Risques et conformité (V113) : registre, évaluations (risk_assess), statut (risk_set_status), actions, liens aux
 * contrôles ; référentiels, contrôles, tests (compliance_record_test), constats (compliance_issue_update). Les droits
 * viennent du catalogue (risks.*, compliance.*).
 */
const db = supabase as any;

export function useGrcPerms() {
  const p = useMyAccess().data?.permissions ?? [];
  const has = (c: string) => p.includes(c);
  return {
    risksManage: has("risks.manage"), risksAssess: has("risks.assess"), risksSettings: has("risks.settings"), risksExport: has("risks.export"),
    complianceManage: has("compliance.manage"), complianceTest: has("compliance.test"), complianceClose: has("compliance.close_issue"),
    complianceSettings: has("compliance.settings"), complianceExport: has("compliance.export"),
  };
}

const fail = (e: { message: string } | null) => {
  if (!e) return;
  throw new Error(/row-level security/i.test(e.message) ? "Droit insuffisant pour cette opération." : /duplicate key|unique/i.test(e.message) ? "Ce code existe déjà." : e.message);
};
const touched = (data: unknown[] | null, right: string) => { if (!data?.length) throw new Error(`Droit « ${right} » requis.`); };

function useInvalidate(keys: string[]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}
const RISK_KEYS = ["risks", "risk-assessments", "risk-actions", "risk-links", "risk-settings", "risk-categories"];
const COMPLIANCE_KEYS = ["compliance-frameworks", "compliance-controls", "compliance-tests", "compliance-issues", "compliance-settings", "risk-links"];

// ─── Risques ───

export interface Risk {
  id: string; risk_code: string; title: string; description: string | null; category: string; category_id: string | null; likelihood: number; impact: number;
  risk_score: number; residual_likelihood: number | null; residual_impact: number | null; residual_score: number | null; status: RiskStatus; treatment: Treatment | null;
  owner: string | null; mitigation_plan: string | null; review_date: string | null; last_assessed_at: string | null; status_reason: string | null; project_id: string | null;
  created_at: string;
}
export interface RiskAssessment { id: string; risk_id: string; assessment_date: string; assessor: string; likelihood: number; impact: number;
  residual_likelihood: number | null; residual_impact: number | null; notes: string | null; created_at: string }
export interface RiskAction { id: string; risk_id: string; title: string; owner: string | null; due_date: string | null; status: "open" | "done" | "cancelled"; done_at: string | null; notes: string | null }
export interface RiskCategory { id: string; code: string; name: string; is_active: boolean }

export function useRiskSettings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["risk-settings", tenantId], enabled: Boolean(tenantId),
    queryFn: async (): Promise<RiskSettings & { saved: boolean }> => {
      const { data, error } = await db.from("risk_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return data ? { ...data, saved: true } : { ...DEFAULT_RISK_SETTINGS, saved: false };
    },
  });
}

export function useSaveRiskSettings() {
  const inv = useInvalidate(RISK_KEYS);
  return useMutation({
    mutationFn: async (s: RiskSettings) => {
      const tenant_id = await fetchTenantId();
      const { data, error } = await db.from("risk_settings").upsert({ tenant_id, ...s, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("tenant_id");
      fail(error); touched(data, "risks.settings");
    },
    onSuccess: () => { inv(); toast.success("Paramètres enregistrés"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRiskCategories() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["risk-categories", tenantId], enabled: Boolean(tenantId),
    queryFn: async (): Promise<RiskCategory[]> => {
      const { data, error } = await db.from("risk_categories").select("*").eq("tenant_id", tenantId).order("code");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSaveRiskCategory() {
  const inv = useInvalidate(RISK_KEYS);
  return useMutation({
    mutationFn: async (c: Partial<RiskCategory> & { code: string; name: string }) => {
      const tenant_id = await fetchTenantId();
      const row = { code: c.code, name: c.name.trim(), is_active: c.is_active ?? true };
      const { data, error } = c.id ? await db.from("risk_categories").update(row).eq("id", c.id).select("id")
        : await db.from("risk_categories").insert({ tenant_id, ...row }).select("id");
      fail(error); touched(data, "risks.settings");
    },
    onSuccess: () => { inv(); toast.success("Catégorie enregistrée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRisks() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["risks", tenantId], enabled: Boolean(tenantId), retry: false,
    queryFn: async (): Promise<Risk[]> => {
      const { data, error } = await db.from("risk_register").select("*").eq("tenant_id", tenantId).order("risk_code");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSaveRisk() {
  const inv = useInvalidate(RISK_KEYS);
  return useMutation({
    mutationFn: async (r: Partial<Risk> & { title: string }) => {
      const row = { title: r.title.trim(), description: r.description || null, category: r.category || "—", category_id: r.category_id || null, owner: r.owner || null,
        mitigation_plan: r.mitigation_plan || null, review_date: r.review_date || null, project_id: r.project_id || null, treatment: r.treatment || null };
      if (r.id) {
        const { data, error } = await db.from("risk_register").update(row).eq("id", r.id).select("id");
        fail(error); touched(data, "risks.manage");
        return r.id;
      }
      const tenant_id = await fetchTenantId();
      const { data, error } = await db.from("risk_register").insert({ tenant_id, risk_code: r.risk_code, likelihood: r.likelihood ?? 1, impact: r.impact ?? 1, ...row })
        .select("id").single();
      fail(error);
      return data.id as string;
    },
    onSuccess: () => { inv(); toast.success("Risque enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAssessRisk() {
  const inv = useInvalidate(RISK_KEYS);
  return useMutation({
    mutationFn: async (v: { risk: string; likelihood: number; impact: number; residual_likelihood: number | null; residual_impact: number | null; notes: string }) => {
      const { error } = await db.rpc("risk_assess", { _risk: v.risk, _likelihood: v.likelihood, _impact: v.impact, _residual_likelihood: v.residual_likelihood,
        _residual_impact: v.residual_impact, _notes: v.notes || null });
      fail(error);
    },
    onSuccess: () => { inv(); toast.success("Évaluation enregistrée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSetRiskStatus() {
  const inv = useInvalidate(RISK_KEYS);
  return useMutation({
    mutationFn: async (v: { risk: string; status: RiskStatus; treatment?: Treatment | null; reason?: string }) => {
      const { error } = await db.rpc("risk_set_status", { _risk: v.risk, _status: v.status, _treatment: v.treatment ?? null, _reason: v.reason || null });
      fail(error);
    },
    onSuccess: () => { inv(); toast.success("Statut du risque modifié"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRiskAssessments(riskId?: string | null) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["risk-assessments", tenantId, riskId ?? "all"], enabled: Boolean(tenantId),
    queryFn: async (): Promise<RiskAssessment[]> => {
      let q = db.from("risk_assessments").select("*").eq("tenant_id", tenantId);
      if (riskId) q = q.eq("risk_id", riskId);
      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRiskActions() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["risk-actions", tenantId], enabled: Boolean(tenantId),
    queryFn: async (): Promise<RiskAction[]> => {
      const { data, error } = await db.from("risk_actions").select("*").eq("tenant_id", tenantId).order("due_date", { nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSaveRiskAction() {
  const inv = useInvalidate(RISK_KEYS);
  return useMutation({
    mutationFn: async (a: Partial<RiskAction> & { risk_id: string }) => {
      if (a.id) {
        const patch: Record<string, unknown> = { status: a.status };
        if (a.status === "done") patch.done_at = new Date().toISOString();
        const { data, error } = await db.from("risk_actions").update(patch).eq("id", a.id).select("id");
        fail(error); touched(data, "risks.manage");
        return;
      }
      const tenant_id = await fetchTenantId();
      const { data, error } = await db.from("risk_actions").insert({ tenant_id, risk_id: a.risk_id, title: a.title, owner: a.owner || null, due_date: a.due_date || null }).select("id");
      fail(error); touched(data, "risks.manage");
    },
    onSuccess: () => { inv(); toast.success("Action enregistrée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRiskControlLinks() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["risk-links", tenantId], enabled: Boolean(tenantId),
    queryFn: async (): Promise<{ risk_id: string; control_id: string }[]> => {
      const { data, error } = await db.from("risk_control_links").select("risk_id, control_id").eq("tenant_id", tenantId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLinkRiskControl() {
  const inv = useInvalidate(RISK_KEYS);
  return useMutation({
    mutationFn: async (v: { risk_id: string; control_id: string; remove?: boolean }) => {
      const tenant_id = await fetchTenantId();
      const { data, error } = v.remove
        ? await db.from("risk_control_links").delete().eq("risk_id", v.risk_id).eq("control_id", v.control_id).select("risk_id")
        : await db.from("risk_control_links").insert({ tenant_id, risk_id: v.risk_id, control_id: v.control_id }).select("risk_id");
      fail(error); touched(data, "risks.manage");
    },
    onSuccess: () => inv(),
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Conformité ───

export interface Framework { id: string; name: string; version: string | null; description: string | null; status: "active" | "archived"; total_controls: number; compliant_controls: number }
export interface Control { id: string; framework_id: string; control_code: string; title: string; description: string | null; category: string | null; owner: string | null;
  status: ControlStatus; last_tested_at: string | null; next_review_at: string | null; risk_level: RiskLevel | null; frequency: string | null; test_procedure: string | null; is_active: boolean }
export interface ControlTest { id: string; control_id: string; test_date: string; tester: string; result: TestResult; findings: number; notes: string | null; created_at: string }
export interface Issue { id: string; control_id: string; test_id: string | null; title: string; description: string | null; severity: RiskLevel; owner: string | null;
  due_date: string | null; status: IssueStatus; raised_by: string | null; closed_by: string | null; closed_at: string | null; closure_notes: string | null; created_at: string }

function useTenantList<T>(key: string, table: string, order: string) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: [key, tenantId], enabled: Boolean(tenantId), retry: false,
    queryFn: async (): Promise<T[]> => {
      const { data, error } = await db.from(table).select("*").eq("tenant_id", tenantId).order(order, { ascending: order === "created_at" || order === "test_date" ? false : true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
export const useFrameworks = () => useTenantList<Framework>("compliance-frameworks", "compliance_frameworks", "name");
export const useControls = () => useTenantList<Control>("compliance-controls", "compliance_controls", "control_code");
export const useControlTests = () => useTenantList<ControlTest>("compliance-tests", "compliance_test_logs", "test_date");
export const useIssues = () => useTenantList<Issue>("compliance-issues", "compliance_issues", "created_at");

export function useComplianceSettings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["compliance-settings", tenantId], enabled: Boolean(tenantId),
    queryFn: async (): Promise<{ issue_second_person: boolean }> => {
      const { data, error } = await db.from("compliance_settings").select("issue_second_person").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return data ?? { issue_second_person: true };
    },
  });
}

export function useSaveComplianceSettings() {
  const inv = useInvalidate(COMPLIANCE_KEYS);
  return useMutation({
    mutationFn: async (s: { issue_second_person: boolean }) => {
      const tenant_id = await fetchTenantId();
      const { data, error } = await db.from("compliance_settings").upsert({ tenant_id, ...s, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("tenant_id");
      fail(error); touched(data, "compliance.settings");
    },
    onSuccess: () => { inv(); toast.success("Paramètres enregistrés"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSaveFramework() {
  const inv = useInvalidate(COMPLIANCE_KEYS);
  return useMutation({
    mutationFn: async (f: Partial<Framework> & { name: string }) => {
      const row = { name: f.name.trim(), version: f.version || null, description: f.description || null, status: f.status ?? "active" };
      const tenant_id = await fetchTenantId();
      const { data, error } = f.id ? await db.from("compliance_frameworks").update(row).eq("id", f.id).select("id")
        : await db.from("compliance_frameworks").insert({ tenant_id, ...row }).select("id");
      fail(error); touched(data, "compliance.manage");
    },
    onSuccess: () => { inv(); toast.success("Référentiel enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSaveControl() {
  const inv = useInvalidate(COMPLIANCE_KEYS);
  return useMutation({
    mutationFn: async (c: Partial<Control> & { framework_id: string; control_code: string; title: string }) => {
      const row = { title: c.title.trim(), description: c.description || null, category: c.category || null, owner: c.owner || null, risk_level: c.risk_level || "medium",
        frequency: c.frequency || null, test_procedure: c.test_procedure || null, next_review_at: c.next_review_at || null, is_active: c.is_active ?? true };
      const { data, error } = c.id ? await db.from("compliance_controls").update(row).eq("id", c.id).select("id")
        : await db.from("compliance_controls").insert({ framework_id: c.framework_id, control_code: c.control_code.trim(), ...row }).select("id");
      fail(error); touched(data, "compliance.manage");
    },
    onSuccess: () => { inv(); toast.success("Contrôle enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRecordTest() {
  const inv = useInvalidate(COMPLIANCE_KEYS);
  return useMutation({
    mutationFn: async (v: { control: string; date: string; result: TestResult; findings: number; notes: string; issue_title?: string; issue_severity?: RiskLevel;
      issue_due?: string; issue_owner?: string }) => {
      const { error } = await db.rpc("compliance_record_test", { _control: v.control, _date: v.date, _result: v.result, _findings: v.findings, _notes: v.notes || null,
        _issue_title: v.issue_title || null, _issue_severity: v.issue_severity ?? "medium", _issue_due: v.issue_due || null, _issue_owner: v.issue_owner || null });
      fail(error);
    },
    onSuccess: () => { inv(); toast.success("Test enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateIssue() {
  const inv = useInvalidate(COMPLIANCE_KEYS);
  return useMutation({
    mutationFn: async (v: { issue: string; status: "in_progress" | "closed"; notes: string }) => {
      const { error } = await db.rpc("compliance_issue_update", { _issue: v.issue, _status: v.status, _notes: v.notes || null });
      fail(error);
    },
    onSuccess: (_d, v) => { inv(); toast.success(v.status === "closed" ? "Constat clôturé" : "Constat mis à jour"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
