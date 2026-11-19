import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantId, useTenantId } from "@/hooks/use-tenant";
import type { ExpenseStatus } from "@/lib/expenses";

/*
 * Notes de frais (V109). Lecture : la base ne renvoie que les notes de l'appelant, sauf droit
 * « expenses.view_all ». Écriture : brouillons et lignes directement (gardes de la base), tout le
 * reste par les fonctions expense_report_submit / decide / post / pay / cancel.
 */
const db = supabase as any;

export interface ExpenseLine {
  id?: string; line_no: number; expense_date: string; category_id: string | null; description: string; merchant: string | null;
  receipt_ref: string | null; amount: number; tax_code_id: string | null; net_amount?: number; tax_amount?: number; category?: string;
}
export interface ExpenseApproval { id: string; level_order: number; level_label: string; approver_label: string; sla_hours: number | null;
  status: string; decided_by: string | null; decided_at: string | null; comment: string | null; created_at: string }
export interface ExpenseReport {
  id: string; report_number: string; employee_id: string | null; purpose: string | null; period_start: string | null; period_end: string | null;
  currency: string; total: number; subtotal: number; tax_amount: number; status: ExpenseStatus; created_by: string | null; created_at: string;
  submitted_at: string | null; approved_at: string | null; posted_at: string | null; paid_at: string | null; rejection_reason: string | null;
  cancel_reason: string | null; notes: string | null; journal_entry_id: string | null; payment_journal_entry_id: string | null;
  employee?: { first_name: string; last_name: string; matricule: string } | null;
  lines: ExpenseLine[]; approvals: ExpenseApproval[];
  entry?: { piece_number: string } | null; payment_entry?: { piece_number: string } | null;
}
export interface ExpenseCategory {
  id: string; code: string; name: string; gl_account_id: string; default_tax_code_id: string | null;
  receipt_required_above: number | null; max_amount_per_line: number | null; is_active: boolean;
}
export interface ExpenseSettingsRow { receipt_required_above: number | null; max_report_amount: number | null; late_submission_days: number | null }

const num = (v: unknown) => (v == null ? null : Number(v));

export function useExpenseReports() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["expense-reports", tenantId],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async (): Promise<ExpenseReport[]> => {
      const all: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from("expense_reports")
          .select("*, employee:employees(first_name, last_name, matricule), lines:expense_lines!expense_lines_report_fkey(*), approvals:expense_report_approvals(*),"
            + " entry:journal_entries!expense_reports_journal_entry_id_fkey(piece_number), payment_entry:journal_entries!expense_reports_payment_journal_entry_id_fkey(piece_number)")
          .eq("tenant_id", tenantId).order("created_at", { ascending: false }).range(from, from + 999);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return all.map((r) => ({
        ...r, total: Number(r.total), subtotal: Number(r.subtotal), tax_amount: Number(r.tax_amount),
        lines: (r.lines ?? []).map((l: any) => ({ ...l, amount: Number(l.amount), net_amount: Number(l.net_amount), tax_amount: Number(l.tax_amount) }))
          .sort((a: ExpenseLine, b: ExpenseLine) => a.line_no - b.line_no),
        approvals: (r.approvals ?? []).sort((a: ExpenseApproval, b: ExpenseApproval) => a.level_order - b.level_order),
      }));
    },
  });
}

export function useExpenseCategories() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["expense-categories", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<ExpenseCategory[]> => {
      const { data, error } = await db.from("expense_categories").select("*").eq("tenant_id", tenantId).order("code");
      if (error) throw error;
      return (data ?? []).map((c: any) => ({ ...c, receipt_required_above: num(c.receipt_required_above), max_amount_per_line: num(c.max_amount_per_line) }));
    },
  });
}

export function useExpenseSettings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["expense-settings", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<ExpenseSettingsRow> => {
      const { data, error } = await db.from("expense_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return { receipt_required_above: num(data?.receipt_required_above), max_report_amount: num(data?.max_report_amount), late_submission_days: data?.late_submission_days ?? null };
    },
  });
}

export function useEmployeesForExpenses() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["expense-employees", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await db.from("employees").select("id, matricule, first_name, last_name, status").eq("tenant_id", tenantId).order("last_name");
      if (error) throw error;
      return (data ?? []) as { id: string; matricule: string; first_name: string; last_name: string; status: string }[];
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => { for (const k of ["expense-reports", "journal-entries", "gl-transactions", "treasury-movements", "bank-accounts"]) qc.invalidateQueries({ queryKey: [k] }); };
}

