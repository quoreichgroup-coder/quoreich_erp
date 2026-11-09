import { describe, it, expect } from "vitest";
import {
  violatesBudgetSoD,
  SOD_CONFLICTS,
  ALL_BUDGET_ROLES,
  type BudgetRole,
} from "@/lib/budget-roles";

/**
 * Mirrors the server-side SoD check in the assign_budget_role RPC.
 * Planner ⊕ Approver are mutually exclusive on a single user.
 * Controller and Admin have no SoD conflicts.
 */
describe("Budget SoD — assign_budget_role enforcement", () => {
  it("flags Planner → Approver conflict", () => {
    expect(violatesBudgetSoD(["budget_planner"], "budget_approver")).toBe(true);
  });

  it("flags Approver → Planner conflict", () => {
    expect(violatesBudgetSoD(["budget_approver"], "budget_planner")).toBe(true);
  });

  it("allows Planner with Controller or Admin", () => {
    expect(violatesBudgetSoD(["budget_planner"], "budget_controller")).toBe(false);
    expect(violatesBudgetSoD(["budget_planner"], "budget_admin")).toBe(false);
  });

  it("allows Approver with Controller or Admin", () => {
    expect(violatesBudgetSoD(["budget_approver"], "budget_controller")).toBe(false);
    expect(violatesBudgetSoD(["budget_approver"], "budget_admin")).toBe(false);
  });

  it("idempotent: re-adding an already-held role is not a violation", () => {
    expect(violatesBudgetSoD(["budget_planner"], "budget_planner")).toBe(false);
  });

  it("re-assign scenario: removing Planner then assigning Approver is allowed", () => {
    const initial: BudgetRole[] = ["budget_planner", "budget_controller"];
    expect(violatesBudgetSoD(initial, "budget_approver")).toBe(true);

    // After revocation of Planner
    const afterRevoke = initial.filter((r) => r !== "budget_planner");
    expect(violatesBudgetSoD(afterRevoke, "budget_approver")).toBe(false);
  });

  it("re-assign scenario: removing Approver then assigning Planner is allowed", () => {
    const initial: BudgetRole[] = ["budget_approver"];
    expect(violatesBudgetSoD(initial, "budget_planner")).toBe(true);

    const afterRevoke = initial.filter((r) => r !== "budget_approver");
    expect(violatesBudgetSoD(afterRevoke, "budget_planner")).toBe(false);
  });

  it("Controller and Admin have no conflicts at all", () => {
    expect(SOD_CONFLICTS.budget_controller).toEqual([]);
    expect(SOD_CONFLICTS.budget_admin).toEqual([]);
    for (const r of ALL_BUDGET_ROLES) {
      expect(violatesBudgetSoD([r], "budget_controller")).toBe(false);
      expect(violatesBudgetSoD([r], "budget_admin")).toBe(false);
    }
  });

  it("empty role set never violates SoD", () => {
    for (const r of ALL_BUDGET_ROLES) {
      expect(violatesBudgetSoD([], r)).toBe(false);
    }
  });

  it("SoD is symmetric for Planner/Approver", () => {
    expect(SOD_CONFLICTS.budget_planner).toContain("budget_approver");
    expect(SOD_CONFLICTS.budget_approver).toContain("budget_planner");
  });
});
