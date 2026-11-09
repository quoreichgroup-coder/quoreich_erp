// Centralised RBAC mapping for Project Accounting actions —
// mirrors budget-roles.ts / fixed-assets-roles.ts / treasury-roles.ts.

export type ProjectRole =
  | "project_planner"
  | "project_accountant"
  | "project_controller"
  | "project_admin";

export type ProjectAction =
  | "create_project"
  | "edit_project"
  | "post_cost"
  | "approve_cost"
  | "close_project"
  | "manage_settings"
  | "export"
  | "view_sensitive";

export const REQUIRED_ROLES: Record<ProjectAction, ProjectRole[]> = {
  create_project:   ["project_planner", "project_admin"],
  edit_project:     ["project_planner", "project_admin"],
  post_cost:        ["project_accountant", "project_admin"],
  approve_cost:     ["project_controller", "project_admin"],
  close_project:    ["project_controller", "project_admin"],
  manage_settings:  ["project_admin"],
  export:           ["project_accountant", "project_controller", "project_admin"],
  view_sensitive:   ["project_planner", "project_accountant", "project_controller", "project_admin"],
};

export const ACTION_LABELS: Record<ProjectAction, string> = {
  create_project:   "Créer un projet",
  edit_project:     "Modifier un projet",
  post_cost:        "Enregistrer un coût",
  approve_cost:     "Approuver un coût",
  close_project:    "Clôturer un projet",
  manage_settings:  "Configurer les paramètres",
  export:           "Exporter (CSV/PDF)",
  view_sensitive:   "Voir les montants sensibles",
};

export const ALL_PROJECT_ACTIONS: ProjectAction[] = [
  "create_project", "edit_project", "post_cost", "approve_cost",
  "close_project", "manage_settings", "export", "view_sensitive",
];

export const ALL_PROJECT_ROLES: ProjectRole[] = [
  "project_planner", "project_accountant", "project_controller", "project_admin",
];

export const ROLE_LABELS: Record<ProjectRole, string> = {
  project_planner:    "Planificateur Projets",
  project_accountant: "Comptable Projets",
  project_controller: "Contrôleur Projets",
  project_admin:      "Administrateur Projets",
};

export type ProjectPerms = {
  canCreate: boolean;
  canEdit: boolean;
  canPostCost: boolean;
  canApproveCost: boolean;
  canClose: boolean;
  canManageSettings: boolean;
  canExport: boolean;
  canViewSensitive: boolean;
};

export function canDo(perms: ProjectPerms | undefined, action: ProjectAction): boolean {
  if (!perms) return false;
  switch (action) {
    case "create_project":  return perms.canCreate;
    case "edit_project":    return perms.canEdit;
    case "post_cost":       return perms.canPostCost;
    case "approve_cost":    return perms.canApproveCost;
    case "close_project":   return perms.canClose;
    case "manage_settings": return perms.canManageSettings;
    case "export":          return perms.canExport;
    case "view_sensitive":  return perms.canViewSensitive;
  }
}

export function missingRoleHint(action: ProjectAction): string {
  const roles = REQUIRED_ROLES[action].map((r) => ROLE_LABELS[r]).join(", ");
  return `Action verrouillée — rôle requis : ${roles}.`;
}

export function actionTooltip(
  perms: ProjectPerms | undefined,
  action: ProjectAction,
  enabledLabel?: string,
): string {
  return canDo(perms, action) ? (enabledLabel ?? "") : missingRoleHint(action);
}

export function maskAmount(perms: ProjectPerms | undefined, value: number | string): string {
  if (canDo(perms, "view_sensitive")) {
    return typeof value === "number" ? Math.round(value).toLocaleString("fr-FR") : String(value);
  }
  return "•••••";
}

/**
 * Segregation of Duties: planner et controller mutuellement exclusifs
 * (le contrôleur valide ce que le planificateur soumet).
 * Mirroir du contrôle serveur dans la RPC assign_project_role.
 */
export const SOD_CONFLICTS: Record<ProjectRole, ProjectRole[]> = {
  project_planner:    ["project_controller"],
  project_controller: ["project_planner"],
  project_accountant: [],
  project_admin:      [],
};

export function violatesProjectSoD(currentRoles: ProjectRole[], roleToAdd: ProjectRole): boolean {
  if (currentRoles.includes(roleToAdd)) return false;
  return (SOD_CONFLICTS[roleToAdd] ?? []).some((c) => currentRoles.includes(c));
}