const refused = (e: { message: string }) => new Error(/row-level security/i.test(e.message) ? "Droit insuffisant pour cette note de frais." : e.message);

export interface ExpenseDraft {
  id?: string; employee_id: string; purpose: string; period_start: string | null; period_end: string | null; notes: string | null;
  lines: Omit<ExpenseLine, "id" | "net_amount" | "tax_amount">[];
}

/** Enregistre un brouillon (ou une note rejetée) : en-tête puis lignes remplacées. */
export function useSaveExpenseDraft() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (d: ExpenseDraft) => {
      const header = { employee_id: d.employee_id, purpose: d.purpose.trim() || null, period_start: d.period_start, period_end: d.period_end, notes: d.notes };
      let id = d.id;
      if (id) {
        const { data, error } = await db.from("expense_reports").update(header).eq("id", id).select("id");
        if (error) throw refused(error);
        if (!data?.length) throw new Error("Note introuvable ou non modifiable.");
        const del = await db.from("expense_lines").delete().eq("report_id", id);
        if (del.error) throw refused(del.error);
      } else {
        const tenant_id = await fetchTenantId();
        const { data, error } = await db.from("expense_reports").insert({ tenant_id, status: "draft", ...header }).select("id").single();
        if (error) throw refused(error);
        id = data.id;
      }
      if (d.lines.length) {
        const { error } = await db.from("expense_lines").insert(d.lines.map((l, i) => ({ ...l, report_id: id, line_no: i + 1 })));
        if (error) throw refused(error);
      }
      return id as string;
    },
    onSuccess: () => { invalidate(); toast.success("Note de frais enregistrée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteExpenseDraft() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await db.from("expense_reports").delete().eq("id", id).select("id");
      if (error) throw refused(error);
      if (!data?.length) throw new Error("Seul un brouillon se supprime.");
    },
    onSuccess: () => { invalidate(); toast.success("Brouillon supprimé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

function rpcMutation<V>(name: string, args: (v: V) => Record<string, unknown>, done: string) {
  return function useIt() {
    const invalidate = useInvalidate();
    return useMutation({
      mutationFn: async (v: V) => {
        const { data, error } = await db.rpc(name, args(v));
        if (error) throw error;
        return data;
      },
      onSuccess: () => { invalidate(); toast.success(done); },
      onError: (e: Error) => toast.error(e.message),
    });
  };
}
export const useSubmitExpense = rpcMutation<string>("expense_report_submit", (id) => ({ _id: id }), "Note soumise à l'approbation");
export const useDecideExpense = rpcMutation<{ approval: string; approve: boolean; comment?: string }>("expense_report_decide",
  (v) => ({ _approval: v.approval, _approve: v.approve, _comment: v.comment ?? null }), "Décision enregistrée");
export const usePostExpense = rpcMutation<{ id: string; date: string }>("expense_report_post", (v) => ({ _id: v.id, _date: v.date }), "Note comptabilisée");
export const usePayExpense = rpcMutation<{ id: string; date: string; method: string; bankAccountId: string | null; reference: string | null }>("expense_report_pay",
  (v) => ({ _id: v.id, _date: v.date, _payment_method: v.method, _bank_account_id: v.bankAccountId, _reference: v.reference }), "Note remboursée");
export const useCancelExpense = rpcMutation<{ id: string; reason: string }>("expense_report_cancel", (v) => ({ _id: v.id, _reason: v.reason }), "Note annulée");

export function useSaveExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Partial<ExpenseCategory> & { code: string; name: string; gl_account_id: string }) => {
      const tenant_id = await fetchTenantId();
      const row = { code: c.code, name: c.name, gl_account_id: c.gl_account_id, default_tax_code_id: c.default_tax_code_id || null,
        receipt_required_above: c.receipt_required_above ?? null, max_amount_per_line: c.max_amount_per_line ?? null, is_active: c.is_active ?? true };
      const { data, error } = c.id
        ? await db.from("expense_categories").update(row).eq("id", c.id).select("id")
        : await db.from("expense_categories").insert({ tenant_id, ...row }).select("id");
      if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? "Ce code de catégorie existe déjà." : error.message);
      if (!data?.length) throw new Error("Droit « expenses.settings » requis.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-categories"] }); toast.success("Catégorie enregistrée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSaveExpenseSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: ExpenseSettingsRow) => {
      const tenant_id = await fetchTenantId();
      const { data, error } = await db.from("expense_settings").upsert({ tenant_id, ...s, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("tenant_id");
      if (error) throw error;
      if (!data?.length) throw new Error("Droit « expenses.settings » requis.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-settings"] }); toast.success("Paramètres enregistrés"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
