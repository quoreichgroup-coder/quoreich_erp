import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId, fetchTenantId } from "@/hooks/use-tenant";
import type { TreasuryAccount, TreasuryKind } from "@/lib/treasury-accounts";

/*
 * Comptes de trésorerie et mouvements (V70) : comptes écrits sous droit treasury.manage_accounts
 * (RLS), mouvements uniquement par fonctions (règlements, mouvement manuel, virement interne).
 */
const db = supabase as any;
const KEYS = ["treasury-accounts", "bank-accounts", "bank-transactions", "treasury-cash-position", "journal-entries", "treasury-settings-v70"];
const invalidate = (qc: ReturnType<typeof useQueryClient>) => { for (const k of KEYS) qc.invalidateQueries({ queryKey: [k] }); };

export function useTreasuryAccounts() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["treasury-accounts", tenantId],
    enabled: !!tenantId,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db.from("bank_accounts").select("*").eq("tenant_id", tenantId).order("account_type").order("name");
      if (error) throw error;
      return (data ?? []).map((a: any) => ({ ...a, balance: Number(a.balance ?? 0), opening_balance: Number(a.opening_balance ?? 0) })) as TreasuryAccount[];
    },
  });
}

export type TreasuryAccountInput = {
  id?: string; name: string; bank_name: string; account_number: string; currency: string; account_type: TreasuryKind;
  gl_account_id: string; opening_balance: number; opening_date: string | null; is_active: boolean;
  min_balance: number | null; max_balance: number | null; overdraft_limit: number | null;
};

export function useSaveTreasuryAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: TreasuryAccountInput) => {
      const tenantId = await fetchTenantId();
      const { id, ...row } = v;
      const q = id ? db.from("bank_accounts").update(row).eq("id", id) : db.from("bank_accounts").insert({ ...row, tenant_id: tenantId });
      const { data, error } = await q.select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Gérer les comptes de trésorerie » requis.");
    },
    onSuccess: (_d, v) => { invalidate(qc); toast.success(v.id ? "Compte de trésorerie modifié" : "Compte de trésorerie créé"); },
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
  return useMutation({ mutationFn: fn, onSuccess: () => { invalidate(qc); toast.success(ok); }, onError: (e: Error) => toast.error(e.message) });
}

export const useSetDefaultTreasuryAccount = () => useRpc((id: string) => rpc("set_default_treasury_account", { _account: id }), "Compte par défaut enregistré");
export const useRecordTreasuryMovement = () => useRpc((v: { account: string; date: string; amount: number; counter: string; description: string; reference: string }) =>
  rpc("record_treasury_movement", { _account: v.account, _date: v.date, _amount: v.amount, _counter_account: v.counter, _description: v.description, _reference: v.reference || null }),
  "Mouvement enregistré et comptabilisé");
export const useTransferTreasury = () => useRpc((v: { from: string; to: string; date: string; amount: number; description: string; reference: string }) =>
  rpc("transfer_between_treasury_accounts", { _from: v.from, _to: v.to, _date: v.date, _amount: v.amount, _description: v.description || null, _reference: v.reference || null }),
  "Virement enregistré et comptabilisé");

export function useTreasuryMovements() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["bank-transactions", "v70", tenantId],
    enabled: !!tenantId,
    retry: false,
    queryFn: async () => {
      const all: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from("bank_transactions")
          .select("id, bank_account_id, transaction_date, description, amount, reference, source, is_reconciled, journal_entry_id, created_at, journal_entry:journal_entries(piece_number)")
          .eq("tenant_id", tenantId).order("transaction_date", { ascending: false }).order("created_at", { ascending: false }).range(from, from + 999);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return all as { id: string; bank_account_id: string; transaction_date: string; description: string | null; amount: number; reference: string | null;
        source: string; is_reconciled: boolean; journal_entry_id: string | null; journal_entry: { piece_number: string } | null }[];
    },
  });
}

export function useTreasuryRequireAccount() {
  const { data: tenantId } = useTenantId();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["treasury-settings-v70", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("treasury_settings").select("require_treasury_account").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return !!data?.require_treasury_account;
    },
  });
  const save = useMutation({
    mutationFn: async (v: boolean) => {
      const { data, error } = await db.from("treasury_settings")
        .upsert({ tenant_id: tenantId, require_treasury_account: v, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("tenant_id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Modifier les paramètres de trésorerie » requis.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["treasury-settings-v70"] }); toast.success("Paramètre de trésorerie enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { query, save };
}
