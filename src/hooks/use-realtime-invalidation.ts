import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isApiEnabled } from "@/api/client";
import { subscribeRealtime } from "@/api/realtime";

/**
 * Tables suivies en temps réel et caches React Query à invalider. Nuage : Supabase Realtime ; sur site : la
 * WebSocket de l'API (V118, mêmes tables — toute table ajoutée ici doit l'être aussi dans la migration de
 * notification et dans la publication supabase_realtime).
 */
export const REALTIME_TABLES: Record<string, string[]> = {
  ar_invoices: ["dashboard-kpis", "recent-transactions", "treasury-13w-forecast"],
  ap_invoices: ["dashboard-kpis", "recent-transactions", "treasury-13w-forecast"],
  payments: ["dashboard-kpis", "cash-trend", "treasury-cash-position", "treasury-recon-status"],
  journal_entries: ["gl-batches", "gl-audit-logs"],
  bank_accounts: ["dashboard-kpis", "bank-accounts", "treasury-accounts", "treasury-cash-position"],
  bank_transactions: ["bank-transactions", "treasury-accounts", "treasury-recon-status", "treasury-cash-position"],
  bank_statements: ["bank-statements"],
  bank_statement_lines: ["statement-lines", "treasury-recon-status"],
  bank_reconciliations: ["bank-reconciliations", "treasury-recon-status"],
  cashflow_forecasts: ["cashflow-forecasts", "treasury-13w-forecast"],
  treasury_role_audit: ["treasury-role-audit", "tenant-treasury-roles"],
  quotations: ["quotations", "sales-pipeline", "sales-kpis"],
  sales_orders: ["sales-orders", "sales-pipeline", "sales-sla", "sales-kpis"],
  delivery_notes: ["delivery-notes", "sales-sla", "sales-kpis"],
  sales_role_audit: ["sales-role-audit", "tenant-sales-roles"],
  erp_alerts: ["erp-alerts", "erp-alerts-unread-count"],
  ai_analysis_history: ["ai-history", "ai-history-infinite"],
};

/** Invalide les caches d'une table modifiée. */
export function invalidateForTable(queryClient: ReturnType<typeof useQueryClient>, table: string) {
  for (const key of REALTIME_TABLES[table] ?? []) queryClient.invalidateQueries({ queryKey: [key] });
}

/** Rafraîchit les écrans quand les tables financières clés changent (autre utilisateur, autre onglet). */
export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isApiEnabled()) return subscribeRealtime((table) => invalidateForTable(queryClient, table));
    let channel = supabase.channel("cfo-dashboard-realtime");
    for (const table of Object.keys(REALTIME_TABLES)) {
      if (table === "ai_analysis_history") continue; // suivi par son propre écran, filtré par société
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () => invalidateForTable(queryClient, table));
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
