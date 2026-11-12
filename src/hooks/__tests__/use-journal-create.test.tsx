import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; args: unknown[] }[],
  /** Erreur à renvoyer pour « table.op » ; sinon succès. */
  errors: {} as Record<string, { message: string }>,
  deleted: [{ id: "je-1" }] as unknown[],
}));

function builder(table: string) {
  const b: any = { last: "" };
  for (const op of ["insert", "update", "delete", "select", "single", "eq"]) {
    b[op] = (...args: unknown[]) => {
      if (["insert", "update", "delete"].includes(op)) b.last = op;
      mocks.calls.push({ table, op, args });
      return b;
    };
  }
  b.then = (resolve: (v: unknown) => void) => {
    const error = mocks.errors[`${table}.${b.last}`] ?? null;
    const data = error ? null : b.last === "delete" ? mocks.deleted : { id: "je-1" };
    resolve({ data, error });
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => builder(t) } }));
vi.mock("@/hooks/use-tenant", () => ({ fetchTenantId: async () => "tenant-a", useTenantId: () => ({ data: "tenant-a" }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useCreateJournalEntry } from "../use-journal-data";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);
const entry = (status: string) => ({
  entry_number: "OD-1", entry_date: "2030-01-10", description: "Test", source: "manual", status,
  lines: [
    { account_id: "acc-601", description: "Achat", debit: 100, credit: 0, analytics: { dept: "com", cc: "" } },
    { account_id: "acc-401", description: "Fournisseur", debit: 0, credit: 100 },
  ],
});
const ops = () => mocks.calls.filter((c) => ["insert", "update", "delete"].includes(c.op)).map((c) => `${c.table}.${c.op}`);

beforeEach(() => { mocks.calls = []; mocks.errors = {}; mocks.deleted = [{ id: "je-1" }]; });
afterEach(cleanup);

describe("useCreateJournalEntry", () => {
  it("comptabilise en quatre temps : brouillon, lignes, imputations, puis passage à posted", async () => {
    const { result } = renderHook(() => useCreateJournalEntry(), { wrapper });
    await result.current.mutateAsync(entry("posted"));

    expect(ops()).toEqual(["journal_entries.insert", "journal_lines.insert", "journal_line_analytics.insert", "journal_entries.update"]);
    const header = mocks.calls.find((c) => c.table === "journal_entries" && c.op === "insert")!.args[0] as any;
    expect(header).toMatchObject({ status: "draft", tenant_id: "tenant-a", created_by: "user-1" });

    const lines = mocks.calls.find((c) => c.table === "journal_lines")!.args[0] as any[];
    expect(lines[0]).not.toHaveProperty("analytics");
    const analytics = mocks.calls.find((c) => c.table === "journal_line_analytics")!.args[0] as any[];
    // Une section vide n'est pas envoyée ; l'imputation vise la ligne dont elle vient.
    expect(analytics).toEqual([{ line_id: lines[0].id, axis_id: "dept", value_id: "com" }]);
    expect(mocks.calls.find((c) => c.op === "update")!.args[0]).toMatchObject({ status: "posted", posted_by: "user-1" });
  });

  it("un brouillon n'est pas comptabilisé", async () => {
    const { result } = renderHook(() => useCreateJournalEntry(), { wrapper });
    await result.current.mutateAsync(entry("draft"));
    expect(ops()).not.toContain("journal_entries.update");
  });

  it("refus à la comptabilisation : le brouillon complet est conservé et l'erreur le dit", async () => {
    mocks.errors["journal_entries.update"] = { message: "Imputation analytique incomplète" };
    const { result } = renderHook(() => useCreateJournalEntry(), { wrapper });
    await expect(result.current.mutateAsync(entry("posted")))
      .rejects.toThrow("Imputation analytique incomplète — l'écriture OD-1 est conservée en brouillon");
    expect(ops()).not.toContain("journal_entries.delete");
  });

  it("échec des lignes : le brouillon incomplet est retiré ; s'il ne peut pas l'être, l'erreur le dit", async () => {
    mocks.errors["journal_lines.insert"] = { message: "compte inconnu" };
    const { result } = renderHook(() => useCreateJournalEntry(), { wrapper });
    await expect(result.current.mutateAsync(entry("posted"))).rejects.toThrow(/^compte inconnu$/);
    expect(ops()).toContain("journal_entries.delete");

    mocks.deleted = [];
    await expect(result.current.mutateAsync(entry("posted"))).rejects.toThrow("compte inconnu — l'écriture OD-1 reste en brouillon");
  });
});
