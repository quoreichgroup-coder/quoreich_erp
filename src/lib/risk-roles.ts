// RBAC mapping for Risk Management — mirrors compliance-roles.

export type RiskRole = "risk_owner" | "risk_assessor" | "risk_admin";

export type RiskAction =
  | "create_risk"
  | "edit_risk"
  | "assess_risk"
  | "approve_assessment"
  | "close_risk"
  | "manage_settings"
  | "export"
  | "view_sensitive";

export const REQUIRED_ROLES: Record<RiskAction, RiskRole[]> = {
  create_risk:         ["risk_owner", "risk_admin"],
  edit_risk:           ["risk_owner", "risk_admin"],
  assess_risk:         ["risk_assessor", "risk_admin"],
  approve_assessment:  ["risk_admin"],
  close_risk:          ["risk_owner", "risk_admin"],
  manage_settings:     ["risk_admin"],
  export:              ["risk_owner", "risk_assessor", "risk_admin"],
  view_sensitive:      ["risk_owner", "risk_assessor", "risk_admin"],
};

export const ACTION_LABELS: Record<RiskAction, string> = {
  create_risk:        "Créer un risque",
  edit_risk:          "Modifier un risque",
  assess_risk:        "Évaluer un risque",
  approve_assessment: "Approuver une évaluation",
  close_risk:         "Clôturer un risque",
  manage_settings:    "Configurer les paramètres",
  export:             "Exporter (CSV/PDF)",
  view_sensitive:     "Voir les données sensibles",
};

export const ALL_RISK_ACTIONS: RiskAction[] = [
  "create_risk", "edit_risk", "assess_risk", "approve_assessment",
  "close_risk", "manage_settings", "export", "view_sensitive",
];

export const ALL_RISK_ROLES: RiskRole[] = ["risk_owner", "risk_assessor", "risk_admin"];

export const ROLE_LABELS: Record<RiskRole, string> = {
  risk_owner:    "Propriétaire de Risques",
  risk_assessor: "Évaluateur de Risques",
  risk_admin:    "Administrateur Risques",
};

// SoD: Owner ⇄ Assessor mutually exclusive
const SOD_CONFLICTS: Record<RiskRole, RiskRole | null> = {
  risk_owner:    "risk_assessor",
  risk_assessor: "risk_owner",
  risk_admin:    null,
};

export function violatesRiskSoD(existing: string[], next: RiskRole): boolean {
  const c = SOD_CONFLICTS[next];
  return !!c && existing.includes(c);
}

export type RiskPerms = {
  canCreate: boolean;
  canEdit: boolean;
  canAssess: boolean;
  canApprove: boolean;
  canClose: boolean;
  canManageSettings: boolean;
  canExport: boolean;
  canViewSensitive: boolean;
};

export function canDo(perms: RiskPerms | undefined, action: RiskAction): boolean {
  if (!perms) return false;
  switch (action) {
    case "create_risk":        return perms.canCreate;
    case "edit_risk":          return perms.canEdit;
    case "assess_risk":        return perms.canAssess;
    case "approve_assessment": return perms.canApprove;
    case "close_risk":         return perms.canClose;
    case "manage_settings":    return perms.canManageSettings;
    case "export":             return perms.canExport;
    case "view_sensitive":     return perms.canViewSensitive;
  }
}

export function missingRoleHint(action: RiskAction): string {
  const roles = REQUIRED_ROLES[action].map((r) => ROLE_LABELS[r]).join(", ");
  return `Action verrouillée — rôle requis : ${roles}.`;
}

export function actionTooltip(perms: RiskPerms | undefined, action: RiskAction, enabledLabel?: string): string {
  return canDo(perms, action) ? (enabledLabel ?? "") : missingRoleHint(action);
}

export function maskAmount(perms: RiskPerms | undefined, value: number | string): string {
  if (canDo(perms, "view_sensitive")) {
    return typeof value === "number" ? Math.round(value).toLocaleString("fr-FR") : String(value);
  }
  return "•••••";
}
