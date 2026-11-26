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
    data: name === "list_hr_payroll_components" ? mocks.rows : name === "list_payroll_bases" ? [] : "new-component-id",
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

  it("sends the component id when editing, so the database updates it instead of refusing a duplicate code (V148)", async () => {
    mocks.rows = [{
      id: "comp-1", tenant_id: "tenant-1", code: "transport", label: "Transport", kind: "earning",
      calculation_method: "fixed", amount: 15000, cap: null, effective_from: "2030-01-01", effective_to: null,
      gl_account_code: null, printable: true, active: true, sort_order: 0, taxable: false,
      subject_employee_social: false, subject_employer_social: false, prorated: false,
    }];
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Modifier" }));
    fireEvent.click(screen.getByRole("switch", { name: "Proratiser selon les jours de présence" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_hr_payroll_component", {
      _input: expect.objectContaining({ id: "comp-1", code: "transport", prorated: true }),
    }));
  });

  it("keeps the register read-only without the central payroll component permission", async () => {
    mocks.canEdit = false;
    renderCard();
    await screen.findByText(/Lecture seule/);
    expect(screen.queryByRole("button", { name: "Ajouter la rubrique" })).toBeNull();
    expect(await screen.findByText("Aucune rubrique configurée pour cette société.")).toBeTruthy();
  });
});

describe("HrPayrollComponentsCard methods (V150)", () => {
  it("saves a formula component without amount and with its calculation order", async () => {
    renderCard();
    await screen.findByText("Aucune rubrique configurée pour cette société.");
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "hs" } });
    fireEvent.change(screen.getByLabelText("Libellé"), { target: { value: "Heures supplémentaires" } });
    fireEvent.change(screen.getByLabelText("Calcul"), { target: { value: "formula" } });
    expect(screen.queryByLabelText("Montant")).toBeNull();
    fireEvent.change(screen.getByLabelText("Formule"), { target: { value: "ROUND(BASE / 173.33 * 1.25 * QTY, 0)" } });
    fireEvent.change(screen.getByLabelText("Ordre de calcul (1 = en premier)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la rubrique" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_hr_payroll_component", {
      _input: expect.objectContaining({ code: "hs", calculation_method: "formula", amount: 0, priority: 20,
        formula: "ROUND(BASE / 173.33 * 1.25 * QTY, 0)", base_code: null, scale: null }),
    }));
  });

  it("tests a formula through the database evaluator and shows its result", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "list_hr_payroll_components" ? [] : name === "list_payroll_bases" ? [] : name === "payroll_formula_try" ? 5000 : null,
      error: null,
    }));
    renderCard();
    await screen.findByText("Aucune rubrique configurée pour cette société.");
    fireEvent.change(screen.getByLabelText("Calcul"), { target: { value: "formula" } });
    fireEvent.change(screen.getByLabelText("Formule"), { target: { value: "BASE * 0.05" } });
    fireEvent.click(screen.getByRole("button", { name: "Tester la formule" }));
    expect(await screen.findByRole("status")).toHaveTextContent("5 000");
    expect(mocks.rpc).toHaveBeenCalledWith("payroll_formula_try", expect.objectContaining({ _formula: "BASE * 0.05" }));
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