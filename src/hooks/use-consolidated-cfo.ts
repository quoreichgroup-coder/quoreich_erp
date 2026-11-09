import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AccessibleTenant = { id: string; name: string; currency: string };

export type ConsolidatedKpiRow = {
  tenant_id: string;
  tenant_name: string;
  currency: string;
  cash_on_hand: number;
  ar_outstanding: number;
  ap_outstanding: number;
  ar_overdue: number;
  ap_overdue: number;
  ar_overdue_count: number;
  ap_overdue_count: number;
  open_projects: number;
  open_risks_high: number;
  unmatched_recon_count: number;
};

/** Liste les tenants auxquels l'utilisateur a accès (RPC SECURITY DEFINER). */
export function useAccessibleTenants() {
  return useQuery({
    queryKey: ["accessible-tenants"],
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<AccessibleTenant[]> => {
      const { data, error } = await (supabase as any).rpc("get_accessible_tenants");
      if (error) throw error;
      return (data ?? []) as AccessibleTenant[];
    },
  });
}

/** Agrégation KPI CFO sur N tenants (RPC SECURITY DEFINER, filtre côté serveur). */
export function useConsolidatedCfoKpis(tenantIds: string[]) {
  return useQuery({
    queryKey: ["cfo-consolidated", [...tenantIds].sort().join(",")],
    enabled: tenantIds.length > 0,
    retry: false,
    staleTime: 15_000,
    queryFn: async (): Promise<ConsolidatedKpiRow[]> => {
      const { data, error } = await (supabase as any).rpc("get_consolidated_cfo_kpis", {
        _tenant_ids: tenantIds,
      });
      if (error) throw error;
      return (data ?? []) as ConsolidatedKpiRow[];
    },
  });
}

export function sumKpis(rows: ConsolidatedKpiRow[]): Omit<ConsolidatedKpiRow, "tenant_id" | "tenant_name" | "currency"> & { currency: string } {
  const currencies = Array.from(new Set(rows.map((r) => r.currency)));
  const sum = (k: keyof ConsolidatedKpiRow) =>
    rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return {
    currency: currencies.length === 1 ? currencies[0] : "MIX",
    cash_on_hand: sum("cash_on_hand"),
    ar_outstanding: sum("ar_outstanding"),
    ap_outstanding: sum("ap_outstanding"),
    ar_overdue: sum("ar_overdue"),
    ap_overdue: sum("ap_overdue"),
    ar_overdue_count: sum("ar_overdue_count"),
    ap_overdue_count: sum("ap_overdue_count"),
    open_projects: sum("open_projects"),
    open_risks_high: sum("open_risks_high"),
    unmatched_recon_count: sum("unmatched_recon_count"),
  };
}
