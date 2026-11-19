import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, isApiEnabled } from "@/api/client";
import { DEFAULT_RISK_SETTINGS, netScore, riskLevel, type RiskSettings } from "@/lib/grc";

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

type Row = Record<string, any>;
/** Données brutes du cockpit : mêmes champs par l'API (sur site) et par Supabase (nuage). */
export interface CfoCockpitData {
  ar: Row[]; ap: Row[]; banks: Row[]; arPayments: Row[]; apPayments: Row[]; activeProjects: number;
  risks: Row[]; riskSettings: Row | null; payroll: Row[]; inventoryClose: Row[]; treasuryClose: Row[]; draftReconciliations: number;
}

async function fetchCockpitData(): Promise<CfoCockpitData> {
  if (isApiEnabled()) return apiGet<CfoCockpitData>("/api/v1/pilotage/cfo");
  const s = supabase as unknown as { from: (t: string) => any };
  const res = await Promise.all([
    s.from("ar_invoices").select("total, amount_paid, status, due_date"),
    s.from("ap_invoices").select("total, amount_paid, status, due_date"),
    s.from("bank_accounts").select("balance").eq("is_active", true),
    s.from("payments").select("amount, payment_date").eq("payment_type", "ar_receipt"),
    s.from("payments").select("amount, payment_date").eq("payment_type", "ap_payment"),
    s.from("projects").select("id", { count: "exact", head: true }).eq("status", "active"),
    s.from("risk_register").select("likelihood, impact, residual_likelihood, residual_impact, status").neq("status", "closed"),
    s.from("risk_settings").select("*").limit(1), // RLS : la ligne de la société
    s.from("payroll_runs").select("net_total, status, pay_date").eq("status", "posted"),
    s.from("inventory_period_closes").select("period").order("period", { ascending: false }).limit(1),
    s.from("treasury_period_closes").select("period").order("period", { ascending: false }).limit(1),
    s.from("bank_reconciliations").select("id", { count: "exact", head: true }).eq("status", "draft"),
  ]);
  const failed = res.find((r: any) => r.error);
  if (failed) throw failed.error;
  const [ar, ap, banks, arPay, apPay, projects, risks, settings, payroll, invClose, trClose, recon] = res as any[];
  return {
    ar: ar.data ?? [], ap: ap.data ?? [], banks: banks.data ?? [], arPayments: arPay.data ?? [], apPayments: apPay.data ?? [],
    activeProjects: projects.count ?? 0, risks: risks.data ?? [], riskSettings: settings.data?.[0] ?? null, payroll: payroll.data ?? [],
    inventoryClose: invClose.data ?? [], treasuryClose: trClose.data ?? [], draftReconciliations: recon.count ?? 0,
  };
}

const open = (i: Row) => Number(i.total) - Number(i.amount_paid ?? 0);

/** Calcul pur des indicateurs du cockpit (testé). Risques élevés : score net ≥ seuil « élevé » de la société. */
export function computeCfoCockpit(d: CfoCockpitData, today = new Date().toISOString().slice(0, 10), ms = monthStart()): CfoCockpitKpis {
  const arOpen = d.ar.filter((i) => i.status !== "paid");
  const apOpen = d.ap.filter((i) => i.status !== "paid");
  const sum = (rows: Row[], f: (r: Row) => number) => rows.reduce((t, r) => t + f(r), 0);
  const arOutstanding = sum(arOpen, open);
  const apOutstanding = sum(apOpen, open);
  const arTotal = sum(d.ar, (i) => Number(i.total));
  const apTotal = sum(d.ap, (i) => Number(i.total));
  const cashOnHand = sum(d.banks, (b) => Number(b.balance ?? 0));
  const arInMtd = sum(d.arPayments.filter((p) => p.payment_date >= ms), (p) => Number(p.amount));
  const apOutMtd = sum(d.apPayments.filter((p) => p.payment_date >= ms), (p) => Number(p.amount));
  const payrollPostedMtd = sum(d.payroll.filter((r) => (r.pay_date ?? "") >= ms), (r) => Number(r.net_total ?? 0));
  const arOverdueRows = arOpen.filter((i) => i.due_date && i.due_date < today);
  const apOverdueRows = apOpen.filter((i) => i.due_date && i.due_date < today);
  const settings = { ...DEFAULT_RISK_SETTINGS, ...(d.riskSettings ?? {}) } as RiskSettings;
  const openRisksHigh = d.risks.filter((r) => r.status !== "closed" && (riskLevel(netScore(r as any), settings) === "high" || riskLevel(netScore(r as any), settings) === "critical")).length;
  return {
    cashOnHand, arOutstanding, apOutstanding,
    workingCapital: cashOnHand + arOutstanding - apOutstanding,
    dso: arTotal > 0 ? Math.round(arOutstanding / (arTotal / 365)) : 0,
    dpo: apTotal > 0 ? Math.round(apOutstanding / (apTotal / 365)) : 0,
    netBurnMtd: arInMtd - apOutMtd - payrollPostedMtd,
    openProjects: d.activeProjects, openRisksHigh, payrollPostedMtd,
    inventoryClosedPeriod: d.inventoryClose[0]?.period ?? null,
    treasuryClosedPeriod: d.treasuryClose[0]?.period ?? null,
    unmatchedReconCount: d.draftReconciliations,
    arOverdue: sum(arOverdueRows, open), apOverdue: sum(apOverdueRows, open),
    arOverdueCount: arOverdueRows.length, apOverdueCount: apOverdueRows.length,
  };
}

/** Indicateurs du cockpit CFO (société courante). */
export function useCfoCockpit() {
  return useQuery({
    queryKey: ["cfo-cockpit"],
    staleTime: 15_000,
    queryFn: async (): Promise<CfoCockpitKpis> => computeCfoCockpit(await fetchCockpitData()),
  });
}
