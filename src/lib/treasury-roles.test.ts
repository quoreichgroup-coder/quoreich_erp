import { describe, it, expect, beforeEach } from "vitest";
import {
  canDo,
  missingRoleHint,
  maskAmount,
  computeTreasuryPerms,
  permsCacheKey,
  __resetTreasuryPermsCache,
  type TreasuryPerms,
} from "./treasury-roles";

const clerk: TreasuryPerms = {
  canCreateTxn: true, canImportStatement: true, canMatch: true,
  canValidateRecon: false, canEditForecast: false, canManageAccounts: false,
  canExport: false, canViewSensitive: true,
  canClosePeriod: false, canAudit: false,
};
const manager: TreasuryPerms = {
  canCreateTxn: true, canImportStatement: true, canMatch: true,
  canValidateRecon: true, canEditForecast: true, canManageAccounts: true,
  canExport: true, canViewSensitive: true,
  canClosePeriod: true, canAudit: true,
};
const controller: TreasuryPerms = {
  canCreateTxn: false, canImportStatement: false, canMatch: false,
  canValidateRecon: true, canEditForecast: true, canManageAccounts: false,
  canExport: true, canViewSensitive: true,
  canClosePeriod: true, canAudit: true,
};
const outsider: TreasuryPerms = {
  canCreateTxn: false, canImportStatement: false, canMatch: false,
  canValidateRecon: false, canEditForecast: false, canManageAccounts: false,
  canExport: false, canViewSensitive: false,
  canClosePeriod: false, canAudit: false,
};

describe("treasury-roles", () => {
  it("clerk peut saisir mais pas valider rapprochement", () => {
    expect(canDo(clerk, "create_txn")).toBe(true);
    expect(canDo(clerk, "match")).toBe(true);
    expect(canDo(clerk, "validate_recon")).toBe(false);
    expect(canDo(clerk, "export")).toBe(false);
  });

  it("manager a tous les droits", () => {
    (["create_txn","import_statement","match","validate_recon","edit_forecast","manage_accounts","export","view_sensitive"] as const)
      .forEach(a => expect(canDo(manager, a)).toBe(true));
  });

  it("controller supervise mais ne crée pas", () => {
    expect(canDo(controller, "validate_recon")).toBe(true);
    expect(canDo(controller, "export")).toBe(true);
    expect(canDo(controller, "create_txn")).toBe(false);
    expect(canDo(controller, "manage_accounts")).toBe(false);
  });

  it("perms undefined refuse tout", () => {
    expect(canDo(undefined, "create_txn")).toBe(false);
    expect(canDo(undefined, "export")).toBe(false);
    expect(canDo(undefined, "view_sensitive")).toBe(false);
  });

  it("missingRoleHint mentionne les rôles requis", () => {
    expect(missingRoleHint("validate_recon")).toMatch(/Responsable Trésorerie/);
    expect(missingRoleHint("export")).toMatch(/Contrôleur/);
    expect(missingRoleHint("close_period")).toMatch(/Responsable Trésorerie/);
    expect(missingRoleHint("audit")).toMatch(/Contrôleur/);
  });

  it("maskAmount masque pour un utilisateur sans rôle trésorerie", () => {
    expect(maskAmount(outsider, 12345)).toBe("•••••");
    expect(maskAmount(undefined, 12345)).toBe("•••••");
  });

  it("maskAmount affiche pour clerk/manager/controller", () => {
    expect(maskAmount(clerk, 1000)).toMatch(/1[\s\u202f]?000/);
    expect(maskAmount(manager, 1000)).toMatch(/1[\s\u202f]?000/);
    expect(maskAmount(controller, 1000)).toMatch(/1[\s\u202f]?000/);
  });

  it("close_period/audit gated correctement", () => {
    expect(canDo(clerk, "close_period")).toBe(false);
    expect(canDo(clerk, "audit")).toBe(false);
    expect(canDo(manager, "close_period")).toBe(true);
    expect(canDo(controller, "close_period")).toBe(true);
    expect(canDo(controller, "audit")).toBe(true);
    expect(canDo(outsider, "close_period")).toBe(false);
    expect(canDo(undefined, "close_period")).toBe(false);
    expect(canDo(undefined, "audit")).toBe(false);
  });
});

describe("computeTreasuryPerms — memoisation stable", () => {
  beforeEach(() => __resetTreasuryPermsCache());

  const allKeys: (keyof TreasuryPerms)[] = [
    "canCreateTxn","canImportStatement","canMatch","canValidateRecon","canEditForecast",
    "canManageAccounts","canExport","canViewSensitive","canClosePeriod","canAudit",
  ];

  it("retourne la même référence pour des entrées équivalentes (ordre + doublons)", () => {
    const a = computeTreasuryPerms(["treasury_manager", "treasury_clerk"]);
    const b = computeTreasuryPerms(["treasury_clerk", "treasury_manager"]);
    const c = computeTreasuryPerms(["treasury_manager", "treasury_clerk", "treasury_manager"]);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(permsCacheKey(["treasury_manager", "treasury_clerk"])).toBe(
      permsCacheKey(["treasury_clerk", "treasury_manager", "treasury_manager"]),
    );
  });

  it("recompose une nouvelle référence quand l'ensemble change vraiment", () => {
    const a = computeTreasuryPerms(["treasury_clerk"]);
    const b = computeTreasuryPerms(["treasury_manager"]);
    expect(a).not.toBe(b);
    expect(a.canClosePeriod).toBe(false);
    expect(b.canClosePeriod).toBe(true);
  });

  it("garantit que tous les champs TreasuryPerms sont définis (pas d'undefined)", () => {
    const cases = [
      computeTreasuryPerms([]),
      computeTreasuryPerms(["treasury_clerk"]),
      computeTreasuryPerms(["treasury_manager"]),
      computeTreasuryPerms(["treasury_controller"]),
      computeTreasuryPerms(["cash_admin"]),
    ];
    for (const p of cases) {
      for (const k of allKeys) {
        expect(typeof p[k]).toBe("boolean");
      }
    }
  });

  it("cash_admin donne tous les droits", () => {
    const p = computeTreasuryPerms(["cash_admin"]);
    for (const k of allKeys) expect(p[k]).toBe(true);
  });
});
