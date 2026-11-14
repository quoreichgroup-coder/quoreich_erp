import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { moduleCan, useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantId } from "@/hooks/use-tenant";
import { toast } from "sonner";
import { useTenantRoleMembers } from "@/hooks/use-role-members";

/* ============================================================
 * Items
 * ============================================================ */
export function useItems() {
  return useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("items").select("*").order("code");
      if (error) throw error;
      return data || [];
    },
  });
}

export function useCreateItem() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: {
      code: string; name: string; category?: string; unit?: string;
      unit_cost?: number; selling_price?: number; reorder_level?: number;
      safety_stock?: number; max_stock?: number; default_warehouse_id?: string;
      valuation_method?: string;
    }) => {
      const { error } = await supabase.from("items").insert({ ...input, tenant_id: tenantId! } as never);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["items"] }); toast.success("Article créé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: unknown }) => {
      const { data, error } = await (supabase as any).from("items").update(updates).eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Modification refusée : droit « Mouvements de stock » requis.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["items"] }); toast.success("Article mis à jour"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ============================================================
 * Warehouses
 * ============================================================ */
export function useWarehouses() {
  return useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("warehouses" as never).select("*").order("code");
      if (error) throw error;
      return (data as unknown as Array<{ id: string; code: string; name: string; is_default: boolean; status: string; address: string | null }>) || [];
    },
  });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: { code: string; name: string; address?: string; is_default?: boolean }) => {
      const { error } = await supabase.from("warehouses" as never).insert({ ...input, tenant_id: tenantId! } as never);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["warehouses"] }); toast.success("Entrepôt créé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; code?: string; name?: string; address?: string | null; status?: string }) => {
      const { data, error } = await (supabase as any).from("warehouses").update(updates).eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Modification refusée : droit « Mouvements de stock » requis.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["warehouses"] }); toast.success("Dépôt mis à jour"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useItemLocations(itemId?: string) {
  return useQuery({
    queryKey: ["item-locations", itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("item_locations" as never)
        .select("*, warehouse:warehouses(code, name)")
        .eq("item_id", itemId!);
      if (error) throw error;
      return (data as unknown as Array<Record<string, unknown>>) || [];
    },
  });
}

/* ============================================================
 * Stock movements (live + audit view)
 * ============================================================ */
export function useStockMovements(filters?: { from?: string; to?: string; itemId?: string; warehouseId?: string }) {
  return useQuery({
    queryKey: ["stock-movements", filters],
    queryFn: async () => {
      let q = supabase
        .from("stock_movements")
        .select("*, item:items(name, code), warehouse:warehouses(code, name)")
        .order("movement_date", { ascending: false })
        .limit(500);
      if (filters?.from) q = q.gte("movement_date", filters.from);
      if (filters?.to) q = q.lte("movement_date", filters.to);
      if (filters?.itemId) q = q.eq("item_id", filters.itemId);
      if (filters?.warehouseId) q = q.eq("warehouse_id", filters.warehouseId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

export function useStockMovementsAudit(filters?: { from?: string; to?: string; itemId?: string }) {
  return useQuery({
    queryKey: ["stock-movements-audit", filters],
    queryFn: async () => {
      let q = supabase.from("stock_movements_audit_view" as never).select("*").order("movement_date", { ascending: false }).limit(500);
      if (filters?.from) q = q.gte("movement_date", filters.from);
      if (filters?.to) q = q.lte("movement_date", filters.to);
      if (filters?.itemId) q = q.eq("item_id", filters.itemId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as Array<Record<string, unknown>>) || [];
    },
  });
}

/** Tous les mouvements de la société, pages épuisées (pas de troncature à 500 pour les listes et exports). */
export function useAllStockMovements() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["stock-movements", "all", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const rows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await (supabase as any).from("stock_movements")
          .select("*, item:items(name, code, unit), warehouse:warehouses(code, name), entry:journal_entries(piece_number)")
          .eq("tenant_id", tenantId)
          .order("movement_date", { ascending: false }).order("created_at", { ascending: false })
          .range(from, from + 999);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return rows;
    },
  });
}

const STOCK_KEYS = ["stock-movements", "items", "stock-valuation", "inventory-kpis", "inventory-kpis-view", "item-locations",
  "journal-entries", "gl-batches", "low-stock"];

/**
 * Ajustement de stock motivé (V53, droit inventory.adjust) : les mouvements ne s'écrivent plus
 * directement dans la table ; la base valorise une sortie au coût moyen et passe l'écriture.
 */
export function useCreateStockAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { item_id: string; warehouse_id: string | null; quantity: number; unit_cost: number; date: string; reason: string }) => {
      const { error } = await (supabase as any).rpc("create_stock_adjustment", {
        _item_id: input.item_id, _warehouse_id: input.warehouse_id, _quantity: input.quantity, _unit_cost: input.unit_cost,
        _movement_date: input.date, _reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const k of STOCK_KEYS) qc.invalidateQueries({ queryKey: [k] });
      toast.success("Ajustement enregistré et comptabilisé");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useTransferStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { item_id: string; from_wh: string; to_wh: string; qty: number; notes?: string }) => {
      const { error } = await supabase.rpc("transfer_stock" as never, {
        _item_id: input.item_id, _from_wh: input.from_wh, _to_wh: input.to_wh, _qty: input.qty, _notes: input.notes ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      for (const k of STOCK_KEYS) qc.invalidateQueries({ queryKey: [k] });
      toast.success("Transfert effectué");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ============================================================
 * Inventory counts
 * ============================================================ */
export function useInventoryCounts() {
  return useQuery({
    queryKey: ["inventory-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts" as never)
        .select("*, warehouse:warehouses(code, name)")
        .order("count_date", { ascending: false });
      if (error) throw error;
      return (data as unknown as Array<Record<string, unknown>>) || [];
    },
  });
}

export function useInventoryCountLines(countId?: string) {
  return useQuery({
    queryKey: ["inventory-count-lines", countId],
    enabled: !!countId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_count_lines" as never)
        .select("*, item:items(code, name, unit)")
        .eq("count_id", countId!);
      if (error) throw error;
      return (data as unknown as Array<Record<string, unknown>>) || [];
    },
  });
}

export function useCreateInventoryCount() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { count_number: string; warehouse_id?: string; count_date?: string; notes?: string }) => {
      const { error } = await supabase.from("inventory_counts" as never).insert({
        ...input, tenant_id: tenantId!, created_by: user?.id, status: "draft",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory-counts"] }); toast.success("Inventaire créé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostInventoryCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (countId: string) => {
      const { error } = await supabase.rpc("post_inventory_count" as never, { _count_id: countId } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory-counts"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stock-movements"] });
      toast.success("Inventaire validé");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ============================================================
 * Reporting views
 * ============================================================ */
export function useStockValuation() {
  return useQuery({
    queryKey: ["stock-valuation"],
    queryFn: async () => {
      const { data, error } = await supabase.from("stock_valuation_view" as never).select("*").order("stock_value", { ascending: false });
      if (error) throw error;
      return (data as unknown as Array<{ item_id: string; code: string; name: string; quantity_on_hand: number; average_cost: number; stock_value: number; warehouse_code: string | null; warehouse_name: string | null }>) || [];
    },
  });
}

export function useLowStockAlerts() {
  return useQuery({
    queryKey: ["low-stock"],
    queryFn: async () => {
      const { data, error } = await supabase.from("low_stock_alerts_view" as never).select("*").order("gap", { ascending: false });
      if (error) throw error;
      return (data as unknown as Array<{ item_id: string; code: string; name: string; quantity_on_hand: number; threshold: number; gap: number }>) || [];
    },
  });
}

export function useInventoryKpisView() {
  return useQuery({
    queryKey: ["inventory-kpis-view"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_kpis_view" as never).select("*").maybeSingle();
      if (error) throw error;
      return data as unknown as { active_items: number; low_stock_items: number; out_of_stock_items: number; total_stock_value: number } | null;
    },
  });
}

export type AbcRow = { item_id: string; code: string; name: string; category: string | null; revenue_12m: number; qty_12m: number; cum_pct: number; abc_class: "A" | "B" | "C" };
export function useAbcAnalysis() {
  return useQuery({
    queryKey: ["inventory-abc"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_abc_view" as never)
        .select("*")
        .order("revenue_12m", { ascending: false });
      if (error) throw error;
      return (data as unknown as AbcRow[]) || [];
    },
  });
}

export type SlowMovingRow = { item_id: string; code: string; name: string; category: string | null; quantity_on_hand: number; unit_cost: number; stock_value: number; last_outbound_date: string | null; movement_class: "Actif" | "Lent" | "Mort" | "Dormant" };
export function useSlowMovingItems() {
  return useQuery({
    queryKey: ["inventory-slow-moving"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_slow_moving_view" as never)
        .select("*")
        .order("stock_value", { ascending: false });
      if (error) throw error;
      return (data as unknown as SlowMovingRow[]) || [];
    },
  });
}

export type InventoryVarianceRow = { count_id: string; count_number: string; count_date: string; status: string; warehouse_code: string | null; warehouse_name: string | null; items_checked: number; items_matched: number; items_variance: number; total_value_diff: number };
export function useInventoryVariance() {
  return useQuery({
    queryKey: ["inventory-variance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_variance_view" as never)
        .select("*")
        .order("count_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as unknown as InventoryVarianceRow[]) || [];
    },
  });
}

export type InventoryPeriodClose = {
  id: string;
  period: string;
  closed_at: string;
  closed_by: string | null;
  total_value: number;
  total_qty: number;
  items_count: number;
  snapshot: unknown;
};
export function useInventoryPeriodCloses() {
  return useQuery({
    queryKey: ["inventory-period-closes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_period_closes" as never)
        .select("id, period, closed_at, closed_by, total_value, total_qty, items_count, snapshot")
        .order("period", { ascending: false });
      if (error) throw error;
      return (data as unknown as InventoryPeriodClose[]) || [];
    },
  });
}

export type PagedClosesParams = {
  page: number;          // 1-indexed
  pageSize: number;
  sortKey: "period" | "closed_at";
  sortDir: "asc" | "desc";
  from?: string;         // YYYY-MM-DD
  to?: string;           // YYYY-MM-DD
  periodSearch?: string; // ilike on period
};

export function useInventoryPeriodClosesPaged(p: PagedClosesParams) {
  return useQuery({
    queryKey: ["inventory-period-closes-paged", p],
    queryFn: async () => {
      let q = supabase
        .from("inventory_period_closes" as never)
        .select("id, period, closed_at, closed_by, total_value, total_qty, items_count, snapshot", { count: "exact" })
        .order(p.sortKey, { ascending: p.sortDir === "asc" });
      if (p.from) q = q.gte("closed_at", `${p.from}T00:00:00`);
      if (p.to)   q = q.lte("closed_at", `${p.to}T23:59:59`);
      if (p.periodSearch?.trim()) q = q.ilike("period", `%${p.periodSearch.trim()}%`);
      const start = (Math.max(1, p.page) - 1) * p.pageSize;
      q = q.range(start, start + p.pageSize - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data as unknown as InventoryPeriodClose[]) || [], count: count ?? 0 };
    },
    placeholderData: (prev) => prev,
  });
}

export type FetchAllOpts = {
  chunkSize?: number;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
};

/**
 * Streams every row matching the server-side filters in chunks (default 500/req).
 * No artificial cap — pull all results. `signal` interrompt aussi la requête en cours : vérifié
 * seulement entre deux pages, un export d'une seule page ne pouvait jamais être annulé.
 */
export async function fetchAllInventoryCloses(
  p: Omit<PagedClosesParams, "page" | "pageSize">,
  opts: FetchAllOpts = {},
): Promise<InventoryPeriodClose[]> {
  const chunkSize = Math.max(100, Math.min(1000, opts.chunkSize ?? 500));
  const build = (withCount: boolean) => {
    let q = supabase
      .from("inventory_period_closes" as never)
      .select(
        "id, period, closed_at, closed_by, total_value, total_qty, items_count, snapshot",
        withCount ? { count: "exact" } : undefined,
      )
      .order(p.sortKey, { ascending: p.sortDir === "asc" });
    if (p.from) q = q.gte("closed_at", `${p.from}T00:00:00`);
    if (p.to)   q = q.lte("closed_at", `${p.to}T23:59:59`);
    if (p.periodSearch?.trim()) q = q.ilike("period", `%${p.periodSearch.trim()}%`);
    if (opts.signal) q = q.abortSignal(opts.signal);
    return q;
  };
  const stopIfAborted = () => { if (opts.signal?.aborted) throw new Error("Export annulé"); };

  stopIfAborted();
  const first = await build(true).range(0, chunkSize - 1);
  stopIfAborted();
  if (first.error) throw first.error;
  const total = first.count ?? 0;
  const all: InventoryPeriodClose[] = (first.data as unknown as InventoryPeriodClose[]) ?? [];
  opts.onProgress?.(all.length, total);

  while (all.length < total) {
    stopIfAborted();
    const next = await build(false).range(all.length, all.length + chunkSize - 1);
    stopIfAborted();
    if (next.error) throw next.error;
    const rows = (next.data as unknown as InventoryPeriodClose[]) ?? [];
    if (rows.length === 0) break;
    all.push(...rows);
    opts.onProgress?.(all.length, total);
  }
  return all;
}

/* ============================================================
 * Export audit — CSV/PDF success / aborted / failed
 * ============================================================ */
export type InventoryExportAuditInput = {
  tenantId: string;
  userId: string;
  kind: "csv" | "pdf";
  status: "success" | "aborted" | "failed";
  rowCount: number;
  filters: Record<string, unknown>;
  error?: string | null;
};

export async function logInventoryExportAudit(input: InventoryExportAuditInput): Promise<void> {
  const action =
    input.status === "aborted" ? "export_aborted" :
    input.status === "failed"  ? "export_failed"  :
    input.kind === "csv"       ? "export_csv"     : "export_pdf";
  const payload = {
    kind: input.kind,
    rows: input.rowCount,
    filters: input.filters,
    ...(input.error ? { error: input.error.slice(0, 240) } : {}),
  };
  const comment = `historique-clotures — ${JSON.stringify(payload)}`.slice(0, 500);
  try {
    await supabase.from("inventory_role_audit" as never).insert({
      tenant_id: input.tenantId,
      target_user_id: input.userId,
      role: "inventory_controller",
      action,
      performed_by: input.userId,
      comment,
    } as never);
  } catch {
    /* best-effort */
  }
}



export function useCloseInventoryPeriod() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (period: string) => {
      const { data, error } = await supabase.rpc("close_inventory_period" as never, { _period: period } as never);
      if (error) throw error;
      return data as unknown as InventoryPeriodClose | null;
    },
    onMutate: async (period: string) => {
      const toastId = toast.loading(`Clôture de la période ${period} en cours…`);
      // Best-effort audit trail: record the launch attempt (RLS-checked).
      if (tenantId && user?.id) {
        await supabase.from("inventory_role_audit" as never).insert({
          tenant_id: tenantId,
          target_user_id: user.id,
          role: "inventory_controller",
          action: "period_close_attempt",
          performed_by: user.id,
          comment: period,
        } as never);
      }
      return { toastId, period };
    },
    onSuccess: (row, period, ctx) => {
      qc.invalidateQueries({ queryKey: ["inventory-period-closes"] });
      qc.invalidateQueries({ queryKey: ["inventory-period-closes-paged"] });
      qc.invalidateQueries({ queryKey: ["inventory-period-locks"] });
      qc.invalidateQueries({ queryKey: ["inventory-close-audit"] });
      const msg = row
        ? `Période ${period} clôturée — ${row.items_count} article(s), ${Math.round(Number(row.total_value || 0)).toLocaleString("fr-FR")} XOF`
        : `Période ${period} clôturée`;
      toast.success(msg, { id: ctx?.toastId });
    },
    onError: async (e: Error, period, ctx) => {
      toast.error(`Échec clôture ${period} — ${e.message}`, { id: ctx?.toastId });
      if (tenantId && user?.id) {
        await supabase.from("inventory_role_audit" as never).insert({
          tenant_id: tenantId,
          target_user_id: user.id,
          role: "inventory_controller",
          action: "period_close_failed",
          performed_by: user.id,
          comment: `${period} — ${e.message}`.slice(0, 500),
        } as never);
        qc.invalidateQueries({ queryKey: ["inventory-close-audit"] });
      }
    },
  });
}


