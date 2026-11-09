import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to Supabase Realtime changes on key financial tables
 * and invalidates the relevant React Query caches so the UI updates instantly.
 */
export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("cfo-dashboard-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ar_invoices" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dashboard-kpis"] });
          queryClient.invalidateQueries({ queryKey: ["recent-transactions"] });
          queryClient.invalidateQueries({ queryKey: ["treasury-13w-forecast"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ap_invoices" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dashboard-kpis"] });
          queryClient.invalidateQueries({ queryKey: ["recent-transactions"] });
          queryClient.invalidateQueries({ queryKey: ["treasury-13w-forecast"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dashboard-kpis"] });
          queryClient.invalidateQueries({ queryKey: ["cash-trend"] });
          queryClient.invalidateQueries({ queryKey: ["treasury-cash-position"] });
          queryClient.invalidateQueries({ queryKey: ["treasury-recon-status"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "journal_entries" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["gl-batches"] });
          queryClient.invalidateQueries({ queryKey: ["gl-audit-logs"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bank_accounts" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dashboard-kpis"] });
          queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
          queryClient.invalidateQueries({ queryKey: ["treasury-cash-position"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bank_transactions" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
          queryClient.invalidateQueries({ queryKey: ["treasury-recon-status"] });
          queryClient.invalidateQueries({ queryKey: ["treasury-cash-position"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bank_statements" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["bank-statements"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bank_statement_lines" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["statement-lines"] });
          queryClient.invalidateQueries({ queryKey: ["treasury-recon-status"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bank_reconciliations" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["bank-reconciliations"] });
          queryClient.invalidateQueries({ queryKey: ["treasury-recon-status"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cashflow_forecasts" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["cashflow-forecasts"] });
          queryClient.invalidateQueries({ queryKey: ["treasury-13w-forecast"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "treasury_role_audit" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["treasury-role-audit"] });
          queryClient.invalidateQueries({ queryKey: ["tenant-treasury-roles"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "quotations" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["quotations"] });
          queryClient.invalidateQueries({ queryKey: ["sales-pipeline"] });
          queryClient.invalidateQueries({ queryKey: ["sales-kpis"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_orders" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
          queryClient.invalidateQueries({ queryKey: ["sales-pipeline"] });
          queryClient.invalidateQueries({ queryKey: ["sales-sla"] });
          queryClient.invalidateQueries({ queryKey: ["sales-kpis"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "delivery_notes" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
          queryClient.invalidateQueries({ queryKey: ["sales-sla"] });
          queryClient.invalidateQueries({ queryKey: ["sales-kpis"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_role_audit" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["sales-role-audit"] });
          queryClient.invalidateQueries({ queryKey: ["tenant-sales-roles"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "erp_alerts" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["erp-alerts"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
