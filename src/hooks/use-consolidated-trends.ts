import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TrendPoint = {
  month: string; // YYYY-MM
  label: string;
  revenue: number;
  expenses: number;
  netProfit: number;
  cashBalance: number | null;
};

/**
 * Tendances consolidées (3/6/12 mois) sur les tenants sélectionnés.
 * Revenue = somme payments ar_receipt, Expenses = somme ap_payment,
 * NetProfit = Revenue - Expenses. Cash historique = relevés mensuels complets,
 * null sans justificatif ; seul le mois courant utilise le solde actuel XOF.
 */
export type TrendMonths = 3 | 6 | 12;

export function useConsolidatedTrends(tenantIds: string[], months: TrendMonths = 12) {
  return useQuery({
    queryKey: ["cfo-consolidated-trends", [...tenantIds].sort().join(","), months],
    enabled: tenantIds.length > 0,
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<TrendPoint[]> => {
      const { data, error } = await supabase.rpc("get_consolidated_cfo_trends", { _tenant_ids: tenantIds, _months: months });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        month: row.month,
        label: new Date(`${row.month}-01T00:00:00Z`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }),
        revenue: Number(row.revenue), expenses: Number(row.expenses), netProfit: Number(row.net_profit),
        cashBalance: row.cash_balance == null ? null : Number(row.cash_balance),
      }));
    },
  });
}
