// Centralised RBAC mapping for Treasury actions — mirrors inventory-roles.ts.
// Used to gate buttons/menus and explain to the user why an action is disabled.

export type TreasuryAction =
  | "create_txn"
  | "import_statement"
  | "match"
  | "validate_recon"
  | "edit_forecast"
  | "manage_accounts"
  | "export"
  | "view_sensitive"     // voir montants / soldes / colonnes sensibles
  | "close_period"
  | "audit";

const REQUIRED_ROLES: Record<TreasuryAction, string[]> = {
  create_txn:        ["treasury_clerk", "treasury_manager", "cash_admin"],
  import_statement:  ["treasury_clerk", "treasury_manager", "cash_admin"],
  match:             ["treasury_clerk", "treasury_manager", "cash_admin"],
  validate_recon:    ["treasury_manager", "treasury_controller", "cash_admin"],
  edit_forecast:     ["treasury_manager", "treasury_controller", "cash_admin"],
  manage_accounts:   ["treasury_manager", "cash_admin"],
  export:            ["treasury_manager", "treasury_controller", "cash_admin"],
  view_sensitive:    ["treasury_clerk", "treasury_manager", "treasury_controller", "cash_admin"],
  close_period:      ["treasury_manager", "treasury_controller", "cash_admin"],
  audit:             ["treasury_manager", "treasury_controller", "cash_admin"],
};

const ROLE_LABELS: Record<string, string> = {
  treasury_clerk:      "Trésorier opérationnel",
  treasury_manager:    "Responsable Trésorerie",
  treasury_controller: "Contrôleur Trésorerie",
  cash_admin:          "Administrateur Cash",
};

export type TreasuryPerms = {
  canCreateTxn: boolean;
  canImportStatement: boolean;
  canMatch: boolean;
  canValidateRecon: boolean;
  canEditForecast: boolean;
  canManageAccounts: boolean;
  canExport: boolean;
  canViewSensitive: boolean;
  canClosePeriod: boolean;
  canAudit: boolean;
};

export function canDo(perms: TreasuryPerms | undefined, action: TreasuryAction): boolean {
  if (!perms) return false;
  switch (action) {
    case "create_txn":       return perms.canCreateTxn;
    case "import_statement": return perms.canImportStatement;
    case "match":            return perms.canMatch;
    case "validate_recon":   return perms.canValidateRecon;
    case "edit_forecast":    return perms.canEditForecast;
    case "manage_accounts":  return perms.canManageAccounts;
    case "export":           return perms.canExport;
    case "view_sensitive":   return perms.canViewSensitive;
    case "close_period":     return perms.canClosePeriod;
    case "audit":            return perms.canAudit;
  }
}

export function maskAmount(perms: TreasuryPerms | undefined, value: number | string): string {
  if (canDo(perms, "view_sensitive")) {
    return typeof value === "number" ? Math.round(value).toLocaleString("fr-FR") : String(value);
  }
  return "•••••";
}

export function missingRoleHint(action: TreasuryAction): string {
  const roles = REQUIRED_ROLES[action].map((r) => ROLE_LABELS[r] ?? r).join(", ");
  return `Action verrouillée — rôle requis : ${roles}.`;
}

export function actionTooltip(
  perms: TreasuryPerms | undefined,
  action: TreasuryAction,
  enabledLabel?: string,
): string {
  return canDo(perms, action) ? (enabledLabel ?? "") : missingRoleHint(action);
}

export const TREASURY_ROLE_LABELS: { value: string; label: string }[] = [
  { value: "treasury_clerk",      label: "Trésorier opérationnel — saisie, import, match" },
  { value: "treasury_manager",    label: "Responsable Trésorerie — validation, comptes, exports" },
  { value: "treasury_controller", label: "Contrôleur Trésorerie — supervision, exports" },
  { value: "cash_admin",          label: "Administrateur Cash — droits complets" },
];

export type TreasuryRole = "treasury_clerk" | "treasury_manager" | "treasury_controller" | "cash_admin";

// ---------------------------------------------------------------------------
// Stable, memoised `TreasuryPerms` computation.
// The cache is keyed by the sorted-distinct role string so equivalent inputs
// (different orders, duplicates) yield the SAME reference — letting React skip
// re-renders downstream and giving tests a referential-equality guarantee.
// ---------------------------------------------------------------------------

const PERMS_CACHE = new Map<string, TreasuryPerms>();

export function permsCacheKey(roles: readonly string[]): string {
  return Array.from(new Set(roles)).sort().join("|");
}

export function computeTreasuryPerms(roles: readonly string[]): TreasuryPerms {
  const key = permsCacheKey(roles);
  const cached = PERMS_CACHE.get(key);
  if (cached) return cached;
  const set = new Set(roles);
  const admin = set.has("cash_admin");
  const clerkOrUp = admin || set.has("treasury_clerk") || set.has("treasury_manager");
  const mgrOrCtrl = admin || set.has("treasury_manager") || set.has("treasury_controller");
  const anyTreasury = admin || set.has("treasury_clerk") || set.has("treasury_manager") || set.has("treasury_controller");
  const perms: TreasuryPerms = {
    canCreateTxn:       clerkOrUp,
    canImportStatement: clerkOrUp,
    canMatch:           clerkOrUp,
    canValidateRecon:   mgrOrCtrl,
    canEditForecast:    mgrOrCtrl,
    canManageAccounts:  admin || set.has("treasury_manager"),
    canExport:          mgrOrCtrl,
    canViewSensitive:   anyTreasury,
    canClosePeriod:     mgrOrCtrl,
    canAudit:           mgrOrCtrl,
  };
  PERMS_CACHE.set(key, perms);
  return perms;
}

/** Test-only: clear the perms cache between assertions. */
export function __resetTreasuryPermsCache(): void {
  PERMS_CACHE.clear();
}
