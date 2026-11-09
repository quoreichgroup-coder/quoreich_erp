// Centralised RBAC mapping for Budget & Forecasting actions —
// mirrors fixed-assets-roles.ts / treasury-roles.ts.

export type BudgetRole =
  | "budget_planner"
  | "budget_approver"
  | "budget_controller"
  | "budget_admin";

export type BudgetAction =
  | "create_budget"
  | "edit_budget"
  | "submit_for_approval"
  | "approve_budget"
  | "lock_period"
  | "manage_scenarios"
  | "export"
  | "view_sensitive";

export const REQUIRED_ROLES: Record<BudgetAction, BudgetRole[]> = {
  create_budget:       ["budget_planner", "budget_admin"],
  edit_budget:         ["budget_planner", "budget_admin"],
  submit_for_approval: ["budget_planner", "budget_admin"],
  approve_budget:      ["budget_approver", "budget_admin"],
  lock_period:         ["budget_approver", "budget_admin"],
  manage_scenarios:    ["budget_admin"],
  export:              ["budget_approver", "budget_controller", "budget_admin"],
  view_sensitive:      ["budget_planner", "budget_approver", "budget_controller", "budget_admin"],
};

export const ACTION_LABELS: Record<BudgetAction, string> = {
  create_budget:       "Créer un budget",
  edit_budget:         "Modifier un budget",
  submit_for_approval: "Soumettre pour approbation",
  approve_budget:      "Approuver le budget",
  lock_period:         "Verrouiller la période",
  manage_scenarios:    "Gérer les scénarios",
  export:              "Exporter (CSV/PDF)",
  view_sensitive:      "Voir les montants sensibles",
};

export const ALL_BUDGET_ACTIONS: BudgetAction[] = [
  "create_budget", "edit_budget", "submit_for_approval", "approve_budget",
  "lock_period", "manage_scenarios", "export", "view_sensitive",
];

export const ALL_BUDGET_ROLES: BudgetRole[] = [
  "budget_planner", "budget_approver", "budget_controller", "budget_admin",
];

export const ROLE_LABELS: Record<BudgetRole, string> = {
  budget_planner:    "Planificateur Budget",
  budget_approver:   "Approbateur Budget",
  budget_controller: "Contrôleur Budget",
  budget_admin:      "Administrateur Budget",
};

export type BudgetPerms = {
  canCreate: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canLockPeriod: boolean;
  canManageScenarios: boolean;
  canExport: boolean;
  canViewSensitive: boolean;
};

export function canDo(perms: BudgetPerms | undefined, action: BudgetAction): boolean {
  if (!perms) return false;
  switch (action) {
    case "create_budget":       return perms.canCreate;
    case "edit_budget":         return perms.canEdit;
    case "submit_for_approval": return perms.canSubmit;
    case "approve_budget":      return perms.canApprove;
    case "lock_period":         return perms.canLockPeriod;
    case "manage_scenarios":    return perms.canManageScenarios;
    case "export":              return perms.canExport;
    case "view_sensitive":      return perms.canViewSensitive;
  }
}

export function missingRoleHint(action: BudgetAction): string {
  const roles = REQUIRED_ROLES[action].map((r) => ROLE_LABELS[r]).join(", ");
  return `Action verrouillée — rôle requis : ${roles}.`;
}

export function actionTooltip(
  perms: BudgetPerms | undefined,
  action: BudgetAction,
  enabledLabel?: string,
): string {
  return canDo(perms, action) ? (enabledLabel ?? "") : missingRoleHint(action);
}

export function maskAmount(perms: BudgetPerms | undefined, value: number | string): string {
  if (canDo(perms, "view_sensitive")) {
    return typeof value === "number" ? Math.round(value).toLocaleString("fr-FR") : String(value);
  }
  return "•••••";
}

export const BUDGET_ROLE_LABELS: { value: BudgetRole; label: string }[] = [
  { value: "budget_planner",    label: "Planificateur Budget — créer / modifier / soumettre" },
  { value: "budget_approver",   label: "Approbateur Budget — approuver, verrouiller, exporter" },
  { value: "budget_controller", label: "Contrôleur Budget — supervision, exports" },
  { value: "budget_admin",      label: "Administrateur Budget — droits complets" },
];

/**
 * Segregation of Duties: a single user must never hold both
 * budget_planner and budget_approver simultaneously.
 * Mirrors the server-side check in the assign_budget_role RPC.
 */
export const SOD_CONFLICTS: Record<BudgetRole, BudgetRole[]> = {
  budget_planner:    ["budget_approver"],
  budget_approver:   ["budget_planner"],
  budget_controller: [],
  budget_admin:      [],
};

export function violatesBudgetSoD(currentRoles: BudgetRole[], roleToAdd: BudgetRole): boolean {
  if (currentRoles.includes(roleToAdd)) return false;
  return (SOD_CONFLICTS[roleToAdd] ?? []).some((c) => currentRoles.includes(c));
}