/**
 * Périodes de stock clôturées. Les colonnes s'appellent closed_at / closed_by et le module
 * INVENTORY depuis V33 : la lecture précédente (locked_at, module « inventory ») ne renvoyait
 * qu'une erreur.
 */
export type InventoryPeriodLock = { id: string; period: string; module: string; locked_at: string; locked_by: string | null };
export function useInventoryPeriodLocks() {
  return useQuery({
    queryKey: ["inventory-period-locks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("period_locks" as never)
        .select("id, period, module, locked_at:closed_at, locked_by:closed_by")
        .eq("module", "INVENTORY")
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as unknown as InventoryPeriodLock[]) || [];
    },
  });
}

export type InventoryCloseAuditRow = { id: string; action: string; performed_by: string | null; comment: string | null; created_at: string };
export function useInventoryCloseAudit() {
  return useQuery({
    queryKey: ["inventory-close-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_role_audit" as never)
        .select("id, action, performed_by, comment, created_at")
          .in("action", ["period_close", "period_close_idempotent", "period_close_attempt", "period_close_failed"])

        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as unknown as InventoryCloseAuditRow[]) || [];
    },
  });
}

export function useValuationByCategory() {
  return useQuery({
    queryKey: ["inventory-valuation-by-category"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_valuation_by_category_view" as never)
        .select("*")
        .order("avg_cost_value", { ascending: false });
      if (error) throw error;
      return (data as unknown as Array<{ category: string; items_count: number; total_qty: number; fifo_value: number; avg_cost_value: number; variance: number }>) || [];
    },
  });
}

