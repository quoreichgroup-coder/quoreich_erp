import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  canEdit: true,
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-1" }) }));
vi.mock("@/hooks/use-my-access", () => ({
  useMyAccess: () => ({ data: { permissions: mocks.canEdit ? ["hr.manage_payroll_components"] : [] } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { HrPayrollComponentsCard } from "@/components/HrPayrollComponentsCard";

afterEach(cleanup);
beforeEach(() => {
  mocks.canEdit = true;
  mocks.rows = [];
  mocks.rpc.mockReset().mockImplementation(async (name: string) => ({
    data: name === "list_hr_payroll_components" ? mocks.rows : "new-component-id",
    error: null,
  }));
});

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><HrPayrollComponentsCard /></QueryClientProvider>);
}

describe("HrPayrollComponentsCard", () => {
  it("starts with an empty tenant reference and exposes no preloaded payroll item", async () => {
    renderCard();
    await screen.findByText("Aucune rubrique configurée pour cette société.");
    expect(screen.getByLabelText("Code")).toHaveValue("");
  });

  it("saves a company component through the secured database RPC", async () => {
    renderCard();
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "transport" } });
    fireEvent.change(screen.getByLabelText("Libellé"), { target: { value: "Indemnité transport" } });
    fireEvent.change(screen.getByLabelText("Montant"), { target: { value: "15000" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la rubrique" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_hr_payroll_component", expect.objectContaining({
      _input: expect.objectContaining({ code: "transport", label: "Indemnité transport", amount: 15000 }),
    })));
  });

  it("keeps the register read-only without the central payroll component permission", async () => {
    mocks.canEdit = false;
    renderCard();
    await screen.findByText(/Lecture seule/);
    expect(screen.queryByRole("button", { name: "Ajouter la rubrique" })).toBeNull();
    expect(await screen.findByText("Aucune rubrique configurée pour cette société.")).toBeTruthy();
  });
});

describe("HrPayrollComponentsCard RPC failure", () => {
  it("does not present an empty catalog when the payroll components RPC is missing", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: null,
      error: name === "list_hr_payroll_components"
        ? { code: "PGRST202", message: "Could not find public.list_hr_payroll_components" }
        : null,
    }));

    renderCard();

    expect(await screen.findByRole("alert")).toHaveTextContent("Supabase Data API");
    expect(screen.queryByText(/Aucune rubrique configur/)).toBeNull();
  });
});