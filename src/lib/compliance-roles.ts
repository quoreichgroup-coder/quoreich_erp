// RBAC mapping for Compliance — mirrors expense-roles / project-roles.

export type ComplianceRole =
  | "compliance_officer"
  | "compliance_auditor"
  | "compliance_admin";

export type ComplianceAction =
  | "create_control"
  | "edit_control"
  | "run_test"
  | "review_test"
  | "manage_framework"
  | "manage_settings"
  | "export"
  | "view_sensitive";

export const REQUIRED_ROLES: Record<ComplianceAction, ComplianceRole[]> = {
  create_control:   ["compliance_officer", "compliance_admin"],
  edit_control:     ["compliance_officer", "compliance_admin"],
  run_test:         ["compliance_officer", "compliance_admin"],
  review_test:      ["compliance_auditor", "compliance_admin"],
  manage_framework: ["compliance_admin"],
  manage_settings:  ["compliance_admin"],
  export:           ["compliance_auditor", "compliance_admin"],
  view_sensitive:   ["compliance_officer", "compliance_auditor", "compliance_admin"],
};

export const ACTION_LABELS: Record<ComplianceAction, string> = {
  create_control:   "Créer un contrôle",
  edit_control:     "Modifier un contrôle",
  run_test:         "Exécuter un test",
  review_test:      "Réviser un test",
  manage_framework: "Gérer les référentiels",
  manage_settings:  "Configurer les paramètres",
  export:           "Exporter (CSV/PDF)",
  view_sensitive:   "Voir les données sensibles",
};

export const ALL_COMPLIANCE_ACTIONS: ComplianceAction[] = [
  "create_control", "edit_control", "run_test", "review_test",
  "manage_framework", "manage_settings", "export", "view_sensitive",
];

export const ALL_COMPLIANCE_ROLES: ComplianceRole[] = [
  "compliance_officer", "compliance_auditor", "compliance_admin",
];

export const ROLE_LABELS: Record<ComplianceRole, string> = {
  compliance_officer: "Officier Conformité",
  compliance_auditor: "Auditeur Conformité",
  compliance_admin:   "Administrateur Conformité",
};

// SoD: Officer ⇄ Auditor mutually exclusive
const SOD_CONFLICTS: Record<ComplianceRole, ComplianceRole | null> = {
  compliance_officer: "compliance_auditor",
  compliance_auditor: "compliance_officer",
  compliance_admin:   null,
};

export function violatesComplianceSoD(existing: string[], next: ComplianceRole): boolean {
  const c = SOD_CONFLICTS[next];
  return !!c && existing.includes(c);
}

export type CompliancePerms = {
  canCreate: boolean;
  canEdit: boolean;
  canRunTest: boolean;
  canReviewTest: boolean;
  canManageFramework: boolean;
  canManageSettings: boolean;
  canExport: boolean;
  canViewSensitive: boolean;
};

export function canDo(perms: CompliancePerms | undefined, action: ComplianceAction): boolean {
  if (!perms) return false;
  switch (action) {
    case "create_control":   return perms.canCreate;
    case "edit_control":     return perms.canEdit;
    case "run_test":         return perms.canRunTest;
    case "review_test":      return perms.canReviewTest;
    case "manage_framework": return perms.canManageFramework;
    case "manage_settings":  return perms.canManageSettings;
    case "export":           return perms.canExport;
    case "view_sensitive":   return perms.canViewSensitive;
  }
}

export function missingRoleHint(action: ComplianceAction): string {
  const roles = REQUIRED_ROLES[action].map((r) => ROLE_LABELS[r]).join(", ");
  return `Action verrouillée — rôle requis : ${roles}.`;
}

export function actionTooltip(
  perms: CompliancePerms | undefined,
  action: ComplianceAction,
  enabledLabel?: string,
): string {
  return canDo(perms, action) ? (enabledLabel ?? "") : missingRoleHint(action);
}

export function maskAmount(perms: CompliancePerms | undefined, value: number | string): string {
  if (canDo(perms, "view_sensitive")) {
    return typeof value === "number" ? Math.round(value).toLocaleString("fr-FR") : String(value);
  }
  return "•••••";
}
