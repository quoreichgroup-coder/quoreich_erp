// Pure helpers extracted from index.ts so they can be unit-tested.
// Kept side-effect free (no Deno.serve, no env reads) on purpose.

export type EntityType =
  | "customers"
  | "suppliers"
  | "gl_accounts"
  | "items"
  | "ar_invoices"
  | "ap_invoices";

export const requiredFields: Record<EntityType, string[]> = {
  customers: ["name"],
  suppliers: ["name"],
  gl_accounts: ["code", "name", "account_type"],
  items: ["code", "name"],
  ar_invoices: ["invoice_number", "customer_id", "due_date", "total"],
  ap_invoices: ["invoice_number", "supplier_id", "due_date", "total"],
};

// SECURITY: explicit allowlist of columns importable per entity.
// Any field not in this list is dropped before insert so that a caller cannot
// override sensitive fields (status, approval_status, amount_paid, credit_limit, …)
// by submitting extra CSV columns.
export const allowedFields: Record<EntityType, string[]> = {
  customers: ["name", "email", "phone", "address", "tax_id", "currency", "payment_terms"],
  suppliers: ["name", "email", "phone", "address", "tax_id", "currency", "payment_terms"],
  gl_accounts: ["code", "name", "account_type", "parent_code", "currency", "is_active"],
  items: [
    "code", "name", "description", "unit_of_measure", "category",
    "unit_cost", "selling_price", "quantity_on_hand", "reorder_level",
  ],
  ar_invoices: [
    "invoice_number", "customer_id", "invoice_date", "due_date",
    "subtotal", "tax_amount", "total", "currency",
  ],
  ap_invoices: [
    "invoice_number", "supplier_id", "invoice_date", "due_date",
    "subtotal", "tax_amount", "total", "currency",
  ],
};

export function coerceNumber(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function normalizeRow(entity: EntityType, raw: Record<string, unknown>) {
  const allowed = new Set(allowedFields[entity]);
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (allowed.has(k)) r[k] = v;
  }
  switch (entity) {
    case "items":
      r.unit_cost = coerceNumber(r.unit_cost);
      r.selling_price = coerceNumber(r.selling_price);
      r.quantity_on_hand = coerceNumber(r.quantity_on_hand);
      r.reorder_level = coerceNumber(r.reorder_level);
      break;
    case "ar_invoices":
    case "ap_invoices":
      r.subtotal = coerceNumber(r.subtotal ?? r.total);
      r.tax_amount = coerceNumber(r.tax_amount);
      r.total = coerceNumber(r.total);
      break;
    case "customers":
    case "suppliers":
      r.payment_terms = r.payment_terms ? coerceNumber(r.payment_terms) : 30;
      break;
  }
  return r;
}

export function validateRow(
  entity: EntityType,
  row: Record<string, unknown>,
): { ok: boolean; missing: string[] } {
  const missing = requiredFields[entity].filter((f) => {
    const v = row[f];
    return v === undefined || v === null || v === "";
  });
  return { ok: missing.length === 0, missing };
}
