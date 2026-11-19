import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, isApiEnabled } from "@/api/client";

export interface DashboardKpis {
  totalAROutstanding: number;
  totalAPOutstanding: number;
  arInvoiceCount: number;
  apInvoiceCount: number;
  customerCount: number;
  supplierCount: number;
  arPaidThisMonth: number;
  apPaidThisMonth: number;
  dso: number;
  dpo: number;
}

export function useDashboardKpis() {
  return useQuery({
    queryKey: ["dashboard-kpis"],
    queryFn: async (): Promise<DashboardKpis> => {
      if (isApiEnabled()) {
        const d = await apiGet<any>("/api/v1/pilotage/dashboard");
        return dashboardKpis(d.ar, d.ap, d.customers, d.suppliers, d.arPayments, d.apPayments);
      }
      // Parallel queries for performance
      const [arRes, apRes, custRes, supRes, arPayRes, apPayRes] = await Promise.all([
        supabase.from("ar_invoices").select("total, amount_paid, status, invoice_date"),
        supabase.from("ap_invoices").select("total, amount_paid, status, invoice_date"),
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("suppliers").select("id", { count: "exact", head: true }),
        supabase.from("payments").select("amount, payment_date").eq("payment_type", "ar_receipt"),
        supabase.from("payments").select("amount, payment_date").eq("payment_type", "ap_payment"),
      ]);

      return dashboardKpis(arRes.data || [], apRes.data || [], custRes.count || 0, supRes.count || 0, arPayRes.data || [], apPayRes.data || []);
    },
    staleTime: 10000, // Data considered fresh for 10s (realtime handles updates)
  });
}

function dashboardKpis(arInvoices: any[], apInvoices: any[], customerCount: number, supplierCount: number, arPayments: any[], apPayments: any[]): DashboardKpis {

      const totalAROutstanding = arInvoices
        .filter(i => i.status !== "paid")
        .reduce((s, i) => s + (i.total - i.amount_paid), 0);

      const totalAPOutstanding = apInvoices
        .filter(i => i.status !== "paid")
        .reduce((s, i) => s + (i.total - i.amount_paid), 0);

      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      const arPaidThisMonth = arPayments
        .filter(p => p.payment_date >= monthStart)
        .reduce((s, p) => s + p.amount, 0);

      const apPaidThisMonth = apPayments
        .filter(p => p.payment_date >= monthStart)
        .reduce((s, p) => s + p.amount, 0);

      // Simple DSO/DPO calculation (total outstanding / avg daily revenue)
      const arTotal = arInvoices.reduce((s, i) => s + i.total, 0);
      const apTotal = apInvoices.reduce((s, i) => s + i.total, 0);
      const dso = arTotal > 0 ? Math.round(totalAROutstanding / (arTotal / 365)) : 0;
      const dpo = apTotal > 0 ? Math.round(totalAPOutstanding / (apTotal / 365)) : 0;

      return {
        totalAROutstanding,
        totalAPOutstanding,
        arInvoiceCount: arInvoices.length,
        apInvoiceCount: apInvoices.length,
        customerCount,
        supplierCount,
        arPaidThisMonth,
        apPaidThisMonth,
        dso,
        dpo,
      };
}

export function useRecentTransactions() {
  return useQuery({
    queryKey: ["recent-transactions"],
    queryFn: async () => {
      const [arRes, apRes] = isApiEnabled()
        ? await apiGet<any>("/api/v1/pilotage/recent").then((d) => [{ data: d.ar }, { data: d.ap }])
        : await Promise.all([
        supabase.from("ar_invoices")
          .select("id, invoice_number, total, status, invoice_date, customer:customers(name)")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase.from("ap_invoices")
          .select("id, invoice_number, total, status, invoice_date, supplier:suppliers(name)")
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      const transactions = [
        ...(arRes.data || []).map(i => ({
          id: i.id,
          number: i.invoice_number,
          party: (i.customer as any)?.name || "—",
          amount: i.total,
          type: "AR" as const,
          status: i.status,
          date: i.invoice_date,
        })),
        ...(apRes.data || []).map(i => ({
          id: i.id,
          number: i.invoice_number,
          party: (i.supplier as any)?.name || "—",
          amount: i.total,
          type: "AP" as const,
          status: i.status,
          date: i.invoice_date,
        })),
      ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

      return transactions;
    },
  });
}
