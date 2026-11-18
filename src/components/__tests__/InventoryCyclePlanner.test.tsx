import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InventoryCyclePlanner } from "../InventoryCyclePlanner";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/use-inventory-data", () => ({
  useWarehouses: () => ({ isSuccess: true, data: [{ id: "depot", code: "D1", name: "Principal" }] }),
}));

function RouteEcho() {
  return <output data-testid="current-route">{useLocation().search}</output>;
}

describe("planification de l’inventaire tournant", () => {
  it("propose les articles sans geler puis ouvre exactement la proposition confirmée", async () => {
    rpc.mockResolvedValueOnce({ data: {
      active_campaign: null, due_total: 2, basis: "stock_value", batch_size: 1, signature: "selection",
      lines: [{ item_id: "item", code: "A1", name: "Article", unit: "pièce", class: "A", last_validated: null, due_date: null }],
    } }).mockResolvedValueOnce({ data: { id: "campagne" } });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <InventoryCyclePlanner tenantId="tenant" /><RouteEcho />
    </MemoryRouter></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("Dépôt du tournant"), { target: { value: "depot" } });
    expect(await screen.findByText("A1 — Article")).toBeInTheDocument();
    expect(rpc.mock.calls).toEqual([["inventory_cycle_prepare", {
      _action: "preview", _warehouse: "depot", _expected_tenant: "tenant",
    }]]);
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir la campagne tournante" }));
    expect(rpc).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Confirmer le gel du dépôt" }));
    await waitFor(() => expect(screen.getByTestId("current-route")).toHaveTextContent("tab=campaigns&depot=depot&campaign=campagne"));
    expect(rpc).toHaveBeenLastCalledWith("inventory_cycle_prepare", {
      _action: "open", _warehouse: "depot", _expected_tenant: "tenant", _signature: "selection",
    });
  });

  it("ne remplace pas un dépôt indisponible dans un lien par le dépôt par défaut", () => {
    rpc.mockClear();
    render(<QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/inventory/transactions?tab=inventory-cycle&depot=autre-societe"]}>
        <InventoryCyclePlanner tenantId="tenant" defaultWarehouseId="depot" />
      </MemoryRouter>
    </QueryClientProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("Ce dépôt n’est pas disponible dans la société active");
    expect(screen.getByLabelText("Dépôt du tournant")).toHaveValue("");
    expect(rpc).not.toHaveBeenCalled();
  });
});
