import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import type { FiscalModule, FiscalPeriod, FiscalYear, PeriodLock } from "@/lib/fiscal-calendar";

/*
 * Calendrier fiscal central (V33). Lecture : fiscal_years, fiscal_periods, fiscal_modules et le
 * registre period_locks, en lecture seule pour tous. Écriture : uniquement par les fonctions
 * create_fiscal_year / open_fiscal_year / close_fiscal_year / set_period_status, qui vérifient
 * les droits (periods.close, periods.reopen) et les règles. Leur message remonte tel quel.
 */
const db = supabase as any;

async function check<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

export interface FiscalCalendar {
  years: FiscalYear[];
  periods: FiscalPeriod[];
  modules: FiscalModule[];
  locks: PeriodLock[];
}

export function useFiscalCalendar() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["fiscal-calendar", tenantId],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async (): Promise<FiscalCalendar> => {
      const [years, periods, modules, locks] = await Promise.all([
        check<FiscalYear[]>(db.from("fiscal_years").select("id, code, start_date, end_date, status").order("start_date")),
        check<FiscalPeriod[]>(db.from("fiscal_periods").select("id, fiscal_year_id, period_no, code, start_date, end_date")
          .order("code").range(0, 999)),
        check<FiscalModule[]>(db.from("fiscal_modules").select("code, label, sort_order, is_ledger").order("sort_order")),
        check<PeriodLock[]>(db.from("period_locks").select("period, module, status, closed_at, reason").range(0, 4999)),
      ]);
      return { years, periods, modules, locks };
    },
  });
}

export interface FiscalAuditRow {
  seq: number; created_at: string; action: string; fiscal_year_code: string | null;
  period: string | null; module: string | null; reason: string | null; actor_id: string | null;
}

export function useFiscalCalendarAudit(enabled: boolean) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["fiscal-calendar-audit", tenantId],
    enabled: Boolean(tenantId) && enabled,
    retry: false,
    queryFn: async () => check<FiscalAuditRow[]>(db.from("fiscal_calendar_audit")
      .select("seq, created_at, action, fiscal_year_code, period, module, reason, actor_id")
      .order("seq", { ascending: false }).limit(100)),
  });
}

function useCalendarMutation<I>(run: (i: I) => Promise<unknown>, success: string | ((i: I) => string)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (_d, i) => {
      qc.invalidateQueries({ queryKey: ["fiscal-calendar"] });
      qc.invalidateQueries({ queryKey: ["fiscal-calendar-audit"] });
      // Les écrans des modules lisent aussi ces statuts.
      qc.invalidateQueries({ queryKey: ["period-locks"] });
      qc.invalidateQueries({ queryKey: ["gl-periods"] });
      qc.invalidateQueries({ queryKey: ["inventory-period-locks"] });
      qc.invalidateQueries({ queryKey: ["treasury-close-history"] });
      toast.success(typeof success === "function" ? success(i) : success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateFiscalYear() {
  return useCalendarMutation(
    (i: { start: string; end: string }) => check(db.rpc("create_fiscal_year", { _start: i.start, _end: i.end })),
    "Exercice créé (non ouvert)");
}

export function useOpenFiscalYear() {
  return useCalendarMutation((id: string) => check(db.rpc("open_fiscal_year", { _id: id })), "Exercice ouvert");
}

export function useCloseFiscalYear() {
  return useCalendarMutation((id: string) => check(db.rpc("close_fiscal_year", { _id: id })), "Exercice clôturé définitivement");
}

export function useSetPeriodStatus() {
  return useCalendarMutation(
    (i: { period: string; module: string; status: "open" | "closed"; reason?: string }) =>
      check(db.rpc("set_period_status", { _period: i.period, _module: i.module, _status: i.status, _reason: i.reason ?? null })),
    (i) => (i.status === "closed" ? "Période clôturée" : "Période rouverte"));
}
