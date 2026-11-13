/**
 * Matrice des autorisations (V23, V25, V26) : catalogue des droits, rôles, utilisateurs.
 *
 * Module pur. Il reconstitue depuis les lectures Supabase exactement la vue que sert l'API Java
 * (`GET /api/v1/authorizations`), et porte les petits calculs de l'écran. Les règles (rôle
 * système intouchable, dernier administrateur, rôle à revoir) sont imposées par la base ; ce
 * module ne fait que les annoncer avant l'envoi.
 */
import type { ApiSchemas } from "@/api";

export type Authorizations = ApiSchemas["AuthorizationsView"];
export type Role = ApiSchemas["RoleView"];
export type Permission = ApiSchemas["PermissionView"];
export type AuthorizationUser = ApiSchemas["UserView"];
export type AuthorizationAudit = ApiSchemas["AuthorizationAuditView"];

export interface RawRole {
  id: string; name: string; description: string | null; code: string | null; is_system: boolean; needs_review: boolean;
}
export interface RawSystemRole { code: string; module: string }

export const MODULE_LABELS: Record<string, string> = {
  general: "Général",
  crm: "CRM",
  hr: "RH / Paie",
  inventory: "Stocks",
  procurement: "Achats",
  sales: "Ventes",
  treasury: "Trésorerie",
  assets: "Immobilisations",
  budget: "Budget",
  projects: "Projets",
  expenses: "Notes de frais",
  compliance: "Conformité",
  risk: "Risques",
};

export function buildAuthorizations(input: {
  canManage: boolean;
  catalog: Permission[];
  roles: RawRole[];
  systemRoles: RawSystemRole[];
  rolePermissions: { role_id: string; permission_code: string }[];
  assignments: { user_id: string; role_id: string }[];
  profiles: { id: string; full_name: string | null }[];
}): Authorizations {
  const moduleOf = new Map(input.systemRoles.map((s) => [s.code, s.module]));
  const perms = new Map<string, string[]>();
  for (const p of input.rolePermissions) perms.set(p.role_id, [...(perms.get(p.role_id) ?? []), p.permission_code]);
  const members = new Map<string, number>();
  const byUser = new Map<string, string[]>();
  for (const a of input.assignments) {
    members.set(a.role_id, (members.get(a.role_id) ?? 0) + 1);
    byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), a.role_id]);
  }
  // Même ordre que l'API : rôles sur mesure d'abord, puis système par module, puis nom.
  const roles = [...input.roles].sort((a, b) =>
    Number(a.is_system) - Number(b.is_system)
    || (moduleOf.get(a.code ?? "") ?? "").localeCompare(moduleOf.get(b.code ?? "") ?? "")
    || a.name.localeCompare(b.name));
  const name = (p: { full_name: string | null }) => (p.full_name ?? "").trim() || "Sans nom";
  return {
    canManage: input.canManage,
    catalog: [...input.catalog].sort((a, b) => a.module.localeCompare(b.module) || a.code.localeCompare(b.code)),
    roles: roles.map((r) => ({
      id: r.id, name: r.name, description: r.description ?? undefined, code: r.code ?? undefined,
      system: r.is_system, needsReview: r.needs_review,
      permissions: [...(perms.get(r.id) ?? [])].sort(), memberCount: members.get(r.id) ?? 0,
    })),
    users: [...input.profiles].sort((a, b) => name(a).localeCompare(name(b)))
      .map((p) => ({ id: p.id, fullName: name(p), roleIds: byUser.get(p.id) ?? [] })),
  };
}

/** Catalogue regroupé par module, dans l'ordre des libellés. */
export function catalogByModule(catalog: Permission[]): { module: string; label: string; permissions: Permission[] }[] {
  const groups = new Map<string, Permission[]>();
  for (const p of catalog) groups.set(p.module, [...(groups.get(p.module) ?? []), p]);
  return [...groups.entries()]
    .map(([module, permissions]) => ({ module, label: MODULE_LABELS[module] ?? module, permissions }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Retirer ce rôle à cet utilisateur laisserait-il la société sans administrateur ? */
export function isLastAdmin(view: Authorizations, userId: string, roleId: string): boolean {
  const role = view.roles.find((r) => r.id === roleId);
  if (role?.code !== "admin") return false;
  return !view.users.some((u) => u.id !== userId && u.roleIds.includes(roleId));
}

export const AUDIT_LABELS: Record<string, string> = {
  role_created: "Rôle créé",
  role_updated: "Rôle modifié",
  role_activated: "Rôle activé",
  role_deleted: "Rôle supprimé",
  permission_granted: "Droit accordé",
  permission_removed: "Droit retiré",
  role_assigned: "Rôle affecté",
  role_revoked: "Rôle retiré",
};
