import { useMemo } from "react";
import { treasuryPermsFromCodes } from "@/lib/treasury-roles";
import { moduleCan, useMyAccess } from "@/hooks/use-my-access";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { computeTreasuryPerms, permsCacheKey, type TreasuryPerms, type TreasuryRole } from "@/lib/treasury-roles";
import { useTenantRoleMembers } from "@/hooks/use-role-members";

export function useBankAccounts() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["bank-accounts", tenantId],
    enabled: !!tenantId,
    retry: false,
    queryFn: async () => {
      if (!tenantId) throw new Error("Aucune société sélectionnée");
      const { data, error } = await supabase.from("bank_accounts").select("*").eq("tenant_id", tenantId).order("name");
      if (error) throw error;
      return data || [];
    },
  });
}

export function useBankTransactions(accountId?: string) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["bank-transactions", tenantId, accountId],
    enabled: !!tenantId,
    retry: false,
    queryFn: async () => {
      if (!tenantId) throw new Error("Aucune société sélectionnée");
      const fetchPage = async (offset: number) => {
        let q = supabase.from("bank_transactions").select("*, bank_account:bank_accounts(name)").eq("tenant_id", tenantId);
        if (accountId) q = q.eq("bank_account_id", accountId);
        const { data, error } = await q.order("transaction_date", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 499);
        if (error) throw error;
        return data ?? [];
      };
      const rows = await fetchPage(0);
      let pageSize = rows.length;
      while (pageSize === 500) {
        const page = await fetchPage(rows.length);
        rows.push(...page);
        pageSize = page.length;
      }
      return rows;
    },
  });
}

export function useCreateBankAccount() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: { name: string; bank_name: string; account_number?: string; currency?: string; balance?: number; account_type?: string }) => {
      const { error } = await supabase.from("bank_accounts").insert({ ...input, tenant_id: tenantId! });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank-accounts"] }); toast.success("Compte bancaire créé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateBankTransaction() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: { bank_account_id: string; transaction_date?: string; description?: string; amount: number; transaction_type: string; reference?: string }) => {
      const { error } = await supabase.from("bank_transactions").insert({ ...input, tenant_id: tenantId! });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank-transactions"] }); toast.success("Transaction enregistrée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ============ Treasury 2.0 ============ */

export function useCashPosition() {
  return useQuery({
    queryKey: ["treasury-cash-position"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treasury_cash_position_view" as never)
        .select("*");
      if (error) throw error;
      return (data ?? []) as Array<{
        bank_account_id: string; name: string; bank_name: string | null; currency: string;
        current_balance: number; net_7d: number; net_30d: number; last_reconciled_at: string | null;
      }>;
    },
  });
}

export function useReconciliationStatus() {
  return useQuery({
    queryKey: ["treasury-recon-status"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treasury_reconciliation_status_view" as never)
        .select("*");
      if (error) throw error;
      return (data ?? []) as Array<{
        bank_account_id: string; name: string; unreconciled_count: number; total_count: number;
        reconciled_pct: number; oldest_unreconciled_days: number | null; last_reconciled_at: string | null;
      }>;
    },
  });
}

export function useCashflowForecast13w() {
  return useQuery({
    queryKey: ["treasury-13w-forecast"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treasury_13w_forecast_view" as never)
        .select("*")
        .order("week_index");
      if (error) throw error;
      return (data ?? []) as Array<{
        week_start: string; week_index: number;
        inflow_ar: number; inflow_manual: number; outflow_ap: number; outflow_manual: number; net_flow: number;
      }>;
    },
  });
}

export function useBankStatements(accountId?: string) {
  return useQuery({
    queryKey: ["bank-statements", accountId],
    queryFn: async () => {
      let q = supabase.from("bank_statements" as never).select("*");
      if (accountId) q = (q as any).eq("bank_account_id", accountId);
      const { data, error } = await (q as any).order("statement_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; bank_account_id: string; statement_date: string; period_start: string; period_end: string;
        opening_balance: number; closing_balance: number; file_name: string | null; status: string;
      }>;
    },
  });
}

export function useStatementLines(statementId: string | null) {
  return useQuery({
    queryKey: ["statement-lines", statementId],
    enabled: !!statementId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_statement_lines" as never)
        .select("*")
        .eq("statement_id", statementId!)
        .order("line_date");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; statement_id: string; line_date: string; description: string | null;
        amount: number; reference: string | null; matched_transaction_id: string | null;
      }>;
    },
  });
}

