// Centralised mapping from Inventory UI actions to the RBAC permission flag
// returned by `useMyInventoryRoles`, plus a human-readable hint listing the
// roles that grant the action. Used to gate buttons/menus and explain to the
// user (via tooltip + aria-label) why an action is disabled.

export type InventoryAction =
  | "move"        // create stock movement (receipt/issue/transfer-in/out)
  | "adjust"      // create adjustment movement
  | "transfer"    // transfer between warehouses
  | "count"       // create / edit inventory count
  | "post_count"  // post (validate) an inventory count
  | "close"       // close monthly inventory period (snapshot + lock)
  | "export";     // CSV / Excel export of inventory data

const REQUIRED_ROLES: Record<InventoryAction, string[]> = {
  move:       ["inventory_clerk", "inventory_manager", "inventory_controller"],
  adjust:     ["inventory_manager", "inventory_controller"],
  transfer:   ["inventory_clerk", "inventory_manager", "inventory_controller"],
  count:      ["inventory_clerk", "inventory_manager", "inventory_controller"],
  post_count: ["inventory_manager", "inventory_controller"],
  close:      ["inventory_controller"],
  export:     ["inventory_manager", "inventory_controller"],
};

const ROLE_LABELS: Record<string, string> = {
  inventory_clerk:      "Magasinier",
  inventory_manager:    "Responsable Stock",
  inventory_controller: "Contrôleur Stock",
};

export type InventoryPerms = {
  canMove: boolean;
  canAdjust: boolean;
  canTransfer: boolean;
  canCount: boolean;
  canPostCount: boolean;
  canClose?: boolean;
  canExport: boolean;
};

export function canDo(perms: InventoryPerms | undefined, action: InventoryAction): boolean {
  if (!perms) return false;
  switch (action) {
    case "move":       return perms.canMove;
    case "adjust":     return perms.canAdjust;
    case "transfer":   return perms.canTransfer;
    case "count":      return perms.canCount;
    case "post_count": return perms.canPostCount;
    case "close":      return perms.canClose ?? false;
    case "export":     return perms.canExport;
  }
}

export function missingRoleHint(action: InventoryAction): string {
  const roles = REQUIRED_ROLES[action].map((r) => ROLE_LABELS[r] ?? r).join(", ");
  return `Action verrouillée — rôle requis : ${roles}.`;
}

export function actionTooltip(
  perms: InventoryPerms | undefined,
  action: InventoryAction,
  enabledLabel?: string,
): string {
  return canDo(perms, action) ? (enabledLabel ?? "") : missingRoleHint(action);
}
