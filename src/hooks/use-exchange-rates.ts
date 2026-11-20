import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { apiDelete, apiGet, apiPost, isApiEnabled } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";

/*
 * Devises (V124) : devise de la société, cours datés (référence BCEAO / BEAC sans société, cours propres à la
 * société qui priment ; droit currency.rates). Le cours d'une facture ou d'un paiement est choisi par la base
 * (exchange_rate_at) quand l'utilisateur n'en saisit pas.
 */
const db = supabase as any;

export interface ExchangeRate {
  id: string; tenant_id: string | null; base_currency: string; currency: string; rate_date: string; rate: number; source: string; created_at: string;
}

/** Devise de la société (XOF par défaut tant qu'elle n'est pas lue). */
export function useBaseCurrency() {
  const { data: tenantId } = useTenantId();
  const q = useQuery({
    queryKey: ["base-currency", tenantId],
    enabled: Boolean(tenantId),
    staleTime: Infinity,
    queryFn: async (): Promise<string> => {
      if (isApiEnabled()) return (await apiGet<{ currency: string }>("/api/v1/gl/company"))?.currency ?? "XOF";
      const { data, error } = await db.from("tenants").select("currency").eq("id", tenantId).single();
      if (error) throw error;
      return data?.currency ?? "XOF";
    },
  });
  return q.data ?? "XOF";
}

export function useExchangeRates() {
  const { data: tenantId } = useTenantId();
  const base = useBaseCurrency();
  return useQuery({
    queryKey: ["exchange-rates", tenantId, base],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<ExchangeRate[]> => {
      if (isApiEnabled()) return apiGet<ExchangeRate[]>("/api/v1/exchange-rates");
      const { data, error } = await db.from("exchange_rates").select("id, tenant_id, base_currency, currency, rate_date, rate, source, created_at")
        .eq("base_currency", base).order("currency").order("rate_date", { ascending: false }).limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Devises proposées pour une pièce : la devise de la société, celles qui ont un cours, et celle du tiers. */
export function currencyChoices(base: string, rates: ExchangeRate[], extra?: string | null): string[] {
  return [...new Set([base, ...rates.map((r) => r.currency), ...(extra ? [extra.toUpperCase()] : [])])];
}

export function useSaveExchangeRate() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const base = useBaseCurrency();
  return useMutation({
    mutationFn: async (r: { currency: string; rate_date: string; rate: number; source: string }) => {
      const body = { currency: r.currency.trim().toUpperCase(), rate_date: r.rate_date, rate: r.rate, source: r.source.trim() || "Saisie" };
      if (isApiEnabled()) { await apiPost("/api/v1/exchange-rates", body); return; }
      const { data, error } = await db.from("exchange_rates").insert({ ...body, tenant_id: tenantId, base_currency: base }).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Saisir les cours de change de la société » requis.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exchange-rates"] }); toast.success("Cours enregistré"); },
    onError: (e: Error) => toast.error(e.message.includes("exchange_rates_unique") ? "Un cours de cette devise existe déjà à cette date." : e.message),
  });
}

export function useDeleteExchangeRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (isApiEnabled()) { await apiDelete(`/api/v1/exchange-rates/${id}`); return; }
      const { data, error } = await db.from("exchange_rates").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : seul un cours de la société se supprime, avec le droit « Saisir les cours de change ».");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exchange-rates"] }); toast.success("Cours supprimé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
