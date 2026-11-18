import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { InventoryCampaignPanel } from "../InventoryCampaignPanel";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/use-inventory-data", () => ({
  useWarehouses: () => ({ data: [{ id: "depot", code: "D1", name: "Principal" }] }),
}));

describe("InventoryCampaignPanel", () => {
  it("resumes a blind count and submits only after zero is saved", async () => {
    const campaign = {
      id: "campaign", state: "counting", can_cancel: true,
      lines: [{ item_id: "item", code: "A", name: "Article A", unit: "pièce", counted: null, is_counted: false, can_edit: true }],
    };
    const counted = { ...campaign, lines: [{ ...campaign.lines[0], counted: 0, is_counted: true }] };
    rpc.mockResolvedValueOnce({ data: campaign })
      .mockResolvedValueOnce({ data: counted })
      .mockResolvedValueOnce({ data: { ...counted, state: "submitted", lines: [{ ...counted.lines[0], can_edit: false }] } })
      .mockResolvedValueOnce({ data: { id: "campaign", state: "submitted", lines: [] } });
    render(<QueryClientProvider client={new QueryClient()}>
      <InventoryCampaignPanel tenantId="tenant" />
    </QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("Dépôt à inventorier"), { target: { value: "depot" } });
    const input = await screen.findByLabelText("A — Article A (pièce)");
    const submit = screen.getByRole("button", { name: "Soumettre le comptage" });
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: "1,001" } });
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "0" } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(submit).toBeEnabled());
    expect(rpc).toHaveBeenCalledWith("inventory_campaign", { _action: "count", _id: "campaign", _item: "item", _quantity: 0 });
    fireEvent.click(submit);
    expect(await screen.findByText("Comptage soumis · dépôt gelé")).toBeInTheDocument();
    expect(input).toBeDisabled();
  });

  it("requires confirmation before cancelling an open campaign", async () => {
    const campaign = { id: "campaign", state: "counting", can_cancel: true, lines: [] };
    rpc.mockReset().mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { item_scope: "warehouse", articles: 1 } })
      .mockResolvedValueOnce({ data: campaign })
      .mockResolvedValueOnce({ data: { ...campaign, state: "cancelled" } });
    render(<QueryClientProvider client={new QueryClient()}>
      <InventoryCampaignPanel tenantId="tenant" />
    </QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("Dépôt à inventorier"), { target: { value: "depot" } });
    const open = await screen.findByRole("button", { name: "Ouvrir et geler le dépôt" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    fireEvent.click(await screen.findByRole("button", { name: "Annuler la campagne" }));
    expect(rpc).toHaveBeenCalledTimes(3);
    const confirm = screen.getByRole("button", { name: "Confirmer l’annulation et lever le gel" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motif d’annulation"), { target: { value: "Erreur de dépôt" } });
    fireEvent.click(confirm);
    expect(await screen.findByRole("button", { name: "Ouvrir et geler le dépôt" })).toBeInTheDocument();
    expect(rpc).toHaveBeenLastCalledWith("inventory_campaign", { _action: "cancel", _id: "campaign", _reason: "Erreur de dépôt" });
  });
});
