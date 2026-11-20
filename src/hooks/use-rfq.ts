import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPut, isApiEnabled } from "@/api/client";
import { moduleRpc } from "@/api/rpc";
import { fetchTenantId, useTenantId } from "@/hooks/use-tenant";

/*
 * Demandes de prix (V139). Lecture : tables et vue rfq_comparison (nuage) ou routes /api/v1/procurement/rfqs (site).
 * Écriture : uniquement les fonctions create_rfq, rfq_set_suppliers, rfq_send, record_rfq_quote, award_rfq, rfq_cancel.
 */
const db = supabase as any;
const P = "/api/v1/procurement";

async function check<T>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await moduleRpc("procurement/rfqs", name, args);
  if (error) throw new Error(error.message);
  return data;
}

export function useRfqs() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["rfqs", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<any[]> => {
      if (isApiEnabled()) return apiGet<any[]>(`${P}/rfqs`);
      const rows = await check<any[]>(db.from("rfqs").select("*, requisition:purchase_requisitions(pr_number), lines:rfq_lines(id), suppliers:rfq_suppliers(status)")
        .order("created_at", { ascending: false }));
      return rows.map((r) => ({ ...r, pr_number: r.requisition?.pr_number ?? null, line_count: r.lines?.length ?? 0, supplier_count: r.suppliers?.length ?? 0,
        response_count: (r.suppliers ?? []).filter((s: any) => s.status === "responded").length }));
    },
  });
}

export function useRfqDetail(id: string | null) {
  const { data: tenantId } = useTenantId();
  const enabled = Boolean(tenantId && id);
  const q = (key: string, api: string, cloud: () => Promise<any[]>) => ({
    queryKey: ["rfq-" + key, tenantId, id], enabled,
    queryFn: async (): Promise<any[]> => (isApiEnabled() ? apiGet<any[]>(`${P}/rfqs/${id}/${api}`) : cloud()),
  });
  const lines = useQuery(q("lines", "lines", () => check(db.from("rfq_lines").select("*").eq("rfq_id", id).order("line_no"))));
  const suppliers = useQuery(q("suppliers", "suppliers", async () => (await check<any[]>(db.from("rfq_suppliers").select("*, supplier:suppliers(name)").eq("rfq_id", id)))
    .map((s) => ({ ...s, supplier_name: s.supplier?.name })).sort((a, b) => String(a.supplier_name).localeCompare(String(b.supplier_name)))));
  const comparison = useQuery(q("comparison", "comparison", () => check(db.from("rfq_comparison").select("*").eq("rfq_id", id).order("line_no").order("price_rank"))));
  const awards = useQuery(q("awards", "awards", async () => (await check<any[]>(db.from("rfq_awards").select("*, supplier:suppliers(name), po:purchase_orders(po_number)").eq("rfq_id", id)))
    .map((a) => ({ ...a, supplier_name: a.supplier?.name, po_number: a.po?.po_number }))));
  return { lines, suppliers, comparison, awards };
}

export function useRfqSettings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["rfq-settings", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<any> => isApiEnabled() ? apiGet<any>(`${P}/rfq-settings`) : check<any>(db.from("rfq_settings").select("*").maybeSingle()),
  });
}

export function useSaveRfqSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: any) => isApiEnabled() ? apiPut(`${P}/rfq-settings`, s)
      : check(db.from("rfq_settings").upsert({ tenant_id: await fetchTenantId(), ...s, updated_at: new Date().toISOString() })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rfq-settings"] }); toast.success("Réglages des demandes de prix enregistrés"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Une action du cycle de vie ; message de réussite selon le résultat. */
export function useRfqAction(name: string, success: (r: any) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: Record<string, unknown>) => rpc(name, args),
    onSuccess: (r) => {
      for (const k of ["rfqs", "rfq-lines", "rfq-suppliers", "rfq-comparison", "rfq-awards", "purchase-orders", "purchase-requisitions"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(success(r));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