export function useInventoryTurnover() {
  return useQuery({
    queryKey: ["inventory-turnover"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_turnover_view" as never)
        .select("*")
        .order("turnover_ratio", { ascending: false });
      if (error) throw error;
      return (data as unknown as Array<{ category: string; inv_value: number; cogs_12m: number; turnover_ratio: number; days_on_hand: number | null }>) || [];
    },
  });
}

export function useStockAging() {
  return useQuery({
    queryKey: ["stock-aging"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_aging_view" as never)
        .select("*");
      if (error) throw error;
      return (data as unknown as Array<{ age_bucket: string; stock_value: number; qty_remaining: number; items_count: number }>) || [];
    },
  });
}

/* ============================================================
 * Settings & RBAC
 * ============================================================ */
export function useInventorySettings() {
  return useQuery({
    queryKey: ["inventory-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_settings" as never).select("*").maybeSingle();
      if (error) throw error;
      return data as unknown as Record<string, unknown> | null;
    },
  });
}

export function useUpdateInventorySettings() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { error } = await supabase
        .from("inventory_settings" as never)
        .upsert({ tenant_id: tenantId!, ...updates } as never, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory-settings"] }); toast.success("Paramètres mis à jour"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export type InventoryRole = "inventory_clerk" | "inventory_manager" | "inventory_controller";

export const INVENTORY_ROLE_LABELS: Array<{ value: InventoryRole; label: string }> = [
  { value: "inventory_clerk",      label: "Magasinier — saisie mouvements, comptages" },
  { value: "inventory_manager",    label: "Responsable Stock — ajustements, validation comptages" },
  { value: "inventory_controller", label: "Contrôleur Stock — supervision, export, audit" },
];

const INV_ROLES: InventoryRole[] = ["inventory_clerk", "inventory_manager", "inventory_controller"];

export function useMyInventoryRoles() {
  // Droits dits par la base (my_access, V27). La clôture suit inventory.close (réservée de fait
  // à admin, comme la base) ; l'export CSV, action du navigateur sans équivalent au catalogue,
  // reste par rôle.
  const q = useMyAccess();
  const can = moduleCan(q.data, "inventory");
  const roles = q.data?.roles ?? [];
  const isAdmin = roles.includes("admin");
  const hasRole = (r: string) => isAdmin || roles.includes(r);
  return {
    ...q,
    data: q.data && {
      roles,
      isAdmin,
      canMove:      can("move"),
      canAdjust:    can("adjust"),
      canTransfer:  can("transfer"),
      canCount:     can("count"),
      canPostCount: can("post_count"),
      canClose:     can("close"),
      canExport:    hasRole("inventory_manager") || hasRole("inventory_controller"),
    },
  };
}

export function useTenantInventoryRoles() {
  return useTenantRoleMembers("tenant-inventory-roles", INV_ROLES);
}

export function useInventoryRoleAudit() {
  return useQuery({
    queryKey: ["inventory-role-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_role_audit" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data as unknown as Array<Record<string, unknown>>) || [];
    },
  });
}

