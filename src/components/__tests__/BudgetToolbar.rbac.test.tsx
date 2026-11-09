import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import {
  REQUIRED_ROLES,
  ALL_BUDGET_ACTIONS,
  ALL_BUDGET_ROLES,
  ACTION_LABELS,
  canDo,
  actionTooltip,
  maskAmount,
  type BudgetAction,
  type BudgetRole,
  type BudgetPerms,
} from "@/lib/budget-roles";

afterEach(cleanup);

// Mirrors useMyBudgetRoles() — derives perms from a role set the same way.
function permsFor(roles: BudgetRole[]): BudgetPerms {
  const has = (a: BudgetAction) =>
    roles.some((r) => REQUIRED_ROLES[a].includes(r));
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

/** Replicates the exact button+RBAC pattern used by the 6 Budget pages. */
function BudgetToolbar({ perms }: { perms: BudgetPerms }) {
  return (
    <div>
      {ALL_BUDGET_ACTIONS.filter((a) => a !== "view_sensitive").map((action) => {
        const tip = actionTooltip(perms, action, ACTION_LABELS[action]);
        return (
          <Button
            key={action}
            data-testid={`btn-${action}`}
            disabled={!canDo(perms, action)}
            aria-label={tip}
            title={tip}
          >
            {ACTION_LABELS[action]}
          </Button>
        );
      })}
      <span data-testid="amount">{maskAmount(perms, 2_500_000)}</span>
    </div>
  );
}

describe("Budget toolbar — RBAC integration (matches role × action matrix)", () => {
  it("no role: every action disabled and amounts masked", () => {
    render(<BudgetToolbar perms={permsFor([])} />);
    for (const a of ALL_BUDGET_ACTIONS.filter((x) => x !== "view_sensitive")) {
      const btn = screen.getByTestId(`btn-${a}`);
      expect(btn).toBeDisabled();
      expect(btn.getAttribute("aria-label")).toMatch(/verrouillée/);
    }
    expect(screen.getByTestId("amount")).toHaveTextContent("•••••");
  });

  it("budget_admin: every action enabled and amounts visible", () => {
    render(<BudgetToolbar perms={permsFor(["budget_admin"])} />);
    for (const a of ALL_BUDGET_ACTIONS.filter((x) => x !== "view_sensitive")) {
      expect(screen.getByTestId(`btn-${a}`), a).toBeEnabled();
    }
    expect(screen.getByTestId("amount")).not.toHaveTextContent("•••••");
  });

  it("budget_planner: create/edit/submit enabled; approve/lock/export/scenarios disabled", () => {
    render(<BudgetToolbar perms={permsFor(["budget_planner"])} />);
    expect(screen.getByTestId("btn-create_budget")).toBeEnabled();
    expect(screen.getByTestId("btn-edit_budget")).toBeEnabled();
    expect(screen.getByTestId("btn-submit_for_approval")).toBeEnabled();
    expect(screen.getByTestId("btn-approve_budget")).toBeDisabled();
    expect(screen.getByTestId("btn-lock_period")).toBeDisabled();
    expect(screen.getByTestId("btn-export")).toBeDisabled();
    expect(screen.getByTestId("btn-manage_scenarios")).toBeDisabled();
    // Planner can view sensitive amounts (needs them to plan)
    expect(screen.getByTestId("amount")).not.toHaveTextContent("•••••");
  });

  it("budget_approver: approve/lock/export enabled; create/edit/submit/scenarios disabled (SoD)", () => {
    render(<BudgetToolbar perms={permsFor(["budget_approver"])} />);
    expect(screen.getByTestId("btn-approve_budget")).toBeEnabled();
    expect(screen.getByTestId("btn-lock_period")).toBeEnabled();
    expect(screen.getByTestId("btn-export")).toBeEnabled();
    expect(screen.getByTestId("btn-create_budget")).toBeDisabled();
    expect(screen.getByTestId("btn-edit_budget")).toBeDisabled();
    expect(screen.getByTestId("btn-submit_for_approval")).toBeDisabled();
    expect(screen.getByTestId("btn-manage_scenarios")).toBeDisabled();
  });

  it("budget_controller: export+view enabled; no write actions", () => {
    render(<BudgetToolbar perms={permsFor(["budget_controller"])} />);
    expect(screen.getByTestId("btn-export")).toBeEnabled();
    expect(screen.getByTestId("amount")).not.toHaveTextContent("•••••");
    for (const a of ["create_budget", "edit_budget", "submit_for_approval",
                     "approve_budget", "lock_period", "manage_scenarios"] as const) {
      expect(screen.getByTestId(`btn-${a}`), a).toBeDisabled();
    }
  });

  it("manage_scenarios is admin-only across all single-role users", () => {
    for (const role of ALL_BUDGET_ROLES) {
      cleanup();
      render(<BudgetToolbar perms={permsFor([role])} />);
      const btn = screen.getByTestId("btn-manage_scenarios");
      if (role === "budget_admin") expect(btn).toBeEnabled();
      else expect(btn).toBeDisabled();
    }
  });

  it("tooltip lists required roles when locked", () => {
    render(<BudgetToolbar perms={permsFor(["budget_planner"])} />);
    const tip = screen.getByTestId("btn-approve_budget").getAttribute("aria-label")!;
    expect(tip).toContain("Approbateur Budget");
    expect(tip).toContain("Administrateur Budget");
  });
});
