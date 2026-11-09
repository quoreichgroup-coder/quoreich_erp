// Centralised RBAC mapping for Fixed Assets actions — mirrors treasury-roles.ts.

export type FixedAssetRole = "asset_clerk" | "asset_accountant" | "asset_controller" | "asset_admin";

export type FixedAssetAction =
  | "create_asset"
  | "edit_asset"
  | "put_in_service"
  | "run_depreciation"
  | "dispose"
  | "manage_categories"
  | "export"
  | "view_sensitive";

export const REQUIRED_ROLES: Record<FixedAssetAction, FixedAssetRole[]> = {
  create_asset:       ["asset_clerk", "asset_accountant", "asset_admin"],
  edit_asset:         ["asset_clerk", "asset_accountant", "asset_admin"],
  put_in_service:     ["asset_accountant", "asset_admin"],
  run_depreciation:   ["asset_accountant", "asset_controller", "asset_admin"],
  dispose:            ["asset_accountant", "asset_admin"],
  manage_categories:  ["asset_admin"],
  export:             ["asset_accountant", "asset_controller", "asset_admin"],
  view_sensitive:     ["asset_clerk", "asset_accountant", "asset_controller", "asset_admin"],
};

export const ACTION_LABELS: Record<FixedAssetAction, string> = {
  create_asset:      "Créer une immobilisation",
  edit_asset:        "Modifier une immobilisation",
  put_in_service:    "Mise en service",
  run_depreciation:  "Lancer les dotations",
  dispose:           "Comptabiliser une cession",
  manage_categories: "Gérer les catégories",
  export:            "Exporter (CSV/PDF)",
  view_sensitive:    "Voir les montants sensibles",
};

export const ALL_FA_ACTIONS: FixedAssetAction[] = [
  "create_asset", "edit_asset", "put_in_service", "run_depreciation",
  "dispose", "manage_categories", "export", "view_sensitive",
];
export const ALL_FA_ROLES: FixedAssetRole[] = [
  "asset_clerk", "asset_accountant", "asset_controller", "asset_admin",
];

export const ROLE_LABELS: Record<FixedAssetRole, string> = {
  asset_clerk:      "Saisie Immobilisations",
  asset_accountant: "Comptable Immobilisations",
  asset_controller: "Contrôleur Immobilisations",
  asset_admin:      "Administrateur Immobilisations",
};

export type FixedAssetPerms = {
  canCreate: boolean;
  canEdit: boolean;
  canPutInService: boolean;
  canRunDepreciation: boolean;
  canDispose: boolean;
  canManageCategories: boolean;
  canExport: boolean;
  canViewSensitive: boolean;
};

export function canDo(perms: FixedAssetPerms | undefined, action: FixedAssetAction): boolean {
  if (!perms) return false;
  switch (action) {
    case "create_asset":       return perms.canCreate;
    case "edit_asset":         return perms.canEdit;
    case "put_in_service":     return perms.canPutInService;
    case "run_depreciation":   return perms.canRunDepreciation;
    case "dispose":            return perms.canDispose;
    case "manage_categories":  return perms.canManageCategories;
    case "export":             return perms.canExport;
    case "view_sensitive":     return perms.canViewSensitive;
  }
}

export function missingRoleHint(action: FixedAssetAction): string {
  const roles = REQUIRED_ROLES[action].map((r) => ROLE_LABELS[r]).join(", ");
  return `Action verrouillée — rôle requis : ${roles}.`;
}

export function actionTooltip(
  perms: FixedAssetPerms | undefined,
  action: FixedAssetAction,
  enabledLabel?: string,
): string {
  return canDo(perms, action) ? (enabledLabel ?? "") : missingRoleHint(action);
}

export function maskAmount(perms: FixedAssetPerms | undefined, value: number | string): string {
  if (canDo(perms, "view_sensitive")) {
    return typeof value === "number" ? Math.round(value).toLocaleString("fr-FR") : String(value);
  }
  return "•••••";
}

export const FIXED_ASSET_ROLE_LABELS: { value: FixedAssetRole; label: string }[] = [
  { value: "asset_clerk",      label: "Saisie Immobilisations — créer / modifier fiches" },
  { value: "asset_accountant", label: "Comptable Immobilisations — mise en service, dotations, cession" },
  { value: "asset_controller", label: "Contrôleur Immobilisations — supervision, exports" },
  { value: "asset_admin",      label: "Administrateur Immobilisations — droits complets" },
];
