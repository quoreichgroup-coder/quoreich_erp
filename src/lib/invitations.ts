/**
 * Invitations à rejoindre la société (V31) : un code à usage unique, daté, émis par un
 * administrateur avec le rôle d'arrivée. Logique pure, testée sans réseau.
 */
export interface InvitationRow {
  id: string;
  code: string;
  role_id: string;
  note: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
}

export type InvitationStatus = "active" | "used" | "revoked" | "expired";

/** Utilisée et révoquée priment sur l'expiration : c'est ce qui s'est réellement passé. */
export function invitationStatus(row: Pick<InvitationRow, "used_at" | "revoked_at" | "expires_at">, now: Date = new Date()): InvitationStatus {
  if (row.used_at) return "used";
  if (row.revoked_at) return "revoked";
  return new Date(row.expires_at).getTime() > now.getTime() ? "active" : "expired";
}

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  active: "Active",
  used: "Utilisée",
  revoked: "Révoquée",
  expired: "Expirée",
};

/** Actives d'abord, puis les plus récentes. */
export function sortInvitations<T extends InvitationRow>(rows: T[], now: Date = new Date()): T[] {
  return [...rows].sort((a, b) => {
    const aa = invitationStatus(a, now) === "active" ? 0 : 1;
    const bb = invitationStatus(b, now) === "active" ? 0 : 1;
    return aa - bb || b.created_at.localeCompare(a.created_at);
  });
}
