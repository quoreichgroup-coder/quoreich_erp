import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; args: unknown[] }[],
  errors: {} as Record<string, { message: string }>,
}));

function builder(table: string) {
  const b: any = { last: "" };
  for (const op of ["insert", "update", "delete", "select", "single", "eq", "order"]) {
    b[op] = (...args: unknown[]) => {
      if (["insert", "update", "delete"].includes(op)) b.last = op;
      mocks.calls.push({ table, op, args });
      return b;
    };
  }
  b.then = (resolve: (v: unknown) => void) => {
    const error = mocks.errors[`${table}.${b.last}`] ?? null;
    resolve({ data: error ? null : { id: "inv-1" }, error });
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => builder(t) } }));
vi.mock("@/hooks/use-tenant", () => ({ fetchTenantId: async () => "tenant-a", useTenantId: () => ({ data: "tenant-a" }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/api/client", () => ({ isApiEnabled: () => false, apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useCreateARInvoice } from "../use-ar-data";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);
const invoice = {
  invoice_number: "F-1", customer_id: "c1", invoice_date: "2030-07-01", due_date: "2030-08-01",
  subtotal: 1000, tax_amount: 162, total: 1162,
  lines: [
    { description: "Licence", quantity: 2, unit_price: 500, discount_pct: 10, tax_code_id: "t18" },
    { description: "Formation", quantity: 1, unit_price: 100, discount_pct: 0 },
  ],
};
const ops = () => mocks.calls.filter((c) => ["insert", "update", "delete"].includes(c.op)).map((c) => `${c.table}.${c.op}`);

beforeEach(() => { mocks.calls = []; mocks.errors = {}; });
afterEach(cleanup);

describe("useCreateARInvoice — facture à lignes, chemin Supabase", () => {
  it("brouillon à zéro, lignes numérotées, puis émission ; l'en-tête est laissé à la base", async () => {
    const { result } = renderHook(() => useCreateARInvoice(), { wrapper });
    await result.current.mutateAsync(invoice);
    expect(ops()).toEqual(["ar_invoices.insert", "ar_invoice_lines.insert", "ar_invoices.update"]);
    expect(mocks.calls.find((c) => c.op === "insert")!.args[0]).toMatchObject({ status: "draft", subtotal: 0, tax_amount: 0, total: 0 });
    const lines = mocks.calls.find((c) => c.table === "ar_invoice_lines")!.args[0] as any[];
    expect(lines.map((l) => [l.line_no, l.description, l.tax_code_id])).toEqual([[1, "Licence", "t18"], [2, "Formation", null]]);
  });

  it("émission refusée : le brouillon est retiré et l'erreur d'origine remonte", async () => {
    mocks.errors["ar_invoices.update"] = { message: "Paramétrage comptable incomplet" };
    const { result } = renderHook(() => useCreateARInvoice(), { wrapper });
    await expect(result.current.mutateAsync(invoice)).rejects.toMatchObject({ message: "Paramétrage comptable incomplet" });
    expect(ops()).toContain("ar_invoices.delete");
  });
});
