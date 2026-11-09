import { describe, it, expect } from "vitest";
import { canDo, actionTooltip, missingRoleHint, type InventoryPerms, type InventoryAction } from "./inventory-roles";

const ALL_ACTIONS: InventoryAction[] = ["move", "adjust", "transfer", "count", "post_count", "export"];

const perms = (overrides: Partial<InventoryPerms> = {}): InventoryPerms => ({
  canMove: false, canAdjust: false, canTransfer: false,
  canCount: false, canPostCount: false, canExport: false,
  ...overrides,
});

// Mirror of useMyInventoryRoles role->permission derivation.
function permsForRoles(roles: string[]): InventoryPerms {
  const has = (r: string) => roles.includes("admin") || roles.includes(r);
  return {
    canMove:      has("inventory_clerk") || has("inventory_manager") || has("inventory_controller"),
    canAdjust:    has("inventory_manager") || has("inventory_controller"),
    canTransfer:  has("inventory_clerk") || has("inventory_manager") || has("inventory_controller"),
    canCount:     has("inventory_clerk") || has("inventory_manager") || has("inventory_controller"),
    canPostCount: has("inventory_manager") || has("inventory_controller"),
    canExport:    has("inventory_manager") || has("inventory_controller"),
  };
}

describe("inventory-roles: canDo()", () => {
  it("returns false for every action when perms is undefined", () => {
    for (const a of ALL_ACTIONS) expect(canDo(undefined, a)).toBe(false);
  });

  it("returns false for every action when user has no inventory role", () => {
    const p = permsForRoles([]);
    for (const a of ALL_ACTIONS) expect(canDo(p, a)).toBe(false);
  });

  it("inventory_clerk: can move/transfer/count only", () => {
    const p = permsForRoles(["inventory_clerk"]);
    expect(canDo(p, "move")).toBe(true);
    expect(canDo(p, "transfer")).toBe(true);
    expect(canDo(p, "count")).toBe(true);
    expect(canDo(p, "adjust")).toBe(false);
    expect(canDo(p, "post_count")).toBe(false);
    expect(canDo(p, "export")).toBe(false);
  });

  it("inventory_manager: all except none — adjust, post_count, export unlocked", () => {
    const p = permsForRoles(["inventory_manager"]);
    for (const a of ALL_ACTIONS) expect(canDo(p, a)).toBe(true);
  });

  it("inventory_controller: full access", () => {
    const p = permsForRoles(["inventory_controller"]);
    for (const a of ALL_ACTIONS) expect(canDo(p, a)).toBe(true);
  });

  it("admin: full access regardless of inventory role", () => {
    const p = permsForRoles(["admin"]);
    for (const a of ALL_ACTIONS) expect(canDo(p, a)).toBe(true);
  });

  it("explicitly blocks export when only canMove is true", () => {
    expect(canDo(perms({ canMove: true }), "export")).toBe(false);
    expect(canDo(perms({ canMove: true }), "adjust")).toBe(false);
    expect(canDo(perms({ canMove: true }), "post_count")).toBe(false);
  });
});

describe("inventory-roles: tooltip / hint", () => {
  it("missingRoleHint mentions the required roles in French", () => {
    expect(missingRoleHint("export")).toMatch(/Responsable Stock/);
    expect(missingRoleHint("export")).toMatch(/Contrôleur Stock/);
    expect(missingRoleHint("move")).toMatch(/Magasinier/);
  });

  it("actionTooltip returns enabled label when allowed", () => {
    const p = permsForRoles(["inventory_manager"]);
    expect(actionTooltip(p, "export", "Exporter CSV")).toBe("Exporter CSV");
  });

  it("actionTooltip returns missing-role hint when disallowed", () => {
    const p = permsForRoles(["inventory_clerk"]);
    expect(actionTooltip(p, "export", "Exporter CSV")).toMatch(/rôle requis/);
  });

  it("actionTooltip with no enabledLabel returns empty string when allowed", () => {
    const p = permsForRoles(["inventory_controller"]);
    expect(actionTooltip(p, "adjust")).toBe("");
  });
});
