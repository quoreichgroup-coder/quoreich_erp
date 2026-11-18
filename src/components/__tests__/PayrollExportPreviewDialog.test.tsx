import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { HrPerms } from "@/lib/hr-roles";
import { PayrollExportPreviewDialog } from "@/components/PayrollExportPreviewDialog";

const permissions = (canExport: boolean, canViewSensitive: boolean): HrPerms => ({
  canCreateEmployee: false,
  canEditEmployee: false,
  canCreatePayrollRun: false,
  canApprovePayrollRun: false,
  canExecutePayroll: false,
  canAuditPayroll: false,
  canManageSettings: false,
  canExport,
  canViewSensitive,
  canManageCompensation: false,
  canManageBankDetails: false,
  canCreateEmployeeMovement: false,
  canApproveEmployeeMovement: false,
  canViewEmployeeHistory: false,
});

describe("PayrollExportPreviewDialog", () => {
  it("previews Excel and uses the cycle currency", () => {
    render(<PayrollExportPreviewDialog
      open onOpenChange={vi.fn()} format="Excel" title="Paie 2032-05"
      perms={permissions(true, true)} currency="XAF" balanced totalDebit={8000} totalCredit={8000}
      columns={[{ key: "employee", header: "Employé" }]} rows={[{ employee: "Awa · M-1" }]}
      onConfirm={vi.fn()}
    />);

    expect(screen.getByText(/Aperçu export Excel/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Télécharger Excel/ })).toBeEnabled();
    expect(document.body.textContent).toContain("XAF");
    expect(document.body.textContent).not.toContain("XOF");
  });

  it("masks journal totals without the sensitive-amount permission", () => {
    render(<PayrollExportPreviewDialog
      open onOpenChange={vi.fn()} format="CSV" title="Paie 2032-05"
      perms={permissions(true, false)} currency="XAF" balanced={false} totalDebit={8000} totalCredit={8000}
      columns={[{ key: "employee", header: "Employé" }]} rows={[{ employee: "Awa · M-1" }]}
      onConfirm={vi.fn()}
    />);

    expect(document.body.textContent).toContain("XAF");
    expect(document.body.textContent).not.toContain("8 000");
    expect(document.body.textContent).toContain("•••••");
  });
});
