import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { Button } from "@/components/ui/button";
import {
  REQUIRED_ROLES,
  ALL_FA_ACTIONS,
  ALL_FA_ROLES,
  ACTION_LABELS,
  canDo,
  actionTooltip,
  maskAmount,
  type FixedAssetAction,
  type FixedAssetRole,
  type FixedAssetPerms,
} from "@/lib/fixed-assets-roles";

afterEach(cleanup);

// Mirror the hook contract used by every Fixed Assets page.
function permsFor(roles: FixedAssetRole[]): FixedAssetPerms {
  const has = (a: FixedAssetAction) =>
    roles.some((r) => REQUIRED_ROLES[a].includes(r));
  return {
    canCreate:           has("create_asset"),
    canEdit:             has("edit_asset"),
    canPutInService:     has("put_in_service"),
    canRunDepreciation:  has("run_depreciation"),
    canDispose:          has("dispose"),
    canManageCategories: has("manage_categories"),
    canExport:           has("export"),
    canViewSensitive:    has("view_sensitive"),
  };
}

/**
 * Toolbar replicates the exact button pattern shared by AssetsMasterData /
 * AssetsTransactions / AssetsReporting / AssetsControl: shadcn Button +
 * disabled={!canDo(...)} + aria-label/title from actionTooltip().
 */
function AssetsToolbar({ perms }: { perms: FixedAssetPerms }) {
  return (
    <div>
      {ALL_FA_ACTIONS.filter((a) => a !== "view_sensitive").map((action) => {
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
      <span data-testid="sensitive-amount">{maskAmount(perms, 1500000)}</span>
    </div>
  );
}

describe("Fixed Assets toolbar — RBAC integration", () => {
  it("disables every action button when user has no role", () => {
    render(<AssetsToolbar perms={permsFor([])} />);
    for (const a of ALL_FA_ACTIONS.filter((x) => x !== "view_sensitive")) {
      const btn = screen.getByTestId(`btn-${a}`);
      expect(btn).toBeDisabled();
      expect(btn.getAttribute("aria-label")).toMatch(/verrouillée/);
    }
    expect(screen.getByTestId("sensitive-amount")).toHaveTextContent("•••••");
  });

  it("enables every action for asset_admin and reveals sensitive amounts", () => {
    render(<AssetsToolbar perms={permsFor(["asset_admin"])} />);
    for (const a of ALL_FA_ACTIONS.filter((x) => x !== "view_sensitive")) {
      const btn = screen.getByTestId(`btn-${a}`);
      expect(btn).toBeEnabled();
      expect(btn.getAttribute("aria-label")).toBe(ACTION_LABELS[a]);
    }
    expect(screen.getByTestId("sensitive-amount")).not.toHaveTextContent("•••••");
  });

  it("asset_clerk: create+edit enabled; export/dispose/depreciation/put_in_service disabled", () => {
    render(<AssetsToolbar perms={permsFor(["asset_clerk"])} />);
    expect(screen.getByTestId("btn-create_asset")).toBeEnabled();
    expect(screen.getByTestId("btn-edit_asset")).toBeEnabled();
    expect(screen.getByTestId("btn-export")).toBeDisabled();
    expect(screen.getByTestId("btn-dispose")).toBeDisabled();
    expect(screen.getByTestId("btn-run_depreciation")).toBeDisabled();
    expect(screen.getByTestId("btn-put_in_service")).toBeDisabled();
    expect(screen.getByTestId("btn-manage_categories")).toBeDisabled();
    // clerk can view sensitive amounts (data-entry needs them)
    expect(screen.getByTestId("sensitive-amount")).not.toHaveTextContent("•••••");
  });

  it("asset_controller: export+depreciation enabled; create/edit/dispose disabled", () => {
    render(<AssetsToolbar perms={permsFor(["asset_controller"])} />);
    expect(screen.getByTestId("btn-export")).toBeEnabled();
    expect(screen.getByTestId("btn-run_depreciation")).toBeEnabled();
    expect(screen.getByTestId("btn-create_asset")).toBeDisabled();
    expect(screen.getByTestId("btn-edit_asset")).toBeDisabled();
    expect(screen.getByTestId("btn-dispose")).toBeDisabled();
    expect(screen.getByTestId("btn-put_in_service")).toBeDisabled();
    expect(screen.getByTestId("btn-manage_categories")).toBeDisabled();
  });

  it("asset_accountant: full lifecycle (create→put_in_service→depreciation→dispose→export) enabled, categories locked", () => {
    render(<AssetsToolbar perms={permsFor(["asset_accountant"])} />);
    for (const a of ["create_asset", "edit_asset", "put_in_service", "run_depreciation", "dispose", "export"] as const) {
      expect(screen.getByTestId(`btn-${a}`), a).toBeEnabled();
    }
    expect(screen.getByTestId("btn-manage_categories")).toBeDisabled();
  });

  it("manage_categories is admin-only across all single-role users", () => {
    for (const role of ALL_FA_ROLES) {
      cleanup();
      render(<AssetsToolbar perms={permsFor([role])} />);
      const btn = screen.getByTestId("btn-manage_categories");
      if (role === "asset_admin") expect(btn).toBeEnabled();
      else expect(btn).toBeDisabled();
    }
  });

  it("tooltip text reflects required roles when locked", () => {
    render(<AssetsToolbar perms={permsFor(["asset_clerk"])} />);
    const exportBtn = screen.getByTestId("btn-export");
    const tip = exportBtn.getAttribute("aria-label")!;
    expect(tip).toContain("Comptable Immobilisations");
    expect(tip).toContain("Contrôleur Immobilisations");
    expect(tip).toContain("Administrateur Immobilisations");
  });
});
