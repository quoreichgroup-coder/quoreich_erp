// Centralised RBAC mapping for Expense Management — mirrors project-roles / budget-roles.

export type ExpenseRole =
  | "expense_clerk"
  | "expense_approver"
  | "expense_controller"
  | "expense_admin";

export type ExpenseAction =
  | "create_report"
  | "submit_report"
  | "approve_report"
  | "reject_report"
  | "reimburse"
  | "manage_settings"
  | "export"
  | "view_sensitive";

export const REQUIRED_ROLES: Record<ExpenseAction, ExpenseRole[]> = {
  create_report:    ["expense_clerk", "expense_admin"],
  submit_report:    ["expense_clerk", "expense_admin"],
  approve_report:   ["expense_approver", "expense_admin"],
  reject_report:    ["expense_approver", "expense_admin"],
  reimburse:        ["expense_controller", "expense_admin"],
  manage_settings:  ["expense_admin"],
  export:           ["expense_approver", "expense_controller", "expense_admin"],
  view_sensitive:   ["expense_clerk", "expense_approver", "expense_controller", "expense_admin"],
};

export const ACTION_LABELS: Record<ExpenseAction, string> = {
  create_report:    "Créer une note de frais",
  submit_report:    "Soumettre la note",
  approve_report:   "Approuver la note",
  reject_report:    "Rejeter la note",
  reimburse:        "Rembourser",
  manage_settings:  "Configurer les paramètres",
  export:           "Exporter (CSV/PDF)",
  view_sensitive:   "Voir les montants sensibles",
};

export const ALL_EXPENSE_ACTIONS: ExpenseAction[] = [
  "create_report", "submit_report", "approve_report", "reject_report",
  "reimburse", "manage_settings", "export", "view_sensitive",
];

export const ALL_EXPENSE_ROLES: ExpenseRole[] = [
  "expense_clerk", "expense_approver", "expense_controller", "expense_admin",
];

export const ROLE_LABELS: Record<ExpenseRole, string> = {
  expense_clerk:      "Saisie Notes de frais",
  expense_approver:   "Approbateur Notes de frais",
  expense_controller: "Contrôleur Notes de frais",
  expense_admin:      "Administrateur Notes de frais",
};

export type ExpensePerms = {
  canCreate: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canReimburse: boolean;
  canManageSettings: boolean;
  canExport: boolean;
  canViewSensitive: boolean;
};

export function canDo(perms: ExpensePerms | undefined, action: ExpenseAction): boolean {
  if (!perms) return false;
  switch (action) {
    case "create_report":   return perms.canCreate;
    case "submit_report":   return perms.canSubmit;
    case "approve_report":  return perms.canApprove;
    case "reject_report":   return perms.canReject;
    case "reimburse":       return perms.canReimburse;
    case "manage_settings": return perms.canManageSettings;
    case "export":          return perms.canExport;
    case "view_sensitive":  return perms.canViewSensitive;
  }
}

export function missingRoleHint(action: ExpenseAction): string {
  const roles = REQUIRED_ROLES[action].map((r) => ROLE_LABELS[r]).join(", ");
  return `Action verrouillée — rôle requis : ${roles}.`;
}

export function actionTooltip(
  perms: ExpensePerms | undefined,
  action: ExpenseAction,
  enabledLabel?: string,
): string {
  return canDo(perms, action) ? (enabledLabel ?? "") : missingRoleHint(action);
}

export function maskAmount(perms: ExpensePerms | undefined, value: number | string): string {
  if (canDo(perms, "view_sensitive")) {
    return typeof value === "number" ? Math.round(value).toLocaleString("fr-FR") : String(value);
  }
  return "•••••";
}

/**
 * Segregation of Duties: Clerk (qui soumet) et Approver (qui approuve)
 * sont mutuellement exclusifs sur un même utilisateur.
 * Miroir du contrôle serveur dans la RPC assign_expense_role.
 */
export const SOD_CONFLICTS: Record<ExpenseRole, ExpenseRole[]> = {
  expense_clerk:      ["expense_approver"],
  expense_approver:   ["expense_clerk"],
  expense_controller: [],
  expense_admin:      [],
};

export function violatesExpenseSoD(currentRoles: ExpenseRole[], roleToAdd: ExpenseRole): boolean {
  if (currentRoles.includes(roleToAdd)) return false;
  return (SOD_CONFLICTS[roleToAdd] ?? []).some((c) => currentRoles.includes(c));
}
