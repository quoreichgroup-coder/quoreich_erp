import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId, fetchTenantId } from "@/hooks/use-tenant";
import { apiGet, apiPost, apiPut, apiDelete, isApiEnabled } from "@/api/client";
import { buildAnalyticsSetup, type AnalyticsSetup, type RawAxis, type RawRule, type RawValue } from "@/lib/analytics-setup";

/*
 * Analytique : deux sources, une seule forme de données (voir use-accounting-setup.ts).
 * Côté Supabase, les écritures vont directement dans les tables V19 : les politiques RLS
 * (administrateur pour les axes et règles, administrateur ou comptable pour les sections) et
 * les gardes de la base (hiérarchie sans boucle, V20) sont la barrière, et leur message
 * remonte tel quel.
 */
const db = supabase as any;
const source = () => (isApiEnabled() ? "api" : "supabase");

async function check<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

/**
 * Modification ou suppression : sous la RLS, une ligne non autorisée est simplement filtrée et
 * l'ordre « réussit » sans rien toucher. Zéro ligne touchée est donc un refus, pas un succès.
 */
async function checkTouched(p: PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<void> {
  const rows = await check(p);
  if (!rows || rows.length === 0) {
    throw new Error("Modification refusée : élément introuvable ou droits insuffisants dans la société courante");
  }
}

async function fetchFromSupabase(): Promise<AnalyticsSetup> {
  const [axes, values, rules, canManageAxes, canManageValues] = await Promise.all([
    check<RawAxis[]>(db.from("analytic_axes").select("id, code, name, sort_order, is_active")),
    check<RawValue[]>(db.from("analytic_values").select("id, axis_id, code, name, parent_id, valid_from, valid_to, is_active")),
    check<RawRule[]>(db.from("analytic_rules").select("axis_id, account_prefix, requirement")),
    check<boolean>(db.rpc("is_tenant_admin")),
    check<boolean>(db.rpc("tenant_has_any_role", { _roles: ["admin", "accountant"] })),
  ]);
  return buildAnalyticsSetup({ canManageAxes: Boolean(canManageAxes), canManageValues: Boolean(canManageValues), axes, values, rules });
}

export function useAnalyticsSetup() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["analytics-setup", tenantId, source()],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: () => (isApiEnabled() ? apiGet<AnalyticsSetup>("/api/v1/analytics") : fetchFromSupabase()),
  });
}

export interface AxisInput { code: string; name: string; sortOrder?: number }
export interface AxisUpdate { id: string; name: string; sortOrder?: number; active: boolean }
export interface ValueInput { axisId: string; code: string; name: string; parentId?: string; validFrom?: string; validTo?: string }
export interface ValueUpdate { id: string; name: string; parentId?: string; validFrom?: string; validTo?: string; active: boolean }
export interface RuleInput { axisId: string; prefix: string; requirement: "required" | "forbidden" }

/** Une mutation de paramétrage : invalide la vue, annonce le résultat, montre le refus tel quel. */
function useSetupMutation<I>(run: (input: I) => Promise<unknown>, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["analytics-setup"] });
      toast.success(success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

const orNull = (s?: string) => (s && s.length > 0 ? s : null);

export function useCreateAnalyticAxis() {
  return useSetupMutation(async (a: AxisInput) => {
    if (isApiEnabled()) return apiPost("/api/v1/analytics/axes", a);
    return check(db.from("analytic_axes").insert({ tenant_id: await fetchTenantId(), code: a.code, name: a.name.trim(), sort_order: a.sortOrder ?? 0 }).select("id"));
  }, "Axe créé");
}

export function useUpdateAnalyticAxis() {
  return useSetupMutation(async (a: AxisUpdate) => {
    if (isApiEnabled()) return apiPut(`/api/v1/analytics/axes/${a.id}`, { name: a.name, sortOrder: a.sortOrder, active: a.active });
    return checkTouched(db.from("analytic_axes").update({ name: a.name.trim(), is_active: a.active, ...(a.sortOrder !== undefined ? { sort_order: a.sortOrder } : {}) }).eq("id", a.id).select("id"));
  }, "Axe enregistré");
}

export function useCreateAnalyticValue() {
  return useSetupMutation(async (v: ValueInput) => {
    const body = { code: v.code.trim(), name: v.name.trim(), parentId: orNull(v.parentId), validFrom: orNull(v.validFrom), validTo: orNull(v.validTo) };
    if (isApiEnabled()) return apiPost(`/api/v1/analytics/axes/${v.axisId}/values`, body);
    return check(db.from("analytic_values").insert({
      tenant_id: await fetchTenantId(), axis_id: v.axisId, code: body.code, name: body.name,
      parent_id: body.parentId, valid_from: body.validFrom, valid_to: body.validTo,
    }).select("id"));
  }, "Section créée");
}

export function useUpdateAnalyticValue() {
  return useSetupMutation(async (v: ValueUpdate) => {
    const body = { name: v.name.trim(), parentId: orNull(v.parentId), validFrom: orNull(v.validFrom), validTo: orNull(v.validTo), active: v.active };
    if (isApiEnabled()) return apiPut(`/api/v1/analytics/values/${v.id}`, body);
    return checkTouched(db.from("analytic_values").update({
      name: body.name, parent_id: body.parentId, valid_from: body.validFrom, valid_to: body.validTo, is_active: body.active,
    }).eq("id", v.id).select("id"));
  }, "Section enregistrée");
}

export function useSetAnalyticRule() {
  return useSetupMutation(async (r: RuleInput) => {
    if (isApiEnabled()) return apiPut(`/api/v1/analytics/axes/${r.axisId}/rules/${encodeURIComponent(r.prefix)}`, { requirement: r.requirement });
    return check(db.from("analytic_rules").upsert(
      { tenant_id: await fetchTenantId(), axis_id: r.axisId, account_prefix: r.prefix, requirement: r.requirement },
      { onConflict: "axis_id,account_prefix" },
    ).select("axis_id"));
  }, "Règle enregistrée");
}

export function useDeleteAnalyticRule() {
  return useSetupMutation(async (r: { axisId: string; prefix: string }) => {
    if (isApiEnabled()) return apiDelete(`/api/v1/analytics/axes/${r.axisId}/rules/${encodeURIComponent(r.prefix)}`);
    return checkTouched(db.from("analytic_rules").delete().eq("axis_id", r.axisId).eq("account_prefix", r.prefix).select("axis_id"));
  }, "Règle retirée");
}
