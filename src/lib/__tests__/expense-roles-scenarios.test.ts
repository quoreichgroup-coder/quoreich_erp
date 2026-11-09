import { describe, it, expect } from "vitest";
import {
  violatesExpenseSoD,
  ALL_EXPENSE_ROLES,
  REQUIRED_ROLES,
  canDo,
  type ExpenseRole,
  type ExpensePerms,
} from "@/lib/expense-roles";

/**
 * Extended SoD scenarios (revoke ↔ reassign loops, idempotence, multi-role).
 * Complements expense-roles-sod.test.ts.
 */

const permsFromRoles = (roles: ExpenseRole[]): ExpensePerms => ({
  canCreate:         roles.some((r) => REQUIRED_ROLES.create_report.includes(r)),
  canSubmit:         roles.some((r) => REQUIRED_ROLES.submit_report.includes(r)),
  canApprove:        roles.some((r) => REQUIRED_ROLES.approve_report.includes(r)),
  canReject:         roles.some((r) => REQUIRED_ROLES.reject_report.includes(r)),
  canReimburse:      roles.some((r) => REQUIRED_ROLES.reimburse.includes(r)),
  canManageSettings: roles.some((r) => REQUIRED_ROLES.manage_settings.includes(r)),
  canExport:         roles.some((r) => REQUIRED_ROLES.export.includes(r)),
  canViewSensitive:  roles.some((r) => REQUIRED_ROLES.view_sensitive.includes(r)),
});

const grant = (r: ExpenseRole[], add: ExpenseRole): ExpenseRole[] =>
  r.includes(add) ? r : [...r, add];
const revoke = (r: ExpenseRole[], rm: ExpenseRole): ExpenseRole[] =>
  r.filter((x) => x !== rm);

describe("Expense SoD — extended revoke/reassign & idempotence", () => {
  it("idempotent grant: granting same role twice yields same set", () => {
    let roles: ExpenseRole[] = [];
    roles = grant(roles, "expense_clerk");
    roles = grant(roles, "expense_clerk");
    expect(roles).toEqual(["expense_clerk"]);
    expect(violatesExpenseSoD(roles, "expense_clerk")).toBe(false);
  });

  it("idempotent revoke: revoking unheld role is a no-op", () => {
    const roles: ExpenseRole[] = ["expense_clerk"];
    const after = revoke(roles, "expense_approver");
    expect(after).toEqual(["expense_clerk"]);
  });

  it("full cycle: clerk → revoke → approver → revoke → clerk", () => {
    let roles: ExpenseRole[] = [];
    roles = grant(roles, "expense_clerk");
    expect(canDo(permsFromRoles(roles), "submit_report")).toBe(true);

    // Cannot upgrade to approver without revoking clerk first (SoD)
    expect(violatesExpenseSoD(roles, "expense_approver")).toBe(true);

    roles = revoke(roles, "expense_clerk");
    expect(canDo(permsFromRoles(roles), "submit_report")).toBe(false);
    roles = grant(roles, "expense_approver");
    expect(canDo(permsFromRoles(roles), "approve_report")).toBe(true);

    // Reverse: revoke approver and re-grant clerk
    expect(violatesExpenseSoD(roles, "expense_clerk")).toBe(true);
    roles = revoke(roles, "expense_approver");
    roles = grant(roles, "expense_clerk");
    expect(canDo(permsFromRoles(roles), "submit_report")).toBe(true);
    expect(canDo(permsFromRoles(roles), "approve_report")).toBe(false);
  });

  it("multi-role admin: granting admin alongside another role keeps both", () => {
    let roles: ExpenseRole[] = ["expense_controller"];
    roles = grant(roles, "expense_admin");
    expect(roles).toContain("expense_controller");
    expect(roles).toContain("expense_admin");
    const p = permsFromRoles(roles);
    expect(p.canReimburse).toBe(true);
    expect(p.canManageSettings).toBe(true);
  });

  it("controller + clerk allowed (no SoD between them)", () => {
    expect(violatesExpenseSoD(["expense_clerk"], "expense_controller")).toBe(false);
    expect(violatesExpenseSoD(["expense_controller"], "expense_clerk")).toBe(false);
    const p = permsFromRoles(["expense_clerk", "expense_controller"]);
    expect(p.canCreate).toBe(true);
    expect(p.canReimburse).toBe(true);
    expect(p.canApprove).toBe(false);
  });

  it("granting admin never violates SoD regardless of current roles", () => {
    for (const r of ALL_EXPENSE_ROLES) {
      expect(violatesExpenseSoD([r], "expense_admin")).toBe(false);
    }
  });

  it("scenario: user accidentally granted both → only one survives via revoke flow", () => {
    // SoD prevents granting approver to clerk; verify the only legal recovery is revoke-first
    const start: ExpenseRole[] = ["expense_clerk"];
    expect(violatesExpenseSoD(start, "expense_approver")).toBe(true);
    const fixed = grant(revoke(start, "expense_clerk"), "expense_approver");
    expect(fixed).toEqual(["expense_approver"]);
  });

  it("sensitive amount masked when user has no expense_* roles", () => {
    const p = permsFromRoles([]);
    expect(p.canViewSensitive).toBe(false);
  });

  it("every non-admin role grants view_sensitive", () => {
    for (const r of ALL_EXPENSE_ROLES) {
      const p = permsFromRoles([r]);
      expect(p.canViewSensitive).toBe(true);
    }
  });
});
