// Unit tests for the import-data column allowlist.
// Pure logic only — no network, no Deno.serve.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { allowedFields, normalizeRow } from "./lib.ts";

Deno.test("normalizeRow drops fields outside the customers allowlist", () => {
  const out = normalizeRow("customers", {
    name: "ACME",
    email: "a@b.co",
    // ── forbidden fields a malicious CSV might inject ──
    id: "00000000-0000-0000-0000-000000000000",
    tenant_id: "other-tenant",
    credit_limit: 9_999_999,
    status: "approved",
    created_at: "1970-01-01",
  });

  assertEquals(out.name, "ACME");
  assertEquals(out.email, "a@b.co");
  assertEquals(out.payment_terms, 30); // default applied
  assert(!("id" in out), "id must be stripped");
  assert(!("tenant_id" in out), "tenant_id must be stripped (set server-side)");
  assert(!("credit_limit" in out), "credit_limit must be stripped");
  assert(!("status" in out), "status must be stripped");
  assert(!("created_at" in out), "created_at must be stripped");
});

Deno.test("normalizeRow drops fields outside the ar_invoices allowlist", () => {
  const out = normalizeRow("ar_invoices", {
    invoice_number: "INV-001",
    customer_id: "11111111-1111-1111-1111-111111111111",
    due_date: "2026-12-31",
    total: "1500.75",
    // ── forbidden fields ──
    amount_paid: 1_500_000,
    payment_status: "paid",
    approval_status: "approved",
    created_by: "attacker-uid",
  });

  assertEquals(out.invoice_number, "INV-001");
  assertEquals(out.total, 1500.75);
  assertEquals(out.subtotal, 1500.75); // defaulted from total
  assert(!("amount_paid" in out));
  assert(!("payment_status" in out));
  assert(!("approval_status" in out));
  assert(!("created_by" in out), "created_by is forced server-side");
});

Deno.test("allowedFields never grants write access to immutable columns", () => {
  const forbidden = [
    "id",
    "tenant_id",
    "created_at",
    "updated_at",
    "status",
    "approval_status",
    "amount_paid",
    "credit_limit",
    "created_by",
  ];
  for (const [entity, fields] of Object.entries(allowedFields)) {
    for (const f of forbidden) {
      assert(
        !fields.includes(f),
        `${entity} allowlist must not include "${f}"`,
      );
    }
  }
});

Deno.test("normalizeRow keeps all whitelisted fields for items", () => {
  const out = normalizeRow("items", {
    code: "SKU-1",
    name: "Widget",
    unit_cost: "12.5",
    selling_price: "20",
    quantity_on_hand: "100",
    reorder_level: "5",
    foo: "bar", // not allowed
  });
  assertEquals(out.code, "SKU-1");
  assertEquals(out.unit_cost, 12.5);
  assertEquals(out.selling_price, 20);
  assertEquals(out.quantity_on_hand, 100);
  assertEquals(out.reorder_level, 5);
  assert(!("foo" in out));
});
