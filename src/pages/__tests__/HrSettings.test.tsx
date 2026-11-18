import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HrSettings from "@/pages/HrSettings";

vi.mock("@/hooks/use-hr-data", () => ({ useMyHrRoles: () => ({ canManageMovementSettings: true }) }));
vi.mock("@/hooks/use-my-access", () => ({ useMyAccess: () => ({ data: { permissions: ["hr.manage_employee_number_settings"] } }) }));
vi.mock("@/components/PayrollSettingsCard", () => ({ PayrollSettingsCard: () => <div>Règles paie</div> }));
vi.mock("@/components/HrPayrollComponentsCard", () => ({ HrPayrollComponentsCard: () => <div>Rubriques paie</div> }));
vi.mock("@/components/HrMovementSettingsCard", () => ({ HrMovementSettingsCard: () => <div>Références mouvements</div> }));
vi.mock("@/components/HrEmployeeNumberSettingsCard", () => ({ HrEmployeeNumberSettingsCard: () => <div>Réglages matricules</div> }));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));

describe("HR settings tabs", () => {
  it("groups payroll, employee numbering, and movement references in separate tabs", () => {
    render(<MemoryRouter><HrSettings /></MemoryRouter>);

    expect(screen.getByRole("tab", { name: "Règles de paie" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Matricules" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Référentiels et mouvements" })).toBeInTheDocument();
    expect(screen.getByText("Règles paie")).toBeInTheDocument();
    expect(screen.queryByText("Réglages matricules")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Matricules" }));
    expect(screen.getByText("Réglages matricules")).toBeInTheDocument();
    expect(screen.queryByText("Règles paie")).not.toBeInTheDocument();
  });
});
