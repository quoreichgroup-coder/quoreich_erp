// CRM RBAC — mirrors hr-roles / sales-roles patterns.
// SoD : crm_agent ⇄ crm_manager mutuellement exclusifs (saisie vs approbation remises/conversion).

export type CrmRole = "crm_agent" | "crm_manager" | "crm_admin" | "crm_auditor";

export type CrmAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "approve_discount"
  | "convert"
  | "export"
  | "view_sensitive"
  | "audit"
  | "manage_settings";

export const REQUIRED_ROLES: Record<CrmAction, CrmRole[]> = {
  view:              ["crm_agent", "crm_manager", "crm_auditor", "crm_admin"],
  create:            ["crm_agent", "crm_manager", "crm_admin"],
  edit:              ["crm_agent", "crm_manager", "crm_admin"],
  delete:            ["crm_manager", "crm_admin"],
  approve_discount:  ["crm_manager", "crm_admin"],
  convert:           ["crm_manager", "crm_admin"],
  export:            ["crm_manager", "crm_auditor", "crm_admin"],
  view_sensitive:    ["crm_manager", "crm_auditor", "crm_admin"],
  audit:             ["crm_auditor", "crm_admin"],
  manage_settings:   ["crm_admin"],
};

export const ACTION_LABELS: Record<CrmAction, string> = {
  view:             "Consulter le CRM",
  create:           "Créer un contact / opportunité",
  edit:             "Modifier un contact / opportunité",
  delete:           "Supprimer",
  approve_discount: "Approuver une remise",
  convert:          "Convertir une opportunité",
  export:           "Exporter (CSV/PDF)",
  view_sensitive:   "Voir les montants sensibles",
  audit:            "Consulter l'audit CRM",
  manage_settings:  "Paramétrer le CRM",
};

export const ROLE_LABELS: Record<CrmRole, string> = {
  crm_agent:   "Agent commercial",
  crm_manager: "Manager commercial",
  crm_admin:   "Administrateur CRM",
  crm_auditor: "Auditeur CRM",
};

export const ALL_CRM_ROLES: CrmRole[] = ["crm_agent", "crm_manager", "crm_admin", "crm_auditor"];
export const ALL_CRM_ACTIONS: CrmAction[] = Object.keys(REQUIRED_ROLES) as CrmAction[];

export type CrmPerms = {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApproveDiscount: boolean;
  canConvert: boolean;
  canExport: boolean;
  canViewSensitive: boolean;
  canAudit: boolean;
  canManageSettings: boolean;
};

export function canDo(perms: CrmPerms | undefined, action: CrmAction): boolean {
  if (!perms) return false;
  switch (action) {
    case "view":             return perms.canView;
    case "create":           return perms.canCreate;
    case "edit":             return perms.canEdit;
    case "delete":           return perms.canDelete;
    case "approve_discount": return perms.canApproveDiscount;
    case "convert":          return perms.canConvert;
    case "export":           return perms.canExport;
    case "view_sensitive":   return perms.canViewSensitive;
    case "audit":            return perms.canAudit;
    case "manage_settings":  return perms.canManageSettings;
  }
}

export function missingRoleHint(action: CrmAction): string {
  const roles = REQUIRED_ROLES[action].map((r) => ROLE_LABELS[r]).join(", ");
  return `Action verrouillée — rôle requis : ${roles}.`;
}

export function actionTooltip(perms: CrmPerms | undefined, action: CrmAction, enabledLabel?: string): string {
  return canDo(perms, action) ? (enabledLabel ?? "") : missingRoleHint(action);
}

export function maskAmount(perms: CrmPerms | undefined, value: number | string): string {
  if (canDo(perms, "view_sensitive")) {
    return typeof value === "number" ? Math.round(value).toLocaleString("fr-FR") : String(value);
  }
  return "•••••";
}

// SoD — agent commercial ⇄ manager commercial (qui saisit ≠ qui approuve)
export const SOD_CONFLICTS: Record<CrmRole, CrmRole[]> = {
  crm_agent:   ["crm_manager"],
  crm_manager: ["crm_agent"],
  crm_admin:   [],
  crm_auditor: [],
};

export function violatesCrmSoD(currentRoles: CrmRole[], roleToAdd: CrmRole): boolean {
  if (currentRoles.includes(roleToAdd)) return false;
  return (SOD_CONFLICTS[roleToAdd] ?? []).some((c) => currentRoles.includes(c));
}

// Pipeline stages
export const CRM_STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export type CrmStage = typeof CRM_STAGES[number];

export const STAGE_LABELS: Record<CrmStage, string> = {
  lead:         "Prospect",
  qualified:    "Qualifié",
  proposal:     "Proposition",
  negotiation:  "Négociation",
  won:          "Gagné",
  lost:         "Perdu",
};

export const STAGE_DEFAULT_PROBABILITY: Record<CrmStage, number> = {
  lead: 10, qualified: 30, proposal: 60, negotiation: 80, won: 100, lost: 0,
};
