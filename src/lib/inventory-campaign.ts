import { supabase } from "@/integrations/supabase/client";
import { invAudit, invRpc } from "@/lib/inventory-api";

export type InventoryCampaignItem = { item_id: string; code: string; name: string; unit: string };
export type InventoryCampaignPolicy = { percent: number | null; value: number | null };
export type InventoryCampaignReviewLine = InventoryCampaignItem & {
  expected: number;
  first_count: number | null;
  second_count: number | null;
  effective_count: number | null;
  variance: number | null;
  requires_recount: boolean;
  recount_requested: boolean;
  opening_unit_cost: number | null;
  movement_id?: string | null;
  journal_piece_number?: string | null;
  posted_unit_cost?: number | null;
  posted_value?: number | null;
};
export type InventoryCampaignReview = InventoryCampaignPolicy & {
  id: string;
  reference?: string | null;
  state: "submitted" | "validated";
  lines: InventoryCampaignReviewLine[];
};
export type InventoryCampaignRecount = {
  id: string;
  state: string;
  lines: InventoryCampaignItem[];
};
export type CampaignStage = "first" | "recount";
export type CampaignCountEntry = { item_id: string; quantity: number };
export type CampaignStatus = "counting" | "submitted" | "validated" | "cancelled";
export type CampaignSettingsItemScope = "warehouse" | "assigned" | "all_active";
export type CampaignItemScope = CampaignSettingsItemScope | "cycle";
export const CAMPAIGN_SCOPE_LABEL: Record<CampaignItemScope, string> = {
  warehouse: "Articles suivis dans le dépôt",
  assigned: "Articles suivis ou affectés au dépôt",
  all_active: "Tous les articles actifs de la société",
  cycle: "Inventaire tournant ABC",
};
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  counting: "Comptage en cours", submitted: "Soumise", validated: "Validée", cancelled: "Annulée",
};
export type CampaignCatalogRow = {
  id: string;
  reference: string | null;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  state: CampaignStatus;
  item_scope: CampaignItemScope;
  opened_at: string;
  updated_at: string;
  submitted_at: string | null;
  validated_at: string | null;
  cancelled_at: string | null;
  total_lines: number;
  counted_lines: number;
  recount_lines: number;
  recounted_lines: number;
};
export type CampaignCatalogFilters = { warehouse: string; state: CampaignStatus | ""; search: string };
export const CAMPAIGN_CATALOG_PARAMS = { warehouse: "catalogDepot", state: "catalogStatus", search: "catalogRef" } as const;
export type CampaignCatalogCursor = { opened_at: string; id: string };
export type CampaignCatalogPage = { campaigns: CampaignCatalogRow[]; next: CampaignCatalogCursor | null };
export type CampaignNumbering = { prefix: string | null; width: number | null; next: number | null };
export type CampaignEvent = {
  event: "opened" | "submitted" | "validated" | "cancelled";
  date: string;
  actor: string;
  reason: string | null;
};

export function campaignTabTarget(current: URLSearchParams, tab: string, context?: { warehouse?: string; campaign?: string }) {
  const next = new URLSearchParams({ tab });
  for (const key of Object.values(CAMPAIGN_CATALOG_PARAMS)) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }
  if (context?.warehouse) next.set("depot", context.warehouse);
  if (context?.campaign) next.set("campaign", context.campaign);
  return `?${next}`;
}

export async function inventoryCampaignControl<Result>(
  action: "active_review" | "review" | "request_recount" | "validate" | "recount_tasks" | "count_again",
  id: string,
  count?: { item: string; quantity: number },
): Promise<Result> {
  const { data, error } = await invRpc("inventory_campaign_control", {
    _action: action, _id: id, ...(count ? { _item: count.item, _quantity: count.quantity } : {}),
  } as never);
  if (error) throw new Error(error.message);
  return data as Result;
}

export async function inventoryCampaignPolicy(tenantId: string, policy?: InventoryCampaignPolicy): Promise<InventoryCampaignPolicy> {
  const { data, error } = await invRpc("inventory_campaign_policy", (policy
    ? { _action: "save", _percent: policy.percent, _value: policy.value, _expected_tenant: tenantId }
    : { _action: "read", _expected_tenant: tenantId }) as never);
  if (error) throw new Error(error.message);
  return data as InventoryCampaignPolicy;
}

export async function inventoryCampaignNumbering(tenantId: string, series?: CampaignNumbering): Promise<CampaignNumbering> {
  const { data, error } = await invRpc("inventory_campaign_numbering", (series
    ? { _action: "save", _prefix: series.prefix, _width: series.width, _next: series.next, _expected_tenant: tenantId }
    : { _action: "read", _expected_tenant: tenantId }) as never);
  if (error) throw new Error(error.message);
  return data as CampaignNumbering;
}

export async function fetchCampaignCatalog(
  tenantId: string, filters: CampaignCatalogFilters, cursor: CampaignCatalogCursor | null = null, forExport = false,
): Promise<CampaignCatalogPage> {
  const { data, error } = await invRpc("inventory_campaign_catalog", {
    _warehouse: filters.warehouse || null, _state: filters.state || null, _search: filters.search.trim() || null,
    _before: cursor?.opened_at ?? null, _before_id: cursor?.id ?? null, _export: forExport, _expected_tenant: tenantId,
  } as never);
  if (error) throw new Error(error.message);
  return data as CampaignCatalogPage;
}

export async function previewCampaignScope(tenantId: string, warehouse: string): Promise<{ item_scope: CampaignItemScope; articles: number }> {
  const { data, error } = await invRpc("inventory_campaign_preview", {
    _warehouse: warehouse, _expected_tenant: tenantId,
  } as never);
  if (error) throw new Error(error.message);
  return data as { item_scope: CampaignItemScope; articles: number };
}

export async function fetchCampaignTimeline(tenantId: string, campaign: string): Promise<CampaignEvent[]> {
  const { data, error } = await invRpc("inventory_campaign_timeline", {
    _campaign: campaign, _expected_tenant: tenantId,
  } as never);
  if (error) throw new Error(error.message);
  return data as CampaignEvent[];
}

export async function saveInventoryCampaignCounts<Result>(campaign: string, stage: CampaignStage, entries: CampaignCountEntry[]) {
  const { data, error } = await invRpc("inventory_campaign_save_counts", {
    _campaign: campaign, _stage: stage, _entries: entries,
  } as never);
  if (error) throw new Error(error.message);
  return data as Result;
}

export const parseInventoryDecimal = (raw: string) => {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(value)) return NaN;
  const [digits, decimals = ""] = value.replace(",", ".").split(".");
  const fraction = decimals.replace(/0+$/, "");
  const canonical = digits.replace(/^0+(?=\d)/, "") + (fraction ? `.${fraction}` : "");
  const number = Number(canonical);
  return Number.isFinite(number) && String(number) === canonical ? number : NaN;
};

export function parseInventoryCount(raw: string) {
  const number = parseInventoryDecimal(raw);
  return number !== null && /^\d+(?:[.,]\d{1,2})?$/.test(raw.trim())
    && number < 10_000_000_000_000_000 ? number : null;
}
