import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost, isApiEnabled } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";

/** V152 — type d'absence, de congé ou d'heures, lié éventuellement à une rubrique de paie. */
export type HrTimeType = {
  id?: string;
  code: string;
  label: string;
  kind: "absence" | "leave" | "overtime";
  unit: "day" | "hour";
  count_method: "calendar" | "working";
  component_id: string | null;
  component_code?: string | null;
  component_label?: string | null;
  tracks_balance: boolean;
  accrual_per_month: number | null;
  allow_negative_balance: boolean;
  requires_second_person: boolean;
  active: boolean;
  sort_order: number;
  /** V153 — fériés comptés, acquisition automatique, libre-service, mode d'approbation. */
  include_public_holidays?: boolean;
  accrual_from?: string | null;
  accrual_prorata?: boolean;
  self_service?: boolean;
  approval_mode?: "officer" | "manager" | "none";
};

export type HrPublicHoliday = {
  id?: string; label: string; holiday_date: string | null; recurring_month: number | null; recurring_day: number | null;
  move_if_sunday: boolean; reference: string | null; active: boolean;
};
export type HrHolidayCalendar = { definitions: HrPublicHoliday[]; year: number; dates: { date: string; label: string }[] };

export type HrSelfService = {
  employee: { id: string; matricule: string; name: string; approver_name: string | null } | null;
  types: { id: string; code: string; label: string; kind: HrTimeType["kind"]; unit: HrTimeType["unit"]; tracks_balance: boolean; approval_mode: string }[];
  requests: { id: string; type_label: string; unit: string; start_date: string; end_date: string; quantity: number; reason: string;
    status: HrTimeRequest["status"]; decision_reason: string | null; transferred: boolean }[];
  balances: { type_id: string; type_label: string; unit: string; balance: number }[];
  to_approve: { id: string; employee_name: string; matricule: string; type_label: string; unit: string; start_date: string;
    end_date: string; quantity: number; reason: string }[];
};

export type HrSelfServiceLink = {
  employee_id: string; matricule: string; employee_name: string; user_id: string | null; user_name: string | null;
  approver_user_id: string | null; approver_name: string | null;
};

export type HrTimeRequest = {
  id: string;
  employee_id: string;
  employee_name: string;
  matricule: string;
  type_id: string;
  type_code: string;
  type_label: string;
  type_kind: HrTimeType["kind"];
  unit: HrTimeType["unit"];
  start_date: string;
  end_date: string;
  quantity: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  created_by: string;
  created_at: string;
  decided_by: string | null;
  decision_reason: string | null;
  payroll_run_id: string | null;
  payroll_period: string | null;
};

export type HrLeaveBalance = {
  employee_id: string; employee_name: string; matricule: string; type_id: string; type_label: string; unit: string;
  acquired: number; taken: number; balance: number;
};

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw error;
  return data as T;
}

function useTimeQuery<T>(key: string, api: string, fn: string, args: Record<string, unknown> = {}, extra: unknown[] = []) {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: [key, tenantId, source, ...extra],
    enabled: !!tenantId,
    queryFn: async () => ((isApiEnabled() ? await apiGet<T>(api) : await rpc<T>(fn, args)) ?? ([] as unknown as T)),
  });
}

export const useHrTimeTypes = () => useTimeQuery<HrTimeType[]>("hr-time-types", "/api/v1/hr/time/types", "list_hr_time_types");
export const useHrTimeRequests = () => useTimeQuery<HrTimeRequest[]>("hr-time-requests", "/api/v1/hr/time/requests", "list_hr_time_requests");
export const useHrLeaveBalances = () => useTimeQuery<HrLeaveBalance[]>("hr-leave-balances", "/api/v1/hr/time/balances", "list_hr_leave_balances");

export function useHrPublicHolidays(year: number) {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-public-holidays", tenantId, source, year],
    enabled: !!tenantId,
    queryFn: async () => (isApiEnabled() ? apiGet<HrHolidayCalendar>(`/api/v1/hr/time/holidays?year=${year}`)
      : rpc<HrHolidayCalendar>("list_hr_public_holidays", { _year: year })),
  });
}
export const useHrSelfService = () => useTimeQuery<HrSelfService>("hr-self-service", "/api/v1/hr/me", "my_hr_self_service");
export const useHrSelfServiceLinks = (enabled: boolean) => {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-self-service-links", tenantId, source],
    enabled: !!tenantId && enabled,
    queryFn: async () => (isApiEnabled() ? apiGet<HrSelfServiceLink[]>("/api/v1/hr/self-service/links")
      : rpc<HrSelfServiceLink[]>("list_hr_self_service_links")) ?? [],
  });
};

