import { describe, it, expect } from "vitest";
import {
  REQUIRED_ROLES, ALL_BUDGET_ACTIONS, ALL_BUDGET_ROLES,
  ACTION_LABELS, ROLE_LABELS,
  canDo, maskAmount, missingRoleHint, actionTooltip,
  type BudgetAction, type BudgetRole, type BudgetPerms,
} from "@/lib/budget-roles";

function permsFor(roles: BudgetRole[]): BudgetPerms {
  const has = (a: BudgetAction) => roles.some((r) => REQUIRED_ROLES[a].includes(r));
  return {
    canCreate:          has("create_budget"),
    canEdit:            has("edit_budget"),
    canSubmit:          has("submit_for_approval"),
    canApprove:         has("approve_budget"),
    canLockPeriod:      has("lock_period"),
    canManageScenarios: has("manage_scenarios"),
    canExport:          has("export"),
    canViewSensitive:   has("view_sensitive"),
  };
}

describe("budget RBAC matrix", () => {
  it("declares labels for every action and role", () => {
    for (const a of ALL_BUDGET_ACTIONS) expect(ACTION_LABELS[a]).toBeTruthy();
    for (const r of ALL_BUDGET_ROLES) expect(ROLE_LABELS[r]).toBeTruthy();
  });

  it("budget_admin can do every action", () => {
    const p = permsFor(["budget_admin"]);
    for (const a of ALL_BUDGET_ACTIONS) expect(canDo(p, a)).toBe(true);
  });

  it("segregation of duties: planner cannot approve or lock", () => {
    const p = permsFor(["budget_planner"]);
    expect(p.canCreate).toBe(true);
    expect(p.canEdit).toBe(true);
    expect(p.canSubmit).toBe(true);
    expect(p.canApprove).toBe(false);
    expect(p.canLockPeriod).toBe(false);
    expect(p.canExport).toBe(false);
    expect(p.canManageScenarios).toBe(false);
  });

  it("approver can approve/lock/export but cannot create or edit", () => {
    const p = permsFor(["budget_approver"]);
    expect(p.canApprove).toBe(true);
    expect(p.canLockPeriod).toBe(true);
    expect(p.canExport).toBe(true);
    expect(p.canCreate).toBe(false);
    expect(p.canEdit).toBe(false);
    expect(p.canSubmit).toBe(false);
    expect(p.canManageScenarios).toBe(false);
  });

  it("controller is read/export only", () => {
    const p = permsFor(["budget_controller"]);
    expect(p.canExport).toBe(true);
    expect(p.canViewSensitive).toBe(true);
    for (const a of ["create_budget","edit_budget","submit_for_approval",
      "approve_budget","lock_period","manage_scenarios"] as const) {
      expect(canDo(p, a), a).toBe(false);
    }
  });

  it("manage_scenarios is admin-exclusive", () => {
    expect(REQUIRED_ROLES.manage_scenarios).toEqual(["budget_admin"]);
    for (const r of ALL_BUDGET_ROLES) {
      expect(permsFor([r]).canManageScenarios).toBe(r === "budget_admin");
    }
  });

  it("each single role only grants its declared actions", () => {
    for (const role of ALL_BUDGET_ROLES) {
      const p = permsFor([role]);
      for (const action of ALL_BUDGET_ACTIONS) {
        expect(canDo(p, action), `${role} → ${action}`)
          .toBe(REQUIRED_ROLES[action].includes(role));
      }
    }
  });

  it("canDo returns false for undefined perms", () => {
    for (const a of ALL_BUDGET_ACTIONS) expect(canDo(undefined, a)).toBe(false);
  });
});

describe("budget maskAmount + tooltips", () => {
  it("masks when view_sensitive denied", () => {
    expect(maskAmount(permsFor([]), 5_000_000)).toBe("•••••");
    expect(maskAmount(undefined, 1)).toBe("•••••");
  });

  it("formats numbers fr-FR when authorised", () => {
    const out = maskAmount(permsFor(["budget_controller"]), 1_234_567);
    expect(out.replace(/\s/g, "")).toBe("1234567");
  });

  it("missingRoleHint lists required role labels", () => {
    expect(missingRoleHint("approve_budget")).toContain(ROLE_LABELS.budget_approver);
    expect(missingRoleHint("manage_scenarios")).toContain(ROLE_LABELS.budget_admin);
  });

  it("actionTooltip switches between enabledLabel and hint", () => {
    expect(actionTooltip(permsFor(["budget_admin"]), "approve_budget", "Approuver"))
      .toBe("Approuver");
    expect(actionTooltip(permsFor([]), "approve_budget")).toContain("verrouillée");
  });
});