export function useAssignInventoryRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: InventoryRole; action: "assign" | "revoke"; comment?: string }) => {
      const { error } = await supabase.rpc("assign_inventory_role" as never, {
        _target_user: input.target_user, _role: input.role, _action: input.action, _comment: input.comment ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-inventory-roles"] });
      qc.invalidateQueries({ queryKey: ["inventory-role-audit"] });
      // Droits de l'utilisateur (my_access, V27) et matrice de /settings : le rôle y est recopié.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      qc.invalidateQueries({ queryKey: ["authorizations"] });
      toast.success("Rôle mis à jour");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ============================================================
 * Dashboard KPIs (legacy aggregation, kept for compatibility)
 * ============================================================ */
export function useInventoryKpis() {
  const { data: items = [] } = useItems();
  const { data: movements = [] } = useStockMovements();

  const totalSKUs = items.length;
  const totalValue = items.reduce((s, i) => s + Number(i.quantity_on_hand) * Number((i as { average_cost?: number }).average_cost ?? i.unit_cost ?? 0), 0);
  const lowStockItems = items.filter((i) => i.reorder_level && Number(i.quantity_on_hand) <= Number(i.reorder_level));
  const activeItems = items.filter((i) => i.status === "active").length;

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const mtdMovements = movements.filter((m) => m.movement_date >= monthStart);
  const inbound = mtdMovements.filter((m) => m.movement_type === "receipt" || m.movement_type === "inbound" || m.movement_type === "transfer_in");
  const outbound = mtdMovements.filter((m) => m.movement_type === "issue" || m.movement_type === "outbound" || m.movement_type === "delivery" || m.movement_type === "transfer_out");

  return { totalSKUs, totalValue, lowStockItems, activeItems, inbound, outbound, items, movements };
}
