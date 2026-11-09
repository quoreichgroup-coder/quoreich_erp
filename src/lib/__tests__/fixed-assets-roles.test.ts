import { describe, it, expect } from "vitest";
import {
  REQUIRED_ROLES,
  ALL_FA_ACTIONS,
  ALL_FA_ROLES,
  ACTION_LABELS,
  ROLE_LABELS,
  canDo,
  maskAmount,
  missingRoleHint,
  actionTooltip,
  type FixedAssetAction,
  type FixedAssetRole,
  type FixedAssetPerms,
} from "@/lib/fixed-assets-roles";

// Build a perms object from a set of roles, mirroring the hook contract.
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

describe("fixed-assets RBAC matrix", () => {
  it("declares a label for every action and role", () => {
    for (const a of ALL_FA_ACTIONS) expect(ACTION_LABELS[a]).toBeTruthy();
    for (const r of ALL_FA_ROLES) expect(ROLE_LABELS[r]).toBeTruthy();
  });

  it("only references known roles in REQUIRED_ROLES", () => {
    for (const a of ALL_FA_ACTIONS) {
      const list = REQUIRED_ROLES[a];
      expect(list.length).toBeGreaterThan(0);
      for (const r of list) expect(ALL_FA_ROLES).toContain(r);
    }
  });

  it("asset_admin can do every action", () => {
    const p = permsFor(["asset_admin"]);
    for (const a of ALL_FA_ACTIONS) {
      expect(canDo(p, a)).toBe(true);
    }
  });

  it("asset_clerk maps to create/edit/view_sensitive only", () => {
    const p = permsFor(["asset_clerk"]);
    expect(p.canCreate).toBe(true);
    expect(p.canEdit).toBe(true);
    expect(p.canViewSensitive).toBe(true);
    expect(p.canPutInService).toBe(false);
    expect(p.canRunDepreciation).toBe(false);
    expect(p.canDispose).toBe(false);
    expect(p.canManageCategories).toBe(false);
    expect(p.canExport).toBe(false);
  });

  it("asset_accountant covers operational lifecycle", () => {
    const p = permsFor(["asset_accountant"]);
    expect(p.canCreate).toBe(true);
    expect(p.canEdit).toBe(true);
    expect(p.canPutInService).toBe(true);
    expect(p.canRunDepreciation).toBe(true);
    expect(p.canDispose).toBe(true);
    expect(p.canExport).toBe(true);
    expect(p.canViewSensitive).toBe(true);
    expect(p.canManageCategories).toBe(false);
  });

  it("asset_controller is read/supervise only — no write/lifecycle", () => {
    const p = permsFor(["asset_controller"]);
    expect(p.canRunDepreciation).toBe(true);
    expect(p.canExport).toBe(true);
    expect(p.canViewSensitive).toBe(true);
    expect(p.canCreate).toBe(false);
    expect(p.canEdit).toBe(false);
    expect(p.canPutInService).toBe(false);
    expect(p.canDispose).toBe(false);
    expect(p.canManageCategories).toBe(false);
  });

  it("manage_categories is admin-exclusive", () => {
    expect(REQUIRED_ROLES.manage_categories).toEqual(["asset_admin"]);
    for (const r of ALL_FA_ROLES) {
      const allowed = permsFor([r]).canManageCategories;
      expect(allowed).toBe(r === "asset_admin");
    }
  });

  it("no role grants any permission outside REQUIRED_ROLES", () => {
    for (const role of ALL_FA_ROLES) {
      const p = permsFor([role]);
      for (const action of ALL_FA_ACTIONS) {
        const expected = REQUIRED_ROLES[action].includes(role);
        expect(canDo(p, action), `${role} → ${action}`).toBe(expected);
      }
    }
  });

  it("canDo returns false when perms is undefined", () => {
    for (const a of ALL_FA_ACTIONS) expect(canDo(undefined, a)).toBe(false);
  });
});

describe("maskAmount", () => {
  it("masks when view_sensitive is denied", () => {
    const p = permsFor([]); // no roles
    expect(maskAmount(p, 1234567)).toBe("•••••");
    expect(maskAmount(undefined, 42)).toBe("•••••");
  });

  it("formats numbers in fr-FR when authorised", () => {
    const p = permsFor(["asset_controller"]);
    const out = maskAmount(p, 1234567.4);
    // fr-FR uses narrow no-break / non-breaking space as thousands separator.
    expect(out.replace(/\s/g, "")).toBe("1234567");
  });

  it("passes through strings when authorised", () => {
    const p = permsFor(["asset_admin"]);
    expect(maskAmount(p, "N/A")).toBe("N/A");
  });
});

describe("tooltips", () => {
  it("missingRoleHint lists required roles by label", () => {
    const hint = missingRoleHint("manage_categories");
    expect(hint).toContain(ROLE_LABELS.asset_admin);
  });

  it("actionTooltip returns enabledLabel when allowed, hint when not", () => {
    const allowed = permsFor(["asset_admin"]);
    const denied = permsFor([]);
    expect(actionTooltip(allowed, "export", "Exporter")).toBe("Exporter");
    expect(actionTooltip(denied, "export")).toContain("verrouillée");
  });
});
