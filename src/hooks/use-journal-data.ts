import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchTenantId } from "@/hooks/use-tenant";
import { toast } from "sonner";

export interface JournalEntry {
  id: string;
  tenant_id: string;
  entry_number: string;
  /** V38 : journal (VT, AC, BQ, PA, OD) et numéro de pièce continu par journal et exercice. */
  journal_code?: string;
  piece_number?: string;
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
      /** analytics : section par axe ({ axisId: valueId }), contrôlée à la comptabilisation (QG002). */
      lines: { account_id: string; description: string; debit: number; credit: number; analytics?: Record<string, string> }[];
    }) => {
      const tenant_id = await fetchTenantId();
      const { lines, status, ...header } = entry;

      // Toujours en brouillon d'abord : la base contrôle l'équilibre et l'analytique au moment
      // où l'écriture devient 'posted', et il lui faut alors ses lignes et leurs imputations.
      // (Insérer l'en-tête directement en 'posted' était refusé : « cannot post empty entry ».)
      const { data, error } = await supabase
        .from("journal_entries")
        .insert({ ...header, status: "draft", tenant_id, created_by: user!.id })
        .select()
        .single();
      if (error) throw error;

      // Identifiants de lignes générés ici pour rattacher chaque imputation à sa ligne sans
      // dépendre de l'ordre de retour.
      const lineRows = lines.map(({ analytics: _a, ...l }) => ({ ...l, id: crypto.randomUUID(), entry_id: data.id }));
      const analyticRows = lines.flatMap((l, i) =>
        Object.entries(l.analytics ?? {})
          .filter(([, valueId]) => Boolean(valueId))
          .map(([axis_id, value_id]) => ({ line_id: lineRows[i].id, axis_id, value_id })),
      );
      const fail = async (cause: { message: string }): Promise<never> => {
        // Pas de transaction entre appels : on retire le brouillon incomplet. Si la suppression
        // est refusée (réservée à l'administrateur), il reste un brouillon, et on le dit.
        await supabase.from("journal_lines").delete().eq("entry_id", data.id);
        const { data: gone } = await supabase.from("journal_entries").delete().eq("id", data.id).select("id");
        throw new Error(gone?.length ? cause.message : `${cause.message} — l'écriture ${entry.entry_number} reste en brouillon`);
      };

      const { error: lineErr } = await supabase.from("journal_lines").insert(lineRows);
      if (lineErr) return fail(lineErr);
      if (analyticRows.length > 0) {
        const { error: anaErr } = await (supabase as any).from("journal_line_analytics").insert(analyticRows);
        if (anaErr) return fail(anaErr);
      }
      if (status === "posted") {
        const { error: postErr } = await supabase
          .from("journal_entries")
          .update({ status: "posted", posted_by: user!.id, posted_at: new Date().toISOString() })
          .eq("id", data.id);
        // Refus de comptabilisation (déséquilibre, période close, analytique) : le brouillon
        // complet est conservé pour correction, rien n'est perdu.
        if (postErr) throw new Error(`${postErr.message} — l'écriture ${entry.entry_number} est conservée en brouillon`);
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
      toast.success("Écriture comptable créée");
    },
    onError: (err: any) => toast.error(err.message),
  });
}
