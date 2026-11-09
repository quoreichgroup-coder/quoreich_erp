import { describe, it, expect } from "vitest";
import {
  violatesRiskSoD,
  ALL_RISK_ROLES,
  REQUIRED_ROLES,
  canDo,
  maskAmount,
  type RiskRole,
  type RiskPerms,
} from "@/lib/risk-roles";

const permsFromRoles = (roles: RiskRole[]): RiskPerms => ({
  canCreate:         roles.some((r) => REQUIRED_ROLES.create_risk.includes(r)),
  canEdit:           roles.some((r) => REQUIRED_ROLES.edit_risk.includes(r)),
  canAssess:         roles.some((r) => REQUIRED_ROLES.assess_risk.includes(r)),
  canApprove:        roles.some((r) => REQUIRED_ROLES.approve_assessment.includes(r)),
  canClose:          roles.some((r) => REQUIRED_ROLES.close_risk.includes(r)),
  canManageSettings: roles.some((r) => REQUIRED_ROLES.manage_settings.includes(r)),
  canExport:         roles.some((r) => REQUIRED_ROLES.export.includes(r)),
  canViewSensitive:  roles.some((r) => REQUIRED_ROLES.view_sensitive.includes(r)),
});

const grant = (r: RiskRole[], add: RiskRole): RiskRole[] =>
  r.includes(add) ? r : [...r, add];
const revoke = (r: RiskRole[], rm: RiskRole): RiskRole[] =>
  r.filter((x) => x !== rm);

describe("Risk SoD — extended", () => {
  it("idempotent grant", () => {
    let r: RiskRole[] = [];
    r = grant(r, "risk_owner");
    r = grant(r, "risk_owner");
    expect(r).toEqual(["risk_owner"]);
  });

  it("idempotent revoke", () => {
    expect(revoke(["risk_owner"], "risk_assessor")).toEqual(["risk_owner"]);
  });

  it("owner ⇄ assessor SoD enforced", () => {
    expect(violatesRiskSoD(["risk_owner"], "risk_assessor")).toBe(true);
    expect(violatesRiskSoD(["risk_assessor"], "risk_owner")).toBe(true);
  });

  it("full owner → assessor → owner cycle", () => {
    let r: RiskRole[] = [];
    r = grant(r, "risk_owner");
    expect(canDo(permsFromRoles(r), "create_risk")).toBe(true);

    expect(violatesRiskSoD(r, "risk_assessor")).toBe(true);
    r = revoke(r, "risk_owner");
    r = grant(r, "risk_assessor");
    expect(canDo(permsFromRoles(r), "assess_risk")).toBe(true);
    expect(canDo(permsFromRoles(r), "create_risk")).toBe(false);

    r = revoke(r, "risk_assessor");
    r = grant(r, "risk_owner");
    expect(canDo(permsFromRoles(r), "create_risk")).toBe(true);
  });

  it("admin never violates SoD", () => {
    for (const role of ALL_RISK_ROLES) {
      expect(violatesRiskSoD([role], "risk_admin")).toBe(false);
    }
  });

  it("masking without any risk role", () => {
    expect(maskAmount(permsFromRoles([]), 99)).toBe("•••••");
  });

  it("masking unlocked for every risk_* role", () => {
    for (const role of ALL_RISK_ROLES) {
      expect(maskAmount(permsFromRoles([role]), 99)).not.toBe("•••••");
    }
  });

  it("only admin can approve assessment", () => {
    expect(permsFromRoles(["risk_assessor"]).canApprove).toBe(false);
    expect(permsFromRoles(["risk_owner"]).canApprove).toBe(false);
    expect(permsFromRoles(["risk_admin"]).canApprove).toBe(true);
  });

  it("recovery via revoke-first", () => {
    const start: RiskRole[] = ["risk_owner"];
    const fixed = grant(revoke(start, "risk_owner"), "risk_assessor");
    expect(fixed).toEqual(["risk_assessor"]);
  });

  it("admin alone has full perms", () => {
    const p = permsFromRoles(["risk_admin"]);
    expect(Object.values(p).every(Boolean)).toBe(true);
  });
});
