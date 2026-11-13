import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantId } from "@/hooks/use-tenant";
import { toast } from "sonner";

export interface GLAccount {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_active: boolean;
  parent_id: string | null;
  tenant_id: string;
  created_at: string;
}

export interface AccountWithBalance extends GLAccount {
  debit_total: number;
  credit_total: number;
  balance: number;
  children: AccountWithBalance[];
}

/** Fetch all GL accounts for the tenant */
export function useGLAccounts() {
  return useQuery({
    queryKey: ["gl-accounts-full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gl_accounts")
        .select("*")
        .order("code");
      if (error) throw error;
      return (data || []) as GLAccount[];
    },
  });
}

/** Fetch account balances from journal_lines (only posted entries) */
export function useAccountBalances() {
  return useQuery({
    queryKey: ["account-balances"],
    queryFn: async () => {
      // Get all journal lines from posted entries
      const { data, error } = await supabase
        .from("journal_lines")
        .select("account_id, debit, credit, entry_id, entry:journal_entries!inner(status)");
      if (error) throw error;

      const balances: Record<string, { debit: number; credit: number }> = {};
      for (const line of data || []) {
        // Only count posted entries
        const entry = line.entry as any;
        if (entry?.status !== "posted") continue;
        if (!balances[line.account_id]) balances[line.account_id] = { debit: 0, credit: 0 };
        balances[line.account_id].debit += Number(line.debit) || 0;
        balances[line.account_id].credit += Number(line.credit) || 0;
      }
      return balances;
    },
  });
}

/** Build hierarchical account tree with balances */
export function buildAccountTree(accounts: GLAccount[], balances: Record<string, { debit: number; credit: number }>): AccountWithBalance[] {
  const map = new Map<string, AccountWithBalance>();

  // Create nodes
  for (const a of accounts) {
    const b = balances[a.id] || { debit: 0, credit: 0 };
    map.set(a.id, {
      ...a,
      debit_total: b.debit,
      credit_total: b.credit,
      balance: b.debit - b.credit,
      children: [],
    });
  }

  // Build tree
  const roots: AccountWithBalance[] = [];
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots.sort((a, b) => a.code.localeCompare(b.code));
}

/** Categorize accounts by type prefix */
export function categorizeAccounts(accounts: AccountWithBalance[]) {
  const categories: { category: string; icon: string; accounts: AccountWithBalance[] }[] = [
    { category: "Assets", icon: "📦", accounts: [] },
    { category: "Liabilities", icon: "📋", accounts: [] },
    { category: "Equity", icon: "🏛️", accounts: [] },
    { category: "Revenue", icon: "📈", accounts: [] },
    { category: "Expenses", icon: "💳", accounts: [] },
  ];

  const typeMap: Record<string, number> = {
    asset: 0, "current asset": 0, "non-current": 0,
    liability: 1, "current liability": 1, "non-current liability": 1,
    equity: 2,
    revenue: 3, "operating revenue": 3, "other revenue": 3,
    expense: 4, "operating expense": 4, "other expense": 4,
  };

  for (const a of accounts) {
    const idx = typeMap[a.account_type.toLowerCase()] ?? (
      a.code.startsWith("1") ? 0 :
      a.code.startsWith("2") ? 1 :
      a.code.startsWith("3") ? 2 :
      a.code.startsWith("4") ? 3 : 4
    );
    categories[idx].accounts.push(a);
  }

  return categories.filter(c => c.accounts.length > 0);
}

