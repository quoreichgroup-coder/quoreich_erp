import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CfoCockpitKpis = {
  cashOnHand: number;
  arOutstanding: number;
  apOutstanding: number;
  workingCapital: number;
  dso: number;
  dpo: number;
  netBurnMtd: number;
  openProjects: number;
  openRisksHigh: number;
  payrollPostedMtd: number;
  inventoryClosedPeriod: string | null;
  treasuryClosedPeriod: string | null;
  unmatchedReconCount: number;
  arOverdue: number;
  apOverdue: number;
  arOverdueCount: number;
  apOverdueCount: number;
};

const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

/** Aggregates KPI across AR, AP, Treasury, Inventory, HR, Risk and Projects. */
export function useCfoCockpit() {
  return useQuery({
    queryKey: ["cfo-cockpit"],
    staleTime: 15_000,
    queryFn: async (): Promise<CfoCockpitKpis> => {
      const s = supabase as unknown as {
        from: (t: string) => any;
      };
      const ms = monthStart();
      const [ar, ap, banks, arPay, apPay, projects, risks, payroll, invClose, trClose, recon] =
        await Promise.all([
          s.from("ar_invoices").select("total, amount_paid, status, due_date"),
          s.from("ap_invoices").select("total, amount_paid, status, due_date"),
          s.from("bank_accounts").select("current_balance"),
          s.from("payments").select("amount, payment_date").eq("payment_type", "ar_receipt"),
          s.from("payments").select("amount, payment_date").eq("payment_type", "ap_payment"),
          s.from("projects").select("id", { count: "exact", head: true }).eq("status", "active"),
          s
            .from("risk_register")
            .select("id", { count: "exact", head: true })
            .in("severity", ["high", "critical"])
            .neq("status", "closed"),
          s.from("payroll_runs").select("total_net, status, period_start").eq("status", "posted"),
          s.from("inventory_period_closes").select("period").order("period", { ascending: false }).limit(1),
          s.from("treasury_period_closes").select("period").order("period", { ascending: false }).limit(1),
          s.from("bank_reconciliations").select("id", { count: "exact", head: true }).eq("status", "draft"),
        ]);

      const arRows = ar.data ?? [];
      const apRows = ap.data ?? [];
      const arOutstanding = arRows
        .filter((i: any) => i.status !== "paid")
        .reduce((s: number, i: any) => s + (Number(i.total) - Number(i.amount_paid)), 0);
      const apOutstanding = apRows
        .filter((i: any) => i.status !== "paid")
        .reduce((s: number, i: any) => s + (Number(i.total) - Number(i.amount_paid)), 0);
      const arTotal = arRows.reduce((s: number, i: any) => s + Number(i.total), 0);
      const apTotal = apRows.reduce((s: number, i: any) => s + Number(i.total), 0);
      const dso = arTotal > 0 ? Math.round(arOutstanding / (arTotal / 365)) : 0;
      const dpo = apTotal > 0 ? Math.round(apOutstanding / (apTotal / 365)) : 0;
      const cashOnHand = (banks.data ?? []).reduce(
        (s: number, b: any) => s + Number(b.current_balance ?? 0),
        0,
      );
      const arInMtd = (arPay.data ?? [])
        .filter((p: any) => p.payment_date >= ms)
        .reduce((s: number, p: any) => s + Number(p.amount), 0);
      const apOutMtd = (apPay.data ?? [])
        .filter((p: any) => p.payment_date >= ms)
        .reduce((s: number, p: any) => s + Number(p.amount), 0);
      const payrollPostedMtd = (payroll.data ?? [])
        .filter((r: any) => (r.period_start ?? "") >= ms)
        .reduce((s: number, r: any) => s + Number(r.total_net ?? 0), 0);

      const today = new Date().toISOString().slice(0, 10);
      const arOverdueRows = arRows.filter(
        (i: any) => i.status !== "paid" && i.due_date && i.due_date < today,
      );
      const apOverdueRows = apRows.filter(
        (i: any) => i.status !== "paid" && i.due_date && i.due_date < today,
      );
      const arOverdue = arOverdueRows.reduce(
        (s: number, i: any) => s + (Number(i.total) - Number(i.amount_paid)),
        0,
      );
      const apOverdue = apOverdueRows.reduce(
        (s: number, i: any) => s + (Number(i.total) - Number(i.amount_paid)),
        0,
      );

      return {
        cashOnHand,
        arOutstanding,
        apOutstanding,
        workingCapital: cashOnHand + arOutstanding - apOutstanding,
        dso,
        dpo,
        netBurnMtd: arInMtd - apOutMtd - payrollPostedMtd,
        openProjects: projects.count ?? 0,
        openRisksHigh: risks.count ?? 0,
        payrollPostedMtd,
        inventoryClosedPeriod: invClose.data?.[0]?.period ?? null,
        treasuryClosedPeriod: trClose.data?.[0]?.period ?? null,
        unmatchedReconCount: recon.count ?? 0,
        arOverdue,
        apOverdue,
        arOverdueCount: arOverdueRows.length,
        apOverdueCount: apOverdueRows.length,
      };
    },
  });
}
