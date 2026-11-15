import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId, fetchTenantId } from "@/hooks/use-tenant";
import type { BudgetImportRow } from "@/lib/budget-import";

/*
 * Prévisions saisies (V78) : versions par exercice (brouillon → publiée, figée), une ligne par compte × section,
 * droit budget.forecast. Préparation par fichier : import_budget_forecast_lines (tout ou rien).
 */
const db = supabase as any;
const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["budget-forecasts"] });
  qc.invalidateQueries({ queryKey: ["budget-forecast-lines"] });
};

export type BudgetForecast = { id: string; fiscal_year: string; name: string; status: "draft" | "published"; notes: string | null;
  created_at: string; published_at: string | null };
export type BudgetForecastLine = { id: string; forecast_id: string; gl_account_id: string; analytic_value_id: string | null; amount: number; comment: string | null };

export function useBudgetForecasts(year: string) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["budget-forecasts", tenantId, year],
    enabled: !!tenantId && /^\d{4}$/.test(year),
    queryFn: async () => {
      const { data, error } = await db.from("budget_forecasts").select("id, fiscal_year, name, status, notes, created_at, published_at")
        .eq("tenant_id", tenantId).eq("fiscal_year", year).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BudgetForecast[];
    },
  });
}

export function useBudgetForecastLines(forecastId: string | null) {
  return useQuery({
    queryKey: ["budget-forecast-lines", forecastId],
    enabled: !!forecastId,
    queryFn: async () => {
      const { data, error } = await db.from("budget_forecast_lines").select("id, forecast_id, gl_account_id, analytic_value_id, amount, comment").eq("forecast_id", forecastId);
      if (error) throw error;
      return (data ?? []).map((l: any) => ({ ...l, amount: Number(l.amount) })) as BudgetForecastLine[];
    },
  });
}

const refused = "Refusé : droit « Saisir et publier les prévisions budgétaires » requis.";

/** Nouvelle version, éventuellement initialisée (atterrissage calculé, budget ou version précédente). */
export function useCreateBudgetForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { year: string; name: string; lines: { gl_account_id: string; analytic_value_id: string | null; amount: number }[] }) => {
      const tenantId = await fetchTenantId();
      const { data, error } = await db.from("budget_forecasts").insert({ tenant_id: tenantId, fiscal_year: v.year, name: v.name.trim() }).select("id").single();
      if (error) throw new Error(/budget_forecasts_tenant_id_fiscal_year_name_key/.test(error.message) ? "Une version de ce nom existe déjà pour l'exercice" : /row-level security/.test(error.message) ? refused : error.message);
      if (v.lines.length) {
        const ins = await db.from("budget_forecast_lines").insert(v.lines.map((l) => ({ tenant_id: tenantId, forecast_id: data.id, ...l, amount: Math.max(0, Math.round(l.amount * 100) / 100) })));
        if (ins.error) { await db.from("budget_forecasts").delete().eq("id", data.id); throw ins.error; }
      }
      return data.id as string;
    },
    onSuccess: () => { invalidate(qc); toast.success("Version de prévision créée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSaveBudgetForecastLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id?: string; forecast_id: string; gl_account_id: string; analytic_value_id: string | null; amount: number; comment?: string | null }) => {
      const tenantId = await fetchTenantId();
      const fields = { gl_account_id: v.gl_account_id, analytic_value_id: v.analytic_value_id, amount: v.amount, comment: v.comment ?? null };
      const q = v.id ? db.from("budget_forecast_lines").update(fields).eq("id", v.id) : db.from("budget_forecast_lines").insert({ tenant_id: tenantId, forecast_id: v.forecast_id, ...fields });
      const { data, error } = await q.select("id");
      if (error) throw new Error(/budget_forecast_lines_unique/.test(error.message) ? "Ce compte et cette section figurent déjà dans la version" : error.message);
      if (!data?.length) throw new Error(refused);
    },
    onSuccess: () => invalidate(qc),
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteBudgetForecastLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await db.from("budget_forecast_lines").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error(refused);
    },
    onSuccess: () => invalidate(qc),
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useImportBudgetForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { forecast: string; rows: BudgetImportRow[] }) => {
      const { data, error } = await db.rpc("import_budget_forecast_lines", { _forecast: v.forecast, _rows: v.rows });
      if (error) throw error;
      return Number(data);
    },
    onSuccess: (n) => { invalidate(qc); toast.success(`Prévision importée : ${n} ligne(s)`); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePublishBudgetForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("budget_forecast_publish", { _forecast: id });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(qc); toast.success("Prévision publiée : version figée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteBudgetForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await db.from("budget_forecasts").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error(refused);
    },
    onSuccess: () => { invalidate(qc); toast.success("Version supprimée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
