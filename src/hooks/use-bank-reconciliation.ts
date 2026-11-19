import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { StatementLine } from "@/lib/bank-statement";
import { apiGet, apiPatch, apiPost, apiPut, isApiEnabled } from "@/api/client";

/* Relevés et rapprochement bancaire (V71) : écritures par fonctions, rapprochement manuel par la table. */
const db = supabase as any;
const KEYS = ["bank-statements-v71", "statement-lines-v71", "bank-reconciliations-v71", "bank-transactions", "treasury-accounts", "treasury-recon-status", "suggest-matches"];
const invalidate = (qc: ReturnType<typeof useQueryClient>) => { for (const k of KEYS) qc.invalidateQueries({ queryKey: [k] }); };

export type Statement = { id: string; period_start: string; period_end: string; opening_balance: number; closing_balance: number; file_name: string | null; status: string; created_at: string };
export type StatementRow = { id: string; line_no: number | null; line_date: string; description: string | null; amount: number; reference: string | null; matched_transaction_id: string | null };
export type Reconciliation = {
  id: string; period_start: string; period_end: string; book_balance: number; bank_balance: number; outstanding_receipts: number; outstanding_payments: number;
  unmatched_statement_lines: number; status: "draft" | "validated"; validated_at: string | null;
};

export function useStatements(account: string | null) {
  return useQuery({
    queryKey: ["bank-statements-v71", account],
    enabled: !!account,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<Statement[]>(`/api/v1/treasury/statements?accountId=${account}&status=imported`);
      const { data, error } = await db.from("bank_statements").select("*").eq("bank_account_id", account).eq("status", "imported").order("period_end", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Statement[];
    },
  });
}

export function useStatementRows(statement: string | null) {
  return useQuery({
    queryKey: ["statement-lines-v71", statement],
    enabled: !!statement,
    queryFn: async () => {
      const all: StatementRow[] = [];
      for (let from = 0; ; from += 1000) {
        if (isApiEnabled()) { all.push(...await apiGet<any[]>(`/api/v1/treasury/statements/${statement}/lines`)); break; }
        const { data, error } = await db.from("bank_statement_lines").select("id, line_no, line_date, description, amount, reference, matched_transaction_id")
          .eq("statement_id", statement).order("line_date").order("line_no").range(from, from + 999);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return all;
    },
  });
}

export function useReconciliationsFor(account: string | null) {
  return useQuery({
    queryKey: ["bank-reconciliations-v71", account],
    enabled: !!account,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<Reconciliation[]>(`/api/v1/treasury/reconciliations?accountId=${account}`);
      const { data, error } = await db.from("bank_reconciliations").select("*").eq("bank_account_id", account).order("period_end", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Reconciliation[];
    },
  });
}

const rpc = async (name: string, args: Record<string, unknown>) => {
  if (isApiEnabled()) return apiPost<any>(`/api/v1/treasury/actions/${name}`, args);
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
};
function useRpc<V>(fn: (v: V) => Promise<unknown>, ok: string | ((d: any) => string)) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (d) => { invalidate(qc); toast.success(typeof ok === "string" ? ok : ok(d)); }, onError: (e: Error) => toast.error(e.message) });
}

export const useImportStatement = () => useRpc((v: { account: string; fileName: string; from: string; to: string; opening: number; closing: number; lines: StatementLine[] }) =>
  rpc("import_bank_statement", { _account: v.account, _file_name: v.fileName, _period_start: v.from, _period_end: v.to, _opening: v.opening, _closing: v.closing, _lines: v.lines }),
  (d) => `Relevé importé : ${d?.lignes ?? 0} ligne(s), ${d?.rapprochees ?? 0} rapprochée(s) automatiquement`);
export const useAutoMatch = () => useRpc((statement: string) => rpc("auto_match_statement", { _statement: statement }), (n) => `${n} ligne(s) rapprochée(s)`);
export const useCancelStatement = () => useRpc((statement: string) => rpc("cancel_bank_statement", { _statement: statement }), "Relevé annulé");
export const usePostStatementLine = () => useRpc((v: { line: string; counter: string; label: string }) =>
  rpc("post_statement_line", { _line: v.line, _counter_account: v.counter, _description: v.label || null }), "Ligne comptabilisée et rapprochée");
export const usePrepareReconciliation = () => useRpc((v: { account: string; date: string }) => rpc("prepare_bank_reconciliation", { _account: v.account, _date: v.date }), "État de rapprochement calculé");
export const useValidateReconciliation = () => useRpc((id: string) => rpc("validate_bank_reconciliation", { _reconciliation: id }), "Rapprochement validé");

export function useSetMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { line: string; transaction: string | null }) => {
      if (isApiEnabled()) { await apiPatch(`/api/v1/treasury/statement-lines/${v.line}/match`, { transaction_id: v.transaction }); return; }
      const { data, error } = await db.from("bank_statement_lines").update({ matched_transaction_id: v.transaction }).eq("id", v.line).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Rapprocher les relevés » requis.");
    },
    onSuccess: (_d, v) => { invalidate(qc); toast.success(v.transaction ? "Ligne rapprochée" : "Rapprochement annulé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useMatchSuggestions(line: string | null) {
  return useQuery({
    queryKey: ["suggest-matches", line],
    enabled: !!line,
    queryFn: async () => (await rpc("suggest_bank_matches", { p_line_id: line })) as { transaction_id: string; transaction_date: string; description: string | null; amount: number; score: number }[],
  });
}
