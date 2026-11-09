// Centralised RBAC mapping for HR / Payroll — mirrors expense-roles / project-roles.
// SoD: HR Clerk (saisie paie) ↔ HR Approver (validation paie) sont exclusifs.
//      Payroll Officer (exécution) ↔ HR Auditor (contrôle ex-post) sont exclusifs.

export type HrRole =
  | "hr_clerk"
  | "hr_approver"
  | "payroll_officer"
  | "hr_auditor"
  | "hr_admin";

export type HrAction =
  | "create_employee"
  | "edit_employee"
  | "create_payroll_run"
  | "approve_payroll_run"
  | "execute_payroll"
  | "audit_payroll"
  | "manage_settings"
  | "export"
  | "view_sensitive";

export const REQUIRED_ROLES: Record<HrAction, HrRole[]> = {
  create_employee:     ["hr_clerk", "hr_admin"],
  edit_employee:       ["hr_clerk", "hr_admin"],
  create_payroll_run:  ["hr_clerk", "hr_admin"],
  approve_payroll_run: ["hr_approver", "hr_admin"],
  execute_payroll:     ["payroll_officer", "hr_admin"],
  audit_payroll:       ["hr_auditor", "hr_admin"],
  manage_settings:     ["hr_admin"],
  export:              ["hr_approver", "payroll_officer", "hr_auditor", "hr_admin"],
  view_sensitive:      ["hr_clerk", "hr_approver", "payroll_officer", "hr_auditor", "hr_admin"],
};

export const ACTION_LABELS: Record<HrAction, string> = {
  create_employee:     "Créer un employé",
  edit_employee:       "Modifier un employé",
  create_payroll_run:  "Créer un cycle de paie",
  approve_payroll_run: "Approuver le cycle de paie",
  execute_payroll:     "Exécuter la paie",
  audit_payroll:       "Auditer la paie",
  manage_settings:     "Configurer les paramètres",
  export:              "Exporter (CSV/PDF)",
  view_sensitive:      "Voir les montants sensibles",
};

export const ALL_HR_ACTIONS: HrAction[] = [
  "create_employee", "edit_employee", "create_payroll_run", "approve_payroll_run",
  "execute_payroll", "audit_payroll", "manage_settings", "export", "view_sensitive",
];

export const ALL_HR_ROLES: HrRole[] = [
  "hr_clerk", "hr_approver", "payroll_officer", "hr_auditor", "hr_admin",
];

export const ROLE_LABELS: Record<HrRole, string> = {
  hr_clerk:        "Saisie RH / Paie",
  hr_approver:     "Approbateur Paie",
  payroll_officer: "Officier de Paie",
  hr_auditor:      "Auditeur RH",
  hr_admin:        "Administrateur RH",
};

export type HrPerms = {
  canCreateEmployee: boolean;
  canEditEmployee: boolean;
  canCreatePayrollRun: boolean;
  canApprovePayrollRun: boolean;
  canExecutePayroll: boolean;
  canAuditPayroll: boolean;
  canManageSettings: boolean;
  canExport: boolean;
  canViewSensitive: boolean;
};

export function canDo(perms: HrPerms | undefined, action: HrAction): boolean {
  if (!perms) return false;
  switch (action) {
    case "create_employee":     return perms.canCreateEmployee;
    case "edit_employee":       return perms.canEditEmployee;
    case "create_payroll_run":  return perms.canCreatePayrollRun;
    case "approve_payroll_run": return perms.canApprovePayrollRun;
    case "execute_payroll":     return perms.canExecutePayroll;
    case "audit_payroll":       return perms.canAuditPayroll;
    case "manage_settings":     return perms.canManageSettings;
    case "export":              return perms.canExport;
    case "view_sensitive":      return perms.canViewSensitive;
  }
}

export function missingRoleHint(action: HrAction): string {
  const roles = REQUIRED_ROLES[action].map((r) => ROLE_LABELS[r]).join(", ");
  return `Action verrouillée — rôle requis : ${roles}.`;
}

export function actionTooltip(
  perms: HrPerms | undefined,
  action: HrAction,
  enabledLabel?: string,
): string {
  return canDo(perms, action) ? (enabledLabel ?? "") : missingRoleHint(action);
}

export function maskAmount(perms: HrPerms | undefined, value: number | string): string {
  if (canDo(perms, "view_sensitive")) {
    return typeof value === "number" ? Math.round(value).toLocaleString("fr-FR") : String(value);
  }
  return "•••••";
}

/**
 * SoD — miroir du contrôle serveur (RPC assign_hr_role).
 *  - hr_clerk ↔ hr_approver : qui saisit ne valide pas.
 *  - payroll_officer ↔ hr_auditor : qui exécute ne contrôle pas.
 */
export const SOD_CONFLICTS: Record<HrRole, HrRole[]> = {
  hr_clerk:        ["hr_approver"],
  hr_approver:     ["hr_clerk"],
  payroll_officer: ["hr_auditor"],
  hr_auditor:      ["payroll_officer"],
  hr_admin:        [],
};

export function violatesHrSoD(currentRoles: HrRole[], roleToAdd: HrRole): boolean {
  if (currentRoles.includes(roleToAdd)) return false;
  return (SOD_CONFLICTS[roleToAdd] ?? []).some((c) => currentRoles.includes(c));
}
