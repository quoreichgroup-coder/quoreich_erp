import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId, fetchTenantId } from "@/hooks/use-tenant";

/* Contrôle budgétaire (V73) : budgets et lignes sous droit budget.manage ; cycle de vie par fonctions. */
const db = supabase as any;
const KEYS = ["budgets-v73", "budget-lines-v73", "budget-status", "budget-revisions", "budget-settings", "budgets", "budget-lines", "budget-monthly", "budget-alert-documents", "purchase-requisitions"];
const invalidate = (qc: ReturnType<typeof useQueryClient>) => { for (const k of KEYS) qc.invalidateQueries({ queryKey: [k] }); };

export type Budget = { id: string; name: string; fiscal_year: string; scenario: string; status: "draft" | "submitted" | "approved" | "closed"; is_control: boolean;
  total_amount: number; created_by: string; submitted_by: string | null; approved_by: string | null; approved_at: string | null };
export type BudgetLine = { id: string; budget_id: string; gl_account_id: string; period: string; planned_amount: number; analytic_value_id: string | null };
/** Situation d'une ligne du budget de contrôle (V77 : section analytique et pré-engagé des demandes d'achat). */
export type BudgetStatusRow = { line_id: string; account_code: string; account_name: string; period: string;
  analytic_value_id: string | null; analytic_code: string | null; analytic_name: string | null;
  planned: number; precommitted: number; committed: number; actual: number; available: number };
export type BudgetControlSettings = { control_mode: "off" | "warn" | "block"; control_level: "year" | "month"; precommit_requisitions: boolean;
  control_requisitions: boolean; analytic_control: boolean; alert_threshold_pct: number };
export const DEFAULT_BUDGET_SETTINGS: BudgetControlSettings = { control_mode: "off", control_level: "year", precommit_requisitions: true,
  control_requisitions: true, analytic_control: true, alert_threshold_pct: 90 };

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
      return (data ?? []).map((r: any) => ({ ...r, planned: Number(r.planned), precommitted: Number(r.precommitted ?? 0), committed: Number(r.committed),
        actual: Number(r.actual), available: Number(r.available) })) as BudgetStatusRow[];
    },
  });
}

export function useBudgetControlSettings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["budget-settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("budget_settings")
        .select("control_mode, control_level, precommit_requisitions, control_requisitions, analytic_control, alert_threshold_pct").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ? { ...data, alert_threshold_pct: Number(data.alert_threshold_pct) } : DEFAULT_BUDGET_SETTINGS) as BudgetControlSettings;
    },
  });
}

export function useSaveBudgetControlSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: Partial<BudgetControlSettings>) => {
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
    mutationFn: async (v: { id?: string; budget_id: string; gl_account_id: string; period: string; planned_amount: number; analytic_value_id?: string | null }) => {
      const fields = { gl_account_id: v.gl_account_id, period: v.period, planned_amount: v.planned_amount, analytic_value_id: v.analytic_value_id || null };
      const q = v.id ? db.from("budget_lines").update(fields).eq("id", v.id)
        : db.from("budget_lines").insert({ budget_id: v.budget_id, tenant_id: await fetchTenantId(), ...fields, actual_amount: 0 });
      const { data, error } = await q.select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Préparer les budgets » requis.");
    },
    onSuccess: () => { invalidate(qc); toast.success("Ligne de budget enregistrée"); },
    onError: (e: Error) => toast.error(/budget_lines_unique/.test(e.message) ? "Cette ligne (compte × période × section) existe déjà dans le budget" : e.message),
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
export const useBudgetOverrideDocument = () => useRpc((v: { docType: "PR" | "PO"; id: string; reason: string }) =>
  rpc("budget_override_document", { _doc_type: v.docType, _id: v.id, _reason: v.reason }), "Dépassement de budget autorisé : la pièce peut être soumise");

const isYear = (y: string) => /^\d{4}$/.test(y);

/** Réalisé mois par mois de chaque ligne du budget de contrôle (écran Prévisions). */
export function useBudgetMonthlyActual(year: string) {
  return useQuery({
    queryKey: ["budget-monthly", year],
    enabled: isYear(year),
    queryFn: async () => {
      const { data, error } = await db.rpc("budget_monthly_actual", { _fiscal_year: year });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ line_id: r.line_id as string, month: Number(r.month), actual: Number(r.actual) }));
    },
  });
}

export type BudgetAlertDocument = { docType: "PR" | "PO"; id: string; number: string; date: string; amount: number; status: string;
  warning: string; overrideReason: string | null; overrideAt: string | null };

/** Demandes et commandes de l'exercice passées en dépassement (mode avertissement ou dérogation). */
export function useBudgetAlertDocuments(year: string) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["budget-alert-documents", tenantId, year],
    enabled: !!tenantId && isYear(year),
    queryFn: async () => {
      const from = `${year}-01-01`, to = `${year}-12-31`;
      const [pr, po] = await Promise.all([
        db.from("purchase_requisitions").select("id, pr_number, request_date, estimated_total, status, budget_warning, budget_override_reason, budget_override_at")
          .eq("tenant_id", tenantId).not("budget_warning", "is", null).gte("request_date", from).lte("request_date", to),
        db.from("purchase_orders").select("id, po_number, order_date, total, status, budget_warning, budget_override_reason, budget_override_at")
          .eq("tenant_id", tenantId).not("budget_warning", "is", null).gte("order_date", from).lte("order_date", to),
      ]);
      if (pr.error) throw pr.error;
      if (po.error) throw po.error;
      const rows: BudgetAlertDocument[] = [
        ...(pr.data ?? []).map((d: any) => ({ docType: "PR" as const, id: d.id, number: d.pr_number, date: d.request_date, amount: Number(d.estimated_total), status: d.status,
          warning: d.budget_warning, overrideReason: d.budget_override_reason, overrideAt: d.budget_override_at })),
        ...(po.data ?? []).map((d: any) => ({ docType: "PO" as const, id: d.id, number: d.po_number, date: d.order_date, amount: Number(d.total), status: d.status,
          warning: d.budget_warning, overrideReason: d.budget_override_reason, overrideAt: d.budget_override_at })),
      ];
      return rows.sort((a, b) => b.date.localeCompare(a.date));
    },
  });
}

export type BudgetRevision = { id: string; created_at: string; reason: string; old_amount: number; new_amount: number; account: string; period: string; section: string | null };

/** Révisions des lignes des budgets de l'exercice. */
export function useBudgetRevisionsOfYear(year: string) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["budget-revisions", tenantId, year],
    enabled: !!tenantId && isYear(year),
    queryFn: async () => {
      const { data, error } = await db.from("budget_revisions")
        .select("id, created_at, reason, old_amount, new_amount, line:budget_lines!inner(period, budget:budgets!inner(fiscal_year), account:gl_accounts(code, name), section:analytic_values(code, name))")
        .eq("tenant_id", tenantId).eq("line.budget.fiscal_year", year).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.id, created_at: r.created_at, reason: r.reason, old_amount: Number(r.old_amount), new_amount: Number(r.new_amount),
        account: r.line?.account ? `${r.line.account.code} ${r.line.account.name}` : "", period: r.line?.period ?? "",
        section: r.line?.section ? `${r.line.section.code} ${r.line.section.name}` : null })) as BudgetRevision[];
    },
  });
}