function useTimeMutation<A>(run: (args: A) => Promise<unknown>, success: string | ((result: unknown) => string)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (result) => {
      for (const key of ["hr-time-types", "hr-time-requests", "hr-leave-balances", "hr-payroll-runs", "payroll-run-variables",
        "hr-public-holidays", "hr-self-service", "hr-self-service-links"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      toast.success(typeof success === "function" ? success(result) : success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export const useSaveHrTimeType = () => useTimeMutation((input: HrTimeType) => {
  const { component_code: _c, component_label: _l, ...payload } = input;
  return isApiEnabled() ? apiPost("/api/v1/hr/time/types", payload) : rpc("save_hr_time_type", { _input: payload });
}, "Type de temps enregistré.");

export const useSubmitHrTimeRequest = () => useTimeMutation((a: {
  employee_id: string; type_id: string; start_date: string; end_date: string; quantity: number | null; reason: string;
}) => (isApiEnabled() ? apiPost("/api/v1/hr/time/requests", a)
  : rpc("submit_hr_time_request", { _employee: a.employee_id, _type: a.type_id, _start: a.start_date, _end: a.end_date,
    _quantity: a.quantity, _reason: a.reason })), "Demande enregistrée : elle attend l'approbation d'une autre personne.");

export const useDecideHrTimeRequest = () => useTimeMutation((a: { id: string; approve: boolean; reason: string | null }) =>
  (isApiEnabled() ? apiPost(`/api/v1/hr/time/requests/${encodeURIComponent(a.id)}/decide`, { approve: a.approve, reason: a.reason })
    : rpc("decide_hr_time_request", { _id: a.id, _approve: a.approve, _reason: a.reason })), "Décision enregistrée.");

export const useCancelHrTimeRequest = () => useTimeMutation((a: { id: string; reason: string }) =>
  (isApiEnabled() ? apiPost(`/api/v1/hr/time/requests/${encodeURIComponent(a.id)}/cancel`, { reason: a.reason })
    : rpc("cancel_hr_time_request", { _id: a.id, _reason: a.reason })), "Demande annulée.");

export const useAccrueHrLeave = () => useTimeMutation((period: string) =>
  (isApiEnabled() ? apiPost<{ count: number }>("/api/v1/hr/time/accrue", { period }).then((r) => r.count)
    : rpc<number>("accrue_hr_leave", { _period: period })), (n) => `${Number(n ?? 0)} acquisition(s) enregistrée(s).`);

export const useAdjustHrLeave = () => useTimeMutation((a: { employee_id: string; type_id: string; quantity: number; entry_date: string; note: string }) =>
  (isApiEnabled() ? apiPost("/api/v1/hr/time/adjustments", a)
    : rpc("adjust_hr_leave_balance", { _employee: a.employee_id, _type: a.type_id, _quantity: a.quantity, _date: a.entry_date, _note: a.note })),
  "Solde ajusté.");

export const useSaveHrPublicHoliday = () => useTimeMutation((input: HrPublicHoliday) =>
  (isApiEnabled() ? apiPost("/api/v1/hr/time/holidays", input) : rpc("save_hr_public_holiday", { _input: input })), "Jour férié enregistré.");

export const useDeleteHrPublicHoliday = () => useTimeMutation((id: string) =>
  (isApiEnabled() ? apiPost(`/api/v1/hr/time/holidays/${encodeURIComponent(id)}/delete`, {}) : rpc("delete_hr_public_holiday", { _id: id })),
  "Jour férié supprimé.");

export const useSubmitMyTimeRequest = () => useTimeMutation((a: { type_id: string; start_date: string; end_date: string; quantity: number | null; reason: string }) =>
  (isApiEnabled() ? apiPost("/api/v1/hr/me/time-requests", a)
    : rpc("submit_my_time_request", { _type: a.type_id, _start: a.start_date, _end: a.end_date, _quantity: a.quantity, _reason: a.reason })),
  "Demande envoyée.");

export const useCancelMyTimeRequest = () => useTimeMutation((a: { id: string; reason: string }) =>
  (isApiEnabled() ? apiPost(`/api/v1/hr/me/time-requests/${encodeURIComponent(a.id)}/cancel`, { reason: a.reason })
    : rpc("cancel_my_time_request", { _id: a.id, _reason: a.reason })), "Demande annulée.");

export const useSetHrSelfService = () => useTimeMutation((a: { employee_id: string; user_id: string | null; approver_user_id: string | null }) =>
  (isApiEnabled() ? apiPost(`/api/v1/hr/employees/${encodeURIComponent(a.employee_id)}/self-service`, { user_id: a.user_id, approver_user_id: a.approver_user_id })
    : rpc("set_hr_employee_self_service", { _employee: a.employee_id, _user: a.user_id, _approver: a.approver_user_id })),
  "Accès libre-service enregistré.");

export const useTransferHrTimeToPayroll = () => useTimeMutation((runId: string) =>
  (isApiEnabled() ? apiPost<{ count: number }>(`/api/v1/hr/payroll/runs/${encodeURIComponent(runId)}/transfer-time`, {}).then((r) => r.count)
    : rpc<number>("transfer_hr_time_to_payroll", { _run_id: runId })),
  (n) => `${Number(n ?? 0)} demande(s) transmise(s) au cycle : régénérez les lignes.`);
