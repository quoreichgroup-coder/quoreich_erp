import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { useInventoryItemCatalog } from "@/hooks/use-inventory-data";

const mocks = vi.hoisted(() => ({ tenantId: "company-a", from: vi.fn() }));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: mocks.tenantId }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));

describe("catalogue des articles", () => {
  it("charge au-delà d’une page partielle et ne mélange pas les sociétés", async () => {
    const pages = [
      [{ id: "1", code: "B" }],
      [{ id: "2", code: "A" }],
      [],
      [{ id: "3", code: "C" }],
      [],
    ];
    const where = vi.fn();
    const after = vi.fn();
    mocks.from.mockImplementation(() => {
      const result = pages.shift();
      const query = {
        select: () => query,
        eq: (column: string, value: string) => { where(column, value); return query; },
        order: () => query,
        limit: () => query,
        gt: (column: string, value: string) => { after(column, value); return query; },
        abortSignal: () => Promise.resolve({ data: result, error: null }),
      };
      return query;
    });
    const client = new QueryClient();
    const { result, rerender } = renderHook(() => useInventoryItemCatalog(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.data?.map((item) => item.code)).toEqual(["A", "B"]));
    expect(after.mock.calls).toEqual([["id", "1"], ["id", "2"]]);
    expect(where.mock.calls).toEqual(Array.from({ length: 3 }, () => ["tenant_id", "company-a"]));
    mocks.tenantId = "company-b";
    rerender();
    await waitFor(() => expect(result.current.data?.map((item) => item.code)).toEqual(["C"]));
    expect(where.mock.calls.slice(3)).toEqual([["tenant_id", "company-b"], ["tenant_id", "company-b"]]);
  });
});
