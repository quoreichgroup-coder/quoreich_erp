import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantId, useTenantId } from "@/hooks/use-tenant";
import type { ProjectFigures, ProjectStatus } from "@/lib/projects";

/*
 * Projets (V111) : fiches, budget par compte, chiffres (project_financials) et grand livre du projet
 * (project_ledger), lus dans la comptabilité ; statut par project_set_status.
 */
const db = supabase as any;

export interface Project extends ProjectFigures {
  id: string; project_code: string; name: string; status: ProjectStatus; description: string | null; customer_id: string | null;
  project_manager: string | null; department: string | null; start_date: string | null; end_date: string | null; completion_pct: number | null;
  analytic_value_id: string | null; status_reason: string | null; customer?: { name: string } | null;
}
export interface ProjectBudgetLine { id: string; project_id: string; gl_account_id: string; amount: number; description: string | null }
export interface ProjectLedgerRow { entry_id: string; piece_number: string; entry_date: string; journal_code: string; source: string; account_code: string;
  account_name: string; account_type: string; description: string; debit: number; credit: number }

export function useProjectSettings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["project-settings", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await db.from("project_settings").select("project_axis_id, include_requisitions_in_commitments").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as { project_axis_id: string; include_requisitions_in_commitments: boolean } | null;
    },
  });
}

export function useSaveProjectSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: { project_axis_id: string; include_requisitions_in_commitments: boolean }) => {
      const tenant_id = await fetchTenantId();
      const { data, error } = await db.from("project_settings").upsert({ tenant_id, ...s, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("tenant_id");
      if (error) throw error;
      if (!data?.length) throw new Error("Droit « projects.settings » requis.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project-settings"] }); toast.success("Paramètres enregistrés"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useProjects() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["projects", tenantId],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async (): Promise<Project[]> => {
      const [p, f] = await Promise.all([
        db.from("projects").select("*, customer:customers(name)").eq("tenant_id", tenantId).order("project_code"),
        db.rpc("project_financials", { _from: null, _to: null }),
      ]);
      if (p.error) throw p.error;
      if (f.error) throw f.error;
      const fig = new Map<string, any>((f.data ?? []).map((r: any) => [r.project_id, r]));
      return (p.data ?? []).map((r: any) => {
        const x = fig.get(r.id) ?? {};
        return { ...r, budget_costs: Number(x.budget_costs ?? 0), budget_revenue: Number(x.budget_revenue ?? 0), actual_costs: Number(x.actual_costs ?? 0),
          actual_revenue: Number(x.actual_revenue ?? 0), committed: Number(x.committed ?? 0) };
      });
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => { for (const k of ["projects", "project-budget", "project-ledger", "analytics-setup"]) qc.invalidateQueries({ queryKey: [k] }); };
}

export function useSaveProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (v: Partial<Project> & { project_code: string; name: string }) => {
      const row = { name: v.name.trim(), description: v.description ?? null, customer_id: v.customer_id || null, project_manager: v.project_manager ?? null,
        department: v.department ?? null, start_date: v.start_date || null, end_date: v.end_date || null, completion_pct: v.completion_pct ?? 0 };
      if (v.id) {
        const { data, error } = await db.from("projects").update(row).eq("id", v.id).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("Droit « projects.manage » requis.");
        return v.id;
      }
      const tenant_id = await fetchTenantId();
      const { data, error } = await db.from("projects").insert({ tenant_id, project_code: v.project_code, status: v.status ?? "planned", ...row }).select("id").single();
      if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? "Ce code de projet existe déjà (ou une section porte déjà ce code)." : /row-level security/i.test(error.message) ? "Droit « projects.manage » requis." : error.message);
      return data.id as string;
    },
    onSuccess: () => { invalidate(); toast.success("Projet enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSetProjectStatus() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (v: { id: string; status: ProjectStatus; reason?: string }) => {
      const { error } = await db.rpc("project_set_status", { _project: v.id, _status: v.status, _reason: v.reason ?? null });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Statut du projet modifié"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useProjectBudget(projectId: string | null) {
  return useQuery({
    queryKey: ["project-budget", projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectBudgetLine[]> => {
      const { data, error } = await db.from("project_budget_lines").select("*").eq("project_id", projectId);
      if (error) throw error;
      return (data ?? []).map((l: any) => ({ ...l, amount: Number(l.amount) }));
    },
  });
}

export function useSaveProjectBudgetLine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (v: { id?: string; project_id: string; gl_account_id: string; amount: number; description?: string | null; remove?: boolean }) => {
      if (v.remove && v.id) {
        const { data, error } = await db.from("project_budget_lines").delete().eq("id", v.id).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("Droit « projects.budget » requis.");
        return;
      }
      const tenant_id = await fetchTenantId();
      const row = { gl_account_id: v.gl_account_id, amount: v.amount, description: v.description ?? null };
      const { data, error } = v.id
        ? await db.from("project_budget_lines").update(row).eq("id", v.id).select("id")
        : await db.from("project_budget_lines").insert({ tenant_id, project_id: v.project_id, ...row }).select("id");
      if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? "Ce compte figure déjà au budget du projet." : error.message);
      if (!data?.length) throw new Error("Droit « projects.budget » requis.");
    },
    onSuccess: () => { invalidate(); toast.success("Budget du projet enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useProjectLedger(projectId: string | null) {
  return useQuery({
    queryKey: ["project-ledger", projectId],
    enabled: Boolean(projectId),
    retry: false,
    queryFn: async (): Promise<ProjectLedgerRow[]> => {
      const { data, error } = await db.rpc("project_ledger", { _project: projectId });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
    },
  });
}
