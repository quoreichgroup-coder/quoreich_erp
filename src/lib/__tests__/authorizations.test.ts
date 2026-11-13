import { describe, expect, it } from "vitest";
import { buildAuthorizations, catalogByModule, isLastAdmin } from "../authorizations";

const catalog = [
  { code: "treasury.match", module: "treasury", action: "match", label: "Rapprocher" },
  { code: "crm.view", module: "crm", action: "view", label: "Consulter le CRM" },
  { code: "treasury.export", module: "treasury", action: "export", label: "Exporter" },
];
const view = buildAuthorizations({
  canManage: true,
  catalog,
  roles: [
    { id: "r-tre", name: "Trésorier opérationnel", description: null, code: "treasury_clerk", is_system: true, needs_review: false },
    { id: "r-adm", name: "Administrateur", description: null, code: "admin", is_system: true, needs_review: false },
    { id: "r-cai", name: "Caissier", description: "Encaissements", code: null, is_system: false, needs_review: true },
  ],
  systemRoles: [{ code: "treasury_clerk", module: "treasury" }, { code: "admin", module: "general" }],
  rolePermissions: [{ role_id: "r-cai", permission_code: "treasury.match" }, { role_id: "r-tre", permission_code: "treasury.match" }],
  assignments: [{ user_id: "u1", role_id: "r-adm" }, { user_id: "u2", role_id: "r-cai" }],
  profiles: [{ id: "u2", full_name: "Zoé" }, { id: "u1", full_name: "  " }],
});

describe("matrice des autorisations — vue reconstituée comme l'API", () => {
  it("rôles sur mesure d'abord, puis système par module ; droits et effectifs comptés", () => {
    expect(view.roles.map((r) => r.id)).toEqual(["r-cai", "r-adm", "r-tre"]);
    expect(view.roles[0]).toMatchObject({ system: false, needsReview: true, permissions: ["treasury.match"], memberCount: 1, description: "Encaissements" });
    expect(view.roles[1]).toMatchObject({ code: "admin", memberCount: 1, permissions: [] });
  });

  it("utilisateurs triés par nom, nom vide affiché « Sans nom », avec leurs rôles", () => {
    expect(view.users).toEqual([
      { id: "u1", fullName: "Sans nom", roleIds: ["r-adm"] },
      { id: "u2", fullName: "Zoé", roleIds: ["r-cai"] },
    ]);
  });

  it("catalogue regroupé par module, libellés français", () => {
    expect(catalogByModule(view.catalog).map((g) => [g.label, g.permissions.map((p) => p.code)])).toEqual([
      ["CRM", ["crm.view"]],
      ["Trésorerie", ["treasury.export", "treasury.match"]],
    ]);
  });

  it("dernier administrateur : signalé ; un autre rôle, ou un second administrateur, non", () => {
    expect(isLastAdmin(view, "u1", "r-adm")).toBe(true);
    expect(isLastAdmin(view, "u2", "r-cai")).toBe(false);
    const deux = { ...view, users: [...view.users, { id: "u3", fullName: "Autre", roleIds: ["r-adm"] }] };
    expect(isLastAdmin(deux, "u1", "r-adm")).toBe(false);
  });
});
