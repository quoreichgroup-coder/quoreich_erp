import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isValidTreasuryPeriod, treasuryCloseMessage } from "@/lib/treasury-close";

export type TreasuryCloseHistoryRow = {
  id: string;
  period: string;
  status: "pending" | "completed" | "failed";
  total_balance: number;
  accounts_count: number;
  reconciliations_count: number;
  error_message: string | null;
  closed_by: string;
  closed_at: string;
  closed_by_name?: string | null;
};

/** Lists recent treasury period closes for the current tenant. */
export function useTreasuryCloseHistory(limit = 24) {
  return useQuery({
    queryKey: ["treasury-close-history", limit],
    queryFn: async (): Promise<TreasuryCloseHistoryRow[]> => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => { limit: (n: number) => Promise<{ data: TreasuryCloseHistoryRow[] | null; error: { message: string } | null }> };
          };
        };
      })
        .from("treasury_close_history_view")
        .select(
          "id,period,status,total_balance,accounts_count,reconciliations_count,error_message,closed_by,closed_at,closed_by_name",
        )
        .order("closed_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useCloseTreasuryPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (period: string) => {
      if (!isValidTreasuryPeriod(period)) {
        throw new Error(treasuryCloseMessage("invalid_period", period));
      }
      // Server derives _period_start / _period_end from _period using the same
      // calendar logic as `periodBounds()` — single source of truth, single arg.
      const { data, error } = await (supabase as unknown as {
        rpc: (
          fn: string,
          params: Record<string, unknown>,
        ) => Promise<{ data: TreasuryCloseHistoryRow | null; error: { message: string } | null }>;
      }).rpc("close_treasury_period", { _period: period });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_row, period) => {
      toast.success(`Période ${period} clôturée`, {
        description: "Verrouillage Trésorerie enregistré et audité.",
      });
      qc.invalidateQueries({ queryKey: ["treasury-close-history"] });
      qc.invalidateQueries({ queryKey: ["bank-reconciliations"] });
      qc.invalidateQueries({ queryKey: ["period-locks"] });
    },
    onError: (err: unknown, period) => {
      const raw = err instanceof Error ? err.message : String(err);
      let friendly = raw;
      if (raw.includes("forbidden")) friendly = "Action refusée — rôle Contrôleur/Responsable Trésorerie requis.";
      else if (raw.includes("already locked")) friendly = `Période ${period} déjà verrouillée.`;
      else if (raw.includes("unreconciled")) friendly = "Rapprochements bancaires encore en brouillon dans la période.";
      else if (raw.includes("invalid period")) friendly = `Format invalide « ${period} » — attendu AAAA-MM.`;
      else if (raw.includes("no unique or exclusion constraint") || raw.includes("42P10")) {
        friendly = "Conflit de contrainte côté base — l'historique reste consultable. Contrainte UNIQUE manquante : prévenez l'administrateur.";
      }
      toast.error("Clôture impossible", { id: `treasury-close-error-${period}`, description: friendly });
    },
  });
}
