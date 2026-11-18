import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryCampaignControl } from "../InventoryCampaignControl";
import { InventoryCampaignPolicyCard } from "../InventoryCampaignPolicyCard";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/use-inventory-data", () => ({
  useWarehouses: () => ({ data: [{ id: "depot", code: "D1", name: "Principal" }] }),
}));

function show(component: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{component}</MemoryRouter></QueryClientProvider>);
}

describe("inventory control and settings", () => {
  beforeEach(() => rpc.mockReset());

  it("leaves tolerances unset until a company explicitly configures them", async () => {
    rpc.mockResolvedValueOnce({ data: { percent: null, value: null } })
      .mockResolvedValueOnce({ data: { percent: 0, value: null } });
    show(<InventoryCampaignPolicyCard tenantId="tenant" />);
    const field = await screen.findByLabelText("Seuil en pourcentage (%)");
    const save = screen.getByRole("button", { name: "Enregistrer les seuils" });
    expect(field).toHaveValue("");
    expect(save).toBeDisabled();
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.click(save);
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("inventory_campaign_policy", {
      _action: "save", _percent: 0, _value: null, _expected_tenant: "tenant",
    }));
  });

  it("requests a recount when the stored policy blocks validation", async () => {
    const line = {
      item_id: "item", code: "A", name: "Article", unit: "pièce", expected: 10,
      first_count: 8, second_count: null, effective_count: 8, variance: -2,
      requires_recount: true, recount_requested: false, opening_unit_cost: 100,
    };
    const review = { id: "campaign", state: "submitted", percent: 10, value: null, lines: [line] };
    rpc.mockResolvedValueOnce({ data: review }).mockResolvedValueOnce({
      data: { ...review, lines: [{ ...line, recount_requested: true }] },
    });
    show(<InventoryCampaignControl tenantId="tenant" campaignId="campaign" canExport={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Consulter les écarts" }));
    expect(await screen.findByRole("button", { name: "Valider et ajuster le stock" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Demander le recomptage" }));
    expect(await screen.findByText("Recomptage en attente")).toBeInTheDocument();
    expect(rpc).toHaveBeenLastCalledWith("inventory_campaign_control", { _action: "request_recount", _id: "campaign" });
  });
});
