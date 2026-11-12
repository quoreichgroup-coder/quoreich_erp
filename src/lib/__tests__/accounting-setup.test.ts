import { describe, expect, it } from "vitest";
import { buildAccountingSetup, missingRoles } from "../accounting-setup";

const roles = [
  { code: "SALES_REVENUE", label: "Ventes", module: "AR", description: "HT" },
  { code: "BANK", label: "Banque", module: "TRE", description: "Banque" },
  { code: "AR_RECEIVABLE", label: "Compte clients", module: "AR", description: "Clients" },
];
const accounts = [
  { id: "acc-411", code: "411", name: "Clients", account_type: "asset", is_active: true },
  { id: "acc-701", code: "701", name: "Ventes de marchandises", account_type: "revenue", is_active: false },
];

describe("paramétrage comptable — reconstitution de la vue de l'API", () => {
  it("trie par module puis rôle, comme l'API, et marque prêt seulement un compte actif", () => {
    const setup = buildAccountingSetup({
      framework: { code: "SYSCOHADA_REVISE", name: "SYSCOHADA révisé", scope: "OHADA", version: "AUDCIF 2017", is_validated: false },
      canEdit: true,
      roles,
      mappings: [
        { role_code: "AR_RECEIVABLE", gl_account_id: "acc-411" },
        { role_code: "SALES_REVENUE", gl_account_id: "acc-701" },
      ],
      accounts,
      defaults: [{ role_code: "SALES_REVENUE", account_code: "701" }],
    });

    expect(setup.roles.map((r) => r.roleCode)).toEqual(["AR_RECEIVABLE", "SALES_REVENUE", "BANK"]);
    expect(setup.roles[0]).toMatchObject({ accountCode: "411", ready: true });
    // Compte inactif : affiché, mais pas prêt — comme posting_account() côté base.
    expect(setup.roles[1]).toMatchObject({ accountCode: "701", ready: false, suggestedAccountCode: "701" });
    expect(setup.roles[2]).toMatchObject({ glAccountId: undefined, ready: false });
    expect(setup.complete).toBe(false);
    expect(setup.framework).toEqual({ code: "SYSCOHADA_REVISE", name: "SYSCOHADA révisé", scope: "OHADA", version: "AUDCIF 2017", validated: false });
    expect(missingRoles(setup).map((r) => r.roleCode)).toEqual(["SALES_REVENUE", "BANK"]);
  });

  it("sans référentiel ni paramétrage : rien n'est prêt, aucun compte n'est inventé", () => {
    const setup = buildAccountingSetup({ framework: null, canEdit: false, roles, mappings: [], accounts: [], defaults: [] });
    expect(setup.framework).toBeUndefined();
    expect(setup.complete).toBe(false);
    expect(setup.roles.every((r) => r.glAccountId === undefined && r.suggestedAccountCode === undefined)).toBe(true);
  });

  it("une correspondance vers un compte invisible (autre société) n'est pas prête", () => {
    const setup = buildAccountingSetup({
      framework: null, canEdit: true, roles: [roles[1]],
      mappings: [{ role_code: "BANK", gl_account_id: "acc-autre-societe" }], accounts, defaults: [],
    });
    expect(setup.roles[0]).toMatchObject({ glAccountId: "acc-autre-societe", accountCode: undefined, ready: false });
  });
});
