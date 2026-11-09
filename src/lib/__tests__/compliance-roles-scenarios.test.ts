import { describe, it, expect } from "vitest";
import {
  violatesComplianceSoD,
  ALL_COMPLIANCE_ROLES,
  REQUIRED_ROLES,
  canDo,
  maskAmount,
  type ComplianceRole,
  type CompliancePerms,
} from "@/lib/compliance-roles";

/**
 * Compliance SoD — mirrors expense-roles-scenarios.
 * Covers idempotence, revoke↔reassign cycles, masking sans rôle, recovery.
 */

const permsFromRoles = (roles: ComplianceRole[]): CompliancePerms => ({
  canCreate:          roles.some((r) => REQUIRED_ROLES.create_control.includes(r)),
  canEdit:            roles.some((r) => REQUIRED_ROLES.edit_control.includes(r)),
  canRunTest:         roles.some((r) => REQUIRED_ROLES.run_test.includes(r)),
  canReviewTest:      roles.some((r) => REQUIRED_ROLES.review_test.includes(r)),
  canManageFramework: roles.some((r) => REQUIRED_ROLES.manage_framework.includes(r)),
  canManageSettings:  roles.some((r) => REQUIRED_ROLES.manage_settings.includes(r)),
  canExport:          roles.some((r) => REQUIRED_ROLES.export.includes(r)),
  canViewSensitive:   roles.some((r) => REQUIRED_ROLES.view_sensitive.includes(r)),
});

const grant = (r: ComplianceRole[], add: ComplianceRole): ComplianceRole[] =>
  r.includes(add) ? r : [...r, add];
const revoke = (r: ComplianceRole[], rm: ComplianceRole): ComplianceRole[] =>
  r.filter((x) => x !== rm);

describe("Compliance SoD — extended", () => {
  it("idempotent grant on officer", () => {
    let r: ComplianceRole[] = [];
    r = grant(r, "compliance_officer");
    r = grant(r, "compliance_officer");
    expect(r).toEqual(["compliance_officer"]);
  });

  it("idempotent revoke (no-op when role absent)", () => {
    const r: ComplianceRole[] = ["compliance_officer"];
    expect(revoke(r, "compliance_auditor")).toEqual(["compliance_officer"]);
  });

  it("officer ⇄ auditor SoD blocks direct upgrade", () => {
    expect(violatesComplianceSoD(["compliance_officer"], "compliance_auditor")).toBe(true);
    expect(violatesComplianceSoD(["compliance_auditor"], "compliance_officer")).toBe(true);
  });

  it("full revoke→reassign cycle officer → auditor → officer", () => {
    let r: ComplianceRole[] = [];
    r = grant(r, "compliance_officer");
    expect(canDo(permsFromRoles(r), "run_test")).toBe(true);

    expect(violatesComplianceSoD(r, "compliance_auditor")).toBe(true);
    r = revoke(r, "compliance_officer");
    r = grant(r, "compliance_auditor");
    expect(canDo(permsFromRoles(r), "review_test")).toBe(true);
    expect(canDo(permsFromRoles(r), "run_test")).toBe(false);

    expect(violatesComplianceSoD(r, "compliance_officer")).toBe(true);
    r = revoke(r, "compliance_auditor");
    r = grant(r, "compliance_officer");
    expect(canDo(permsFromRoles(r), "run_test")).toBe(true);
  });

  it("admin coexists with any role without SoD", () => {
    for (const role of ALL_COMPLIANCE_ROLES) {
      expect(violatesComplianceSoD([role], "compliance_admin")).toBe(false);
    }
  });

  it("masking: no role → •••••", () => {
    expect(maskAmount(permsFromRoles([]), 1500)).toBe("•••••");
  });

  it("masking: any compliance_* role unlocks sensitive view", () => {
    for (const role of ALL_COMPLIANCE_ROLES) {
      expect(maskAmount(permsFromRoles([role]), 1500)).not.toBe("•••••");
    }
  });

  it("recovery: accidental double grant requires revoke-first", () => {
    const start: ComplianceRole[] = ["compliance_officer"];
    expect(violatesComplianceSoD(start, "compliance_auditor")).toBe(true);
    const fixed = grant(revoke(start, "compliance_officer"), "compliance_auditor");
    expect(fixed).toEqual(["compliance_auditor"]);
  });

  it("admin alone has full perms", () => {
    const p = permsFromRoles(["compliance_admin"]);
    expect(p.canCreate && p.canEdit && p.canRunTest && p.canReviewTest).toBe(true);
    expect(p.canManageFramework && p.canManageSettings && p.canExport && p.canViewSensitive).toBe(true);
  });

  it("auditor alone cannot create or edit controls", () => {
    const p = permsFromRoles(["compliance_auditor"]);
    expect(p.canCreate).toBe(false);
    expect(p.canEdit).toBe(false);
    expect(p.canReviewTest).toBe(true);
    expect(p.canExport).toBe(true);
  });
});
