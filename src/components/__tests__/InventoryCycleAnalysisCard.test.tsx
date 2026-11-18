import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InventoryCycleAnalysisCard } from "../InventoryCycleAnalysisCard";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/use-inventory-data", () => ({
  useWarehouses: () => ({ data: [{ id: "depot", code: "D1", name: "Principal" }] }),
  useInventorySettings: () => ({ data: { default_warehouse_id: "depot" } }),
}));

describe("rapport ABC des stocks", () => {
  it("montre la période choisie et les totaux complets, même si seul le haut du classement est affiché", async () => {
    rpc.mockResolvedValueOnce({ data: {
      configured: true, basis: "outflow_value", lookback_months: 3, total_articles: 68, due_total: 15, total_weight: 1000,
      classes: [{ class: "A", articles: 9, due: 5, weight: 700 }],
      top: [{ item_id: "item", code: "A1", name: "Article", class: "A", weight: 400, cumulative_percent: 40, is_due: true }],
    } });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <InventoryCycleAnalysisCard tenantId="tenant" canPlan={false} />
    </MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText(/3 mois.*68 article.*15 à échéance/i)).toBeInTheDocument();
    expect(screen.getByText("A1 — Article")).toBeInTheDocument();
    expect(screen.getByText("70 % de la valeur")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Préparer le tournant" })).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("inventory_cycle_analysis", { _warehouse: "depot", _expected_tenant: "tenant" });
  });
});
