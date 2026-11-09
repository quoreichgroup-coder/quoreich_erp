import { describe, it, expect } from "vitest";
import {
  violatesHrSoD,
  ALL_HR_ROLES,
  REQUIRED_ROLES,
  canDo,
  maskAmount,
  type HrRole,
  type HrPerms,
} from "@/lib/hr-roles";

const permsFromRoles = (roles: HrRole[]): HrPerms => ({
  canCreateEmployee:    roles.some((r) => REQUIRED_ROLES.create_employee.includes(r)),
  canEditEmployee:      roles.some((r) => REQUIRED_ROLES.edit_employee.includes(r)),
  canCreatePayrollRun:  roles.some((r) => REQUIRED_ROLES.create_payroll_run.includes(r)),
  canApprovePayrollRun: roles.some((r) => REQUIRED_ROLES.approve_payroll_run.includes(r)),
  canExecutePayroll:    roles.some((r) => REQUIRED_ROLES.execute_payroll.includes(r)),
  canAuditPayroll:      roles.some((r) => REQUIRED_ROLES.audit_payroll.includes(r)),
  canManageSettings:    roles.some((r) => REQUIRED_ROLES.manage_settings.includes(r)),
  canExport:            roles.some((r) => REQUIRED_ROLES.export.includes(r)),
  canViewSensitive:     roles.some((r) => REQUIRED_ROLES.view_sensitive.includes(r)),
});

const grant = (r: HrRole[], add: HrRole): HrRole[] =>
  r.includes(add) ? r : [...r, add];
const revoke = (r: HrRole[], rm: HrRole): HrRole[] =>
  r.filter((x) => x !== rm);

describe("HR / Payroll SoD", () => {
  it("idempotent grant on hr_clerk", () => {
    let r: HrRole[] = [];
    r = grant(r, "hr_clerk");
    r = grant(r, "hr_clerk");
    expect(r).toEqual(["hr_clerk"]);
  });

  it("idempotent revoke (no-op when role absent)", () => {
    expect(revoke(["hr_clerk"], "hr_approver")).toEqual(["hr_clerk"]);
  });

  it("clerk ⇄ approver SoD blocks direct upgrade", () => {
    expect(violatesHrSoD(["hr_clerk"], "hr_approver")).toBe(true);
    expect(violatesHrSoD(["hr_approver"], "hr_clerk")).toBe(true);
  });

  it("payroll_officer ⇄ hr_auditor SoD enforced", () => {
    expect(violatesHrSoD(["payroll_officer"], "hr_auditor")).toBe(true);
    expect(violatesHrSoD(["hr_auditor"], "payroll_officer")).toBe(true);
  });

  it("clerk ↔ approver revoke→reassign cycle", () => {
    let r: HrRole[] = [];
    r = grant(r, "hr_clerk");
    expect(canDo(permsFromRoles(r), "create_payroll_run")).toBe(true);

    expect(violatesHrSoD(r, "hr_approver")).toBe(true);
    r = revoke(r, "hr_clerk");
    r = grant(r, "hr_approver");
    expect(canDo(permsFromRoles(r), "approve_payroll_run")).toBe(true);
    expect(canDo(permsFromRoles(r), "create_payroll_run")).toBe(false);

    r = revoke(r, "hr_approver");
    r = grant(r, "hr_clerk");
    expect(canDo(permsFromRoles(r), "create_payroll_run")).toBe(true);
  });

  it("officer ↔ auditor revoke→reassign cycle", () => {
    let r: HrRole[] = ["payroll_officer"];
    expect(canDo(permsFromRoles(r), "execute_payroll")).toBe(true);

    expect(violatesHrSoD(r, "hr_auditor")).toBe(true);
    r = revoke(r, "payroll_officer");
    r = grant(r, "hr_auditor");
    expect(canDo(permsFromRoles(r), "audit_payroll")).toBe(true);
    expect(canDo(permsFromRoles(r), "execute_payroll")).toBe(false);
  });

  it("hr_admin coexists with any role without SoD", () => {
    for (const role of ALL_HR_ROLES) {
      expect(violatesHrSoD([role], "hr_admin")).toBe(false);
    }
  });

  it("compatible cross-SoD pairs are allowed", () => {
    // clerk + auditor : pas de conflit direct (le clerc saisit, l'auditeur contrôle un autre cycle)
    expect(violatesHrSoD(["hr_clerk"], "hr_auditor")).toBe(false);
    expect(violatesHrSoD(["hr_approver"], "payroll_officer")).toBe(false);
  });

  it("masking: no role → •••••", () => {
    expect(maskAmount(permsFromRoles([]), 1500)).toBe("•••••");
  });

  it("masking: every hr_* role unlocks sensitive view", () => {
    for (const role of ALL_HR_ROLES) {
      expect(maskAmount(permsFromRoles([role]), 1500)).not.toBe("•••••");
    }
  });

  it("recovery: accidental conflicting grant requires revoke-first", () => {
    const start: HrRole[] = ["hr_clerk"];
    expect(violatesHrSoD(start, "hr_approver")).toBe(true);
    const fixed = grant(revoke(start, "hr_clerk"), "hr_approver");
    expect(fixed).toEqual(["hr_approver"]);
  });

  it("admin alone has full perms", () => {
    const p = permsFromRoles(["hr_admin"]);
    expect(Object.values(p).every(Boolean)).toBe(true);
  });

  it("only admin can manage settings", () => {
    expect(permsFromRoles(["hr_clerk"]).canManageSettings).toBe(false);
    expect(permsFromRoles(["hr_approver"]).canManageSettings).toBe(false);
    expect(permsFromRoles(["payroll_officer"]).canManageSettings).toBe(false);
    expect(permsFromRoles(["hr_auditor"]).canManageSettings).toBe(false);
    expect(permsFromRoles(["hr_admin"]).canManageSettings).toBe(true);
  });

  it("auditor cannot create or execute payroll", () => {
    const p = permsFromRoles(["hr_auditor"]);
    expect(p.canCreatePayrollRun).toBe(false);
    expect(p.canExecutePayroll).toBe(false);
    expect(p.canAuditPayroll).toBe(true);
    expect(p.canExport).toBe(true);
  });
});