export function useMatchLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ lineId, transactionId }: { lineId: string; transactionId: string | null }) => {
      const { error } = await (supabase
        .from("bank_statement_lines" as never) as any)
        .update({ matched_transaction_id: transactionId })
        .eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["statement-lines"] });
      qc.invalidateQueries({ queryKey: ["bank-transactions"] });
      qc.invalidateQueries({ queryKey: ["treasury-recon-status"] });
      toast.success("Rapprochement mis à jour");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSuggestMatches(lineId: string | null) {
  return useQuery({
    queryKey: ["suggest-matches", lineId],
    enabled: !!lineId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("suggest_bank_matches" as never, { p_line_id: lineId } as never);
      if (error) throw error;
      return (data ?? []) as Array<{
        transaction_id: string; transaction_date: string; description: string | null; amount: number; score: number;
      }>;
    },
  });
}

export function useReconciliations() {
  return useQuery({
    queryKey: ["bank-reconciliations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_reconciliations" as never)
        .select("*")
        .order("period_end", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; bank_account_id: string; period_start: string; period_end: string;
        book_balance: number; bank_balance: number; difference: number; status: string;
        validated_at: string | null;
      }>;
    },
  });
}

export function useCashflowForecastRows() {
  return useQuery({
    queryKey: ["cashflow-forecasts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cashflow_forecasts" as never)
        .select("*")
        .order("week_start");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; week_start: string; bank_account_id: string | null; category: string;
        direction: "inflow" | "outflow"; amount_forecast: number; amount_actual: number; source: string; notes: string | null;
      }>;
    },
  });
}

export function useUpsertCashflowForecast() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: {
      id?: string; week_start: string; category: string; direction: "inflow" | "outflow";
      amount_forecast: number; bank_account_id?: string | null; source?: string; notes?: string | null;
    }) => {
      const payload = { ...input, tenant_id: tenantId! };
      const table = supabase.from("cashflow_forecasts" as never) as any;
      if (input.id) {
        const { error } = await table.update(payload).eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await table.insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cashflow-forecasts"] });
      qc.invalidateQueries({ queryKey: ["treasury-13w-forecast"] });
      toast.success("Prévision enregistrée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ===== Treasury RBAC ===== */

const TREASURY_ROLES: TreasuryRole[] = ["treasury_clerk", "treasury_manager", "treasury_controller", "cash_admin"];

export function useMyTreasuryRoles(): TreasuryPerms {
  // Droits dits par la base (my_access, V27), dans la société courante : rôles sur mesure
  // compris, et admin inclus (l'ancien calcul par rôle l'ignorait, la base lui donne tout).
  const { data: access } = useMyAccess();
  const codes = access?.permissions ?? [];
  const key = useMemo(() => permsCacheKey(codes.filter((c) => c.startsWith("treasury."))), [codes]);
  return useMemo<TreasuryPerms>(() => treasuryPermsFromCodes(codes), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useTenantTreasuryRoles() {
  return useTenantRoleMembers("tenant-treasury-roles", TREASURY_ROLES);
}

export function useAssignTreasuryRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: TreasuryRole; action: "assign" | "revoke"; comment?: string }) => {
      const { error } = await supabase.rpc("assign_treasury_role" as never, {
        p_target_user: input.target_user,
        p_role: input.role,
        p_action: input.action,
        p_comment: input.comment ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["tenant-treasury-roles"] });
      qc.invalidateQueries({ queryKey: ["treasury-role-audit"] });
      // Droits de l'utilisateur (my_access, V27) et matrice de /settings : le rôle y est recopié.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      qc.invalidateQueries({ queryKey: ["authorizations"] });
      toast.success(vars.action === "assign" ? "Rôle attribué" : "Rôle révoqué");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useTreasuryRoleAudit() {
  return useQuery({
    queryKey: ["treasury-role-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treasury_role_audit" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; created_at: string; actor_id: string; target_user_id: string;
        role: string; action: string; comment: string | null;
      }>;
    },
  });
}

/* ===== KPIs ===== */

export function useTreasuryKpis() {
  const { data: accounts = [] } = useBankAccounts();
  const { data: txns = [] } = useBankTransactions();
  const { data: position = [] } = useCashPosition();
  const { data: forecast = [] } = useCashflowForecast13w();

  const totalCash = accounts.reduce((s, a) => s + Number(a.balance), 0);
  const activeAccounts = accounts.filter(a => a.is_active).length;
  const unreconciledCount = txns.filter(t => !t.is_reconciled).length;
  const net30d = position.reduce((s, p) => s + Number(p.net_30d || 0), 0);
  const net7d = position.reduce((s, p) => s + Number(p.net_7d || 0), 0);
  const burnRate30 = net30d < 0 ? Math.abs(net30d) : 0;
  const runwayWeeks = burnRate30 > 0 ? Math.round((totalCash / (burnRate30 / 4)) * 10) / 10 : null;
  const forecastNet13w = forecast.reduce((s, w) => s + Number(w.net_flow || 0), 0);

  return { accounts, txns, totalCash, activeAccounts, unreconciledCount, net7d, net30d, burnRate30, runwayWeeks, forecastNet13w };
}
