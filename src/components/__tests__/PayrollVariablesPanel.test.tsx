import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  variables: [] as Record<string, unknown>[],
  canCreate: true,
  canApprove: false,
  create: vi.fn(),
  decide: vi.fn(),
}));

vi.mock("@/hooks/use-hr-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-hr-data")>();
  return { ...actual,
    useMyHrRoles: () => ({ canCreatePayrollRun: mocks.canCreate, canApprovePayrollRun: mocks.canApprove }),
    usePayrollRunVariables: () => ({ data: mocks.variables, isLoading: false, isError: false }),
    useEmployees: () => ({ data: [{ id: "employee-1", first_name: "Awa", last_name: "Test", matricule: "RH-1", status: "active" }], isError: false }),
    useHrPayrollComponents: () => ({ data: [{ id: "component-1", code: "bonus", label: "Prime" }], isError: false }),
    useCreatePayrollRunVariable: () => ({ mutate: mocks.create, isPending: false }),
    useDecidePayrollRunVariable: () => ({ mutate: mocks.decide }),
  };
});

import { PayrollVariablesPanel } from "@/components/PayrollVariablesPanel";

beforeEach(() => {
  mocks.variables = [];
  mocks.canCreate = true;
  mocks.canApprove = false;
  mocks.create.mockReset();
  mocks.decide.mockReset();
});

describe("PayrollVariablesPanel", () => {
  const renderPanel = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><PayrollVariablesPanel runId="run-1" status="draft" /></QueryClientProvider>);
  };
  it("submits a dated payroll variable using the chosen employee, component and source reference", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Salarié de la variable"), { target: { value: "employee-1" } });
    fireEvent.change(screen.getByLabelText("Rubrique variable"), { target: { value: "component-1" } });
    fireEvent.change(screen.getByLabelText("Montant"), { target: { value: "25000" } });
    fireEvent.change(screen.getByLabelText("Référence source unique"), { target: { value: "heures-2027-01" } });
    fireEvent.change(screen.getByLabelText("Motif"), { target: { value: "Heures approuvées" } });
    fireEvent.click(screen.getByRole("button", { name: "Soumettre la variable" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1", employee_id: "employee-1", component_id: "component-1", amount: 25000,
      source_key: "heures-2027-01", reason: "Heures approuvées",
    }), expect.any(Object)));
  });

  it("does not offer variable entry to users without payroll creation permission", () => {
    mocks.canCreate = false;
    renderPanel();
    expect(screen.queryByRole("button", { name: "Soumettre la variable" })).toBeNull();
  });
});
