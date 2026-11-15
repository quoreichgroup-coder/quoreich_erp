import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId, fetchTenantId } from "@/hooks/use-tenant";

/* Contrôle budgétaire (V73) : budgets et lignes sous droit budget.manage ; cycle de vie par fonctions. */
const db = supabase as any;
const KEYS = ["budgets-v73", "budget-lines-v73", "budget-status", "budget-revisions", "budget-settings", "budgets", "budget-lines"];
const invalidate = (qc: ReturnType<typeof useQueryClient>) => { for (const k of KEYS) qc.invalidateQueries({ queryKey: [k] }); };

export type Budget = { id: string; name: string; fiscal_year: string; scenario: string; status: "draft" | "submitted" | "approved" | "closed"; is_control: boolean;
  total_amount: number; created_by: string; submitted_by: string | null; approved_by: string | null; approved_at: string | null };
export type BudgetLine = { id: string; budget_id: string; gl_account_id: string; period: string; planned_amount: number; analytic_value_id: string | null };
export type BudgetStatusRow = { line_id: string; account_code: string; account_name: string; period: string; planned: number; committed: number; actual: number; available: number };

export function useBudgetList() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["budgets-v73", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("budgets").select("*").eq("tenant_id", tenantId).order("fiscal_year", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((b: any) => ({ ...b, total_amount: Number(b.total_amount) })) as Budget[];
    },
  });
}

export function useBudgetLinesOf(budgetId: string | null) {
  return useQuery({
    queryKey: ["budget-lines-v73", budgetId],
    enabled: !!budgetId,
    queryFn: async () => {
      const { data, error } = await db.from("budget_lines").select("id, budget_id, gl_account_id, period, planned_amount, analytic_value_id").eq("budget_id", budgetId).order("period");
      if (error) throw error;
      return (data ?? []).map((l: any) => ({ ...l, planned_amount: Number(l.planned_amount) })) as BudgetLine[];
    },
  });
}

export function useBudgetStatus(year: string) {
  return useQuery({
    queryKey: ["budget-status", year],
    queryFn: async () => {
      const { data, error } = await db.rpc("budget_status", { _fiscal_year: year });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, planned: Number(r.planned), committed: Number(r.committed), actual: Number(r.actual), available: Number(r.available) })) as BudgetStatusRow[];
    },
  });
}

export function useBudgetControlSettings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["budget-settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("budget_settings").select("control_mode, control_level").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? { control_mode: "off", control_level: "year" }) as { control_mode: "off" | "warn" | "block"; control_level: "year" | "month" };
    },
  });
}

export function useSaveBudgetControlSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { control_mode: string; control_level: string }) => {
      const tenantId = await fetchTenantId();
      const { data, error } = await db.from("budget_settings").upsert({ tenant_id: tenantId, ...v, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("tenant_id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Modifier les paramètres du contrôle budgétaire » requis.");
    },
    onSuccess: () => { invalidate(qc); toast.success("Paramètres du contrôle budgétaire enregistrés"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateBudgetV73() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { name: string; fiscal_year: string }) => {
      const tenantId = await fetchTenantId();
      const { data, error } = await db.from("budgets").insert({ tenant_id: tenantId, name: v.name, fiscal_year: v.fiscal_year, scenario: "base", total_amount: 0, status: "draft", created_by: (await supabase.auth.getUser()).data.user?.id })
        .select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => { invalidate(qc); toast.success("Budget créé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSaveBudgetLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id?: string; budget_id: string; gl_account_id: string; period: string; planned_amount: number }) => {
      const q = v.id ? db.from("budget_lines").update({ gl_account_id: v.gl_account_id, period: v.period, planned_amount: v.planned_amount }).eq("id", v.id)
        : db.from("budget_lines").insert({ budget_id: v.budget_id, gl_account_id: v.gl_account_id, period: v.period, planned_amount: v.planned_amount, actual_amount: 0 });
      const { data, error } = await q.select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Préparer les budgets » requis.");
    },
    onSuccess: () => { invalidate(qc); toast.success("Ligne de budget enregistrée"); },
    onError: (e: Error) => toast.error(/budget_lines_unique/.test(e.message) ? "Cette ligne (compte × période) existe déjà dans le budget" : e.message),
  });
}

export function useDeleteBudgetLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await db.from("budget_lines").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Préparer les budgets » requis.");
    },
    onSuccess: () => { invalidate(qc); toast.success("Ligne supprimée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

const rpc = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
};
function useRpc<V>(fn: (v: V) => Promise<unknown>, ok: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { invalidate(qc); qc.invalidateQueries({ queryKey: ["purchase-orders"] }); toast.success(ok); }, onError: (e: Error) => toast.error(e.message) });
}
export const useBudgetSubmit = () => useRpc((id: string) => rpc("budget_submit", { _budget: id }), "Budget soumis à approbation");
export const useBudgetApprove = () => useRpc((id: string) => rpc("budget_approve", { _budget: id, _control: true }), "Budget approuvé : budget de contrôle de l'exercice");
export const useBudgetReject = () => useRpc((v: { id: string; reason: string }) => rpc("budget_reject", { _budget: v.id, _reason: v.reason }), "Budget renvoyé en brouillon");
export const useBudgetClose = () => useRpc((id: string) => rpc("budget_close", { _budget: id }), "Budget clos");
export const useBudgetReviseLine = () => useRpc((v: { line: string; amount: number; reason: string }) => rpc("budget_revise_line", { _line: v.line, _amount: v.amount, _reason: v.reason }), "Ligne révisée");
export const useBudgetOverridePO = () => useRpc((v: { po: string; reason: string }) => rpc("budget_override_po", { _po: v.po, _reason: v.reason }), "Dépassement de budget autorisé : la commande peut être soumise");
