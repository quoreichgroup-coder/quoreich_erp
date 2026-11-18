import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Employees from "@/pages/Employees";

vi.mock("@/hooks/use-hr-data", () => ({
    useMyHrRoles: () => ({ canCreateEmployee: true, canEditEmployee: true, canExport: false,
      canViewSensitive: true, canManageCompensation: true, canManageBankDetails: true,
      canCreateEmployeeMovement: false, canApproveEmployeeMovement: false, canViewEmployeeHistory: false }),
    useEmployees: () => ({ data: [], isLoading: false, isError: false }),
    useHrEmployeeNumberSettings: () => ({ data: { prefix: "EMP", include_year: false, separator: "-", number_width: 5, next_number: 1, default_status: "active" } }),
    useUpsertEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useHrPayrollSettings: () => ({ data: null }),
    useTenantHrCurrency: () => ({ data: "XOF", isLoading: false }),
    useHrMovementReferences: () => ({ data: [{ id: "r1", kind: "contract_type", code: "cdi", label: "CDI", active: true, sort_order: 0 }] }),
}));
vi.mock("@/hooks/use-my-access", () => ({ useMyAccess: () => ({ data: { permissions: [] } }) }));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/EmployeeMovementDialog", () => ({ EmployeeMovementDialog: () => null }));
vi.mock("@/components/EmployeePayrollComponentsDialog", () => ({ EmployeePayrollComponentsDialog: () => null }));
vi.mock("@/components/ExportButtons", () => ({ ExportButtons: () => null }));
vi.mock("@/components/HrEmployeeImportDialog", () => ({ HrEmployeeImportDialog: () => null }));
vi.mock("@/components/HrEmployeeBulkMovementDialog", () => ({ HrEmployeeBulkMovementDialog: () => null }));

describe("Employees page", () => {
  it("survit au premier rendu du dialogue avant l'initialisation du dossier", async () => {
    render(<Employees />);
    fireEvent.click(screen.getByRole("button", { name: "Créer un employé" }));
    const save = await screen.findByRole("button", { name: "Enregistrer" });
    expect(save).toBeDisabled();
  });
});
