import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchTenantId } from "@/hooks/use-tenant";
import { toast } from "sonner";

export interface JournalEntry {
  id: string;
  tenant_id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  source: string;
  status: string;
  created_by: string;
  created_at: string;
  posted_at: string | null;
  posted_by: string | null;
  lines: JournalLine[];
}

export interface JournalLine {
  id: string;
  entry_id: string;
  account_id: string;
  description: string | null;
  debit: number;
  credit: number;
  cost_center: string | null;
  department: string | null;
  project: string | null;
  account?: { id: string; code: string; name: string };
}

export function useJournalEntries() {
  return useQuery({
    queryKey: ["journal-entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("*, lines:journal_lines(*, account:gl_accounts(id, code, name))")
        .order("entry_date", { ascending: false });
      if (error) throw error;
      return (data || []) as JournalEntry[];
    },
  });
}

export function useGLAccounts() {
  return useQuery({
    queryKey: ["gl-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gl_accounts")
        .select("id, code, name, account_type, is_active")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });
}

export function useCreateJournalEntry() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (entry: {
      entry_number: string;
      entry_date: string;
      description: string;
      source: string;
      status: string;
      lines: { account_id: string; description: string; debit: number; credit: number; cost_center?: string; department?: string; project?: string }[];
    }) => {
      const tenant_id = await fetchTenantId();
      const { lines, ...header } = entry;

      const { data, error } = await supabase
        .from("journal_entries")
        .insert({
          ...header,
          tenant_id,
          created_by: user!.id,
          ...(entry.status === "posted" ? { posted_by: user!.id, posted_at: new Date().toISOString() } : {}),
        })
        .select()
        .single();
      if (error) throw error;

      const lineRows = lines.map((l) => ({ ...l, entry_id: data.id }));
      const { error: lineErr } = await supabase.from("journal_lines").insert(lineRows);
      if (lineErr) throw lineErr;

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
      toast.success("Écriture comptable créée");
    },
    onError: (err: any) => toast.error(err.message),
  });
}
