import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InventorySettings from "@/pages/InventorySettings";
import { InventoryCampaignCatalog } from "../InventoryCampaignCatalog";
import { InventoryCampaignSheet } from "../InventoryCampaignSheet";
import { buildXlsx } from "@/lib/xlsx";
import { countSheetColumns, countSheetRows } from "@/lib/inventory-campaign-workbook";

const { rpc, excel } = vi.hoisted(() => ({ rpc: vi.fn(), excel: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant" }) }));
vi.mock("@/hooks/use-inventory-data", () => ({
  useWarehouses: () => ({ isSuccess: true, data: [{ id: "depot", code: "D1", name: "Principal" }] }),
  useInventorySettings: () => ({ isSuccess: true, data: { default_warehouse_id: "depot" } }),
  useUpdateInventorySettings: () => ({ mutate: vi.fn() }),
  useMyInventoryRoles: () => ({ data: { canSettings: true } }),
}));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/InventoryRolesPanel", () => ({ InventoryRolesPanel: () => <p>Droits Stock</p> }));
vi.mock("@/components/PostingAccountsPanel", () => ({ PostingAccountsPanel: () => <p>Comptes Stock</p> }));
vi.mock("@/lib/xlsx", async (original) => ({ ...(await original<typeof import("@/lib/xlsx")>()), exportToXLSX: excel }));

function show(component: React.ReactNode, path = "/") {
  return render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[path]}>{component}</MemoryRouter>
  </QueryClientProvider>);
}

describe("inventaires physiques : suivi et saisie groupée", () => {
  beforeEach(() => { rpc.mockReset(); excel.mockReset(); });

  it("ouvre les paramètres par onglet, avec les contrôles de la section seulement", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "inventory_campaign_policy") return { data: { percent: null, value: null } };
      if (name === "inventory_cycle_policy") return { data: { configured: false } };
      return { data: { prefix: "INV-", width: 4, next: 10 } };
    });
    show(<InventorySettings />, "/inventory/settings?tab=inventaires");
    expect(screen.getByRole("tab", { name: "Inventaires" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Seuil en pourcentage (%)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Préfixe")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Documents" }), { key: "Enter" });
    expect(await screen.findByLabelText("Préfixe")).toHaveValue("INV-");
    expect(screen.getByText("INV-0010")).toBeInTheDocument();
  });

  it("exporte aussi les pages non affichées et fournit un lien pour les campagnes validées", async () => {
    const row = {
      id: "campaign", reference: "INV-001", warehouse_id: "depot", warehouse_code: "D1", warehouse_name: "Principal",
      state: "validated", item_scope: "assigned", opened_at: "2026-11-15T12:00:00Z", updated_at: "2026-11-15T12:10:00Z",
      total_lines: 3, counted_lines: 3, recount_lines: 0, recounted_lines: 0,
    };
    const first = { campaigns: [row], next: { id: "campaign", opened_at: row.opened_at } };
    rpc.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: first })
      .mockResolvedValueOnce({ data: { campaigns: [{ ...row, id: "campaign2", reference: "INV-002" }], next: null } });
    show(<InventoryCampaignCatalog tenantId="tenant" canCount canReview canExport />, "/?tab=campaign-catalog&catalogStatus=validated");
    expect(await screen.findByRole("link", { name: "Voir les écarts" })).toHaveAttribute("href",
      "/?tab=campaign-control&catalogStatus=validated&campaign=campaign");
    fireEvent.click(screen.getByRole("button", { name: "Exporter le catalogue (Excel)" }));
    await waitFor(() => expect(excel).toHaveBeenCalled());
    expect(excel.mock.calls[0][0].map((item: { reference: string }) => item.reference)).toEqual(["INV-001", "INV-002"]);
    expect(rpc.mock.calls[2][1]).toMatchObject({ _export: true, _expected_tenant: "tenant", _before_id: "campaign", _state: "validated" });
  });

  it("prépare le classeur sans écriture puis envoie un lot à la confirmation", async () => {
    const items = [{ item_id: "a", code: "A", name: "Article A", unit: "pièce" }];
    const rows = countSheetRows("campaign", "INV-001", "first", items);
    rows[0].quantity = 0;
    const bytes = buildXlsx(rows, countSheetColumns);
    const file = new File([bytes as BlobPart], "feuille.xlsx");
    Object.defineProperty(file, "arrayBuffer", { value: () => Promise.resolve(bytes.slice().buffer) });
    const onImport = vi.fn().mockResolvedValue(undefined);
    show(<InventoryCampaignSheet campaignId="campaign" reference="INV-001" stage="first" items={items} disabled={false} onImport={onImport} />);
    fireEvent.change(screen.getByLabelText("Importer la feuille remplie (.xlsx)"), { target: { files: [file] } });
    const confirm = await screen.findByRole("button", { name: "Confirmer l’import" });
    expect(onImport).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onImport).toHaveBeenCalledWith([{ item_id: "a", quantity: 0 }]));
  });

  it("affiche la décision d’annulation et son motif dans l’historique", async () => {
    rpc.mockResolvedValueOnce({ data: { campaigns: [{
      id: "campaign", reference: "INV-001", warehouse_id: "depot", warehouse_code: "D1", warehouse_name: "Principal",
      state: "cancelled", item_scope: "warehouse", opened_at: "2026-11-15T12:00:00Z", updated_at: "2026-11-15T12:10:00Z",
      total_lines: 3, counted_lines: 1, recount_lines: 0, recounted_lines: 0,
    }], next: null } }).mockResolvedValueOnce({ data: [{
      event: "cancelled", date: "2026-11-15T12:10:00Z", actor: "Responsable Stock", reason: "Dépôt incorrect",
    }] });
    show(<InventoryCampaignCatalog tenantId="tenant" canCount canReview canExport />);
    fireEvent.click(await screen.findByRole("button", { name: "Historique de INV-001" }));
    expect(await screen.findByRole("dialog", { name: "Historique de la campagne" })).toBeInTheDocument();
    expect(await screen.findByText("Motif : Dépôt incorrect")).toBeInTheDocument();
    expect(rpc).toHaveBeenLastCalledWith("inventory_campaign_timeline", { _campaign: "campaign", _expected_tenant: "tenant" });
  });
});
