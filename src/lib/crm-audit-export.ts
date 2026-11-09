// Preview rows for CRM audit exports (CSV/PDF), gated by RBAC.
// Returns the exact rows + columns that will be emitted, plus a warning string
// when sensitive fields are masked or unavailable.

import { ROLE_LABELS, type CrmRole, type CrmPerms, canDo } from "@/lib/crm-roles";
import type { CrmActivity, CrmRoleAuditRow } from "@/hooks/use-crm-data";

export type AuditExportKind = "roles" | "stages";

export type AuditPreviewColumn = { key: string; header: string };

export type AuditPreview = {
  kind: AuditExportKind;
  columns: AuditPreviewColumn[];
  rows: Array<Record<string, string>>;
  totalCount: number;
  maskedFields: string[];
  warning: string | null;
  canExport: boolean;
  blockedReason: string | null;
};

function maskUser(perms: CrmPerms | undefined, id: string | null | undefined): string {
  if (!id) return "—";
  return canDo(perms, "view_sensitive") ? id : `${id.slice(0, 8)}…`;
}
function maskReason(perms: CrmPerms | undefined, reason: string | null | undefined): string {
  if (!reason) return "—";
  return canDo(perms, "view_sensitive") ? reason : "•••";
}
function maskSubject(perms: CrmPerms | undefined, subject: string): string {
  return canDo(perms, "view_sensitive") ? subject : subject.replace(/\b[\w-]{6,}\b/g, "•••");
}

export function buildRoleAuditPreview(
  perms: CrmPerms | undefined,
  rows: CrmRoleAuditRow[],
): AuditPreview {
  const sensitive = canDo(perms, "view_sensitive");
  const masked = sensitive ? [] : ["Utilisateur cible", "Par", "Motif"];
  return {
    kind: "roles",
    columns: [
      { key: "date", header: "Date" },
      { key: "action", header: "Action" },
      { key: "role", header: "Rôle" },
      { key: "target_user", header: "Utilisateur cible" },
      { key: "performed_by", header: "Par" },
      { key: "reason", header: "Motif" },
    ],
    rows: rows.map((r) => ({
      date: new Date(r.created_at).toLocaleString("fr-FR"),
      action: r.action === "grant" ? "Attribué" : "Révoqué",
      role: ROLE_LABELS[r.role as CrmRole] ?? r.role,
      target_user: maskUser(perms, r.target_user_id),
      performed_by: maskUser(perms, r.performed_by),
      reason: maskReason(perms, r.reason),
    })),
    totalCount: rows.length,
    maskedFields: masked,
    warning: sensitive
      ? null
      : `Champs masqués (rôle « view_sensitive » requis) : ${masked.join(", ")}.`,
    canExport: canDo(perms, "export"),
    blockedReason: canDo(perms, "export")
      ? null
      : "Export verrouillé — rôle « export » requis (Manager, Auditeur ou Admin CRM).",
  };
}

export function buildStageAuditPreview(
  perms: CrmPerms | undefined,
  rows: CrmActivity[],
): AuditPreview {
  const sensitive = canDo(perms, "view_sensitive");
  const masked = sensitive ? [] : ["Changement", "Par"];
  return {
    kind: "stages",
    columns: [
      { key: "date", header: "Date" },
      { key: "opportunity", header: "Opportunité" },
      { key: "subject", header: "Changement" },
      { key: "by", header: "Par" },
    ],
    rows: rows.map((a) => ({
      date: new Date(a.created_at).toLocaleString("fr-FR"),
      opportunity: a.opportunity_id ? `${a.opportunity_id.slice(0, 8)}…` : "—",
      subject: maskSubject(perms, a.subject),
      by: maskUser(perms, a.created_by),
    })),
    totalCount: rows.length,
    maskedFields: masked,
    warning: sensitive
      ? null
      : `Champs masqués (rôle « view_sensitive » requis) : ${masked.join(", ")}.`,
    canExport: canDo(perms, "export"),
    blockedReason: canDo(perms, "export")
      ? null
      : "Export verrouillé — rôle « export » requis (Manager, Auditeur ou Admin CRM).",
  };
}
