import { describe, it, expect } from "vitest";
import {
  assertBulkAllowed,
  canPerformBulk,
  BULK_ACTION_REQUIRED,
} from "@/lib/crm-bulk-actions";
import type { CrmPerms } from "@/lib/crm-roles";

function perms(p: Partial<CrmPerms>): CrmPerms {
  return {
    canView: false, canCreate: false, canEdit: false, canDelete: false,
    canApproveDiscount: false, canConvert: false, canExport: false,
    canViewSensitive: false, canAudit: false, canManageSettings: false,
    ...p,
  };
}

describe("crm-bulk-actions — RBAC", () => {
  it("expose les actions requises par bulk action (SoD-friendly)", () => {
    expect(BULK_ACTION_REQUIRED.change_stage).toBe("edit");
    expect(BULK_ACTION_REQUIRED.assign).toBe("edit");
    expect(BULK_ACTION_REQUIRED.archive).toBe("delete");
  });

  it("refuse change_stage / assign sans canEdit (agent ⇄ manager respect)", () => {
    const p = perms({ canView: true });
    expect(canPerformBulk(p, "change_stage")).toBe(false);
    expect(canPerformBulk(p, "assign")).toBe(false);
  });

  it("refuse archive sans canDelete (réservé manager/admin)", () => {
    const p = perms({ canEdit: true });
    expect(canPerformBulk(p, "archive")).toBe(false);
  });

  it("autorise change_stage/assign avec canEdit, archive uniquement avec canDelete", () => {
    const manager = perms({ canEdit: true, canDelete: true });
    expect(canPerformBulk(manager, "change_stage")).toBe(true);
    expect(canPerformBulk(manager, "assign")).toBe(true);
    expect(canPerformBulk(manager, "archive")).toBe(true);
  });
});

describe("crm-bulk-actions — assertBulkAllowed (requêtes modifiées)", () => {
  it("bloque une sélection vide même avec tous les droits", () => {
    const admin = perms({ canEdit: true, canDelete: true });
    const r = assertBulkAllowed(admin, "change_stage", []);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "no_selection" });
  });

  it("bloque une requête forgée (ids présents) sans le rôle requis", () => {
    const agent = perms({ canEdit: true }); // pas de delete
    const forgedIds = ["id-1", "id-2", "id-3"];
    const r = assertBulkAllowed(agent, "archive", forgedIds) as Extract<
      ReturnType<typeof assertBulkAllowed>,
      { ok: false }
    >;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("forbidden");
    expect(r.message).toMatch(/Archiver/);
    expect(r.message).toMatch(/verrouill/i);
  });

  it("laisse passer change_stage avec canEdit + sélection non vide", () => {
    const p = perms({ canEdit: true });
    expect(assertBulkAllowed(p, "change_stage", ["a"]).ok).toBe(true);
    expect(assertBulkAllowed(p, "assign", ["a", "b"]).ok).toBe(true);
  });

  it("rejette systématiquement perms=undefined (utilisateur non authentifié)", () => {
    for (const a of ["change_stage", "assign", "archive"] as const) {
      const r = assertBulkAllowed(undefined, a, ["x"]);
      expect(r.ok).toBe(false);
    }
  });
});
