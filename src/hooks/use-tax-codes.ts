import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId, fetchTenantId } from "@/hooks/use-tenant";
import { apiGet, apiPost, apiPut, isApiEnabled } from "@/api/client";
import type { TaxCode } from "@/lib/invoice-lines";

/*
 * Codes TVA (V21). Deux sources, une forme (voir use-accounting-setup.ts). Le taux d'un code est
 * figé par la base : il n'y a donc pas de modification de taux ici, seulement nom, activation et
 * compte de TVA.
 */
const db = supabase as any;
const source = () => (isApiEnabled() ? "api" : "supabase");

async function check<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

interface RawTaxCode {
  id: string; code: string; name: string; rate: number; gl_account_id: string | null; is_active: boolean;
  gl_accounts: { code: string } | null;
}

export function useTaxCodes() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["tax-codes", tenantId, source()],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async (): Promise<TaxCode[]> => {
      if (isApiEnabled()) return apiGet<TaxCode[]>("/api/v1/accounting/tax-codes");
      const rows = await check<RawTaxCode[]>(
        db.from("tax_codes").select("id, code, name, rate, gl_account_id, is_active, gl_accounts(code)").order("code"),
      );
      return rows.map((r) => ({
        id: r.id, code: r.code, name: r.name, rate: Number(r.rate), active: r.is_active,
        glAccountId: r.gl_account_id ?? undefined, accountCode: r.gl_accounts?.code,
      }));
    },
  });
}

function useTaxMutation<I>(run: (i: I) => Promise<unknown>, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tax-codes"] }); toast.success(success); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateTaxCode() {
  return useTaxMutation(async (t: { code: string; name: string; rate: number; glAccountId?: string }) => {
    if (isApiEnabled()) return apiPost("/api/v1/accounting/tax-codes", { ...t, glAccountId: t.glAccountId || null });
    return check(db.from("tax_codes").insert({
      tenant_id: await fetchTenantId(), code: t.code, name: t.name.trim(), rate: t.rate, gl_account_id: t.glAccountId || null,
    }).select("id"));
  }, "Code TVA créé");
}

export function useUpdateTaxCode() {
  return useTaxMutation(async (t: { id: string; name: string; active: boolean; glAccountId?: string }) => {
    if (isApiEnabled()) return apiPut(`/api/v1/accounting/tax-codes/${t.id}`, { name: t.name, active: t.active, glAccountId: t.glAccountId || null });
    const rows = await check<unknown[]>(db.from("tax_codes")
      .update({ name: t.name.trim(), is_active: t.active, gl_account_id: t.glAccountId || null }).eq("id", t.id).select("id"));
    // Sous la RLS, une ligne non autorisée est filtrée sans erreur : zéro ligne est un refus.
    if (!rows || rows.length === 0) throw new Error("Modification refusée : réservée à l'administrateur de la société");
    return rows;
  }, "Code TVA enregistré");
}
