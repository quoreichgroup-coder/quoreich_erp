import { describe, it, expect } from "vitest";
import {
  buildRoleAuditPreview,
  buildStageAuditPreview,
} from "@/lib/crm-audit-export";
import type { CrmPerms } from "@/lib/crm-roles";
import type { CrmActivity, CrmRoleAuditRow } from "@/hooks/use-crm-data";

function perms(p: Partial<CrmPerms>): CrmPerms {
  return {
    canView: false, canCreate: false, canEdit: false, canDelete: false,
    canApproveDiscount: false, canConvert: false, canExport: false,
    canViewSensitive: false, canAudit: false, canManageSettings: false,
    ...p,
  };
}

const roleRows: CrmRoleAuditRow[] = [
  {
    id: "a1",
    created_at: "2026-06-28T10:00:00Z",
    tenant_id: "t1",
    target_user_id: "0123456789abcdef0123456789abcdef",
    role: "crm_manager",
    action: "grant",
    performed_by: "fedcba9876543210fedcba9876543210",
    reason: "Promotion",
  },
];

const stageRows: CrmActivity[] = [
  {
    id: "s1",
    tenant_id: "t1",
    opportunity_id: "abcdef0123456789",
    contact_id: null,
    type: "stage_change",
    subject: "lead -> qualified (Aurora-Project)",
    notes: null,
    due_at: null,
    completed_at: null,
    assigned_to: null,
    created_by: "fedcba9876543210fedcba9876543210",
    created_at: "2026-06-28T10:00:00Z",
  },
];

describe("crm-audit-export — preview rôles", () => {
  it("auditeur (view_sensitive + export) : aucune donnée masquée, export autorisé", () => {
    const p = perms({ canAudit: true, canExport: true, canViewSensitive: true });
    const out = buildRoleAuditPreview(p, roleRows);
    expect(out.canExport).toBe(true);
    expect(out.maskedFields).toEqual([]);
    expect(out.warning).toBeNull();
    expect(out.rows[0].target_user).toBe(roleRows[0].target_user_id);
    expect(out.rows[0].reason).toBe("Promotion");
    expect(out.rows[0].action).toBe("Attribué");
  });

  it("sans view_sensitive : champs masqués + warning explicite", () => {
    const p = perms({ canAudit: true, canExport: true });
    const out = buildRoleAuditPreview(p, roleRows);
    expect(out.maskedFields).toEqual(["Utilisateur cible", "Par", "Motif"]);
    expect(out.warning).toMatch(/view_sensitive/);
    expect(out.rows[0].target_user.endsWith("…")).toBe(true);
    expect(out.rows[0].reason).toBe("•••");
  });

  it("sans export : blockedReason renseigné, preview affichable, téléchargement bloqué", () => {
    const p = perms({ canAudit: true, canViewSensitive: true });
    const out = buildRoleAuditPreview(p, roleRows);
    expect(out.canExport).toBe(false);
    expect(out.blockedReason).toMatch(/export/i);
    expect(out.rows).toHaveLength(1); // preview reste calculée
  });

  it("liste vide : totalCount 0, canExport reflète quand même les droits", () => {
    const out = buildRoleAuditPreview(perms({ canExport: true }), []);
    expect(out.totalCount).toBe(0);
    expect(out.rows).toEqual([]);
    expect(out.canExport).toBe(true);
  });
});

describe("crm-audit-export — preview étapes/assignations", () => {
  it("manager sans view_sensitive : sujet long-mot masqué, warning présent", () => {
    const out = buildStageAuditPreview(perms({ canExport: true }), stageRows);
    expect(out.maskedFields).toEqual(["Changement", "Par"]);
    expect(out.warning).toMatch(/masqués/);
    expect(out.rows[0].subject).not.toBe(stageRows[0].subject);
    expect(out.rows[0].subject).toContain("•••");
    expect(out.rows[0].by.endsWith("…")).toBe(true);
  });

  it("avec view_sensitive : sujet et auteur en clair", () => {
    const p = perms({ canExport: true, canViewSensitive: true });
    const out = buildStageAuditPreview(p, stageRows);
    expect(out.warning).toBeNull();
    expect(out.rows[0].subject).toBe(stageRows[0].subject);
    expect(out.rows[0].by).toBe(stageRows[0].created_by);
  });

  it("colonnes exposées correspondent strictement au CSV/PDF émis", () => {
    const out = buildStageAuditPreview(perms({ canExport: true }), stageRows);
    expect(out.columns.map((c) => c.key)).toEqual(["date", "opportunity", "subject", "by"]);
  });
});
