import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { actionTooltip, canDo, type HrPerms, type HrRole, REQUIRED_ROLES } from "@/lib/hr-roles";

afterEach(cleanup);

// Mirror useMyHrRoles() — derive perms from a flat role set.
function permsFor(roles: HrRole[]): HrPerms {
  const has = (action: keyof typeof REQUIRED_ROLES) =>
    roles.some((r) => REQUIRED_ROLES[action].includes(r));
  return {
    canCreateEmployee:    has("create_employee"),
    canEditEmployee:      has("edit_employee"),
    canCreatePayrollRun:  has("create_payroll_run"),
    canApprovePayrollRun: has("approve_payroll_run"),
    canExecutePayroll:    has("execute_payroll"),
    canAuditPayroll:      has("audit_payroll"),
    canManageSettings:    has("manage_settings"),
    canExport:            has("export"),
    canViewSensitive:     has("view_sensitive"),
  };
}

/** Replicates the export toolbar used by PayrollRuns + PayrollRunDialog. */
function ExportToolbar({ perms }: { perms: HrPerms }) {
  const tip = actionTooltip(perms, "export", "Exporter");
  return (
    <div>
      <Button data-testid="btn-export-csv" disabled={!canDo(perms, "export")} aria-label={tip} title={tip}>CSV</Button>
      <Button data-testid="btn-export-pdf" disabled={!canDo(perms, "export")} aria-label={tip} title={tip}>PDF</Button>
      <Button data-testid="btn-export-recap" disabled={!canDo(perms, "export")} aria-label={tip} title={tip}>Récapitulatif</Button>
    </div>
  );
}

describe("Payroll export buttons — has_hr_perm gating", () => {
  it("no role: every export is locked with an explicit tooltip", () => {
    render(<ExportToolbar perms={permsFor([])} />);
    for (const id of ["btn-export-csv", "btn-export-pdf", "btn-export-recap"]) {
      const btn = screen.getByTestId(id);
      expect(btn).toBeDisabled();
      expect(btn.getAttribute("aria-label")).toMatch(/verrouillée/);
    }
  });

  it("hr_clerk alone cannot export (clerks saisissent, ne sortent pas)", () => {
    render(<ExportToolbar perms={permsFor(["hr_clerk"])} />);
    expect(screen.getByTestId("btn-export-csv")).toBeDisabled();
  });

  it("hr_approver / payroll_officer / hr_auditor / hr_admin can export", () => {
    for (const r of ["hr_approver", "payroll_officer", "hr_auditor", "hr_admin"] as HrRole[]) {
      cleanup();
      render(<ExportToolbar perms={permsFor([r])} />);
      expect(screen.getByTestId("btn-export-csv"), r).toBeEnabled();
      expect(screen.getByTestId("btn-export-pdf"), r).toBeEnabled();
      expect(screen.getByTestId("btn-export-recap"), r).toBeEnabled();
    }
  });
});
