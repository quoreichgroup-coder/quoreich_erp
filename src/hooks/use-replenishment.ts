import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";

/*
 * Réapprovisionnement (V54) : catalogue fournisseur et règles (écriture directe, droit
 * procurement.replenish contrôlé par la RLS), propositions (lecture seule, fonctions dédiées).
 */
const db = supabase as any;
const KEYS = ["supplier-items", "replenishment-rules", "replenishment-proposals", "stock-projection", "purchase-requisitions", "procurement-kpis"];
const invalidate = (qc: ReturnType<typeof useQueryClient>) => { for (const k of KEYS) qc.invalidateQueries({ queryKey: [k] }); };
/** Une écriture filtrée par la RLS ne renvoie pas d'erreur : la signaler. */
const touched = (data: unknown[] | null) => {
  if (!data?.length) throw new Error("Opération refusée : droit « Paramétrer et lancer le réapprovisionnement » requis.");
};

export function useSupplierItems() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["supplier-items", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("supplier_items")
        .select("*, supplier:suppliers(name), item:items(code, name, unit)").eq("tenant_id", tenantId).order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function useSaveSupplierItem() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async ({ id, ...row }: { id?: string; [k: string]: unknown }) => {
      const q = id ? db.from("supplier_items").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id)
        : db.from("supplier_items").insert({ ...row, tenant_id: tenantId });
      const { data, error } = await q.select("id");
      if (error) throw error;
      touched(data);
    },
    onSuccess: () => { invalidate(qc); toast.success("Catalogue fournisseur enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteSupplierItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await db.from("supplier_items").delete().eq("id", id).select("id");
      if (error) throw error;
      touched(data);
    },
    onSuccess: () => { invalidate(qc); toast.success("Ligne de catalogue supprimée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useReplenishmentRules() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["replenishment-rules", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("item_replenishment_rules")
        .select("*, item:items(code, name, unit), warehouse:warehouses(code, name)").eq("tenant_id", tenantId).order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function useSaveReplenishmentRule() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async ({ id, ...row }: { id?: string; [k: string]: unknown }) => {
      const q = id ? db.from("item_replenishment_rules").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id)
        : db.from("item_replenishment_rules").insert({ ...row, tenant_id: tenantId });
      const { data, error } = await q.select("id");
      if (error) throw error;
      touched(data);
    },
    onSuccess: () => { invalidate(qc); toast.success("Règle de réapprovisionnement enregistrée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteReplenishmentRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await db.from("item_replenishment_rules").delete().eq("id", id).select("id");
      if (error) throw error;
      touched(data);
    },
    onSuccess: () => { invalidate(qc); toast.success("Règle supprimée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useStockProjection() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["stock-projection", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("stock_projection_view").select("*").eq("tenant_id", tenantId);
      if (error) throw error;
      return (data ?? []) as { item_id: string; on_hand: number; on_order: number; reserved: number; projected: number }[];
    },
  });
}

export function useReplenishmentProposals() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["replenishment-proposals", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("replenishment_proposals")
        .select("*, item:items(code, name, unit), warehouse:warehouses(code, name), supplier:suppliers(name), requisition:purchase_requisitions(pr_number)")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function useGenerateReplenishment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("generate_replenishment_proposals");
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (n) => { invalidate(qc); toast.success(n === 0 ? "Aucun besoin : tous les articles suivis sont au-dessus de leur seuil" : `${n} proposition(s) de réapprovisionnement`); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useConvertReplenishment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await db.rpc("convert_replenishment_proposals", { _ids: ids });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (n) => { invalidate(qc); toast.success(`${n} demande(s) d'achat brouillon créée(s)`); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDismissReplenishment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await db.rpc("dismiss_replenishment_proposal", { _id: id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(qc); toast.success("Proposition écartée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
