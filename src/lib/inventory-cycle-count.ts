import { supabase } from "@/integrations/supabase/client";
import type { InventoryCampaignItem } from "@/lib/inventory-campaign";

export type CycleBasis = "stock_value" | "outflow_value";
export const CYCLE_BASIS_LABEL: Record<CycleBasis, string> = {
  stock_value: "Valeur en stock au dépôt",
  outflow_value: "Sorties valorisées du dépôt",
};
export type CycleClass = "A" | "B" | "C" | "N";
export const CYCLE_CLASS_LABEL: Record<CycleClass, string> = { A: "Classe A", B: "Classe B", C: "Classe C", N: "Sans valeur" };
export type CyclePolicy = {
  basis: CycleBasis; lookback_months: number | null; a_percent: number; b_percent: number;
  a_days: number; b_days: number; c_days: number; unvalued_days: number | null; batch_size: number;
};
export type SavedCyclePolicy = { configured: false } | ({ configured: true } & CyclePolicy);
export type CyclePlan = {
  active_campaign: string | null;
  signature?: string;
  due_total?: number;
  basis?: CycleBasis;
  batch_size?: number;
  lines: (InventoryCampaignItem & { class: CycleClass; last_validated: string | null; due_date: string | null })[];
};
export type CycleAnalysis = { configured: false } | {
  configured: true;
  basis: CycleBasis;
  lookback_months: number | null;
  total_articles: number;
  due_total: number;
  total_weight: number;
  classes: { class: CycleClass; articles: number; due: number; weight: number }[];
  top: { item_id: string; code: string; name: string; class: CycleClass; weight: number;
    cumulative_percent: number | null; is_due: boolean }[];
};

export async function inventoryCyclePolicy(tenantId: string, policy?: CyclePolicy): Promise<SavedCyclePolicy> {
  const { data, error } = await supabase.rpc("inventory_cycle_policy" as never, {
    _action: policy ? "save" : "read", _expected_tenant: tenantId, ...(policy ? { _policy: policy } : {}),
  } as never);
  if (error) throw new Error(error.message);
  return data as SavedCyclePolicy;
}

export async function inventoryCyclePreview(tenantId: string, warehouse: string): Promise<CyclePlan> {
  const { data, error } = await supabase.rpc("inventory_cycle_prepare" as never, {
    _action: "preview", _warehouse: warehouse, _expected_tenant: tenantId,
  } as never);
  if (error) throw new Error(error.message);
  return data as CyclePlan;
}

export async function inventoryCycleOpen(tenantId: string, warehouse: string, signature: string): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc("inventory_cycle_prepare" as never, {
    _action: "open", _warehouse: warehouse, _expected_tenant: tenantId, _signature: signature,
  } as never);
  if (error) throw new Error(error.message);
  return data as { id: string };
}

export async function inventoryCycleAnalysis(tenantId: string, warehouse: string): Promise<CycleAnalysis> {
  const { data, error } = await supabase.rpc("inventory_cycle_analysis" as never, {
    _warehouse: warehouse, _expected_tenant: tenantId,
  } as never);
  if (error) throw new Error(error.message);
  return data as CycleAnalysis;
}
