import { describe, it, expect } from "vitest";
import {
  violatesExpenseSoD,
  SOD_CONFLICTS,
  ALL_EXPENSE_ROLES,
  ALL_EXPENSE_ACTIONS,
  REQUIRED_ROLES,
  canDo,
  type ExpenseRole,
  type ExpensePerms,
} from "@/lib/expense-roles";

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

describe("Expense SoD — assign_expense_role enforcement", () => {
  it("flags Clerk → Approver conflict", () => {
    expect(violatesExpenseSoD(["expense_clerk"], "expense_approver")).toBe(true);
  });

  it("flags Approver → Clerk conflict", () => {
    expect(violatesExpenseSoD(["expense_approver"], "expense_clerk")).toBe(true);
  });

  it("allows Clerk with Controller or Admin", () => {
    expect(violatesExpenseSoD(["expense_clerk"], "expense_controller")).toBe(false);
    expect(violatesExpenseSoD(["expense_clerk"], "expense_admin")).toBe(false);
  });

  it("allows Approver with Controller or Admin", () => {
    expect(violatesExpenseSoD(["expense_approver"], "expense_controller")).toBe(false);
    expect(violatesExpenseSoD(["expense_approver"], "expense_admin")).toBe(false);
  });

  it("idempotent: re-adding an already-held role is not a violation", () => {
    for (const r of ALL_EXPENSE_ROLES) {
      expect(violatesExpenseSoD([r], r)).toBe(false);
    }
  });

  it("revoke → reassign: removing Clerk then granting Approver is allowed", () => {
    const initial: ExpenseRole[] = ["expense_clerk", "expense_controller"];
    expect(violatesExpenseSoD(initial, "expense_approver")).toBe(true);
    const after = initial.filter((r) => r !== "expense_clerk");
    expect(violatesExpenseSoD(after, "expense_approver")).toBe(false);
  });

  it("revoke → reassign: removing Approver then granting Clerk is allowed", () => {
    const initial: ExpenseRole[] = ["expense_approver"];
    expect(violatesExpenseSoD(initial, "expense_clerk")).toBe(true);
    const after = initial.filter((r) => r !== "expense_approver");
    expect(violatesExpenseSoD(after, "expense_clerk")).toBe(false);
  });

  it("Controller and Admin have no conflicts at all", () => {
    expect(SOD_CONFLICTS.expense_controller).toEqual([]);
    expect(SOD_CONFLICTS.expense_admin).toEqual([]);
    for (const r of ALL_EXPENSE_ROLES) {
      expect(violatesExpenseSoD([r], "expense_controller")).toBe(false);
      expect(violatesExpenseSoD([r], "expense_admin")).toBe(false);
    }
  });

  it("empty role set never violates SoD", () => {
    for (const r of ALL_EXPENSE_ROLES) {
      expect(violatesExpenseSoD([], r)).toBe(false);
    }
  });

  it("SoD is symmetric for Clerk/Approver", () => {
    expect(SOD_CONFLICTS.expense_clerk).toContain("expense_approver");
    expect(SOD_CONFLICTS.expense_approver).toContain("expense_clerk");
  });

  it("matrix coherence: admin has every capability", () => {
    const p = permsFromRoles(["expense_admin"]);
    for (const a of ALL_EXPENSE_ACTIONS) expect(canDo(p, a)).toBe(true);
  });

  it("matrix coherence: clerk cannot approve or reimburse", () => {
    const p = permsFromRoles(["expense_clerk"]);
    expect(canDo(p, "create_report")).toBe(true);
    expect(canDo(p, "submit_report")).toBe(true);
    expect(canDo(p, "approve_report")).toBe(false);
    expect(canDo(p, "reimburse")).toBe(false);
    expect(canDo(p, "manage_settings")).toBe(false);
  });

  it("matrix coherence: approver approves/rejects but does not create or reimburse", () => {
    const p = permsFromRoles(["expense_approver"]);
    expect(canDo(p, "approve_report")).toBe(true);
    expect(canDo(p, "reject_report")).toBe(true);
    expect(canDo(p, "create_report")).toBe(false);
    expect(canDo(p, "reimburse")).toBe(false);
    expect(canDo(p, "export")).toBe(true);
  });

  it("matrix coherence: controller reimburses but neither creates nor approves", () => {
    const p = permsFromRoles(["expense_controller"]);
    expect(canDo(p, "reimburse")).toBe(true);
    expect(canDo(p, "create_report")).toBe(false);
    expect(canDo(p, "approve_report")).toBe(false);
  });

  it("re-assign loop: grant → revoke → grant restores capability", () => {
    let roles: ExpenseRole[] = [];
    roles = [...roles, "expense_clerk"];
    expect(canDo(permsFromRoles(roles), "create_report")).toBe(true);
    roles = roles.filter((r) => r !== "expense_clerk");
    expect(canDo(permsFromRoles(roles), "create_report")).toBe(false);
    roles = [...roles, "expense_clerk"];
    expect(canDo(permsFromRoles(roles), "create_report")).toBe(true);
  });
});