/** Create a new GL account */
export function useCreateGLAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (account: { code: string; name: string; account_type: string; parent_id?: string | null; is_active?: boolean }) => {
      const tenant_id = await fetchTenantId();
      const { data, error } = await supabase
        .from("gl_accounts")
        .insert({ ...account, tenant_id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gl-accounts-full"] });
      qc.invalidateQueries({ queryKey: ["gl-accounts"] });
      toast.success("Compte créé");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

/** Update a GL account */
export function useUpdateGLAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; code?: string; name?: string; account_type?: string; is_active?: boolean; parent_id?: string | null }) => {
      const { error } = await supabase
        .from("gl_accounts")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gl-accounts-full"] });
      qc.invalidateQueries({ queryKey: ["gl-accounts"] });
      toast.success("Compte mis à jour");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

// ─── Trial Balance & Ledger Detail (server-side aggregation) ───
export interface TrialBalanceRow {
  tenant_id: string;
  account_id: string;
  code: string;
  name: string;
  account_type: string;
  total_debit: number;
  total_credit: number;
  balance: number;
}

export function useTrialBalance() {
  return useQuery({
    queryKey: ["gl-trial-balance"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("gl_trial_balance")
        .select("*")
        .order("code");
      if (error) throw error;
      return (data || []) as TrialBalanceRow[];
    },
  });
}

export interface LedgerDetailRow {
  tenant_id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  entry_id: string;
  entry_number: string;
  entry_date: string;
  entry_description: string | null;
  source: string;
  line_id: string;
  debit: number;
  credit: number;
  line_description: string | null;
  running_balance: number;
}

export function useLedgerDetail(accountId?: string) {
  return useQuery({
    queryKey: ["gl-ledger-detail", accountId],
    queryFn: async () => {
      let q = (supabase as any).from("gl_ledger_detail").select("*");
      if (accountId) q = q.eq("account_id", accountId);
      const { data, error } = await q.order("entry_date").order("entry_number");
      if (error) throw error;
      return (data || []) as LedgerDetailRow[];
    },
    enabled: accountId !== undefined,
  });
}

// ─── GL Periods (period_locks + journal aggregate) ───
export interface GLPeriodRow {
  tenant_id: string;
  period: string;
  status: "open" | "closed";
  closed_by: string | null;
  closed_at: string | null;
  posted_count: number;
  draft_count: number;
  reversed_count: number;
  total_debit: number;
  total_credit: number;
}

export function useGLPeriods() {
  return useQuery({
    queryKey: ["gl-periods"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("gl_periods_view")
        .select("*")
        .order("period", { ascending: false });
      if (error) throw error;
      return (data || []) as GLPeriodRow[];
    },
  });
}

export function useCloseGLPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (period: string) => {
      const { data, error } = await (supabase as any).rpc("close_gl_period", { _period: period });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gl-periods"] });
      qc.invalidateQueries({ queryKey: ["fiscal-calendar"] });
      toast.success("Période clôturée");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/** Réouverture : motif obligatoire, par le calendrier fiscal central (V33). */
export function useReopenGLPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ period, reason }: { period: string; reason: string }) => {
      const { error } = await (supabase as any).rpc("set_period_status", {
        _period: period, _module: "GL", _status: "open", _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gl-periods"] });
      qc.invalidateQueries({ queryKey: ["fiscal-calendar"] });
      toast.success("Période ré-ouverte");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Reverse journal entry ───
export function useReverseJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ entryId, reverseDate, reason }: { entryId: string; reverseDate?: string; reason?: string }) => {
      const { data, error } = await (supabase as any).rpc("reverse_journal_entry", {
        _entry_id: entryId,
        _reverse_date: reverseDate ?? new Date().toISOString().slice(0, 10),
        _reason: reason ?? "Contre-passation",
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
      qc.invalidateQueries({ queryKey: ["gl-trial-balance"] });
      qc.invalidateQueries({ queryKey: ["gl-periods"] });
      qc.invalidateQueries({ queryKey: ["account-balances"] });
      toast.success("Écriture contre-passée");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── SIG (Soldes Intermédiaires de Gestion - SYSCOHADA) ───
export interface GLSigRow {
  tenant_id: string;
  period: string;
  ventes: number;
  production_stockee: number;
  achats_consommes: number;
  services_ext: number;
  impots_taxes: number;
  charges_personnel: number;
  dotations: number;
  marge_commerciale: number;
  chiffre_affaires: number;
  valeur_ajoutee: number;
  ebe: number;
  resultat_exploitation: number;
  resultat_net: number;
}

export function useGLSig(fromPeriod?: string, toPeriod?: string) {
  return useQuery({
    queryKey: ["gl-sig", fromPeriod, toPeriod],
    queryFn: async () => {
      let q = (supabase as any).from("gl_sig_view").select("*");
      if (fromPeriod) q = q.gte("period", fromPeriod);
      if (toPeriod) q = q.lte("period", toPeriod);
      const { data, error } = await q.order("period");
      if (error) throw error;
      return (data || []) as GLSigRow[];
    },
  });
}
