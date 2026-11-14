// RBAC gate for bulk opportunity actions.
// Server-side (RPC + RLS) is the source of truth, but we ALSO gate client-side
// so that a tampered request (e.g. selection forced via devtools) still fails fast
// with a clear reason BEFORE any network call.

import { canDo, type CrmAction, type CrmPerms } from "@/lib/crm-roles";

export type CrmBulkAction = "change_stage" | "assign" | "archive";

export const BULK_ACTION_REQUIRED: Record<CrmBulkAction, CrmAction> = {
  change_stage: "edit",
  assign: "edit",
  // Archiving is an UPDATE to status, so the database requires edit permission.
  archive: "edit",
};

export const BULK_ACTION_LABEL: Record<CrmBulkAction, string> = {
  change_stage: "Changer d'étape",
  assign: "Assigner",
  archive: "Archiver",
};

export type BulkCheck =
  | { ok: true }
  | { ok: false; reason: "no_selection" | "forbidden"; message: string };

export function canPerformBulk(perms: CrmPerms | undefined, action: CrmBulkAction): boolean {
  return canDo(perms, BULK_ACTION_REQUIRED[action]);
}

export function assertBulkAllowed(
  perms: CrmPerms | undefined,
  action: CrmBulkAction,
  ids: string[],
): BulkCheck {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, reason: "no_selection", message: "Sélection vide." };
  }
  if (!canPerformBulk(perms, action)) {
    return {
      ok: false,
      reason: "forbidden",
      message: `Action « ${BULK_ACTION_LABEL[action]} » verrouillée par le RBAC.`,
    };
  }
  return { ok: true };
}
