import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import type { FiscalModule, FiscalPeriod, FiscalYear, PeriodLock } from "@/lib/fiscal-calendar";
import { apiGet, apiPost, apiPut, isApiEnabled } from "@/api/client";

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
      if (isApiEnabled()) return apiGet<FiscalCalendar>("/api/v1/fiscal-calendar");
      const [years, periods, modules, locks] = await Promise.all([
        check<FiscalYear[]>(db.from("fiscal_years").select("id, code, start_date, end_date, status, result_amount").order("start_date")),
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
    queryFn: async () => isApiEnabled() ? apiGet<FiscalAuditRow[]>("/api/v1/fiscal-calendar/audit") : check<FiscalAuditRow[]>(db.from("fiscal_calendar_audit")
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
      qc.invalidateQueries({ queryKey: ["fiscal-close-preview"] });
      qc.invalidateQueries({ queryKey: ["fiscal-opening-balances"] });
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
    (i: { start: string; end: string }) => isApiEnabled() ? apiPost("/api/v1/fiscal-calendar/years", i) : check(db.rpc("create_fiscal_year", { _start: i.start, _end: i.end })),
    "Exercice créé (non ouvert)");
}

export function useOpenFiscalYear() {
  return useCalendarMutation((id: string) => isApiEnabled() ? apiPost(`/api/v1/fiscal-calendar/years/${id}/open`, {}) : check(db.rpc("open_fiscal_year", { _id: id })), "Exercice ouvert");
}

export function useCloseFiscalYear() {
  return useCalendarMutation((id: string) => isApiEnabled() ? apiPost(`/api/v1/fiscal-calendar/years/${id}/close`, {}) : check(db.rpc("close_fiscal_year", { _id: id })), "Exercice clôturé définitivement");
}

export function useSetPeriodStatus() {
  return useCalendarMutation(
    (i: { period: string; module: string; status: "open" | "closed"; reason?: string }) =>
      isApiEnabled() ? apiPost("/api/v1/fiscal-calendar/period-status", { period: i.period, module: i.module, status: i.status, reason: i.reason ?? null })
        : check(db.rpc("set_period_status", { _period: i.period, _module: i.module, _status: i.status, _reason: i.reason ?? null })),
    (i) => (i.status === "closed" ? "Période clôturée" : "Période rouverte"));
}

// ─── Clôture d'exercice (V121) : aperçu, état des à-nouveaux, paramètre de l'écriture de résultat ───

export interface FiscalClosePreview {
  fiscal_year: string; status: string; revenue: number; expense: number; result: number; post_result_entry: boolean;
  open_periods: number; draft_entries: number; missing_roles: string[]; result_entry_id: string | null; result_amount: number | null;
}
export interface OpeningBalanceRow { account_code: string | null; account_name: string; account_type: string; debit: number; credit: number }

export function useFiscalClosePreview(id: string | null) {
  return useQuery({
    queryKey: ["fiscal-close-preview", id],
    enabled: Boolean(id),
    retry: false,
    queryFn: async (): Promise<FiscalClosePreview> => isApiEnabled()
      ? apiGet<FiscalClosePreview>(`/api/v1/fiscal-calendar/years/${id}/close-preview`)
      : check<FiscalClosePreview>(db.rpc("fiscal_year_close_preview", { _id: id })),
  });
}

export function useOpeningBalances(id: string | null) {
  return useQuery({
    queryKey: ["fiscal-opening-balances", id],
    enabled: Boolean(id),
    retry: false,
    queryFn: async (): Promise<OpeningBalanceRow[]> => isApiEnabled()
      ? apiGet<OpeningBalanceRow[]>(`/api/v1/fiscal-calendar/years/${id}/opening-balances`)
      : check<OpeningBalanceRow[]>(db.rpc("fiscal_year_opening_balances", { _id: id })),
  });
}

export function useFiscalCloseSettings() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["fiscal-close-settings"],
    queryFn: async (): Promise<{ post_result_entry: boolean }> => {
      if (isApiEnabled()) return (await apiGet<{ post_result_entry: boolean } | null>("/api/v1/fiscal-calendar/close-settings")) ?? { post_result_entry: true };
      const rows = await check<{ post_result_entry: boolean }[]>(db.from("fiscal_close_settings").select("post_result_entry").limit(1));
      return rows[0] ?? { post_result_entry: true };
    },
  });
  const save = useMutation({
    mutationFn: async (post_result_entry: boolean) => {
      if (isApiEnabled()) { await apiPut("/api/v1/fiscal-calendar/close-settings", { post_result_entry }); return; }
      const { data: tenant } = await db.rpc("get_user_tenant_id", { _user_id: (await db.auth.getUser()).data.user?.id });
      const rows = await check<unknown[]>(db.from("fiscal_close_settings").upsert({ tenant_id: tenant, post_result_entry, updated_at: new Date().toISOString() },
        { onConflict: "tenant_id" }).select("tenant_id"));
      if (!rows?.length) throw new Error("Refusé : droit « Clôturer une période » requis.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fiscal-close-settings"] }); qc.invalidateQueries({ queryKey: ["fiscal-close-preview"] }); toast.success("Paramètre de clôture enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { query, save };
}
